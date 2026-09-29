import { test, assert, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import {
  diffEvents, planMigration, selectBackend, isConfigured, cloudBackend, collectionBackend,
  PORTALS, newPortalToken, isPortalToken, portalBackend
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
    collection: name => ({
      doc: id => ({
        path: `${name}/${id}`,
        collection: sub => col(`${name}/${id}/${sub}`),
        set: async data => { docs.set(`${name}/${id}`, data); },
        delete: async () => { docs.delete(`${name}/${id}`); },
        get: async () => ({ exists: docs.has(`${name}/${id}`), data: () => docs.get(`${name}/${id}`) })
      })
    }),
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
  assertDeepEqual([counts.upserts, counts.deletes], [2, 0]);
  assertDeepEqual([...db.docs.keys()], ['users/uid-1/events/a', 'users/uid-1/events/b']);
  assert(!('id' in db.docs.get('users/uid-1/events/a')), 'id is the document id, not a field');
});

later('cloudBackend.write deletes removed reminders and skips unchanged ones', async () => {
  const db = fakeDb();
  const cloud = cloudBackend(db, 'uid-1');
  await cloud.write([], [a, b]);
  const counts = await cloud.write([a, b], [{ ...b, title: 'Moved' }]);
  assertDeepEqual([counts.upserts, counts.deletes], [1, 1]);
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

later('cloudBackend.write resolves once the change is on the device, before the server answers', async () => {
  const db = fakeDb();
  let answer;
  db.batch = () => ({
    set: () => {},
    delete: () => {},
    commit: () => new Promise(resolve => { answer = resolve; })
  });
  const result = await cloudBackend(db, 'uid-1').write([], [a]);
  assertEqual(result.upserts, 1);
  let confirmed = false;
  result.confirmed.then(() => { confirmed = true; });
  await Promise.resolve();
  assert(!confirmed, 'not confirmed until the server answers');
  answer();
  await result.confirmed;
  assert(confirmed, 'confirmed once the server answers');
});

later('cloudBackend.write: a refused write rejects `confirmed`, not the write', async () => {
  const db = fakeDb();
  db.batch = () => ({ set: () => {}, delete: () => {}, commit: () => Promise.reject(new Error('permission-denied')) });
  const result = await cloudBackend(db, 'uid-1').write([], [a]);
  let error = null;
  await result.confirmed.catch(err => { error = err; });
  assertEqual(error && error.message, 'permission-denied');
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

test('diffEvents compares nested fields too (minutes hold arrays of objects)', () => {
  const m = { id: 'm', actionItems: [{ task: 'Call', owner: 'Anna' }] };
  const reordered = { actionItems: [{ owner: 'Anna', task: 'Call' }], id: 'm' };
  assertDeepEqual(diffEvents([m], [reordered]).upserts, []);
  const edited = { id: 'm', actionItems: [{ task: 'Call', owner: 'Omar' }] };
  assertDeepEqual(diffEvents([m], [edited]).upserts.map(r => r.id), ['m']);
});

later('collectionBackend writes meetings and history at users/{uid}/<name>/{id}', async () => {
  const db = fakeDb();
  const meetings = collectionBackend(db, 'uid-1', 'meetings');
  const history = collectionBackend(db, 'uid-1', 'history', r => ({ ...r, normalized: true }));
  assertEqual(meetings.kind, 'cloud');
  await meetings.write([], [{ id: 'm1', title: 'Kickoff' }]);
  await history.write([], [{ id: 'h1', action: 'create' }]);
  assertDeepEqual([...db.docs.keys()], ['users/uid-1/meetings/m1', 'users/uid-1/history/h1']);
  assertDeepEqual(db.docs.get('users/uid-1/meetings/m1'), { title: 'Kickoff' });
  const list = await history.fetchServer();
  assertDeepEqual(list, [{ action: 'create', id: 'h1', normalized: true }]);
  await meetings.write([{ id: 'm1', title: 'Kickoff' }], []);
  assertDeepEqual([...db.docs.keys()], ['users/uid-1/history/h1']);
});

// ---------- client portal ----------

test('newPortalToken: 32 hex characters from crypto, different every time', () => {
  const token = newPortalToken();
  assert(isPortalToken(token), `bad token ${token}`);
  assert(newPortalToken() !== token, 'tokens repeat');
  const fixed = { getRandomValues: bytes => bytes.fill(171) };
  assertEqual(newPortalToken(fixed), 'ab'.repeat(16));
});

test('newPortalToken refuses to make a weak link without crypto', () => {
  let message = '';
  try {
    newPortalToken(null);
  } catch (err) {
    message = err.message;
  }
  assert(/secure share link/.test(message), message);
});

test('isPortalToken accepts only 32 lower-case hex characters', () => {
  assert(isPortalToken('0123456789abcdef0123456789abcdef'));
  for (const bad of ['', 'abc', '0123456789ABCDEF0123456789ABCDEF', '../users/uid-1/events/x0000000000', null, 42]) {
    assert(!isPortalToken(bad), `accepted ${bad}`);
  }
});

later('portalBackend publishes a page with the owner, reads it back and unpublishes it', async () => {
  const db = fakeDb();
  const portal = portalBackend(db, 'uid-1');
  const token = 'ab'.repeat(16);
  const doc = await portal.publish(token, { clientName: 'Acme', invoices: [] }, new Date('2026-09-28T08:00:00.000Z'));
  assertDeepEqual(doc, { clientName: 'Acme', invoices: [], ownerUid: 'uid-1', updatedAt: '2026-09-28T08:00:00.000Z' });
  assertDeepEqual([...db.docs.keys()], [`${PORTALS}/${token}`]);
  assertEqual((await portal.read(token)).token, token);
  await portal.unpublish(token);
  assertEqual(await portal.read(token), null);
});

later('portalBackend rejects a malformed token before touching Firestore', async () => {
  const db = fakeDb();
  let message = '';
  try {
    await portalBackend(db, 'uid-1').publish('users/uid-2', {});
  } catch (err) {
    message = err.message;
  }
  assertEqual(message, 'Invalid portal link.');
  assertEqual(db.docs.size, 0);
});

export const cloudTestsDone = Promise.all(pending);
