// Pure date logic for the calendar grid. No DOM, no storage.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Format a Date as a 'YYYY-MM-DD' key in local time. */
export function toDateKey(date) {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a 'YYYY-MM-DD' key into a local Date at midnight. */
export function fromDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Return a new Date shifted by `count` months, clamped to the last valid day. */
export function addMonths(date, count) {
  const year = date.getFullYear();
  const month = date.getMonth() + count;
  const target = new Date(year, month, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

export function formatMonthLabel(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

export function weekdayNames() {
  return WEEKDAY_NAMES.slice();
}

/**
 * Build the 42-cell (6 weeks) grid for the given month.
 * @returns {{date: Date, key: string, inMonth: boolean, isToday: boolean}[]}
 */
export function getMonthGrid(year, month, today = new Date()) {
  const first = new Date(year, month, 1);
  const offset = first.getDay(); // 0 = Sunday
  const todayKey = toDateKey(today);
  const cells = [];

  for (let i = 0; i < 42; i++) {
    const date = new Date(year, month, 1 - offset + i);
    const key = toDateKey(date);
    cells.push({
      date,
      key,
      inMonth: date.getMonth() === month && date.getFullYear() === year,
      isToday: key === todayKey
    });
  }
  return cells;
}

/** Human-friendly label for a day, e.g. "Mon, 5 May 2025". */
export function formatDayLabel(key) {
  const date = fromDateKey(key);
  return `${WEEKDAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

/** 'dashboard' is the Home page; the other three are calendar views. */
export const VIEWS = ['dashboard', 'day', 'week', 'month'];

const shortMonth = date => MONTH_NAMES[date.getMonth()].slice(0, 3);

/** A new local-midnight Date `n` days after `date` (negative goes back). */
export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

/** The Sunday on or before `date`, at local midnight. */
export function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

/**
 * The 7 days (Sunday first) of the week containing `date`, shaped like
 * getMonthGrid cells.
 */
export function getWeekDays(date, today = new Date()) {
  const start = startOfWeek(date);
  const todayKey = toDateKey(today);
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const key = toDateKey(day);
    cells.push({ date: day, key, inMonth: true, isToday: key === todayKey });
  }
  return cells;
}

/** Move the cursor by `delta` units of the current view. */
export function shiftCursor(view, date, delta) {
  if (view === 'day') return addDays(date, delta);
  if (view === 'week') return addDays(date, 7 * delta);
  return addMonths(date, delta);
}

/** Header label: "Sun, 27 Sep 2026", "27 Sep – 3 Oct 2026" or "September 2026". */
export function formatRangeLabel(view, date) {
  if (view === 'day') {
    return `${WEEKDAY_NAMES[date.getDay()]}, ${date.getDate()} ${shortMonth(date)} ${date.getFullYear()}`;
  }
  if (view === 'week') {
    const start = startOfWeek(date);
    const end = addDays(start, 6);
    if (start.getFullYear() !== end.getFullYear()) {
      return `${start.getDate()} ${shortMonth(start)} ${start.getFullYear()} – ${end.getDate()} ${shortMonth(end)} ${end.getFullYear()}`;
    }
    if (start.getMonth() !== end.getMonth()) {
      return `${start.getDate()} ${shortMonth(start)} – ${end.getDate()} ${shortMonth(end)} ${end.getFullYear()}`;
    }
    return `${start.getDate()} – ${end.getDate()} ${shortMonth(end)} ${end.getFullYear()}`;
  }
  return formatMonthLabel(date.getFullYear(), date.getMonth());
}

/** A sorted copy: by date, then time (blank times first). */
export function eventsSortedByTime(list) {
  return list.slice().sort((a, b) =>
    (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
}
