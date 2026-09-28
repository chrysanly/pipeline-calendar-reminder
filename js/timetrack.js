// Time and expenses per client, pure. A session is a record in the `time`
// collection ({clientKey, clientName, start, end, minutes, note}); end is null
// while its timer runs, so a running timer survives a reload and shows on
// every device. Expenses are records in `expenses`.

import { toDateKey, fromDateKey } from './calendar.js';
import { clientKey } from './storage.js';
import { parseAmount } from './deals.js';
import { CURRENCIES } from './store.js';

export const EXPENSE_CATEGORIES = ['Travel', 'Meals', 'Software', 'Materials', 'Subcontractor', 'Other'];

/** Longest single session: 24 hours. */
export const MAX_SESSION_MINUTES = 24 * 60;

const ttText = value => (value === null || value === undefined ? '' : String(value).trim());
const ofClient = (list, name) => {
  const key = clientKey(name);
  return list.filter(record => record.clientKey === key || clientKey(record.clientName) === key);
};

// ---------- sessions ----------

/** The session whose timer is running (at most one), or null. */
export function runningSession(sessions) {
  return sessions.find(session => session.start && !session.end) || null;
}

/** A new running session for this client. */
export function startSession(name, now = new Date()) {
  return { clientKey: clientKey(name), clientName: ttText(name).replace(/\s+/g, ' '), start: now.toISOString(), end: null, minutes: 0, note: '' };
}

/** Whole minutes between two ISO times: at least 1, at most MAX_SESSION_MINUTES. */
export function minutesBetween(startIso, endIso) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_SESSION_MINUTES, Math.max(1, Math.round(ms / 60000)));
}

/** The patch that stops a running session. */
export function stopSession(session, now = new Date(), note = '') {
  const end = now.toISOString();
  return { end, minutes: minutesBetween(session.start, end), note: ttText(note) || ttText(session.note) };
}

/** "0:04:05" for the running timer. */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "1h 05m", "45m", "0m". */
export function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "1:30", "90", "90m", "1.5h", "1h 30m", "2h" → minutes; blank, zero or over 24h → null. */
export function parseDuration(input) {
  const raw = ttText(input).toLowerCase().replace(/\s+/g, ' ');
  let minutes = null;
  let match;
  if ((match = raw.match(/^(\d{1,2}):([0-5]\d)$/))) minutes = Number(match[1]) * 60 + Number(match[2]);
  else if ((match = raw.match(/^(\d+(?:\.\d+)?) ?h(?:ours?|rs?)?(?: ?(\d{1,2}) ?m(?:in(?:utes?|s)?)?)?$/))) {
    minutes = Math.round(Number(match[1]) * 60) + Number(match[2] || 0);
  } else if ((match = raw.match(/^(\d+) ?(?:m|min|mins|minutes?)?$/))) minutes = Number(match[1]);
  if (!minutes || minutes > MAX_SESSION_MINUTES) return null;
  return minutes;
}

/**
 * A session typed in by hand: that day at 09:00 local, lasting `duration`.
 * @returns {{session: object|null, error: string}}
 */
export function manualSession(name, { date, duration, note = '' }) {
  const minutes = parseDuration(duration);
  if (!minutes) return { session: null, error: 'Enter a time like 1:30, 90m or 1.5h (up to 24h).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ttText(date))) return { session: null, error: 'Pick the day you worked.' };
  const start = fromDateKey(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + minutes * 60000);
  return {
    session: { ...startSession(name, start), end: end.toISOString(), minutes, note: ttText(note).slice(0, 500), manual: true },
    error: ''
  };
}

/** One client's finished sessions, newest first. */
export function clientSessions(sessions, name) {
  return ofClient(sessions, name).filter(s => s.end).sort((a, b) => ttText(b.start).localeCompare(ttText(a.start)));
}

export function totalMinutes(sessions) {
  return sessions.reduce((sum, session) => sum + (session.end ? session.minutes || 0 : 0), 0);
}

// ---------- expenses ----------

/**
 * Check an expense from the form.
 * @returns {{expense: object|null, errors: Object<string, string>}}
 */
export function validateExpense(input, fallbackCurrency = 'AED') {
  const errors = {};
  const amount = parseAmount(input.amount);
  if (!amount) errors.amount = 'Enter an amount like 250 or 1,200.50.';
  const currency = ttText(input.currency || fallbackCurrency).toUpperCase();
  if (!CURRENCIES.includes(currency)) errors.currency = 'Pick a currency from the list.';
  const date = ttText(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toDateKey(fromDateKey(date)) !== date) errors.date = 'Pick the date of the expense.';
  const category = EXPENSE_CATEGORIES.includes(input.category) ? input.category : 'Other';
  if (Object.keys(errors).length) return { expense: null, errors };
  return { expense: { date, amount, currency, category, note: ttText(input.note).slice(0, 500) }, errors };
}

/** What to store for a new expense of this client. */
export function expenseRecord(name, expense) {
  return { clientKey: clientKey(name), clientName: ttText(name).replace(/\s+/g, ' '), ...expense };
}

/** One client's expenses, newest first. */
export function clientExpenses(expenses, name) {
  return ofClient(expenses, name).sort((a, b) => ttText(b.date).localeCompare(ttText(a.date)) || ttText(b.createdAt).localeCompare(ttText(a.createdAt)));
}

/** Sum per currency, never converted: { AED: 1250, USD: 40 }. */
export function expenseTotals(expenses) {
  const totals = {};
  for (const { amount, currency } of expenses) {
    if (!currency || !amount) continue;
    totals[currency] = Math.round(((totals[currency] || 0) + amount) * 100) / 100;
  }
  return totals;
}
