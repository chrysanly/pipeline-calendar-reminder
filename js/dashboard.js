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
