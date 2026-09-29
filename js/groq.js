// Groq chat completions for the meeting minutes. A teammate's own free Groq
// key, kept in this browser's localStorage only (never synced to Firestore,
// never logged, never built into the site), goes straight to Groq. Without
// one, and with a Worker URL set, the minutes go through the CladFlo Worker
// (POST /ai/chat), which holds the Groq key instead. An own key always wins.

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_KEY_STORAGE = 'cladflo.groq-key.v1';
export const GROQ_MODEL_STORAGE = 'cladflo.groq-model.v1';

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (best minutes)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (faster, higher free limits)' }
];
export const DEFAULT_MODEL = GROQ_MODELS[0].id;

export const MAX_RETRIES = 5;
const MAX_DELAY_MS = 60000;

/** Roughly 3,000 tokens: well inside every Groq model's context and rate limits. */
export const CHUNK_CHARS = 12000;

const browserStore = typeof localStorage !== 'undefined' ? localStorage : null;

function readSetting(store, key) {
  try {
    return store ? store.getItem(key) || '' : '';
  } catch (err) {
    return '';
  }
}

export const loadGroqKey = (store = browserStore) => readSetting(store, GROQ_KEY_STORAGE).trim();

export function saveGroqKey(key, store = browserStore) {
  const clean = String(key || '').trim();
  if (!clean) throw new Error('Paste your Groq API key first.');
  if (/\s/.test(clean)) throw new Error('A Groq API key has no spaces.');
  store.setItem(GROQ_KEY_STORAGE, clean);
  return clean;
}

export function removeGroqKey(store = browserStore) {
  if (store) store.removeItem(GROQ_KEY_STORAGE);
}

export function loadGroqModel(store = browserStore) {
  const saved = readSetting(store, GROQ_MODEL_STORAGE);
  return GROQ_MODELS.some(m => m.id === saved) ? saved : DEFAULT_MODEL;
}

export function saveGroqModel(model, store = browserStore) {
  if (!GROQ_MODELS.some(m => m.id === model)) throw new Error(`Unknown model "${model}".`);
  store.setItem(GROQ_MODEL_STORAGE, model);
}

