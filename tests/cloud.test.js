import { test, assert, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import {
  diffEvents, planMigration, selectBackend, isConfigured, cloudBackend
} from '../js/cloud.js';
import { localBackend, STORAGE_KEY } from '../js/storage.js';

const a = { id: 'a', title: 'Call', date: '2026-09-27', time: '09:00', notified: false };
const b = { id: 'b', title: 'Visit', date: '2026-09-28', time: '10:00', notified: false };
const CONFIG = { apiKey: 'test-api-key', projectId: 'client-calendar', appId: '1:2:web:3' };

// ---------- diffEvents ----------

test('diffEvents: added reminders are upserted', () => {
  const d = diffEvents([a], [a, b]);
  assertDeepEqual(d.upserts.map(e => e.id), ['b']);
  assertDeepEqual(d.deletes, []);
});

test('diffEvents: an edited reminder is upserted with its new values', () => {
  const d = diffEvents([a, b], [{ ...a, title: 'Renamed' }, b]);
  assertDeepEqual(d.upserts, [{ ...a, title: 'Renamed' }]);
  assertDeepEqual(d.deletes, []);
});

test('diffEvents: removed reminders are deleted by id', () => {
  const d = diffEvents([a, b], [b]);
  assertDeepEqual(d.upserts, []);
  assertDeepEqual(d.deletes, ['a']);
});

test('diffEvents: an identical list, even with keys in another order, writes nothing', () => {
  const reordered = { notified: false, time: '09:00', date: '2026-09-27', title: 'Call', id: 'a' };
  assertDeepEqual(diffEvents([a, b], [b, reordered]), { upserts: [], deletes: [] });
  assertDeepEqual(diffEvents([], []), { upserts: [], deletes: [] });
});

test('diffEvents: marking notified is a single upsert', () => {
  const d = diffEvents([a, b], [a, { ...b, notified: true }]);
  assertDeepEqual(d.upserts.map(e => e.id), ['b']);
});

// ---------- planMigration ----------

test('planMigration uploads local reminders when the cloud is empty', () => {
  assertDeepEqual(planMigration([a, b], [], false).map(e => e.id), ['a', 'b']);
});

test('planMigration uploads nothing when the cloud already has data', () => {
  assertDeepEqual(planMigration([a], [b], false), []);
});

test('planMigration uploads nothing once the migrated flag is set', () => {
  assertDeepEqual(planMigration([a, b], [], 'uid-1'), []);
});

test('planMigration with no local reminders uploads nothing', () => {
  assertDeepEqual(planMigration([], [], false), []);
});

// ---------- backend selection ----------

test('a filled-in config (as generated from .env) uses the cloud once the SDK loads', () => {
  // The real values live in .env on the developer's PC, never in git; see
  // tests/config.test.js for the generator itself.
  assertEqual(isConfigured(CONFIG), true);
  assertEqual(selectBackend({ config: CONFIG, sdk: {} }), 'cloud');
  assertEqual(selectBackend({ config: CONFIG, sdk: null }), 'local');
});

test('selectBackend: no config, placeholder config or no SDK means local', () => {
  assertEqual(selectBackend({ config: {}, sdk: {} }), 'local');
  assertEqual(selectBackend({ config: undefined, sdk: {} }), 'local');
  assertEqual(selectBackend({ config: { apiKey: 'YOUR_API_KEY', projectId: 'YOUR_PROJECT_ID' }, sdk: {} }), 'local');
  assertEqual(selectBackend({ config: CONFIG, sdk: null }), 'local');
});

test('selectBackend: a real config and a loaded SDK means cloud, unless forced local', () => {
  assertEqual(selectBackend({ config: CONFIG, sdk: {} }), 'cloud');
  assertEqual(selectBackend({ config: CONFIG, sdk: {}, forceLocal: true }), 'local');
});

// runner.js is synchronous, so async cases collect results for a later check.
const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

later('localBackend loads and saves through the store', async () => {
  const store = fakeStorage();
  const local = localBackend(store);
  assertEqual(local.kind, 'local');
  await local.write([], [a]);
  assertDeepEqual(JSON.parse(store.getItem(STORAGE_KEY)), [a]);
  assertDeepEqual(local.load(), [a]);
});

// ---------- cloudBackend against a tiny fake Firestore ----------

function fakeDb() {
  const docs = new Map();
  const commits = [];
  const col = path => ({
    doc: id => ({ path: `${path}/${id}`, id }),
    get: async () => ({ docs: [...docs].filter(([p]) => p.startsWith(`${path}/`)).map(([p, d]) => ({ id: p.split('/').pop(), data: () => d })) })
  });
  return {
    docs,
    commits,
    collection: name => ({ doc: id => ({ collection: sub => col(`${name}/${id}/${sub}`) }) }),
    batch() {
      const ops = [];
      return {
        set: (ref, data) => ops.push(['set', ref.path, data]),
        delete: ref => ops.push(['delete', ref.path]),
        commit: async () => {
          commits.push(ops.length);
          for (const [op, path, data] of ops) op === 'set' ? docs.set(path, data) : docs.delete(path);
        }
      };
    }
  };
}

later('cloudBackend.write stores each reminder at users/{uid}/events/{id} without the id field', async () => {
  const db = fakeDb();
  const cloud = cloudBackend(db, 'uid-1');
  const counts = await cloud.write([], [a, b]);
  assertDeepEqual(counts, { upserts: 2, deletes: 0 });
  assertDeepEqual([...db.docs.keys()], ['users/uid-1/events/a', 'users/uid-1/events/b']);
  assert(!('id' in db.docs.get('users/uid-1/events/a')), 'id is the document id, not a field');
});

later('cloudBackend.write deletes removed reminders and skips unchanged ones', async () => {
  const db = fakeDb();
  const cloud = cloudBackend(db, 'uid-1');
  await cloud.write([], [a, b]);
  const counts = await cloud.write([a, b], [{ ...b, title: 'Moved' }]);
  assertDeepEqual(counts, { upserts: 1, deletes: 1 });
  assertDeepEqual([...db.docs.keys()], ['users/uid-1/events/b']);
  assertEqual(db.docs.get('users/uid-1/events/b').title, 'Moved');
  assertEqual((await cloud.write([b], [b])).upserts, 0);
});

later('cloudBackend.write splits big imports into batches under the 500-write limit', async () => {
  const db = fakeDb();
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...a, id: `e${i}` }));
  await cloudBackend(db, 'uid-1').write([], many);
  assertDeepEqual(db.commits, [450, 450, 100]);
  assertEqual(db.docs.size, 1000);
});

later('cloudBackend.fetchServer returns normalized reminders with their ids', async () => {
  const db = fakeDb();
  db.docs.set('users/uid-1/events/x1', { title: ' Call ', date: '2026-09-27', time: '09:00' });
  db.docs.set('users/uid-2/events/x2', { title: 'Someone else', date: '2026-09-27' });
  const list = await cloudBackend(db, 'uid-1').fetchServer();
  assertEqual(list.length, 1);
  assertEqual(list[0].id, 'x1');
  assertEqual(list[0].title, 'Call');
  assertEqual(list[0].notified, false);
});

export const cloudTestsDone = Promise.all(pending);
