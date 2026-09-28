// Groq chat completions for the meeting minutes. Each teammate uses their own
// free Groq key, kept in this browser's localStorage only: it is never synced
// to Firestore, never logged and never built into the site.

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

/**
 * One chat completion. Retries a 429, a 5xx or a network failure up to
 * MAX_RETRIES times. `fetch` and `sleep` are injectable for tests.
 * @returns {Promise<string>} the reply text
 */
export async function chatGroq({
  key, model = DEFAULT_MODEL, messages, json = false, temperature = 0.2,
  fetch: fetchFn = (...args) => globalThis.fetch(...args), sleep = groqWait, retries = MAX_RETRIES
}) {
  if (!key) throw new GroqError('Add your Groq API key in AI settings first.', 401);
  const body = { model, messages, temperature };
  if (json) body.response_format = { type: 'json_object' };
  const request = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  };

  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchFn(GROQ_URL, request);
    } catch (err) {
      if (attempt >= retries) throw new GroqError('Could not reach Groq. Check your internet connection.');
      await sleep(retryDelay(attempt));
      continue;
    }
    if (response.ok) {
      const data = await response.json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (typeof content !== 'string') throw new GroqError('Groq sent an empty reply.');
      return content;
    }
    if (!isRetryable(response.status) || attempt >= retries) throw await groqFailure(response);
    await sleep(retryDelay(attempt, response.headers && response.headers.get('retry-after')));
  }
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
