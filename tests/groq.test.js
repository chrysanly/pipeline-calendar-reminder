// Groq client against a fake fetch: nothing here reaches the real API.

import { test, assert, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import {
  GROQ_URL, GROQ_KEY_STORAGE, GROQ_MODELS, DEFAULT_MODEL, MAX_RETRIES,
  loadGroqKey, saveGroqKey, removeGroqKey, loadGroqModel, saveGroqModel, maskKey,
  retryDelay, chatGroq, testGroqKey, chunkText, chatWorker, minutesSource, minutesChat
} from '../js/groq.js';

const KEY = 'gsk_test_0123456789abcd';

function reply(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => body
  };
}
const answer = content => reply(200, { choices: [{ message: { content } }] });

/** A fetch that plays back `responses` in order and records every call. */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

function recordSleep() {
  const waits = [];
  const sleep = async ms => { waits.push(ms); };
  sleep.waits = waits;
  return sleep;
}

test('the key lives in this browser under cladflo.groq-key.v1, trimmed', () => {
  const store = fakeStorage();
  assertEqual(GROQ_KEY_STORAGE, 'cladflo.groq-key.v1');
  assertEqual(loadGroqKey(store), '');
  saveGroqKey(`  ${KEY} `, store);
  assertEqual(store.getItem('cladflo.groq-key.v1'), KEY);
  assertEqual(loadGroqKey(store), KEY);
  removeGroqKey(store);
  assertEqual(loadGroqKey(store), '');
  for (const bad of ['', '   ', 'gsk with spaces']) {
    let message = '';
    try { saveGroqKey(bad, store); } catch (err) { message = err.message; }
    assert(message, `"${bad}" should be refused`);
  }
});

