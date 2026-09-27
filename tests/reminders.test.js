import { test, assertEqual, assertDeepEqual } from './runner.js';
import { dueReminders, eventDateTime, reminderMessage, popupTitle } from '../js/reminders.js';

const base = {
  id: 'a',
  clientName: 'Acme Ltd.',
  title: 'Renewal call',
  date: '2025-05-15',
  time: '10:00',
  notes: 'Discuss terms',
  reminderMinutesBefore: 15,
  notified: false
};

const at = (h, m) => new Date(2025, 4, 15, h, m, 0, 0);

test('eventDateTime combines date and time locally', () => {
  const when = eventDateTime(base);
  assertEqual(when.getFullYear(), 2025);
  assertEqual(when.getMonth(), 4);
  assertEqual(when.getDate(), 15);
  assertEqual(when.getHours(), 10);
  assertEqual(when.getMinutes(), 0);
});

test('eventDateTime defaults a missing time to 09:00', () => {
  assertEqual(eventDateTime({ ...base, time: '' }).getHours(), 9);
});

test('eventDateTime returns null for a missing date', () => {
  assertEqual(eventDateTime({ ...base, date: '' }), null);
});

test('not due before the reminder window opens', () => {
  assertDeepEqual(dueReminders([base], at(9, 44)), []);
});

test('due exactly at the reminder moment', () => {
  assertEqual(dueReminders([base], at(9, 45)).length, 1);
});

test('due after the reminder moment', () => {
  assertEqual(dueReminders([base], at(9, 59)).length, 1);
});

test('still due at the event start time', () => {
  assertEqual(dueReminders([base], at(10, 0)).length, 1);
});

test('already notified events are skipped', () => {
  assertDeepEqual(dueReminders([{ ...base, notified: true }], at(10, 0)), []);
});

test('reminderMinutesBefore 0 fires only at start time', () => {
  const evt = { ...base, reminderMinutesBefore: 0 };
  assertDeepEqual(dueReminders([evt], at(9, 59)), []);
  assertEqual(dueReminders([evt], at(10, 0)).length, 1);
});

test('events more than a day past are treated as stale', () => {
  const later = new Date(2025, 4, 16, 10, 1, 0, 0);
  assertDeepEqual(dueReminders([base], later), []);
  const justInside = new Date(2025, 4, 16, 9, 59, 0, 0);
  assertEqual(dueReminders([base], justInside).length, 1);
});

test('events with a broken date are ignored', () => {
  assertDeepEqual(dueReminders([{ ...base, date: '' }], at(10, 0)), []);
});

test('only the due events are returned from a mixed list', () => {
  const list = [
    base,
    { ...base, id: 'b', time: '23:00' },
    { ...base, id: 'c', notified: true }
  ];
  assertDeepEqual(dueReminders(list, at(10, 0)).map(e => e.id), ['a']);
});

test('reminderMessage includes time, client and notes', () => {
  assertEqual(reminderMessage(base), '10:00 · Acme Ltd. — Discuss terms');
});

test('reminderMessage falls back when notes are empty', () => {
  assertEqual(reminderMessage({ ...base, notes: '' }), '10:00 · Acme Ltd. — Reminder');
});

test('popupTitle greets with the reminder title', () => {
  assertEqual(popupTitle(base), 'Hey you have a Renewal call');
});
