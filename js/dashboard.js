// Home page data: reminders grouped into clients, status counts, locations.
// Pure; ui.js renders it.

import { STATUSES, clientKey } from './storage.js';
import { eventDateTime } from './reminders.js';

export const NO_CLIENT = '(No client)';
export const UNKNOWN = 'Unknown';

const FIELDS = ['phone', 'location', 'city', 'country'];

/**
 * One entry per client (case/spacing-insensitive name). Where reminders
 * disagree, the most recently saved one wins; blanks fall back to the newest
 * reminder that has a value.
 */
export function buildClients(events, now = new Date()) {
  const groups = new Map();
  for (const evt of events) {
    const key = clientKey(evt.clientName);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(evt);
  }

  const clients = [];
  for (const [key, list] of groups) {
    // Newest save first; stable for equal/missing timestamps (later in list = newer).
    const byUpdate = list
      .map((evt, i) => ({ evt, i }))
      .sort((a, b) => (b.evt.updatedAt || '').localeCompare(a.evt.updatedAt || '') || b.i - a.i)
      .map(x => x.evt);
    const latest = byUpdate[0];

    const upcoming = list
      .map(evt => ({ evt, when: eventDateTime(evt) }))
      .filter(x => x.when && x.when.getTime() >= now.getTime())
      .sort((a, b) => a.when - b.when);
    const byDate = list
      .map(evt => ({ evt, when: eventDateTime(evt) }))
      .filter(x => x.when)
      .sort((a, b) => b.when - a.when);

    const client = {
      key,
      // Shown as first entered; later reminders may differ only in case/spacing.
      name: key ? list[0].clientName.trim().replace(/\s+/g, ' ') : NO_CLIENT,
      status: STATUSES.includes(latest.status) ? latest.status : 'lead',
      reminderCount: list.length,
      // Rows an import added again (importer.js): Home shows a Duplicate badge.
      duplicateCount: list.filter(evt => evt.duplicate).length,
      nextReminder: upcoming.length ? reminderRef(upcoming[0].evt) : null,
      latestReminder: byDate.length ? reminderRef(byDate[0].evt) : reminderRef(latest),
      lastUpdated: latest.updatedAt || ''
    };
    for (const field of FIELDS) client[field] = (byUpdate.find(e => e[field]) || {})[field] || '';
    clients.push(client);
  }

  // A–Z, with "(No client)" last.
  return clients.sort((a, b) => (!a.key) - (!b.key) || a.name.localeCompare(b.name));
}

function reminderRef(evt) {
  return { id: evt.id, title: evt.title, date: evt.date, time: evt.time };
}

export function statusCounts(clients) {
  const counts = { lead: 0, potential: 0, active: 0, inactive: 0 };
  for (const c of clients) counts[c.status] = (counts[c.status] || 0) + 1;
  return counts;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * The Home chart: Potential and Active clients at the end of each of the last
 * `months` months (this one included). A client counts from the month it was
 * last saved (its latest status); one with no timestamp counts in every month.
 * @returns {{months: {key: string, label: string, potential: number, active: number}[],
 *   totals: {potential: number, active: number}, share: {potential: number, active: number}, max: number}}
 * share: whole-number percent of all clients (every status) that are potential / active.
 */
export function progressData(clients, now = new Date(), months = 6) {
  const tracked = clients
    .filter(c => c.status === 'potential' || c.status === 'active')
    .map(c => {
      const saved = c.lastUpdated ? new Date(c.lastUpdated) : null;
      return { status: c.status, from: saved && !Number.isNaN(saved.getTime()) ? monthKey(saved) : '' };
    });
  const series = [];
  for (let back = months - 1; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const key = monthKey(date);
    const upTo = tracked.filter(c => c.from <= key);
    series.push({
      key,
      label: SHORT_MONTHS[date.getMonth()],
      potential: upTo.filter(c => c.status === 'potential').length,
      active: upTo.filter(c => c.status === 'active').length
    });
  }
  const totals = {
    potential: tracked.filter(c => c.status === 'potential').length,
    active: tracked.filter(c => c.status === 'active').length
  };
  const max = Math.max(1, ...series.map(m => Math.max(m.potential, m.active)));
  const percent = count => (clients.length ? Math.round((count / clients.length) * 100) : 0);
  const share = { potential: percent(totals.potential), active: percent(totals.active) };
  return { months: series, totals, share, max };
}

const placeName = value => value || UNKNOWN;
const byCountThenName = (a, b) =>
  (a.name === UNKNOWN) - (b.name === UNKNOWN) || b.count - a.count || a.name.localeCompare(b.name);

/**
 * [{name: country, count, cities: [{name, count}]}], busiest first,
 * "Unknown" (blank) last at both levels.
 */
export function locationTree(clients) {
  const countries = new Map();
  for (const c of clients) {
    const country = placeName(c.country);
    if (!countries.has(country)) countries.set(country, { name: country, count: 0, cities: new Map() });
    const entry = countries.get(country);
    entry.count++;
    const city = placeName(c.city);
    entry.cities.set(city, (entry.cities.get(city) || 0) + 1);
  }
  return [...countries.values()]
    .map(c => ({
      name: c.name,
      count: c.count,
      cities: [...c.cities].map(([name, count]) => ({ name, count })).sort(byCountThenName)
    }))
    .sort(byCountThenName);
}

/** Clients matching every given filter; "Unknown" matches a blank country/city. */
export function filterClients(clients, { status = null, country = null, city = null, search = '' } = {}) {
  const needle = search.trim().toLowerCase();
  return clients.filter(c =>
    (!status || c.status === status) &&
    (!country || placeName(c.country) === country) &&
    (!city || placeName(c.city) === city) &&
    (!needle || [c.name, c.phone, c.location, c.city, c.country]
      .some(v => (v || '').toLowerCase().includes(needle))));
}

export const PAGE_SIZES = [25, 50, 100];
export const MAX_PAGE_SIZE = 1000;

/** A page size from user input: a whole number from 1 to MAX_PAGE_SIZE, else the fallback. */
export function parsePageSize(value, fallback = PAGE_SIZES[0]) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, MAX_PAGE_SIZE);
}

