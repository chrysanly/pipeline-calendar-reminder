// Talking to the CladFlo Worker (worker/src/index.js) from the app: action
// items, follow-up emails, transcription and email alerts. Signed in, the
// Firebase ID token proves who is asking; in local mode the Worker access
// token saved in this browser does. fetch and the token source are passed in,
// so this is unit-tested without a network.

export const WORKER_TOKEN_STORAGE = 'cladflo.worker-token.v1';
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const FOLLOWUP_TONES = ['friendly', 'formal', 'brief'];

const aiStore = typeof localStorage !== 'undefined' ? localStorage : null;
const aiText = value => (value === null || value === undefined ? '' : String(value).trim());

export function loadWorkerToken(store = aiStore) {
  try {
    return aiText(store && store.getItem(WORKER_TOKEN_STORAGE));
  } catch (err) {
    return '';
  }
}

export function saveWorkerToken(token, store = aiStore) {
  const value = aiText(token);
  if (!value) store.removeItem(WORKER_TOKEN_STORAGE);
  else store.setItem(WORKER_TOKEN_STORAGE, value);
  return value;
}

export class WorkerError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'WorkerError';
    this.status = status;
  }
}

/** What to tell the user for a failed Worker call. */
export function workerErrorMessage(status, serverMessage = '') {
  if (status === 401) return serverMessage || 'The Worker did not accept your sign-in. Sign in again, or check the access token.';
  if (status === 403) return 'The Worker does not allow this site. Add it to ALLOWED_ORIGINS in worker/wrangler.toml.';
  if (status === 429) return serverMessage || 'Too many requests. Wait a minute and try again.';
  if (status === 413) return serverMessage || 'That is too big for the Worker.';
  return serverMessage || `The Worker failed (${status}). Try again.`;
}

/**
 * POST to the Worker. auth: { idToken } signed in, or { appToken } in local
 * mode. body: a plain object (sent as JSON) or FormData.
 */
export async function callWorker({ workerUrl, path, auth = {}, body, fetchImpl = fetch }) {
  const base = aiText(workerUrl).replace(/\/+$/, '');
  if (!base) throw new WorkerError('Set the Worker URL in Settings → Business first.');
  const headers = {};
  if (auth.idToken) headers.Authorization = `Bearer ${auth.idToken}`;
  else if (auth.appToken) headers['X-App-Token'] = auth.appToken;
  else throw new WorkerError('Sign in, or save the Worker access token in the AI panel.');
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (!isForm) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetchImpl(`${base}${path}`, { method: 'POST', headers, body: isForm ? body : JSON.stringify(body || {}) });
  } catch (err) {
    throw new WorkerError('Could not reach the Worker. Check the Worker URL and your connection.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (!res.ok) throw new WorkerError(workerErrorMessage(res.status, data && data.error), res.status);
  return data || {};
}

// ---------- the four calls ----------

const cleanItems = items => (Array.isArray(items) ? items : [])
  .map(item => ({ task: aiText(item && item.task), owner: aiText(item && item.owner), due: aiText(item && item.due) }))
  .filter(item => item.task);

export async function findActionItems(options, { text, client }) {
  const data = await callWorker({ ...options, path: '/ai/actions', body: { text, client } });
  return { summary: aiText(data.summary), actionItems: cleanItems(data.actionItems) };
}

export async function draftFollowup(options, { text, client, actionItems = [], tone = 'friendly' }) {
  const data = await callWorker({ ...options, path: '/ai/followup', body: { text, client, actionItems, tone } });
  return { subject: aiText(data.subject), body: aiText(data.body) };
}

/** Is this a file Whisper can take? '' when fine, else the reason. */
export function audioProblem(file) {
  if (!file) return 'Pick an audio file first.';
  if (!/^(audio|video)\//.test(file.type || '')) return 'That is not an audio file (try .mp3, .m4a, .wav or .webm).';
  if (file.size > MAX_AUDIO_BYTES) return 'Audio must be 25 MB or less. Split a long recording into parts.';
  if (!file.size) return 'That file is empty.';
  return '';
}

export async function transcribeAudio(options, file, name = 'audio.webm') {
  const problem = audioProblem(file);
  if (problem) throw new WorkerError(problem);
  const form = new FormData();
  form.append('file', file, file.name || name);
  const data = await callWorker({ ...options, path: '/ai/transcribe', body: form });
  return aiText(data.text);
}

export function sendAlertEmail(options, { subject, text }) {
  return callWorker({ ...options, path: '/notify', body: { subject, text } });
}

// ---------- helpers for the panel ----------

/** A mailto: link with the draft (the client's email is not known, so no "to"). */
export function followupMailto({ subject, body }) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** "0:42" for the recording clock. */
export function formatRecording(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The auth for callWorker: the signed-in user's ID token, else the saved access token. */
export async function workerAuth(user, store = aiStore) {
  if (user && typeof user.getIdToken === 'function') return { idToken: await user.getIdToken() };
  const appToken = loadWorkerToken(store);
  return appToken ? { appToken } : {};
}
