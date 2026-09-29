import { test, assert, assertEqual, assertDeepEqual, fakeStorage } from './runner.js';
import {
  STORAGE_KEY, loadEvents, saveEvents, addEvent, updateEvent,
  deleteEvent, findEvent, groupByDate, normalizeEvent, applyClientFields, clientKey,
  hideFromCalendar, calendarEvents, setClientOnCalendar, calendarCounts, countOnCalendar
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

// ---------- Clear calendar ----------

const onDays = (...dates) => dates.map((date, i) => normalizeEvent({ id: `e${i}`, title: `T${i}`, date }));

test('hideFromCalendar with no dates hides every dated reminder and counts them', () => {
  const list = onDays('2026-10-01', '2026-10-15', '');
  const { events, count } = hideFromCalendar(list, {}, 'T1');
  assertEqual(count, 2);
  assertDeepEqual(events.map(e => Boolean(e.calendarHidden)), [true, true, false]);
  assertEqual(events[0].updatedAt, 'T1');
  assertEqual(list[0].calendarHidden, undefined, 'the input is not mutated');
});

test('hideFromCalendar keeps to From and To, both inclusive, either one optional', () => {
  const list = onDays('2026-09-30', '2026-10-01', '2026-10-31', '2026-11-01');
  const hidden = range => hideFromCalendar(list, range).events.map(e => Boolean(e.calendarHidden));
  assertDeepEqual(hidden({ from: '2026-10-01', to: '2026-10-31' }), [false, true, true, false]);
  assertDeepEqual(hidden({ from: '2026-10-31' }), [false, false, true, true]);
  assertDeepEqual(hidden({ to: '2026-10-01' }), [true, true, false, false]);
});

test('hideFromCalendar refuses From after To, and counts only newly hidden reminders', () => {
  let message = '';
  try { hideFromCalendar(onDays('2026-10-01'), { from: '2026-10-02', to: '2026-10-01' }); } catch (err) { message = err.message; }
  assertEqual(message, '"From" must be on or before "To".');
  const once = hideFromCalendar(onDays('2026-10-01', '2026-10-02'), { to: '2026-10-01' }).events;
  const twice = hideFromCalendar(once, {});
  assertEqual(twice.count, 1);
  const none = hideFromCalendar(twice.events, {});
  assertEqual(none.count, 0);
  assertEqual(none.events, twice.events, 'nothing hidden: the same list comes back');
});

test('calendarEvents leaves out hidden reminders; normalizeEvent keeps the flag only when set', () => {
  const { events } = hideFromCalendar(onDays('2026-10-01', '2026-11-01'), { to: '2026-10-31' });
  assertDeepEqual(calendarEvents(events).map(e => e.id), ['e1']);
  assertEqual(normalizeEvent({ ...events[0] }).calendarHidden, true);
  assert(!('calendarHidden' in normalizeEvent({ ...events[0], calendarHidden: false })), 'false drops the key');
  assertEqual(findEvent(events, 'e0').title, 'T0', 'hidden reminders are still in the data');
});

test('normalizeEvent keeps the duplicate mark of an imported row only', () => {
  assertEqual(normalizeEvent({ title: 'x', importKey: 'acme|2026-10-01#1', duplicate: true }).duplicate, true);
  assertEqual('duplicate' in normalizeEvent({ title: 'x', importKey: 'acme|2026-10-01' }), false);
  assertEqual('duplicate' in normalizeEvent({ title: 'x', duplicate: true }), false, 'only imports can be duplicates');
});

const onCal = [
  { id: 'a', clientName: 'Acme', title: 'A', date: '2026-10-01', time: '09:00', calendarHidden: true },
  { id: 'b', clientName: ' acme ', title: 'B', date: '2026-10-02', time: '', calendarHidden: true },
  { id: 'c', clientName: 'Acme', title: 'C', date: '2026-10-03', time: '10:00' },
  { id: 'd', clientName: 'Falcon', title: 'D', date: '2026-10-01', time: '09:00', calendarHidden: true },
  { id: 'e', clientName: 'Acme', title: 'Undated', date: '', time: '', calendarHidden: true }
];

test('setClientOnCalendar puts one client\'s dated reminders on the calendar, or takes them off', () => {
  const on = setClientOnCalendar(onCal, 'ACME', true, 'T1');
  assertEqual(on.count, 2);
  assertDeepEqual(on.events.map(e => Boolean(e.calendarHidden)), [false, false, false, true, true]);
  assertEqual(on.events[0].updatedAt, 'T1');
  assertEqual(on.events[2], onCal[2], 'already on it: untouched');
  const off = setClientOnCalendar(on.events, 'Acme', false, 'T2');
  assertEqual(off.count, 3);
  assertDeepEqual(off.events.map(e => Boolean(e.calendarHidden)), [true, true, true, true, true]);
  const none = setClientOnCalendar(off.events, 'Acme', false);
  assertEqual(none.count, 0);
  assertEqual(none.events, off.events, 'nothing to change: the same list');
  assertEqual(setClientOnCalendar(onCal, '  ', true).count, 0, 'no client name: nothing changes');
});

test('calendarCounts: a client\'s dated reminders on and off the calendar', () => {
  assertDeepEqual(calendarCounts(onCal, 'acme'), { shown: 1, hidden: 2 });
  assertDeepEqual(calendarCounts(onCal, 'Falcon'), { shown: 0, hidden: 1 });
  assertDeepEqual(calendarCounts(onCal, 'Nobody'), { shown: 0, hidden: 0 });
});

test('countOnCalendar: the reminders still on the calendar in a period, both ends included', () => {
  const list = [
    { id: 'a', date: '2026-10-01' }, { id: 'b', date: '2026-10-03' }, { id: 'c', date: '2026-10-03', calendarHidden: true },
    { id: 'd', date: '2026-10-04' }, { id: 'e', date: '' }
  ];
  assertEqual(countOnCalendar(list, { from: '2026-10-03', to: '2026-10-03' }), 1, 'a day');
  assertEqual(countOnCalendar(list, { from: '2026-10-01', to: '2026-10-04' }), 3, 'the hidden and undated ones do not count');
  assertEqual(countOnCalendar(list, { from: '2026-11-01', to: '2026-11-30' }), 0);
  assertEqual(countOnCalendar([], { from: '2026-10-01', to: '2026-10-31' }), 0);
});