test('models: llama-3.3-70b-versatile by default, llama-3.1-8b-instant as the option', () => {
  const store = fakeStorage();
  assertDeepEqual(GROQ_MODELS.map(m => m.id), ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']);
  assertEqual(DEFAULT_MODEL, 'llama-3.3-70b-versatile');
  assertEqual(loadGroqModel(store), DEFAULT_MODEL);
  saveGroqModel('llama-3.1-8b-instant', store);
  assertEqual(loadGroqModel(store), 'llama-3.1-8b-instant');
  store.setItem('cladflo.groq-model.v1', 'gone-model');
  assertEqual(loadGroqModel(store), DEFAULT_MODEL);
});

test('maskKey shows only the start and end of the key', () => {
  assertEqual(maskKey(KEY), 'gsk_…abcd');
  assertEqual(maskKey('short'), '•••••');
  assertEqual(maskKey(''), '');
});

test('retryDelay uses retry-after (seconds or a date), else 1s, 2s, 4s… capped at 60s', () => {
  assertEqual(retryDelay(0, '3'), 3000);
  assertEqual(retryDelay(4, '0'), 0);
  assertEqual(retryDelay(0, new Date(10000).toUTCString(), 4000), 6000);
  assertEqual(retryDelay(0, null), 1000);
  assertEqual(retryDelay(2), 4000);
  assertEqual(retryDelay(10), 60000);
  assertEqual(retryDelay(0, '999'), 60000);
});

test('chunkText keeps short text whole and splits long text between lines', () => {
  assertDeepEqual(chunkText('Anna: hi\nOmar: hello'), ['Anna: hi\nOmar: hello']);
  assertDeepEqual(chunkText(''), []);
  const lines = Array.from({ length: 30 }, (_, i) => `Speaker ${i}: ${'word '.repeat(18).trim()}`);
  const chunks = chunkText(lines.join('\n'), 1000);
  assert(chunks.length > 1, 'split');
  assert(chunks.every(c => c.length <= 1000), 'every part fits');
  assertEqual(chunks.join('\n'), lines.join('\n'), 'nothing lost or reordered');
  assert(chunks.every(c => /^Speaker \d+:/.test(c)), 'each part starts at a speaker turn');
});

test('chunkText breaks a single overlong line at a space', () => {
  const long = Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ');
  const chunks = chunkText(long, 500);
  assert(chunks.every(c => c.length <= 500), 'fits');
  assertEqual(chunks.join(' '), long);
});

const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

later('chatGroq posts to the Groq endpoint with the key, model and messages', async () => {
  const fetch = fakeFetch([answer('Hello')]);
  const messages = [{ role: 'user', content: 'Hi' }];
  const text = await chatGroq({ key: KEY, model: 'llama-3.1-8b-instant', messages, json: true, fetch });
  assertEqual(text, 'Hello');
  assertEqual(fetch.calls.length, 1);
  assertEqual(fetch.calls[0].url, GROQ_URL);
  assertEqual(GROQ_URL, 'https://api.groq.com/openai/v1/chat/completions');
  assertEqual(fetch.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assertEqual(fetch.calls[0].body.model, 'llama-3.1-8b-instant');
  assertDeepEqual(fetch.calls[0].body.messages, messages);
  assertDeepEqual(fetch.calls[0].body.response_format, { type: 'json_object' });
});

later('chatGroq retries a 429 using retry-after, then succeeds', async () => {
  const fetch = fakeFetch([reply(429, {}, { 'retry-after': '2' }), answer('OK')]);
  const sleep = recordSleep();
  assertEqual(await chatGroq({ key: KEY, messages: [], fetch, sleep }), 'OK');
  assertEqual(fetch.calls.length, 2);
  assertDeepEqual(sleep.waits, [2000]);
});

later('chatGroq retries 5xx and network errors with backoff', async () => {
  const fetch = fakeFetch([reply(503, {}), new TypeError('offline'), reply(500, {}), answer('OK')]);
  const sleep = recordSleep();
  assertEqual(await chatGroq({ key: KEY, messages: [], fetch, sleep }), 'OK');
  assertDeepEqual(sleep.waits, [1000, 2000, 4000]);
});

later('chatGroq gives up after 5 retries with a clear message', async () => {
  assertEqual(MAX_RETRIES, 5);
  const fetch = fakeFetch(Array.from({ length: 6 }, () => reply(429, { error: { message: 'Rate limit reached' } })));
  const sleep = recordSleep();
  let error = null;
  try { await chatGroq({ key: KEY, messages: [], fetch, sleep }); } catch (err) { error = err; }
  assertEqual(fetch.calls.length, 6, '1 try + 5 retries');
  assertEqual(sleep.waits.length, 5);
  assertEqual(error.status, 429);
  assert(/busy|limit/i.test(error.message) && /Rate limit reached/.test(error.message), error.message);
});

later('a 401 is "Key not valid" at once, with no retry and no key in the message', async () => {
  const fetch = fakeFetch([reply(401, { error: { message: `Invalid API Key ${KEY}` } })]);
  let error = null;
  try { await chatGroq({ key: KEY, messages: [], fetch, sleep: recordSleep() }); } catch (err) { error = err; }
  assertEqual(fetch.calls.length, 1);
  assertEqual(error.status, 401);
  assert(/Key not valid/.test(error.message), error.message);
  assert(!error.message.includes(KEY), 'the key never appears in an error');
});

later('other errors are not retried and carry Groq\'s reason', async () => {
  const fetch = fakeFetch([reply(400, { error: { message: 'model not found' } })]);
  let error = null;
  try { await chatGroq({ key: KEY, messages: [], fetch, sleep: recordSleep() }); } catch (err) { error = err; }
  assertEqual(fetch.calls.length, 1);
  assert(/400/.test(error.message) && /model not found/.test(error.message), error.message);
});

later('no key: chatGroq refuses before any request', async () => {
  const fetch = fakeFetch([]);
  let error = null;
  try { await chatGroq({ key: '', messages: [], fetch }); } catch (err) { error = err; }
  assertEqual(fetch.calls.length, 0);
  assert(/AI settings/.test(error.message), error.message);
});

later('testGroqKey resolves for a working key', async () => {
  const fetch = fakeFetch([answer('OK')]);
  assertEqual(await testGroqKey({ key: KEY, fetch }), true);
});

// ---------- Minutes through the CladFlo Worker ----------

const WORKER = 'https://cladflo.example.workers.dev/';
const workerAnswer = content => reply(200, { content });
const noSleep = async () => {};

test('minutesSource: an own key wins, else the Worker URL, else nothing', () => {
  assertEqual(minutesSource({ key: KEY, workerUrl: WORKER }), 'key');
  assertEqual(minutesSource({ key: '', workerUrl: WORKER }), 'worker');
  assertEqual(minutesSource({ key: ' ', workerUrl: ' ' }), '');
  assertEqual(minutesSource({}), '');
});

later('chatWorker posts the model, messages and JSON flag to /ai/chat with the ID token', async () => {
  const calls = [];
  const content = await chatWorker({
    workerUrl: WORKER, auth: { idToken: 'id-token' }, model: 'llama-3.1-8b-instant', json: true,
    messages: [{ role: 'user', content: 'hi' }],
    fetch: async (url, init) => { calls.push({ url, init }); return workerAnswer('{"ok":true}'); }
  });
  assertEqual(content, '{"ok":true}');
  assertEqual(calls[0].url, 'https://cladflo.example.workers.dev/ai/chat');
  assertEqual(calls[0].init.headers.Authorization, 'Bearer id-token');
  assertDeepEqual(JSON.parse(calls[0].init.body), { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'hi' }], json: true });
  assert(!JSON.stringify(calls[0].init).includes('gsk_'), 'no Groq key leaves the browser');
});

