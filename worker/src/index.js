// CladFlo Worker (Cloudflare): the server side of the AI and email features,
// so the Groq and Resend keys never reach a browser.
//
//   POST /ai/actions     {text, client}            → {summary, actionItems: [{task, owner, due}]}
//   POST /ai/followup    {client, text, actionItems, tone} → {subject, body}
//   POST /ai/transcribe  multipart "file" (audio)  → {text}
//   POST /notify         {subject, text}           → 202, email to NOTIFY_TO only
//
// Every request must come from an allowed origin (ALLOWED_ORIGINS) and carry
// either a Firebase ID token (Authorization: Bearer, verified against Google's
// keys for FIREBASE_PROJECT_ID) or the shared X-App-Token (APP_TOKEN, for
// local mode). Each caller gets RATE_LIMIT_PER_MINUTE requests a minute.
// Secrets (wrangler secret put): GROQ_API_KEY, APP_TOKEN, RESEND_API_KEY.

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const RESEND_URL = 'https://api.resend.com/emails';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export const CHAT_MODEL = 'llama-3.3-70b-versatile';
export const AUDIO_MODEL = 'whisper-large-v3-turbo';
export const MAX_TEXT_CHARS = 30000;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // Groq's limit on the free tier
const DEFAULT_RATE_LIMIT = 20;

// ---------- responses ----------

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-App-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

// ---------- origin ----------

export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
}

// ---------- auth ----------

const b64urlBytes = text => {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
};
const b64urlJson = text => JSON.parse(new TextDecoder().decode(b64urlBytes(text)));

let jwksCache = { keys: null, until: 0 };

async function googleKeys(fetchImpl, now) {
  if (jwksCache.keys && jwksCache.until > now) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new HttpError(503, 'Could not check the sign-in right now. Try again.');
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('Cache-Control') || '') || [])[1] || 3600);
  const { keys } = await res.json();
  jwksCache = { keys, until: now + maxAge * 1000 };
  return keys;
}

/** For tests: forget the cached Google keys. */
export function resetKeyCache() {
  jwksCache = { keys: null, until: 0 };
}

/**
 * A Firebase ID token's user id, after checking its signature (RS256 with one
 * of Google's current keys), audience, issuer and times. Throws 401 otherwise.
 */
export async function verifyFirebaseToken(token, projectId, { fetchImpl = fetch, now = Date.now() } = {}) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || !projectId) throw new HttpError(401, 'Sign in again.');
  let header;
  let claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch (err) {
    throw new HttpError(401, 'Sign in again.');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'Sign in again.');
  const jwk = (await googleKeys(fetchImpl, now)).find(k => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Sign in again.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), signed);
  const seconds = Math.floor(now / 1000);
  if (!valid ||
    claims.aud !== projectId ||
    claims.iss !== `https://securetoken.google.com/${projectId}` ||
    !claims.sub ||
    !(claims.exp > seconds) ||
    !(claims.iat <= seconds + 60)) {
    throw new HttpError(401, 'Sign in again.');
  }
  return claims.sub;
}

/** Constant-time comparison, so the app token can't be guessed byte by byte. */
function sameSecret(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Who is calling: 'uid:<uid>' or 'token'. Throws 401. */
async function identify(request, env, deps) {
  const bearer = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (bearer) return `uid:${await verifyFirebaseToken(bearer[1].trim(), env.FIREBASE_PROJECT_ID, deps)}`;
  const appToken = request.headers.get('X-App-Token');
  if (appToken && env.APP_TOKEN && sameSecret(appToken, env.APP_TOKEN)) return 'token';
  throw new HttpError(401, 'Sign in, or enter the Worker access token in the AI panel.');
}

// ---------- rate limit (per Worker instance, fixed one-minute window) ----------

const windows = new Map();

export function resetRateLimits() {
  windows.clear();
}

export function checkRateLimit(caller, limit, now = Date.now()) {
  const minute = Math.floor(now / 60000);
  const entry = windows.get(caller);
  if (!entry || entry.minute !== minute) {
    windows.set(caller, { minute, count: 1 });
    if (windows.size > 5000) for (const [key, value] of windows) if (value.minute !== minute) windows.delete(key);
    return;
  }
  entry.count += 1;
  if (entry.count > limit) {
    const retry = Math.max(1, Math.ceil(((minute + 1) * 60000 - now) / 1000));
    throw new HttpError(429, `Too many requests. Try again in ${retry} s.`, { 'Retry-After': String(retry) });
  }
}

// ---------- Groq ----------

async function groqChat(env, deps, messages) {
  if (!env.GROQ_API_KEY) throw new HttpError(503, 'The Worker has no GROQ_API_KEY yet.');
  const res = await deps.fetchImpl(GROQ_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, messages })
  });
  if (res.status === 429) throw new HttpError(429, 'The AI is busy. Try again in a minute.', { 'Retry-After': res.headers.get('Retry-After') || '60' });
  if (!res.ok) throw new HttpError(502, `The AI failed (${res.status}). Try again.`);
  const data = await res.json();
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch (err) {
    throw new HttpError(502, 'The AI sent an unreadable answer. Try again.');
  }
}

const clean = (value, max = 500) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function normalizeActionReply(reply) {
  const items = Array.isArray(reply && reply.actionItems) ? reply.actionItems : [];
  return {
    summary: clean(reply && reply.summary, 2000),
    actionItems: items
      .map(item => ({ task: clean(item && item.task, 300), owner: clean(item && item.owner, 80), due: clean(item && item.due, 20) }))
      .filter(item => item.task)
      .slice(0, 50)
  };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (err) {
    throw new HttpError(400, 'Send a JSON body.');
  }
}

