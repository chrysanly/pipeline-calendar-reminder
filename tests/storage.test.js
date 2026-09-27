import { test, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import {
  STORAGE_KEY, loadEvents, saveEvents, addEvent, updateEvent,
  deleteEvent, findEvent, groupByDate, normalizeEvent, applyClientFields, clientKey
} from '../js/storage.js';

const sample = {
  clientName: 'Acme Ltd.',
  title: 'Renewal call',
  date: '2025-05-15',
  time: '10:30',
  notes: 'Discuss terms',
  reminderMinutesBefore: 15
};

test('loadEvents returns [] for empty storage', () => {
  assertDeepEqual(loadEvents(fakeStorage()), []);
});

test('loadEvents returns [] for corrupt JSON', () => {
  const store = fakeStorage({ [STORAGE_KEY]: '{not json' });
  assertDeepEqual(loadEvents(store), []);
});

test('loadEvents returns [] when the payload is not an array', () => {
  const store = fakeStorage({ [STORAGE_KEY]: '{"a":1}' });
  assertDeepEqual(loadEvents(store), []);
});

test('saveEvents then loadEvents round-trips', () => {
  const store = fakeStorage();
  const list = addEvent([], sample);
  saveEvents(list, store);
  assertDeepEqual(loadEvents(store), list);
});

test('addEvent assigns an id and does not mutate the input', () => {
  const list = [];
  const next = addEvent(list, sample);
  assertEqual(list.length, 0);
  assertEqual(next.length, 1);
  assertEqual(typeof next[0].id, 'string');
  assertEqual(next[0].title, 'Renewal call');
  assertEqual(next[0].notified, false);
});

test('normalizeEvent trims text and coerces the reminder to a number', () => {
  const evt = normalizeEvent({ title: '  Call  ', clientName: ' Acme ', reminderMinutesBefore: '30' });
  assertEqual(evt.title, 'Call');
  assertEqual(evt.clientName, 'Acme');
  assertEqual(evt.reminderMinutesBefore, 30);
});

test('normalizeEvent defaults a blank reminder to 0', () => {
  assertEqual(normalizeEvent({ title: 'x', reminderMinutesBefore: '' }).reminderMinutesBefore, 0);
});

test('updateEvent patches only the matching event and keeps the id', () => {
  const list = addEvent(addEvent([], sample), { ...sample, title: 'Second' });
  const id = list[0].id;
  const next = updateEvent(list, id, { title: 'Changed', notes: 'New notes' });
  assertEqual(next[0].id, id);
  assertEqual(next[0].title, 'Changed');
  assertEqual(next[0].notes, 'New notes');
  assertEqual(next[1].title, 'Second');
  assertEqual(list[0].title, 'Renewal call', 'original list untouched');
});

test('updateEvent on an unknown id leaves the list unchanged', () => {
  const list = addEvent([], sample);
  assertDeepEqual(updateEvent(list, 'nope', { title: 'x' }), list);
});

test('deleteEvent removes only the matching event', () => {
  const list = addEvent(addEvent([], sample), { ...sample, title: 'Second' });
  const next = deleteEvent(list, list[0].id);
  assertEqual(next.length, 1);
  assertEqual(next[0].title, 'Second');
});

test('findEvent returns the event or null', () => {
  const list = addEvent([], sample);
  assertEqual(findEvent(list, list[0].id).title, 'Renewal call');
  assertEqual(findEvent(list, 'missing'), null);
});

test('groupByDate buckets by date key and sorts by time', () => {
  let list = [];
  list = addEvent(list, { ...sample, title: 'Late', time: '16:00' });
  list = addEvent(list, { ...sample, title: 'Early', time: '09:00' });
  list = addEvent(list, { ...sample, title: 'Other day', date: '2025-05-16' });

  const groups = groupByDate(list);
  assertEqual(groups.size, 2);
  assertDeepEqual(groups.get('2025-05-15').map(e => e.title), ['Early', 'Late']);
  assertEqual(groups.get('2025-05-16').length, 1);
});

// ---------- client status and location ----------

test('normalizeEvent defaults status to lead and rejects unknown statuses', () => {
  assertEqual(normalizeEvent({ title: 'x' }).status, 'lead');
  assertEqual(normalizeEvent({ title: 'x', status: 'active' }).status, 'active');
  assertEqual(normalizeEvent({ title: 'x', status: 'ACTIVE' }).status, 'lead');
  assertEqual(normalizeEvent({ title: 'x', status: 'won' }).status, 'lead');
});

test('normalizeEvent trims the location fields and keeps updatedAt', () => {
  const evt = normalizeEvent({ title: 'x', phone: ' +971 4 1 ', location: ' JLT ', city: ' Dubai ', country: ' UAE ', updatedAt: 'T1' });
  assertDeepEqual([evt.phone, evt.location, evt.city, evt.country, evt.updatedAt], ['+971 4 1', 'JLT', 'Dubai', 'UAE', 'T1']);
  const old = normalizeEvent({ title: 'old reminder from before statuses' });
  assertDeepEqual([old.phone, old.location, old.city, old.country, old.updatedAt], ['', '', '', '', '']);
});

test('clientKey ignores case and extra spaces', () => {
  assertEqual(clientKey('  Acme   LTD. '), 'acme ltd.');
  assertEqual(clientKey(''), '');
  assertEqual(clientKey(undefined), '');
});

test('applyClientFields updates every reminder of that client, and only those', () => {
  let list = addEvent([], { ...sample, clientName: 'Acme Ltd.' });
  list = addEvent(list, { ...sample, clientName: '  acme  ltd. ', title: 'Second' });
  list = addEvent(list, { ...sample, clientName: 'Falcon' });
  list = addEvent(list, { ...sample, clientName: '' });

  const next = applyClientFields(list, 'ACME LTD.', { status: 'active', city: 'Dubai', country: 'United Arab Emirates' }, 'T9');
  assertDeepEqual(next.map(e => e.status), ['active', 'active', 'lead', 'lead']);
  assertDeepEqual(next.map(e => e.city), ['Dubai', 'Dubai', '', '']);
  assertEqual(next[0].updatedAt, 'T9');
  assertEqual(next[2].updatedAt, '', 'other clients untouched');
  assertEqual(next[1].title, 'Second', 'other fields kept');
  assertEqual(list[0].status, 'lead', 'input not mutated');
});

test('applyClientFields writes only the given fields and skips reminders with no client', () => {
  let list = addEvent([], { ...sample, clientName: 'Acme', city: 'Dubai', status: 'active' });
  list = addEvent(list, { ...sample, clientName: '' });
  const next = applyClientFields(list, 'Acme', { status: 'inactive' }, 'T1');
  assertEqual(next[0].status, 'inactive');
  assertEqual(next[0].city, 'Dubai', 'unlisted fields kept');
  assertDeepEqual(applyClientFields(list, '', { status: 'active' }), list, 'blank client: nothing changes');
  assertDeepEqual(applyClientFields(list, 'Acme', {}), list, 'no fields: nothing changes');
});