/**
 * One page of a list. `page` is 1-based and clamped to the pages there are.
 * @returns {{items: any[], page: number, pages: number, start: number, end: number, total: number}}
 */
export function paginate(list, page = 1, size = PAGE_SIZES[0]) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const from = (current - 1) * size;
  const items = list.slice(from, from + size);
  return { items, page: current, pages, start: total ? from + 1 : 0, end: from + items.length, total };
}

// ---------- Board filters (js/views/kanban.js) ----------

export const EMPTY_BOARD_FILTERS = Object.freeze({ search: '', status: null, country: null, city: null });

/** Saved filters (JSON from localStorage), cleaned up; anything unreadable is no filter. */
export function parseBoardFilters(raw) {
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== 'object') return { ...EMPTY_BOARD_FILTERS };
  const pick = value => (typeof value === 'string' && value.trim() ? value : null);
  return {
    search: typeof data.search === 'string' ? data.search.slice(0, 200) : '',
    status: STATUSES.includes(data.status) ? data.status : null,
    country: pick(data.country),
    city: pick(data.city)
  };
}

export const hasBoardFilters = filters =>
  Boolean((filters.search || '').trim() || filters.status || filters.country || filters.city);

/**
 * The board columns ({status: cards[]}) with only the cards matching every
 * filter (as filterClients). shown / total count the cards.
 */
export function filterBoard(columns, filters = EMPTY_BOARD_FILTERS) {
  const result = {};
  let shown = 0;
  let total = 0;
  for (const [status, cards] of Object.entries(columns)) {
    result[status] = filterClients(cards, filters);
    shown += result[status].length;
    total += cards.length;
  }
  return { columns: result, shown, total };
}

// ---------- Home list: one line per client, plus one per duplicate row ----------

/**
 * The Home client list: each client (its own reminders), then one line per
 * reminder an import marked `duplicate`, so every imported row shows and the
 * duplicates can carry a badge. A 3867-row file gives 3867 lines.
 * `clients` is buildClients(events).
 */
export function homeRows(clients, events, now = new Date()) {
  const dupes = new Map();
  for (const evt of events) {
    if (!evt.duplicate) continue;
    const key = clientKey(evt.clientName);
    if (!dupes.has(key)) dupes.set(key, []);
    dupes.get(key).push(evt);
  }
  const rows = [];
  for (const client of clients) {
    const own = dupes.get(client.key) || [];
    rows.push({ ...client, rowId: `client:${client.key}`, isDuplicate: false, reminderCount: client.reminderCount - own.length });
    const byDate = own.slice().sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    for (const evt of byDate) {
      const when = eventDateTime(evt);
      const ref = reminderRef(evt);
      rows.push({
        ...client,
        rowId: `dup:${evt.id}`,
        isDuplicate: true,
        eventId: evt.id,
        phone: evt.phone || client.phone,
        location: evt.location || client.location,
        reminderCount: 1,
        duplicateCount: 0,
        nextReminder: when && when.getTime() >= now.getTime() ? ref : null,
        latestReminder: ref
      });
    }
  }
  return rows;
}

// ---------- Home shows the pipeline: potential and active clients only ----------

export const HOME_STATUSES = ['potential', 'active'];

/** The clients Home lists: potential and active (every client is on the Client tab). */
export const pipelineClients = clients => clients.filter(c => HOME_STATUSES.includes(c.status));

/** A Home status filter: potential, active, or null (both); anything else is no filter. */
export const homeStatusFilter = status => (HOME_STATUSES.includes(status) ? status : null);

/** How many reminders an import added again (`duplicate: true`): the Home Duplicates card. */
export const duplicateCount = events => events.filter(evt => evt.duplicate).length;
