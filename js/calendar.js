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

/** The views that show a date range; prev/next/Today move through them. */
export const CALENDAR_VIEWS = ['day', 'week', 'month'];

/** 'dashboard' is the Home page, then the calendar, Minutes and the History log. */
export const VIEWS = ['dashboard', ...CALENDAR_VIEWS, 'minutes', 'history'];

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

/**
 * The dates the current calendar view shows, for Clear calendar: the day, the
 * week (Sunday to Saturday) or the month. label is the toolbar's own label.
 * @returns {{view: string, from: string, to: string, label: string}}
 */
export function calendarPeriod(view, date) {
  let from = date;
  let to = date;
  if (view === 'week') {
    from = startOfWeek(date);
    to = addDays(from, 6);
  } else if (view !== 'day') {
    from = new Date(date.getFullYear(), date.getMonth(), 1);
    to = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }
  const shown = CALENDAR_VIEWS.includes(view) ? view : 'month';
  return { view: shown, from: toDateKey(from), to: toDateKey(to), label: formatRangeLabel(shown, date) };
}

// ---------- Day / Week time grid ----------

/** Height of one hour on the Day and Week grids, in px (css/styles.css --hour). */
export const HOUR_PX = 48;
export const DAY_MINUTES = 24 * 60;
/** Moves and resizes snap to this many minutes. */
export const SNAP_MINUTES = 15;

/** 'HH:MM' → minutes after midnight; null when blank or not a time. */
export function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** Minutes after midnight → 'HH:MM', kept inside the day. */
export function minutesToTime(minutes) {
  const m = Math.min(DAY_MINUTES - 1, Math.max(0, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export const minutesToPx = (minutes, hourPx = HOUR_PX) => (minutes / 60) * hourPx;

/** A pixel offset on the grid → minutes, snapped (15 by default). */
export function pxToMinutes(px, hourPx = HOUR_PX, step = SNAP_MINUTES) {
  return Math.round(((px / hourPx) * 60) / step) * step;
}

/**
 * Where a reminder lands after a drag: `minuteDelta` later (snapped) and
 * `dayDelta` days on, its start kept inside the day it lands on.
 * @returns {{date: string, time: string}}
 */
export function moveEventTime({ date, time }, { dayDelta = 0, minuteDelta = 0 }, step = SNAP_MINUTES) {
  const start = timeToMinutes(time) ?? 0;
  const snapped = Math.round((start + minuteDelta) / step) * step;
  const minutes = Math.min(DAY_MINUTES - step, Math.max(0, snapped));
  return { date: toDateKey(addDays(fromDateKey(date), dayDelta)), time: minutesToTime(minutes) };
}

/** A new length after dragging the bottom edge, snapped, at least one step, not past midnight. */
export function resizeDuration(startMinutes, duration, minuteDelta, step = SNAP_MINUTES) {
  const next = Math.round((duration + minuteDelta) / step) * step;
  return Math.max(step, Math.min(DAY_MINUTES - startMinutes, next));
}

/**
 * Side-by-side lanes for one day's timed reminders, like Google Calendar:
 * reminders that overlap share the width; the rest use all of it.
 * items: [{id, start, end}] in minutes.
 * @returns {Map<string, {lane: number, lanes: number}>}
 */
export function layoutOverlaps(items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map();
  let cluster = [];
  let laneEnds = [];
  let clusterEnd = -1;
  const close = () => {
    for (const id of cluster) result.get(id).lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd) close();
    let lane = laneEnds.findIndex(end => end <= item.start);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = item.end;
    clusterEnd = Math.max(clusterEnd, item.end);
    cluster.push(item.id);
    result.set(item.id, { lane, lanes: 1 });
  }
  close();
  return result;
}
