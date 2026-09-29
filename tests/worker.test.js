// worker/src/index.js: origin and token checks, rate limit and the four
// routes (and the ALLOWED_EMAILS lock), with Google's keys, Groq and Resend
// faked. Node-only.

import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  handle, verifyFirebaseToken, resetKeyCache, resetRateLimits, checkRateLimit, normalizeActionReply,
  allowedOrigins, allowedEmails, MAX_TEXT_CHARS, AUDIO_MODEL, CHAT_MODELS, MAX_CHAT_MESSAGES, MAX_CHAT_CHARS
} from '../worker/src/index.js';

const ORIGIN = 'https://app.example.com';
const PROJECT = 'demo-project';
const NOW = Date.UTC(2026, 8, 29, 8, 0, 0);
const ENV = {
  ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:8000/`,
  FIREBASE_PROJECT_ID: PROJECT,
  APP_TOKEN: 'local-token-123',
  GROQ_API_KEY: 'gsk_test',
  RESEND_API_KEY: 're_test',
  NOTIFY_FROM: 'CladFlo <alerts@example.com>',
  NOTIFY_TO: 'owner@example.com',
  RATE_LIMIT_PER_MINUTE: '3',
  ALLOWED_EMAILS: 'owner@example.com,\n Teammate@Example.com'
};

// ---------- a signing key standing in for Google's ----------

const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' };
const b64url = bytes => Buffer.from(bytes).toString('base64url');

async function makeToken(overrides = {}, header = { alg: 'RS256', kid: 'key-1', typ: 'JWT' }) {
  const seconds = Math.floor(NOW / 1000);
  const claims = { aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'user-1', email: 'owner@example.com', email_verified: true, iat: seconds - 60, exp: seconds + 3000, ...overrides };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

/** Fake upstreams; `calls` records every request the Worker makes. */
function fakeFetch({ groq = { summary: 'Agreed scope.', actionItems: [{ task: 'Send proposal', owner: 'Anna', due: '2026-10-01' }] }, groqStatus = 200, resendStatus = 200, whisper = 'Hello from the meeting.' } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('googleapis.com')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { 'Cache-Control': 'public, max-age=600' } });
    }
    if (String(url).endsWith('/chat/completions')) {
      if (groqStatus !== 200) return new Response('{}', { status: groqStatus, headers: { 'Retry-After': '30' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(groq) } }] }));
    }
    if (String(url).endsWith('/audio/transcriptions')) return new Response(JSON.stringify({ text: whisper }));
    if (String(url).includes('resend.com')) return new Response('{}', { status: resendStatus });
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, calls };
}

function request(path, { method = 'POST', origin = ORIGIN, token, appToken, body, form } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (appToken) headers['X-App-Token'] = appToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://worker.example.dev${path}`, {
    method, headers, body: form || (body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))
  });
}

async function call(req, { env = ENV, fake = fakeFetch(), now = NOW } = {}) {
  const res = await handle(req, env, { fetchImpl: fake.fetchImpl, now });
  const text = await res.text();
  return { status: res.status, headers: res.headers, data: text ? JSON.parse(text) : null, calls: fake.calls };
}

// One after another: the tests share the Worker's rate-limit and key caches.
let chain = Promise.resolve();
const later = (name, fn) => { chain = chain.then(() => fn().then(() => test(name, () => {}), err => test(name, () => { throw err; }))); };
const fresh = () => { resetRateLimits(); resetKeyCache(); };

// ---------- origin and preflight ----------

test('allowedOrigins trims spaces and trailing slashes', () => {
  assertDeepEqual(allowedOrigins(ENV), [ORIGIN, 'http://localhost:8000']);
  assertDeepEqual(allowedOrigins({}), []);
});

later('other origins, or none, get 403 before anything else happens', async () => {
  fresh();
  for (const origin of ['https://evil.example.com', '']) {
    const res = await call(request('/ai/actions', { origin, appToken: ENV.APP_TOKEN, body: { text: 'x' } }));
    assertEqual(res.status, 403);
    assertEqual(res.headers.get('Access-Control-Allow-Origin'), null);
    assertEqual(res.calls.length, 0);
  }
});

