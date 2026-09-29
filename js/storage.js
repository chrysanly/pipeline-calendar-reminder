// Event persistence. Pure functions over an injectable storage object so
// tests can pass a fake instead of window.localStorage.

export const STORAGE_KEY = 'client-calendar.events.v1';

const defaultStore = typeof localStorage !== 'undefined' ? localStorage : null;

/**
 * Event shape:
 * { id, clientName, title, date 'YYYY-MM-DD', time 'HH:mm',
 *   notes, reminderMinutesBefore, notified, durationMinutes? }
 */

export function createId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadEvents(store = defaultStore) {
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    // Corrupt payload: start clean rather than breaking the app.
    return [];
  }
}

export function saveEvents(list, store = defaultStore) {
  if (!store) return list;
  store.setItem(STORAGE_KEY, JSON.stringify(list));
  return list;
}

/** Local mode: this browser's localStorage, same interface as cloudBackend. */
export function localBackend(store = defaultStore) {
  return {
    kind: 'local',
    load: () => loadEvents(store),
    write(prev, next) {
      try {
        saveEvents(next, store);
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };
}

/** A client's pipeline stage. Every reminder carries its client's status. */
export const STATUSES = ['lead', 'potential', 'active', 'inactive'];

export const STATUS_LABELS = { lead: 'Lead', potential: 'Potential', active: 'Active', inactive: 'Inactive' };

const text = value => (value === null || value === undefined ? '' : String(value).trim());

/** Case- and spacing-insensitive client identity: " ACME  Ltd " === "acme ltd". */
export function clientKey(name) {
  return text(name).replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeEvent(data) {
  const evt = {
    id: data.id || createId(),
    clientName: text(data.clientName),
    title: text(data.title),
    date: data.date || '',
    time: data.time || '',
    notes: text(data.notes),
    reminderMinutesBefore: Number(data.reminderMinutesBefore) || 0,
    notified: Boolean(data.notified),
    // Older reminders have none of these; they read as a lead with no location.
    status: STATUSES.includes(data.status) ? data.status : 'lead',
    phone: text(data.phone),
    location: text(data.location),
    city: text(data.city),
    country: text(data.country),
    updatedAt: text(data.updatedAt)
  };
  // Only imported reminders carry these; they let a re-import update in place.
  if (data.importKey) {
    evt.source = data.source || 'import';
    evt.importKey = data.importKey;
    // A row an upload added again rather than updating (importer.js).
    if (data.duplicate) evt.duplicate = true;
  }
  // Cleared from the calendar: still on Home, no popup (hideFromCalendar).
  if (data.calendarHidden) evt.calendarHidden = true;
  // Length on the Day/Week grid; older reminders have none and read as 30 min.
  const duration = parseEventLength(data.durationMinutes);
  if (duration) evt.durationMinutes = duration;
  return evt;
}

export const DEFAULT_DURATION = 30;
export const MIN_DURATION = 15;
export const MAX_DURATION = 1440;

/** A length in minutes, whole and within 15 min–24 h; null when blank or not a number. */
export function parseEventLength(value) {
  if (value === '' || value === null || value === undefined) return null;
  const minutes = Math.round(Number(value));
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, minutes));
}

/** How long a reminder lasts on the grid. */
export const eventDuration = evt => parseEventLength(evt && evt.durationMinutes) || DEFAULT_DURATION;

export function addEvent(list, data) {
  return list.concat(normalizeEvent(data));
}

export function updateEvent(list, id, patch) {
  return list.map(evt => (evt.id === id ? normalizeEvent({ ...evt, ...patch, id }) : evt));
}

const CLIENT_FIELDS = ['status', 'phone', 'location', 'city', 'country'];

/**
 * Copy client-level fields onto every reminder for the same client, so a
 * client always has one status and one location. Only the fields given (not
 * undefined) are written. Reminders without a client name are left alone.
 */
export function applyClientFields(list, clientName, fields, updatedAt = new Date().toISOString()) {
  const key = clientKey(clientName);
  if (!key) return list;
  const patch = {};
  for (const field of CLIENT_FIELDS) {
    if (fields[field] !== undefined) patch[field] = fields[field];
  }
  if (!Object.keys(patch).length) return list;
  return list.map(evt => (clientKey(evt.clientName) === key
    ? normalizeEvent({ ...evt, ...patch, updatedAt })
    : evt));
}

export function deleteEvent(list, id) {
  return list.filter(evt => evt.id !== id);
}

export function findEvent(list, id) {
  return list.find(evt => evt.id === id) || null;
}

/** Group events by their date key, each group sorted by time. */
export function groupByDate(list) {
  const map = new Map();
  for (const evt of list) {
    if (!map.has(evt.date)) map.set(evt.date, []);
    map.get(evt.date).push(evt);
  }
  for (const group of map.values()) {
    group.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }
  return map;
}

/** The reminders the calendar views and popups show: not cleared from the calendar. */
export function calendarEvents(list) {
  return list.filter(evt => !evt.calendarHidden);
}

/**
 * Put every dated reminder of one client on the calendar (`onCalendar` true)
 * or take them off it. Imports start off it (importer.js).
 * @returns {{events: object[], count: number}} count: how many changed
 */
export function setClientOnCalendar(list, clientName, onCalendar, updatedAt = new Date().toISOString()) {
  const key = clientKey(clientName);
  let count = 0;
  const events = list.map(evt => {
    if (!key || clientKey(evt.clientName) !== key || !evt.date) return evt;
    if (Boolean(evt.calendarHidden) === !onCalendar) return evt;
    count++;
    return normalizeEvent({ ...evt, calendarHidden: !onCalendar, updatedAt });
  });
  return { events: count ? events : list, count };
}

/** How many of a client's dated reminders are on / off the calendar. */
export function calendarCounts(list, clientName) {
  const key = clientKey(clientName);
  const mine = list.filter(evt => key && clientKey(evt.clientName) === key && evt.date);
  const hidden = mine.filter(evt => evt.calendarHidden).length;
  return { shown: mine.length - hidden, hidden };
}

/** How many reminders on the calendar fall in from..to (inclusive): what Clear calendar would clear. */
export function countOnCalendar(list, { from = '', to = '' } = {}) {
  return calendarEvents(list).filter(evt => evt.date && (!from || evt.date >= from) && (!to || evt.date <= to)).length;
}

/**
 * Clear reminders from the calendar only: they stay on Home and in the data,
 * but no longer show on the calendar or pop up. `from` / `to` are optional
 * 'YYYY-MM-DD' bounds, both inclusive; blank means open-ended.
 * @returns {{events: object[], count: number}} count: how many were hidden now
 * @throws when `from` is after `to`
 */
export function hideFromCalendar(list, { from = '', to = '' } = {}, updatedAt = new Date().toISOString()) {
  if (from && to && from > to) throw new Error('"From" must be on or before "To".');
  const inRange = evt => Boolean(evt.date) && (!from || evt.date >= from) && (!to || evt.date <= to);
  let count = 0;
  const events = list.map(evt => {
    if (evt.calendarHidden || !inRange(evt)) return evt;
    count++;
    return normalizeEvent({ ...evt, calendarHidden: true, updatedAt });
  });
  return { events: count ? events : list, count };
}