/** "gsk_…1a2b": enough to recognise a key without showing it. */
export function maskKey(key) {
  const clean = String(key || '');
  if (!clean) return '';
  return clean.length <= 8 ? '•'.repeat(clean.length) : `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

export class GroqError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'GroqError';
    this.status = status;
  }
}

const isRetryable = status => status === 429 || status >= 500;

/**
 * How long to wait before retry number `attempt` (0-based): the server's
 * retry-after (seconds or an HTTP date) if given, else 1s, 2s, 4s… capped at 60s.
 */
export function retryDelay(attempt, retryAfter, now = Date.now()) {
  if (retryAfter !== null && retryAfter !== undefined && retryAfter !== '') {
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
    if (Number.isFinite(ms)) return Math.min(Math.max(ms, 0), MAX_DELAY_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
}

const groqWait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function groqErrorMessage(response) {
  try {
    const body = await response.json();
    return (body && body.error && body.error.message) || '';
  } catch (err) {
    return '';
  }
}

async function groqFailure(response) {
  if (response.status === 401) {
    return new GroqError('Key not valid. Check your Groq API key in AI settings.', 401);
  }
  const detail = await groqErrorMessage(response);
  if (response.status === 429) {
    return new GroqError(`Groq is busy or your free limit is used up. Try again in a minute.${detail ? ` (${detail})` : ''}`, 429);
  }
  return new GroqError(`Groq error ${response.status}${detail ? `: ${detail}` : ''}`, response.status);
}

const defaultFetch = (...args) => globalThis.fetch(...args);

/** POST, retrying a 429, a 5xx or a network failure up to `retries` times. */
async function postWithRetry({ url, request, fetchFn, sleep, retries, unreachable, readReply, failure }) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchFn(url, request);
    } catch (err) {
      if (attempt >= retries) throw new GroqError(unreachable);
      await sleep(retryDelay(attempt));
      continue;
    }
    if (response.ok) return readReply(await response.json().catch(() => null));
    if (!isRetryable(response.status) || attempt >= retries) throw await failure(response);
    await sleep(retryDelay(attempt, response.headers && response.headers.get('retry-after')));
  }
}

/**
 * One chat completion. Retries a 429, a 5xx or a network failure up to
 * MAX_RETRIES times. `fetch` and `sleep` are injectable for tests.
 * @returns {Promise<string>} the reply text
 */
export async function chatGroq({
  key, model = DEFAULT_MODEL, messages, json = false, temperature = 0.2,
  fetch: fetchFn = defaultFetch, sleep = groqWait, retries = MAX_RETRIES
}) {
  if (!key) throw new GroqError('Add your Groq API key in AI settings first.', 401);
  const body = { model, messages, temperature };
  if (json) body.response_format = { type: 'json_object' };
  return postWithRetry({
    url: GROQ_URL,
    request: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body)
    },
    fetchFn,
    sleep,
    retries,
    unreachable: 'Could not reach Groq. Check your internet connection.',
    readReply(data) {
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (typeof content !== 'string') throw new GroqError('Groq sent an empty reply.');
      return content;
    },
    failure: groqFailure
  });
}

// ---------- through the CladFlo Worker ----------

async function workerFailure(response) {
  let reason = '';
  try {
    const body = await response.json();
    reason = (body && body.error) || '';
  } catch (err) {
    reason = '';
  }
  if (response.status === 401) return new GroqError(reason || 'Sign in again to use the CladFlo Worker.', 401);
  if (response.status === 403) return new GroqError(reason || 'The CladFlo Worker did not allow this.', 403);
  if (response.status === 429) return new GroqError(reason || 'The CladFlo Worker is busy. Try again in a minute.', 429);
  return new GroqError(`CladFlo Worker error ${response.status}${reason ? `: ${reason}` : ''}`, response.status);
}

/**
 * One chat completion through the Worker's POST /ai/chat, with the same
 * retries as chatGroq. auth: { idToken } signed in, or { appToken } in local mode.
 * @returns {Promise<string>} the reply text
 */
export async function chatWorker({
  workerUrl, auth = {}, model = DEFAULT_MODEL, messages, json = false,
  fetch: fetchFn = defaultFetch, sleep = groqWait, retries = MAX_RETRIES
}) {
  const base = String(workerUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new GroqError('Set the Worker URL in Settings → Business first.');
  const headers = { 'Content-Type': 'application/json' };
  if (auth.idToken) headers.Authorization = `Bearer ${auth.idToken}`;
  else if (auth.appToken) headers['X-App-Token'] = auth.appToken;
  else throw new GroqError('Sign in to use the CladFlo Worker, or add your own Groq key in AI settings.', 401);
  return postWithRetry({
    url: `${base}/ai/chat`,
    request: { method: 'POST', headers, body: JSON.stringify({ model, messages, json }) },
    fetchFn,
    sleep,
    retries,
    unreachable: 'Could not reach the CladFlo Worker. Check the Worker URL and your connection.',
    readReply(data) {
      if (!data || typeof data.content !== 'string') throw new GroqError('The CladFlo Worker sent an empty reply.');
      return data.content;
    },
    failure: workerFailure
  });
}

/** Who writes the minutes: 'key' (own Groq key, wins), 'worker' (Worker URL set) or '' (neither). */
export function minutesSource({ key, workerUrl }) {
  if (String(key || '').trim()) return 'key';
  return String(workerUrl || '').trim() ? 'worker' : '';
}

/** The chat(messages, {json}) that generateMinutes calls, for the source above. */
export function minutesChat({ key, workerUrl, auth, model = DEFAULT_MODEL, ...deps }) {
  const source = minutesSource({ key, workerUrl });
  return (messages, { json = false } = {}) => (source === 'key'
    ? chatGroq({ key, model, messages, json, ...deps })
    : chatWorker({ workerUrl, auth, model, messages, json, ...deps }));
}

/** A tiny request that proves the key works. */
export async function testGroqKey(options) {
  await chatGroq({ ...options, retries: 1, messages: [{ role: 'user', content: 'Reply with the word OK.' }] });
  return true;
}

/** Split a long line at the last space before `max` (or hard at `max`). */
function splitLong(line, max) {
  const parts = [];
  let rest = line;
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > max / 2 ? cut : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Split a transcript into parts of at most `maxChars`, breaking between lines
 * (so a speaker's turn stays whole) and only inside a line that is too long.
 */
export function chunkText(text, maxChars = CHUNK_CHARS) {
  const lines = String(text || '').split('\n').flatMap(line => splitLong(line.trim(), maxChars)).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + 1 + line.length > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