later('a preflight from an allowed origin gets the CORS headers', async () => {
  fresh();
  const res = await call(request('/ai/actions', { method: 'OPTIONS' }));
  assertEqual(res.status, 204);
  assertEqual(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert(res.headers.get('Access-Control-Allow-Headers').includes('X-App-Token'));
});

later('unknown paths are 404 and GET is 405, both with CORS', async () => {
  fresh();
  const missing = await call(request('/nope', { appToken: ENV.APP_TOKEN, body: {} }));
  assertEqual(missing.status, 404);
  assertEqual(missing.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assertEqual((await call(request('/ai/actions', { method: 'GET' }))).status, 405);
});

// ---------- auth ----------

later('no token, a wrong app token, or a bad Firebase token: 401 and no upstream call', async () => {
  fresh();
  const cases = [
    {},
    { appToken: 'wrong' },
    { token: 'not.a.jwt' },
    { token: await makeToken({ aud: 'other-project' }) },
    { token: await makeToken({ iss: 'https://evil.example.com' }) },
    { token: await makeToken({ exp: Math.floor(NOW / 1000) - 1 }) },
    { token: await makeToken({ sub: '' }) },
    { token: await makeToken({}, { alg: 'HS256', kid: 'key-1' }) },
    { token: await makeToken({}, { alg: 'RS256', kid: 'unknown' }) }
  ];
  for (const auth of cases) {
    const res = await call(request('/ai/actions', { ...auth, body: { text: 'notes' } }));
    assertEqual(res.status, 401, JSON.stringify(auth).slice(0, 60));
    assert(!res.calls.some(c => c.url.includes('groq')), 'Groq called without auth');
  }
});

later('a tampered token fails the signature check', async () => {
  fresh();
  const [h, , s] = (await makeToken()).split('.');
  const forged = `${h}.${b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'admin', iat: 0, exp: 9e9 }))}.${s}`;
  let message = '';
  try {
    await verifyFirebaseToken(forged, PROJECT, { fetchImpl: fakeFetch().fetchImpl, now: NOW });
  } catch (err) {
    message = err.message;
  }
  assertEqual(message, 'Sign in again.');
});

later('a valid Firebase token names the user; Google\'s keys are fetched once and cached', async () => {
  fresh();
  const fake = fakeFetch();
  const token = await makeToken();
  assertEqual(await verifyFirebaseToken(token, PROJECT, { fetchImpl: fake.fetchImpl, now: NOW }), 'user-1');
  assertEqual(await verifyFirebaseToken(token, PROJECT, { fetchImpl: fake.fetchImpl, now: NOW + 1000 }), 'user-1');
  assertEqual(fake.calls.filter(c => c.url.includes('googleapis')).length, 1);
});

// ---------- email allow-list ----------

test('allowedEmails splits on commas, spaces and new lines, lower case; blank is an empty list', () => {
  assertDeepEqual(allowedEmails(ENV), ['owner@example.com', 'teammate@example.com']);
  assertDeepEqual(allowedEmails({ ALLOWED_EMAILS: ' a@x.com; b@x.com c@x.com ' }), ['a@x.com', 'b@x.com', 'c@x.com']);
  assertDeepEqual(allowedEmails({}), []);
});

later('signed in: only a verified email on ALLOWED_EMAILS gets through, in any case', async () => {
  fresh();
  const ok = await call(request('/ai/actions', { token: await makeToken({ email: 'TEAMMATE@example.com', sub: 'user-2' }), body: { text: 'n' } }));
  assertEqual(ok.status, 200);
  const refused = [
    { email: 'stranger@example.com' },
    { email_verified: false },
    { email_verified: 'true' },
    { email: '' }
  ];
  for (const claims of refused) {
    resetRateLimits();
    const res = await call(request('/ai/actions', { token: await makeToken(claims), body: { text: 'n' } }));
    assertEqual(res.status, 403, JSON.stringify(claims));
    assertEqual(res.data.error, 'This account may not use the CladFlo Worker. Ask the owner to add your email.');
    assertEqual(res.headers.get('Access-Control-Allow-Origin'), ORIGIN, 'the app can read the reason');
    assert(!res.calls.some(c => c.url.includes('groq')), 'Groq called for a refused account');
  }
});

later('an empty ALLOWED_EMAILS lets no signed-in account in; the app token still works', async () => {
  fresh();
  const env = { ...ENV, ALLOWED_EMAILS: ' ' };
  const signedIn = await call(request('/ai/actions', { token: await makeToken(), body: { text: 'n' } }), { env });
  assertEqual(signedIn.status, 403);
  assertEqual(signedIn.data.error, 'The Worker has no ALLOWED_EMAILS yet, so no account may use it.');
  const local = await call(request('/ai/actions', { appToken: ENV.APP_TOKEN, body: { text: 'n' } }), { env: { ...ENV, ALLOWED_EMAILS: undefined } });
  assertEqual(local.status, 200);
});

// ---------- rate limit ----------

test('checkRateLimit: N a minute per caller, then 429 with Retry-After; a new minute starts over', () => {
  resetRateLimits();
  for (let i = 0; i < 3; i++) checkRateLimit('a', 3, NOW);
  let error = null;
  try { checkRateLimit('a', 3, NOW + 15000); } catch (err) { error = err; }
  assertEqual(error.status, 429);
  assertEqual(error.headers['Retry-After'], '45');
  checkRateLimit('b', 3, NOW); // another caller is unaffected
  checkRateLimit('a', 3, NOW + 60000);
});

later('the fourth request in a minute gets 429', async () => {
  fresh();
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await call(request('/ai/actions', { appToken: ENV.APP_TOKEN, body: { text: 'notes' } }))).status);
  assertDeepEqual(statuses, [200, 200, 200, 429]);
});

