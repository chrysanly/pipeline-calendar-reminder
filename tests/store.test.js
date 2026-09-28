import { test, assert, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import {
  COLLECTIONS, makeRecord, findRecord, upsertRecord, patchRecord, removeRecord, localListBackend,
  listBackend, createStore, readSettings, validateSettings, DEFAULT_SETTINGS, SETTINGS_ID
} from '../js/store.js';

const NOW = new Date('2026-09-28T08:00:00.000Z');
const LATER = new Date('2026-09-28T09:30:00.000Z');

// runner.js is synchronous, so async cases collect results for a later check.
const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

// ---------- pure list helpers ----------

test('COLLECTIONS: the feature lists, not the ones record-store.js already keeps', () => {
  for (const name of ['clients', 'tasks', 'time', 'expenses', 'invoices', 'proposals', 'templates', 'settings']) {
    assert(COLLECTIONS.includes(name), `missing ${name}`);
  }
  for (const name of ['events', 'meetings', 'history']) assert(!COLLECTIONS.includes(name), `duplicates ${name}`);
});

test('makeRecord stamps id, createdAt and updatedAt and drops undefined values', () => {
  const record = makeRecord({ title: 'Logo', notes: undefined }, NOW);
  assert(typeof record.id === 'string' && record.id.length >= 8, 'id');
  assertEqual(record.createdAt, NOW.toISOString());
  assertEqual(record.updatedAt, NOW.toISOString());
  assert(!('notes' in record), 'undefined kept');
  assertEqual(makeRecord({ id: 'fixed' }, NOW).id, 'fixed');
  assert(makeRecord({}).id !== makeRecord({}).id, 'ids repeat');
});

test('upsertRecord replaces by id or appends; findRecord and removeRecord by id', () => {
  const list = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }];
  assertDeepEqual(upsertRecord(list, { id: 'a', n: 9 }), [{ id: 'a', n: 9 }, { id: 'b', n: 2 }]);
  assertDeepEqual(upsertRecord(list, { id: 'c', n: 3 }).map(r => r.id), ['a', 'b', 'c']);
  assertEqual(findRecord(list, 'b').n, 2);
  assertEqual(findRecord(list, 'x'), null);
  assertDeepEqual(removeRecord(list, 'a'), [{ id: 'b', n: 2 }]);
  assertEqual(list.length, 2, 'input list untouched');
});

test('patchRecord merges into one record, keeps its id and restamps updatedAt', () => {
  const list = [{ id: 'a', title: 'Old', updatedAt: NOW.toISOString() }];
  const next = patchRecord(list, 'a', { title: 'New', id: 'hijack', extra: undefined }, LATER);
  assertDeepEqual(next, [{ id: 'a', title: 'New', updatedAt: LATER.toISOString() }]);
  assertEqual(patchRecord(list, 'missing', { title: 'x' }), list, 'unknown id: unchanged');
});

// ---------- backends ----------

later('localListBackend saves under client-calendar.<name>.v1 and survives bad data', async () => {
  const store = fakeStorage();
  const backend = localListBackend('tasks', store);
  assertEqual(backend.key, 'client-calendar.tasks.v1');
  assertDeepEqual(backend.load(), []);
  await backend.write([], [{ id: 't1', title: 'Wireframes' }]);
  assertDeepEqual(backend.load(), [{ id: 't1', title: 'Wireframes' }]);
  store.setItem(backend.key, '{not json');
  assertDeepEqual(backend.load(), []);
  store.setItem(backend.key, JSON.stringify([{ id: 'ok' }, null, 'x', { noId: true }]));
  assertDeepEqual(backend.load(), [{ id: 'ok' }]);
});

test('listBackend: this browser without an account, Firestore with db and uid', () => {
  assertEqual(listBackend('tasks', { store: fakeStorage() }).kind, 'local');
  const db = { collection: () => ({ doc: () => ({ collection: () => ({}) }) }) };
  assertEqual(listBackend('tasks', { db, uid: 'uid-1' }).kind, 'cloud');
});

// ---------- the store ----------


later('createStore adds, updates, puts and removes, saving each change through the backend', async () => {
  const storage = fakeStorage();
  const changes = [];
  let clock = NOW;
  const store = createStore({ onChange: name => changes.push(name), now: () => clock });
  store.attach(name => localListBackend(name, storage));
  assertEqual(changes.at(-1), null, 'attach announces every list');

  const task = await store.add('tasks', { title: 'Wireframes', status: 'todo' });
  assertEqual(store.all('tasks').length, 1);
  assertEqual(JSON.parse(storage.getItem('client-calendar.tasks.v1'))[0].title, 'Wireframes');

  clock = LATER;
  const moved = await store.update('tasks', task.id, { status: 'done' });
  assertEqual(moved.status, 'done');
  assertEqual(moved.createdAt, NOW.toISOString());
  assertEqual(moved.updatedAt, LATER.toISOString());

  await store.put('settings', { id: SETTINGS_ID, currency: 'USD' });
  const replaced = await store.put('settings', { id: SETTINGS_ID, currency: 'EUR' });
  assertEqual(store.all('settings').length, 1, 'put replaces');
  assertEqual(replaced.currency, 'EUR');
  assertEqual(replaced.createdAt, LATER.toISOString(), 'createdAt kept from the first put');

  await store.remove('tasks', task.id);
  assertDeepEqual(store.all('tasks'), []);
  assertDeepEqual(JSON.parse(storage.getItem('client-calendar.tasks.v1')), []);
  assert(changes.includes('tasks') && changes.includes('settings'), 'onChange per collection');
});