function requireText(body) {
  const text = clean(body.text, MAX_TEXT_CHARS + 1);
  if (!text) throw new HttpError(400, 'Send the notes or transcript as "text".');
  if (text.length > MAX_TEXT_CHARS) throw new HttpError(413, `Keep the text under ${MAX_TEXT_CHARS} characters.`);
  return text;
}

async function aiActions(request, env, deps) {
  const body = await readJson(request);
  const text = requireText(body);
  const client = clean(body.client, 120);
  const reply = await groqChat(env, deps, [
    {
      role: 'system',
      content: 'You turn meeting notes into action items for a small business. Reply with JSON only: ' +
        '{"summary": "two or three sentences", "actionItems": [{"task": "...", "owner": "name or empty", "due": "YYYY-MM-DD or empty"}]}. ' +
        'Only include tasks that are clearly agreed in the notes. Never invent owners or dates.'
    },
    { role: 'user', content: `Client: ${client || 'unknown'}\n\nNotes:\n${text}` }
  ]);
  return json(normalizeActionReply(reply));
}

export const TONES = ['friendly', 'formal', 'brief'];

async function aiFollowup(request, env, deps) {
  const body = await readJson(request);
  const text = requireText(body);
  const client = clean(body.client, 120);
  const tone = TONES.includes(body.tone) ? body.tone : 'friendly';
  const actions = normalizeActionReply({ actionItems: body.actionItems }).actionItems
    .map(a => `- ${a.task}${a.owner ? ` (${a.owner})` : ''}${a.due ? `, due ${a.due}` : ''}`).join('\n');
  const reply = await groqChat(env, deps, [
    {
      role: 'system',
      content: `You write ${tone} follow-up emails after client meetings. Reply with JSON only: {"subject": "...", "body": "..."}. ` +
        'Plain text body, no markdown, no placeholders like [Name]; sign off without a name.'
    },
    { role: 'user', content: `Client: ${client || 'the client'}\n\nWhat was discussed:\n${text}${actions ? `\n\nAgreed next steps:\n${actions}` : ''}` }
  ]);
  const subject = clean(reply.subject, 200);
  const emailBody = clean(reply.body, 8000);
  if (!subject || !emailBody) throw new HttpError(502, 'The AI sent an empty email. Try again.');
  return json({ subject, body: emailBody });
}

async function aiTranscribe(request, env, deps) {
  if (!env.GROQ_API_KEY) throw new HttpError(503, 'The Worker has no GROQ_API_KEY yet.');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_AUDIO_BYTES + 1024 * 64) {
    throw new HttpError(413, 'Audio must be 25 MB or less.');
  }
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    throw new HttpError(400, 'Send the audio as a form upload named "file".');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') throw new HttpError(400, 'Send the audio as a form upload named "file".');
  if (file.size > MAX_AUDIO_BYTES) throw new HttpError(413, 'Audio must be 25 MB or less.');
  if (!/^(audio|video)\//.test(file.type || '')) throw new HttpError(415, 'That is not an audio file.');
  const upstream = new FormData();
  upstream.append('file', file, file.name || 'audio.webm');
  upstream.append('model', AUDIO_MODEL);
  upstream.append('response_format', 'json');
  const res = await deps.fetchImpl(GROQ_AUDIO_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: upstream
  });
  if (res.status === 429) throw new HttpError(429, 'The AI is busy. Try again in a minute.', { 'Retry-After': res.headers.get('Retry-After') || '60' });
  if (!res.ok) throw new HttpError(502, `Transcription failed (${res.status}). Try again.`);
  const data = await res.json();
  return json({ text: clean(data.text, 200000) });
}

async function notify(request, env, deps) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_TO || !env.NOTIFY_FROM) throw new HttpError(503, 'Email alerts are not set up on the Worker.');
  const body = await readJson(request);
  const subject = clean(body.subject, 200);
  const text = clean(body.text, 5000);
  if (!subject || !text) throw new HttpError(400, 'Send a "subject" and a "text".');
  // Only ever to the owner's own address: the Worker is not an open mail relay.
  const res = await deps.fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.NOTIFY_FROM, to: [env.NOTIFY_TO], subject: `[CladFlo] ${subject}`, text })
  });
  if (!res.ok) throw new HttpError(502, `The email could not be sent (${res.status}).`);
  return json({ sent: true }, 202);
}

const ROUTES = { '/ai/actions': aiActions, '/ai/followup': aiFollowup, '/ai/transcribe': aiTranscribe, '/notify': notify };

/** The whole Worker; deps.fetchImpl and deps.now are swapped in by the tests. */
export async function handle(request, env, deps = {}) {
  const ctx = { fetchImpl: deps.fetchImpl || fetch, now: deps.now || Date.now() };
  const origin = (request.headers.get('Origin') || '').replace(/\/+$/, '');
  if (!origin || !allowedOrigins(env).includes(origin)) return json({ error: 'This site may not use the Worker.' }, 403);
  const cors = corsHeaders(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const route = ROUTES[new URL(request.url).pathname];
  try {
    if (!route) throw new HttpError(404, 'Not found.');
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST.', { Allow: 'POST, OPTIONS' });
    const caller = await identify(request, env, ctx);
    checkRateLimit(caller, Number(env.RATE_LIMIT_PER_MINUTE) || DEFAULT_RATE_LIMIT, ctx.now);
    const res = await route(request, env, ctx);
    for (const [key, value] of Object.entries(cors)) res.headers.set(key, value);
    return res;
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status, { ...cors, ...err.headers });
    console.error('worker error', err);
    return json({ error: 'Something went wrong on the Worker.' }, 500, cors);
  }
}

export default {
  fetch: (request, env) => handle(request, env)
};