// ---------- routes ----------

later('/ai/actions sends the notes to Groq with the key and returns clean action items', async () => {
  fresh();
  const fake = fakeFetch({ groq: { summary: ' Agreed. ', actionItems: [{ task: ' Send proposal ', owner: 'Anna', due: '2026-10-01' }, { task: '' }, 'junk'] } });
  const res = await call(request('/ai/actions', { token: await makeToken(), body: { text: 'We agreed Anna sends the proposal.', client: 'Acme' } }), { fake });
  assertEqual(res.status, 200);
  assertDeepEqual(res.data, { summary: 'Agreed.', actionItems: [{ task: 'Send proposal', owner: 'Anna', due: '2026-10-01' }] });
  const groq = res.calls.find(c => c.url.includes('chat/completions'));
  assertEqual(groq.init.headers.Authorization, 'Bearer gsk_test');
  const sent = JSON.parse(groq.init.body);
  assert(sent.messages[1].content.includes('Client: Acme'));
  assertEqual(sent.response_format.type, 'json_object');
  assertEqual(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

later('/ai/actions checks the body and the text length', async () => {
  fresh();
  const bad = [
    [request('/ai/actions', { appToken: ENV.APP_TOKEN, body: '{broken' }), 400],
    [request('/ai/actions', { appToken: ENV.APP_TOKEN, body: { text: '  ' } }), 400]
  ];
  for (const [req, status] of bad) assertEqual((await call(req)).status, status);
  resetRateLimits();
  assertEqual((await call(request('/ai/actions', { appToken: ENV.APP_TOKEN, body: { text: 'x'.repeat(MAX_TEXT_CHARS + 1) } }))).status, 413);
});

later('Groq busy or broken: 429 with Retry-After, or 502', async () => {
  fresh();
  const busy = await call(request('/ai/actions', { appToken: ENV.APP_TOKEN, body: { text: 'n' } }), { fake: fakeFetch({ groqStatus: 429 }) });
  assertEqual(busy.status, 429);
  assertEqual(busy.headers.get('Retry-After'), '30');
  const broken = await call(request('/ai/actions', { appToken: ENV.APP_TOKEN, body: { text: 'n' } }), { fake: fakeFetch({ groqStatus: 500 }) });
  assertEqual(broken.status, 502);
  const noKey = await call(request('/ai/actions', { appToken: ENV.APP_TOKEN, body: { text: 'n' } }), { env: { ...ENV, GROQ_API_KEY: '' } });
  assertEqual(noKey.status, 503);
});

later('/ai/followup returns a subject and body in the chosen tone', async () => {
  fresh();
  const fake = fakeFetch({ groq: { subject: 'Thanks for today', body: 'Hi Anna,\n\nThanks for the meeting.' } });
  const res = await call(request('/ai/followup', {
    appToken: ENV.APP_TOKEN, body: { text: 'Kickoff went well', client: 'Acme', tone: 'formal', actionItems: [{ task: 'Send proposal', owner: 'Anna' }] }
  }), { fake });
  assertDeepEqual(res.data, { subject: 'Thanks for today', body: 'Hi Anna,\n\nThanks for the meeting.' });
  const sent = JSON.parse(fake.calls.find(c => c.url.includes('chat')).init.body);
  assert(sent.messages[0].content.includes('formal'));
  assert(sent.messages[1].content.includes('- Send proposal (Anna)'));
  resetRateLimits();
  const empty = await call(request('/ai/followup', { appToken: ENV.APP_TOKEN, body: { text: 'x' } }), { fake: fakeFetch({ groq: { subject: '', body: '' } }) });
  assertEqual(empty.status, 502);
});

later('/ai/transcribe forwards the audio to Whisper and returns the text; non-audio is refused', async () => {
  fresh();
  const fake = fakeFetch();
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(1000)], { type: 'audio/webm' }), 'meeting.webm');
  const res = await call(request('/ai/transcribe', { appToken: ENV.APP_TOKEN, form }), { fake });
  assertEqual(res.status, 200);
  assertDeepEqual(res.data, { text: 'Hello from the meeting.' });
  const upstream = fake.calls.find(c => c.url.includes('audio'));
  assertEqual(upstream.init.body.get('model'), AUDIO_MODEL);
  assertEqual(upstream.init.body.get('file').name, 'meeting.webm');

  const text = new FormData();
  text.append('file', new Blob(['hi'], { type: 'text/plain' }), 'notes.txt');
  assertEqual((await call(request('/ai/transcribe', { appToken: ENV.APP_TOKEN, form: text }))).status, 415);
  const none = new FormData();
  assertEqual((await call(request('/ai/transcribe', { appToken: ENV.APP_TOKEN, form: none }))).status, 400);
});

