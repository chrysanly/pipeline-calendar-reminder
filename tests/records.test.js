import { test, assert, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import { RECORD_KINDS, recordKey, recordId, loadRecords, recordBackend } from '../js/records.js';
import { createRecordStore } from '../js/record-store.js';

test('record lists are meetings and history, stored under client-calendar.<name>.v1', () => {
  assertDeepEqual(RECORD_KINDS, ['meetings', 'history']);
  assertEqual(recordKey('meetings'), 'client-calendar.meetings.v1');
  assert(/^mtg_[a-z0-9]+_[a-z0-9]+$/.test(recordId('mtg')), recordId('mtg'));
  assert(recordId('x') !== recordId('x'), 'ids are unique');
});

test('loadRecords returns [] for nothing, corrupt JSON or a non-array, and skips records without ids', () => {
  assertDeepEqual(loadRecords('history', fakeStorage()), []);
  assertDeepEqual(loadRecords('history', fakeStorage({ 'client-calendar.history.v1': '{oops' })), []);
  assertDeepEqual(loadRecords('history', fakeStorage({ 'client-calendar.history.v1': '{"a":1}' })), []);
  const store = fakeStorage({ 'client-calendar.history.v1': '[{"id":"a"},null,{"title":"no id"}]' });
  assertDeepEqual(loadRecords('history', store), [{ id: 'a' }]);
  assertDeepEqual(loadRecords('history', null), []);
});

test('recordBackend without a db is this browser; with a db and uid it is Firestore', () => {
  assertEqual(recordBackend('meetings', { store: fakeStorage() }).kind, 'local');
  const db = { collection: () => ({ doc: () => ({ collection: () => ({}) }) }) };
  assertEqual(recordBackend('meetings', { db, uid: 'u1' }).kind, 'cloud');
  assertEqual(recordBackend('meetings', { db, uid: null, store: fakeStorage() }).kind, 'local');
  let message = '';
  try { recordBackend('events'); } catch (err) { message = err.message; }
  assert(/Unknown record list/.test(message), 'only meetings and history');
});

const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

later('the local record backend saves and loads through the store, normalized', async () => {
  const store = fakeStorage();
  const backend = recordBackend('meetings', { store, normalize: r => ({ ...r, seen: true }) });
  await backend.write([], [{ id: 'm1', title: 'Kickoff' }]);
  assertDeepEqual(JSON.parse(store.getItem('client-calendar.meetings.v1')), [{ id: 'm1', title: 'Kickoff' }]);
  const got = [];
  backend.subscribe(list => got.push(list));
  assertDeepEqual(got, [[{ id: 'm1', title: 'Kickoff', seen: true }]]);
});

later('the record store logs History newest first and saves both lists locally', async () => {
  const store = fakeStorage();
  const changes = [];
  const records = createRecordStore({ onChange: (name, list) => changes.push([name, list.length]), onError: () => {} });
  records.connect({ store });
  await records.log({ action: 'create', kind: 'reminder', title: 'First' });
  await records.log({ action: 'delete', kind: 'reminder', title: 'Second' });
  await records.commit('meetings', [{ id: 'm1', clientName: 'Acme', title: 'Kickoff', date: '2026-09-28' }]);
  const history = records.get('history');
  assertEqual(history.length, 2);
  assert(history[0].at >= history[1].at, 'newest first');
  assertEqual(JSON.parse(store.getItem('client-calendar.history.v1')).length, 2);
  assertEqual(JSON.parse(store.getItem('client-calendar.meetings.v1'))[0].title, 'Kickoff');
  assertEqual(records.get('meetings')[0].summary, '', 'meetings are normalized');
  assert(changes.some(([name]) => name === 'meetings'), 'onChange fires');
});

later('the record store reloads a list when another tab saves it, and empties on disconnect', async () => {
  const store = fakeStorage();
  const records = createRecordStore({ onChange: () => {}, onError: () => {} });
  records.connect({ store });
  store.setItem('client-calendar.history.v1', JSON.stringify([{ id: 'h1', at: '2026-09-28T10:00:00.000Z', action: 'import', title: 'x.xlsx' }]));
  records.reloadKey('client-calendar.events.v1');
  assertEqual(records.get('history').length, 0, 'other keys are ignored');
  records.reloadKey('client-calendar.history.v1');
  assertEqual(records.get('history')[0].action, 'import');
  records.disconnect();
  assertDeepEqual(records.get('history'), []);
  await records.commit('history', []);
});

export const recordsTestsDone = Promise.all(pending);