later('createStore reports a failed save through onError and keeps the change on screen', async () => {
  const errors = [];
  const store = createStore({ onError: err => errors.push(err.message) });
  store.attach(() => ({ write: () => Promise.reject(new Error('offline')) }));
  await store.add('clients', { name: 'Acme' });
  assertDeepEqual(errors, ['offline']);
  assertEqual(store.all('clients').length, 1);
});

later('createStore ignores a snapshot that arrives after switching accounts', async () => {
  const listeners = [];
  const store = createStore();
  store.attach(() => ({ subscribe: next => { listeners.push(next); return () => {}; }, write: async () => {} }));
  const stale = listeners[0];
  store.attach(() => ({ load: () => [], write: async () => {} }));
  stale([{ id: 'old-account' }]);
  assertDeepEqual(store.all('clients'), []);
});

later('createStore: unknown collections throw, detach empties, reloadKey picks up another tab', async () => {
  const storage = fakeStorage();
  const store = createStore();
  let message = '';
  try {
    store.all('nope');
  } catch (err) {
    message = err.message;
  }
  assert(/Unknown collection "nope"/.test(message), message);

  store.attach(name => localListBackend(name, storage));
  storage.setItem('client-calendar.invoices.v1', JSON.stringify([{ id: 'i1', number: 'INV-1' }]));
  store.reloadKey('client-calendar.events.v1');
  assertDeepEqual(store.all('invoices'), [], 'other keys are ignored');
  store.reloadKey('client-calendar.invoices.v1');
  assertEqual(store.all('invoices')[0].number, 'INV-1');
  store.detach();
  assertDeepEqual(store.all('invoices'), []);
});

// ---------- settings ----------

test('readSettings: saved values over the .env fallback over the defaults', () => {
  assertDeepEqual(readSettings([]), DEFAULT_SETTINGS);
  const list = [{ id: SETTINGS_ID, currency: 'USD', workerUrl: '  ', stripeLink: 'https://buy.stripe.com/x' }];
  const settings = readSettings(list, { workerUrl: 'https://env.example.workers.dev' });
  assertEqual(settings.currency, 'USD');
  assertEqual(settings.workerUrl, 'https://env.example.workers.dev', 'blank saved value falls through');
  assertEqual(settings.stripeLink, 'https://buy.stripe.com/x');
  assertEqual(readSettings([{ id: SETTINGS_ID, workerUrl: 'https://mine.workers.dev' }], { workerUrl: 'https://env.workers.dev' }).workerUrl, 'https://mine.workers.dev');
});

test('validateSettings tidies good input', () => {
  const { settings, errors } = validateSettings({
    currency: 'usd',
    stripeLink: 'buy.stripe.com/abc',
    paypalLink: 'https://paypal.me/chrys/',
    gcashNumber: '0917 123 4567',
    gcashQr: '',
    workerUrl: 'http://localhost:8787/'
  });
  assertDeepEqual(errors, {});
  assertDeepEqual(settings, {
    currency: 'USD',
    stripeLink: 'https://buy.stripe.com/abc',
    paypalLink: 'https://paypal.me/chrys',
    gcashQr: '',
    workerUrl: 'http://localhost:8787',
    gcashNumber: '09171234567'
  });
});

test('validateSettings flags each bad field with a message', () => {
  const { errors } = validateSettings({
    currency: 'BTC',
    stripeLink: 'http://buy.stripe.com/abc',
    paypalLink: 'not a url',
    gcashNumber: '12345',
    gcashQr: 'javascript:alert(1)',
    workerUrl: 'http://evil.example.com'
  });
  assertDeepEqual(Object.keys(errors).sort(), ['currency', 'gcashNumber', 'gcashQr', 'paypalLink', 'stripeLink', 'workerUrl']);
  assert(/currency/i.test(errors.currency), errors.currency);
});

test('validateSettings: blank links and number are fine; +63 numbers are accepted', () => {
  const { settings, errors } = validateSettings({ currency: 'AED', gcashNumber: '+63 917 123 4567' });
  assertDeepEqual(errors, {});
  assertEqual(settings.gcashNumber, '+639171234567');
  assertEqual(settings.stripeLink, '');
});

export const storeTestsDone = Promise.all(pending);