later('/notify emails only NOTIFY_TO, never an address from the request', async () => {
  fresh();
  const fake = fakeFetch();
  const res = await call(request('/notify', { appToken: ENV.APP_TOKEN, body: { subject: 'Acme is now Active', text: 'Lead → Active', to: 'victim@example.com' } }), { fake });
  assertEqual(res.status, 202);
  const email = JSON.parse(fake.calls.find(c => c.url.includes('resend')).init.body);
  assertDeepEqual(email.to, ['owner@example.com']);
  assertEqual(email.subject, '[CladFlo] Acme is now Active');
  assertEqual(email.from, ENV.NOTIFY_FROM);
  resetRateLimits();
  assertEqual((await call(request('/notify', { appToken: ENV.APP_TOKEN, body: { subject: 'x' } }))).status, 400);
  assertEqual((await call(request('/notify', { appToken: ENV.APP_TOKEN, body: { subject: 'x', text: 'y' } }), { env: { ...ENV, RESEND_API_KEY: '' } })).status, 503);
  assertEqual((await call(request('/notify', { appToken: ENV.APP_TOKEN, body: { subject: 'x', text: 'y' } }), { fake: fakeFetch({ resendStatus: 500 }) })).status, 502);
});

// ---------- /ai/chat (Minutes) ----------

