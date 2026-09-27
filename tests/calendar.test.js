import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  getMonthGrid, toDateKey, fromDateKey, addMonths, formatMonthLabel, formatDayLabel,
  addDays, startOfWeek, getWeekDays, shiftCursor, formatRangeLabel, eventsSortedByTime
} from '../js/calendar.js';

test('toDateKey zero-pads month and day', () => {
  assertEqual(toDateKey(new Date(2025, 0, 5)), '2025-01-05');
  assertEqual(toDateKey(new Date(2025, 11, 31)), '2025-12-31');
});

test('fromDateKey round-trips toDateKey', () => {
  const key = '2024-02-29';
  assertEqual(toDateKey(fromDateKey(key)), key);
});

test('getMonthGrid always returns 42 cells', () => {
  assertEqual(getMonthGrid(2025, 0).length, 42);
  assertEqual(getMonthGrid(2025, 1).length, 42);
  assertEqual(getMonthGrid(2026, 7).length, 42);
});

test('grid starts on the Sunday on or before the 1st', () => {
  // 1 May 2025 is a Thursday -> grid starts Sun 27 Apr 2025.
  const cells = getMonthGrid(2025, 4);
  assertEqual(cells[0].key, '2025-04-27');
  assertEqual(cells[0].inMonth, false);
  assertEqual(cells[0].date.getDay(), 0);
});

test('grid starts on the 1st when the month begins on a Sunday', () => {
  // 1 June 2025 is a Sunday.
  const cells = getMonthGrid(2025, 5);
  assertEqual(cells[0].key, '2025-06-01');
  assertEqual(cells[0].inMonth, true);
});

test('leap year February 2024 has 29 in-month days', () => {
  const inMonth = getMonthGrid(2024, 1).filter(c => c.inMonth);
  assertEqual(inMonth.length, 29);
  assertEqual(inMonth[28].key, '2024-02-29');
});

test('non-leap February 2025 has 28 in-month days', () => {
  assertEqual(getMonthGrid(2025, 1).filter(c => c.inMonth).length, 28);
});

test('isToday marks exactly one cell for the given today', () => {
  const today = new Date(2025, 4, 15);
  const flagged = getMonthGrid(2025, 4, today).filter(c => c.isToday);
  assertEqual(flagged.length, 1);
  assertEqual(flagged[0].key, '2025-05-15');
});

test('addMonths crosses the year boundary', () => {
  assertEqual(toDateKey(addMonths(new Date(2025, 11, 1), 1)), '2026-01-01');
  assertEqual(toDateKey(addMonths(new Date(2025, 0, 1), -1)), '2024-12-01');
});

test('addMonths clamps to the last day of a shorter month', () => {
  assertEqual(toDateKey(addMonths(new Date(2025, 0, 31), 1)), '2025-02-28');
});

test('formatMonthLabel and formatDayLabel', () => {
  assertEqual(formatMonthLabel(2025, 4), 'May 2025');
  assertEqual(formatDayLabel('2025-05-15'), 'Thu, 15 May 2025');
});

test('grid cell dates are contiguous', () => {
  const cells = getMonthGrid(2025, 2); // March 2025, includes a DST change
  const keys = cells.map(c => c.key);
  assertDeepEqual(keys.length, 42);
  for (let i = 1; i < cells.length; i++) {
    const prev = fromDateKey(keys[i - 1]);
    const expected = toDateKey(new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1));
    assertEqual(keys[i], expected, `cell ${i} should follow ${keys[i - 1]}`);
  }
});

test('addDays crosses month and year ends', () => {
  assertEqual(toDateKey(addDays(new Date(2026, 8, 30), 1)), '2026-10-01');
  assertEqual(toDateKey(addDays(new Date(2026, 11, 31), 1)), '2027-01-01');
  assertEqual(toDateKey(addDays(new Date(2027, 0, 1), -1)), '2026-12-31');
  assertEqual(toDateKey(addDays(new Date(2024, 1, 28), 1)), '2024-02-29');
});

test('addDays returns local midnight across a DST change', () => {
  const next = addDays(new Date(2025, 2, 29, 15, 30), 2);
  assertEqual(toDateKey(next), '2025-03-31');
  assertEqual(next.getHours(), 0);
});

test('startOfWeek returns the Sunday on or before the date', () => {
  assertEqual(toDateKey(startOfWeek(new Date(2026, 9, 1))), '2026-09-27'); // Thu
  assertEqual(toDateKey(startOfWeek(new Date(2026, 8, 27))), '2026-09-27'); // Sun itself
  assertEqual(toDateKey(startOfWeek(new Date(2027, 0, 2))), '2026-12-27'); // Sat, across year
});

test('getWeekDays returns 7 contiguous days, Sunday first, with isToday', () => {
  const today = new Date(2026, 8, 29);
  const days = getWeekDays(new Date(2026, 9, 1), today);
  assertEqual(days.length, 7);
  assertEqual(days[0].date.getDay(), 0);
  assertDeepEqual(days.map(d => d.key), [
    '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
    '2026-10-01', '2026-10-02', '2026-10-03'
  ]);
  assertDeepEqual(days.filter(d => d.isToday).map(d => d.key), ['2026-09-29']);
  assert(days.every(d => d.inMonth === true), 'week cells should all be inMonth');
});

test('shiftCursor moves by one day, week or month', () => {
  const d = new Date(2026, 8, 27);
  assertEqual(toDateKey(shiftCursor('day', d, 1)), '2026-09-28');
  assertEqual(toDateKey(shiftCursor('day', d, -1)), '2026-09-26');
  assertEqual(toDateKey(shiftCursor('week', d, 1)), '2026-10-04');
  assertEqual(toDateKey(shiftCursor('week', d, -1)), '2026-09-20');
  assertEqual(toDateKey(shiftCursor('month', d, 1)), '2026-10-27');
  assertEqual(toDateKey(shiftCursor('month', d, -1)), '2026-08-27');
});

test('shiftCursor month clamps 31 Jan + 1 month to the end of February', () => {
  assertEqual(toDateKey(shiftCursor('month', new Date(2026, 0, 31), 1)), '2026-02-28');
  assertEqual(toDateKey(shiftCursor('month', new Date(2024, 0, 31), 1)), '2024-02-29');
});

test('formatRangeLabel for day, week and month', () => {
  assertEqual(formatRangeLabel('day', new Date(2026, 8, 27)), 'Sun, 27 Sep 2026');
  assertEqual(formatRangeLabel('week', new Date(2026, 8, 30)), '27 Sep – 3 Oct 2026');
  assertEqual(formatRangeLabel('week', new Date(2026, 9, 7)), '4 – 10 Oct 2026');
  assertEqual(formatRangeLabel('week', new Date(2026, 11, 30)), '27 Dec 2026 – 2 Jan 2027');
  assertEqual(formatRangeLabel('month', new Date(2026, 8, 27)), 'September 2026');
});

test('eventsSortedByTime orders by date then time without mutating', () => {
  const list = [
    { id: 'c', date: '2026-09-28', time: '08:00' },
    { id: 'b', date: '2026-09-27', time: '14:30' },
    { id: 'a', date: '2026-09-27', time: '09:00' },
    { id: 'z', date: '2026-09-27', time: '' }
  ];
  assertDeepEqual(eventsSortedByTime(list).map(e => e.id), ['z', 'a', 'b', 'c']);
  assertEqual(list[0].id, 'c', 'input list was mutated');
});