later('chatWorker uses the app token in local mode and refuses with no auth or no URL before any request', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push(init); return workerAnswer('ok'); };
  await chatWorker({ workerUrl: WORKER, auth: { appToken: 'local-token' }, messages: [], fetch });
  assertEqual(calls[0].headers['X-App-Token'], 'local-token');
  assertEqual(calls[0].headers.Authorization, undefined);
  const failures = [];
  for (const options of [{ workerUrl: WORKER, auth: {} }, { workerUrl: '', auth: { idToken: 't' } }]) {
    try { await chatWorker({ ...options, messages: [], fetch }); } catch (err) { failures.push([err.status, err.message]); }
  }
  assertDeepEqual(failures, [
    [401, 'Sign in to use the CladFlo Worker, or add your own Groq key in AI settings.'],
    [0, 'Set the Worker URL in Settings → Business first.']
  ]);
  assertEqual(calls.length, 1);
});

later('chatWorker retries a busy Worker, shows its 403 reason at once, and gives up when unreachable', async () => {
  const replies = [reply(429, { error: 'Too many requests.' }, { 'retry-after': '2' }), workerAnswer('done')];
  const waits = [];
  const ok = await chatWorker({ workerUrl: WORKER, auth: { idToken: 't' }, messages: [], fetch: async () => replies.shift(), sleep: async ms => { waits.push(ms); } });
  assertEqual(ok, 'done');
  assertDeepEqual(waits, [2000]);

  let refused = null;
  let tries = 0;
  const reason = 'This account may not use the CladFlo Worker. Ask the owner to add your email.';
  try {
    await chatWorker({ workerUrl: WORKER, auth: { idToken: 't' }, messages: [], sleep: noSleep, fetch: async () => { tries++; return reply(403, { error: reason }); } });
  } catch (err) { refused = err; }
  assertEqual(refused.status, 403);
  assertEqual(refused.message, reason);
  assertEqual(tries, 1, 'a refusal is not retried');

  let offline = '';
  try {
    await chatWorker({ workerUrl: WORKER, auth: { idToken: 't' }, messages: [], sleep: noSleep, retries: 1, fetch: async () => { throw new Error('offline'); } });
  } catch (err) { offline = err.message; }
  assertEqual(offline, 'Could not reach the CladFlo Worker. Check the Worker URL and your connection.');

  let empty = '';
  try { await chatWorker({ workerUrl: WORKER, auth: { idToken: 't' }, messages: [], fetch: async () => reply(200, {}) }); } catch (err) { empty = err.message; }
  assertEqual(empty, 'The CladFlo Worker sent an empty reply.');
});

later('minutesChat: an own key goes straight to Groq; without one the Worker is used', async () => {
  const urls = [];
  const fetch = async url => { urls.push(url); return url === GROQ_URL ? answer('from groq') : workerAnswer('from worker'); };
  const own = minutesChat({ key: KEY, workerUrl: WORKER, auth: { idToken: 't' }, fetch });
  assertEqual(await own([{ role: 'user', content: 'x' }], { json: true }), 'from groq');
  const viaWorker = minutesChat({ key: '', workerUrl: WORKER, auth: { idToken: 't' }, model: 'llama-3.1-8b-instant', fetch });
  assertEqual(await viaWorker([{ role: 'user', content: 'x' }]), 'from worker');
  assertDeepEqual(urls, [GROQ_URL, 'https://cladflo.example.workers.dev/ai/chat']);
});

export const groqTestsDone = Promise.all(pending);