const chatBody = (extra = {}) => ({ model: 'llama-3.1-8b-instant', json: true, messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'Anna: hi' }], ...extra });

later('/ai/chat sends the model, messages and JSON mode with the Worker key and returns the reply text', async () => {
  fresh();
  const fake = fakeFetch({ groq: { title: 'Kickoff' } });
  const res = await call(request('/ai/chat', { token: await makeToken(), body: chatBody() }), { fake });
  assertEqual(res.status, 200);
  assertDeepEqual(res.data, { content: '{"title":"Kickoff"}' });
  const groq = fake.calls.find(c => c.url.includes('chat/completions'));
  assertEqual(groq.init.headers.Authorization, 'Bearer gsk_test');
  const sent = JSON.parse(groq.init.body);
  assertEqual(sent.model, 'llama-3.1-8b-instant');
  assertDeepEqual(sent.messages, chatBody().messages);
  assertEqual(sent.response_format.type, 'json_object');

  resetRateLimits();
  const plain = fakeFetch();
  await call(request('/ai/chat', { appToken: ENV.APP_TOKEN, body: chatBody({ json: false, model: undefined }) }), { fake: plain });
  const plainSent = JSON.parse(plain.calls.find(c => c.url.includes('chat/completions')).init.body);
  assertEqual(plainSent.response_format, undefined);
  assertEqual(plainSent.model, CHAT_MODELS[0], 'no model: the default Llama 3.3 70B');
});

later('/ai/chat takes only the two Llama models, plain messages and capped sizes; nothing reaches Groq otherwise', async () => {
  fresh();
  assertDeepEqual(CHAT_MODELS, ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']);
  const cases = [
    [chatBody({ model: 'gpt-4o' }), 400],
    [chatBody({ messages: [] }), 400],
    [chatBody({ messages: [{ role: 'tool', content: 'x' }] }), 400],
    [chatBody({ messages: [{ role: 'user', content: { text: 'x' } }] }), 400],
    [chatBody({ messages: Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' })) }), 413],
    [chatBody({ messages: [{ role: 'user', content: 'x'.repeat(MAX_CHAT_CHARS + 1) }] }), 413]
  ];
  for (const [body, status] of cases) {
    resetRateLimits();
    const res = await call(request('/ai/chat', { appToken: ENV.APP_TOKEN, body }));
    assertEqual(res.status, status, JSON.stringify(body).slice(0, 80));
    assert(!res.calls.some(c => c.url.includes('groq')), 'Groq called for a bad body');
  }
  resetRateLimits();
  assertEqual((await call(request('/ai/chat', { appToken: ENV.APP_TOKEN, body: chatBody({ messages: [{ role: 'user', content: 'x'.repeat(MAX_CHAT_CHARS) }] }) }))).status, 200);
});

later('/ai/chat shares the rate limit and passes on a busy Groq as 429', async () => {
  fresh();
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await call(request('/ai/chat', { appToken: ENV.APP_TOKEN, body: chatBody() }))).status);
  assertDeepEqual(statuses, [200, 200, 200, 429]);
  resetRateLimits();
  const busy = await call(request('/ai/chat', { appToken: ENV.APP_TOKEN, body: chatBody() }), { fake: fakeFetch({ groqStatus: 429 }) });
  assertEqual(busy.status, 429);
  assertEqual(busy.headers.get('Retry-After'), '30');
});

test('normalizeActionReply keeps only tasks, trimmed and capped', () => {
  assertDeepEqual(normalizeActionReply(null), { summary: '', actionItems: [] });
  const many = normalizeActionReply({ actionItems: Array.from({ length: 60 }, (_, i) => ({ task: `t${i}` })) });
  assertEqual(many.actionItems.length, 50);
});

export const workerTestsDone = Promise.resolve().then(() => chain);
