// js/ai.js (Worker client) and js/notify.js (status alerts), with fetch faked.

import { test, assert, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import {
  WORKER_TOKEN_STORAGE, loadWorkerToken, saveWorkerToken, workerErrorMessage, callWorker, findActionItems, draftFollowup,
  audioProblem, transcribeAudio, sendAlertEmail, followupMailto, formatRecording, workerAuth, MAX_AUDIO_BYTES
} from '../js/ai.js';
import { DEFAULT_ALERT_PREFS, loadAlertPrefs, saveAlertPrefs, shouldAlert, alertMessage } from '../js/notify.js';

const URL_ = 'https://w.example.workers.dev/';

function fakeFetch(status = 200, data = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => data };
  };
  return { fetchImpl, calls };
}

const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));
const rejects = async promise => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
};

// ---------- token ----------

test('the Worker access token is saved trimmed in this browser and removed when blank', () => {
  const store = fakeStorage();
  assertEqual(loadWorkerToken(store), '');
  saveWorkerToken('  abc  ', store);
  assertEqual(store.getItem(WORKER_TOKEN_STORAGE), 'abc');
  assertEqual(loadWorkerToken(store), 'abc');
  saveWorkerToken('', store);
  assertEqual(store.getItem(WORKER_TOKEN_STORAGE), null);
});

later('workerAuth: the signed-in user\'s ID token, else the saved access token, else nothing', async () => {
  const store = fakeStorage();
  assertDeepEqual(await workerAuth({ getIdToken: async () => 'id-token' }, store), { idToken: 'id-token' });
  assertDeepEqual(await workerAuth(null, store), {});
  saveWorkerToken('local', store);
  assertDeepEqual(await workerAuth(null, store), { appToken: 'local' });
});

// ---------- callWorker ----------

later('callWorker posts JSON with the right auth header, and FormData as is', async () => {
  const fake = fakeFetch(200, { ok: 1 });
  assertDeepEqual(await callWorker({ workerUrl: URL_, path: '/ai/actions', auth: { idToken: 't' }, body: { a: 1 }, fetchImpl: fake.fetchImpl }), { ok: 1 });
  const [first] = fake.calls;
  assertEqual(first.url, 'https://w.example.workers.dev/ai/actions');
  assertEqual(first.init.headers.Authorization, 'Bearer t');
  assertEqual(first.init.headers['Content-Type'], 'application/json');
  assertEqual(first.init.body, '{"a":1}');
  const form = new FormData();
  await callWorker({ workerUrl: URL_, path: '/x', auth: { appToken: 'k' }, body: form, fetchImpl: fake.fetchImpl });
  assertEqual(fake.calls[1].init.headers['X-App-Token'], 'k');
  assertEqual(fake.calls[1].init.headers['Content-Type'], undefined, 'the browser sets the multipart boundary');
  assertEqual(fake.calls[1].init.body, form);
});

later('callWorker explains a missing URL, missing auth, a network failure and each error status', async () => {
  const f = fakeFetch();
  assert(/Worker URL/.test((await rejects(callWorker({ workerUrl: ' ', path: '/x', auth: { appToken: 'k' }, fetchImpl: f.fetchImpl }))).message));
  assert(/access token/.test((await rejects(callWorker({ workerUrl: URL_, path: '/x', fetchImpl: f.fetchImpl }))).message));
  assertEqual(f.calls.length, 0);
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  assert(/Could not reach/.test((await rejects(callWorker({ workerUrl: URL_, path: '/x', auth: { appToken: 'k' }, fetchImpl: offline }))).message));
  const busy = await rejects(callWorker({ workerUrl: URL_, path: '/x', auth: { appToken: 'k' }, fetchImpl: fakeFetch(429, { error: 'Too many requests. Try again in 12 s.' }).fetchImpl }));
  assertEqual(busy.status, 429);
  assertEqual(busy.message, 'Too many requests. Try again in 12 s.');
});

test('workerErrorMessage covers the statuses the Worker returns', () => {
  assert(/ALLOWED_ORIGINS/.test(workerErrorMessage(403)));
  assert(/sign-in/.test(workerErrorMessage(401)));
  assertEqual(workerErrorMessage(502, 'The AI failed (500).'), 'The AI failed (500).');
  assertEqual(workerErrorMessage(500), 'The Worker failed (500). Try again.');
});

// ---------- the calls ----------

