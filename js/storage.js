// Event persistence. Pure functions over an injectable storage object so
// tests can pass a fake instead of window.localStorage.

export const STORAGE_KEY = 'client-calendar.events.v1';

const defaultStore = typeof localStorage !== 'undefined' ? localStorage : null;

/**
 * Event shape:
 * { id, clientName, title, date 'YYYY-MM-DD', time 'HH:mm',
 *   notes, reminderMinutesBefore, notified }
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
  }
  return evt;
}

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
