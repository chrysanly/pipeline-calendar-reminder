import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  runningSession, startSession, minutesBetween, stopSession, formatClock, formatDuration, parseDuration,
  manualSession, clientSessions, totalMinutes, validateExpense, expenseRecord, clientExpenses, expenseTotals,
  MAX_SESSION_MINUTES
} from '../js/timetrack.js';

const T0 = new Date('2026-09-28T08:00:00.000Z');
const plus = minutes => new Date(T0.getTime() + minutes * 60000);

test('startSession and stopSession: a running session with no end, then whole minutes', () => {
  const session = startSession(' Acme  Ltd. ', T0);
  assertDeepEqual(session, { clientKey: 'acme ltd.', clientName: 'Acme Ltd.', start: T0.toISOString(), end: null, minutes: 0, note: '' });
  assertEqual(runningSession([{ start: 'x', end: 'y' }, session]), session);
  assertEqual(runningSession([{ start: 'x', end: 'y' }]), null);
  assertDeepEqual(stopSession(session, plus(95.4), ' Wireframes '), { end: plus(95.4).toISOString(), minutes: 95, note: 'Wireframes' });
});

test('minutesBetween: at least 1 minute, at most 24 hours', () => {
  assertEqual(minutesBetween(T0.toISOString(), plus(0.2).toISOString()), 1);
  assertEqual(minutesBetween(T0.toISOString(), plus(3000).toISOString()), MAX_SESSION_MINUTES);
  assertEqual(minutesBetween('bad', 'worse'), 0);
});

test('formatClock and formatDuration', () => {
  assertEqual(formatClock(245000), '0:04:05');
  assertEqual(formatClock(3600000 * 2 + 61000), '2:01:01');
  assertEqual(formatClock(-5), '0:00:00');
  assertEqual(formatDuration(65), '1h 05m');
  assertEqual(formatDuration(45), '45m');
  assertEqual(formatDuration(0), '0m');
});

test('parseDuration reads 1:30, 90, 90m, 1.5h and 1h 30m', () => {
  for (const [input, minutes] of [['1:30', 90], ['90', 90], ['90m', 90], ['90 min', 90], ['1.5h', 90], ['1h 30m', 90], ['2 hours', 120], ['24h', 1440]]) {
    assertEqual(parseDuration(input), minutes, input);
  }
  for (const bad of ['', '0', 'abc', '25h', '1:75', '-5']) assertEqual(parseDuration(bad), null, bad);
});

test('manualSession: that day from 09:00 local, checked', () => {
  const { session, error } = manualSession('Acme Ltd.', { date: '2026-09-25', duration: '1:30', note: 'Call' });
  assertEqual(error, '');
  const start = new Date(session.start);
  assertDeepEqual([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()], [2026, 8, 25, 9]);
  assertEqual(session.minutes, 90);
  assertEqual(new Date(session.end) - start, 90 * 60000);
  assertEqual(session.manual, true);
  assert(/1:30/.test(manualSession('A', { date: '2026-09-25', duration: 'soon' }).error));
  assert(/day/.test(manualSession('A', { date: '', duration: '1h' }).error));
});

test('clientSessions and totalMinutes: finished sessions of one client, newest first', () => {
  const sessions = [
    { id: 'a', clientKey: 'acme ltd.', start: '2026-09-20T08:00:00Z', end: '2026-09-20T09:00:00Z', minutes: 60 },
    { id: 'b', clientName: 'ACME Ltd.', start: '2026-09-22T08:00:00Z', end: '2026-09-22T08:30:00Z', minutes: 30 },
    { id: 'c', clientKey: 'acme ltd.', start: '2026-09-28T08:00:00Z', end: null },
    { id: 'd', clientKey: 'falcon', start: '2026-09-23T08:00:00Z', end: '2026-09-23T09:00:00Z', minutes: 60 }
  ];
  const mine = clientSessions(sessions, 'Acme Ltd.');
  assertDeepEqual(mine.map(s => s.id), ['b', 'a']);
  assertEqual(totalMinutes(mine), 90);
  assertEqual(totalMinutes(sessions), 150, 'a running session counts nothing');
});

test('validateExpense checks amount, currency and date; unknown categories become Other', () => {
  const { expense, errors } = validateExpense({ date: '2026-09-26', amount: '1,200.50', currency: 'usd', category: 'Travel', note: ' Flight ' });
  assertDeepEqual(errors, {});
  assertDeepEqual(expense, { date: '2026-09-26', amount: 1200.5, currency: 'USD', category: 'Travel', note: 'Flight' });
  assertEqual(validateExpense({ date: '2026-09-26', amount: '10', category: 'Yacht' }, 'EUR').expense.category, 'Other');
  assertEqual(validateExpense({ date: '2026-09-26', amount: '10' }, 'EUR').expense.currency, 'EUR');
  const bad = validateExpense({ date: '2026-02-31', amount: '0', currency: 'BTC' });
  assertEqual(bad.expense, null);
  assertDeepEqual(Object.keys(bad.errors).sort(), ['amount', 'currency', 'date']);
});

test('expenseRecord, clientExpenses and expenseTotals per currency', () => {
  assertDeepEqual(expenseRecord(' Acme Ltd.', { amount: 5 }), { clientKey: 'acme ltd.', clientName: 'Acme Ltd.', amount: 5 });
  const list = [
    { id: 'a', clientKey: 'acme ltd.', date: '2026-09-20', amount: 100.1, currency: 'AED' },
    { id: 'b', clientKey: 'acme ltd.', date: '2026-09-26', amount: 200.2, currency: 'AED' },
    { id: 'c', clientKey: 'acme ltd.', date: '2026-09-22', amount: 40, currency: 'USD' },
    { id: 'd', clientKey: 'falcon', date: '2026-09-22', amount: 1, currency: 'USD' }
  ];
  const mine = clientExpenses(list, 'acme ltd.');
  assertDeepEqual(mine.map(e => e.id), ['b', 'c', 'a']);
  assertDeepEqual(expenseTotals(mine), { AED: 300.3, USD: 40 });
  assertDeepEqual(expenseTotals([]), {});
});