later('findActionItems and draftFollowup send the right body and clean the reply', async () => {
  const actions = fakeFetch(200, { summary: ' Agreed. ', actionItems: [{ task: ' Send deck ', owner: 'Anna' }, { task: '' }] });
  const options = { workerUrl: URL_, auth: { appToken: 'k' }, fetchImpl: actions.fetchImpl };
  assertDeepEqual(await findActionItems(options, { text: 'notes', client: 'Acme' }),
    { summary: 'Agreed.', actionItems: [{ task: 'Send deck', owner: 'Anna', due: '' }] });
  assertDeepEqual(JSON.parse(actions.calls[0].init.body), { text: 'notes', client: 'Acme' });

  const email = fakeFetch(200, { subject: 'Thanks', body: 'Hi' });
  const draft = await draftFollowup({ ...options, fetchImpl: email.fetchImpl }, { text: 'n', client: 'Acme', tone: 'brief' });
  assertDeepEqual(draft, { subject: 'Thanks', body: 'Hi' });
  assertEqual(JSON.parse(email.calls[0].init.body).tone, 'brief');
  assert(email.calls[0].url.endsWith('/ai/followup'));
});

test('audioProblem checks the type and the 25 MB limit', () => {
  assertEqual(audioProblem({ type: 'audio/mpeg', size: 1000 }), '');
  assertEqual(audioProblem({ type: 'video/mp4', size: 1000 }), '');
  assert(/audio file/.test(audioProblem({ type: 'text/plain', size: 10 })));
  assert(/25 MB/.test(audioProblem({ type: 'audio/wav', size: MAX_AUDIO_BYTES + 1 })));
  assert(/empty/.test(audioProblem({ type: 'audio/wav', size: 0 })));
  assert(/Pick/.test(audioProblem(null)));
});

later('transcribeAudio uploads the file as "file" and refuses bad files before any request', async () => {
  const fake = fakeFetch(200, { text: ' Hello ' });
  const file = new File([new Uint8Array(10)], 'call.m4a', { type: 'audio/mp4' });
  assertEqual(await transcribeAudio({ workerUrl: URL_, auth: { appToken: 'k' }, fetchImpl: fake.fetchImpl }, file), 'Hello');
  assertEqual(fake.calls[0].init.body.get('file').name, 'call.m4a');
  await rejects(transcribeAudio({ workerUrl: URL_, auth: { appToken: 'k' }, fetchImpl: fake.fetchImpl }, new File(['x'], 'a.txt', { type: 'text/plain' })));
  assertEqual(fake.calls.length, 1);
});

later('sendAlertEmail posts the subject and text to /notify', async () => {
  const fake = fakeFetch(202, { sent: true });
  await sendAlertEmail({ workerUrl: URL_, auth: { appToken: 'k' }, fetchImpl: fake.fetchImpl }, { subject: 'S', text: 'T' });
  assert(fake.calls[0].url.endsWith('/notify'));
  assertDeepEqual(JSON.parse(fake.calls[0].init.body), { subject: 'S', text: 'T' });
});

test('followupMailto and formatRecording', () => {
  assertEqual(followupMailto({ subject: 'Hi & thanks', body: 'Line 1\nLine 2' }), 'mailto:?subject=Hi%20%26%20thanks&body=Line%201%0ALine%202');
  assertEqual(formatRecording(65400), '1:05');
  assertEqual(formatRecording(-1), '0:00');
});

// ---------- status alerts ----------

test('alert prefs: defaults, saved values, and junk ignored', () => {
  const store = fakeStorage();
  assertDeepEqual(loadAlertPrefs(store), DEFAULT_ALERT_PREFS);
  saveAlertPrefs({ browser: false, email: true, statuses: ['active', 'bogus'] }, store);
  assertDeepEqual(loadAlertPrefs(store), { browser: false, email: true, statuses: ['active'] });
  store.setItem('cladflo.alerts.v1', '{broken');
  assertDeepEqual(loadAlertPrefs(store), DEFAULT_ALERT_PREFS);
});

test('shouldAlert: only a real move into a chosen status, with some channel on', () => {
  const prefs = { browser: true, email: false, statuses: ['active'] };
  assertEqual(shouldAlert(prefs, { status: 'active', previous: 'lead' }), true);
  assertEqual(shouldAlert(prefs, { status: 'active', previous: 'active' }), false);
  assertEqual(shouldAlert(prefs, { status: 'potential', previous: 'lead' }), false);
  assertEqual(shouldAlert({ ...prefs, browser: false }, { status: 'active', previous: 'lead' }), false);
});

test('alertMessage names the client and both stages', () => {
  assertDeepEqual(alertMessage({ clientName: 'Acme Ltd.', status: 'active', previous: 'lead' }),
    { subject: 'Acme Ltd. is now Active', text: 'Acme Ltd. moved from Lead to Active.' });
  assertEqual(alertMessage({ clientName: 'Acme', status: 'inactive', previous: null }).text, 'Acme was set to Inactive.');
});

export const aiTestsDone = Promise.all(pending);
