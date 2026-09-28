// The History log: one entry per change, newest first. Pure, no DOM.

import { recordId } from './records.js';
import { clientKey } from './storage.js';

export const HISTORY_ACTIONS = ['create', 'edit', 'delete', 'status', 'import', 'minutes', 'clear'];

export const HISTORY_LABELS = {
  create: 'Created',
  edit: 'Edited',
  delete: 'Deleted',
  status: 'Status',
  import: 'Import',
  minutes: 'Minutes',
  clear: 'Cleared'
};

/** Oldest entries past this are dropped. */
export const HISTORY_LIMIT = 500;

const entryText = value => (value === null || value === undefined ? '' : String(value).trim());

/** A stored entry, cleaned up. Unknown actions read as edits. */
export function normalizeEntry(data) {
  return {
    id: data.id || recordId('log'),
    at: entryText(data.at),
    action: HISTORY_ACTIONS.includes(data.action) ? data.action : 'edit',
    kind: entryText(data.kind) || 'reminder',
    title: entryText(data.title),
    client: entryText(data.client),
    detail: entryText(data.detail)
  };
}

/**
 * A new entry. kind: 'reminder' | 'client' | 'minutes' | 'data'.
 * @throws on an unknown action, so a typo never logs silently.
 */
export function logEntry({ action, kind, title, client, detail }, now = new Date()) {
  if (!HISTORY_ACTIONS.includes(action)) throw new Error(`Unknown history action "${action}".`);
  return normalizeEntry({ action, kind, title, client, detail, at: now.toISOString() });
}

/** Newest first; the ISO timestamps sort as text. */
export function sortHistory(list) {
  return list.slice().sort((a, b) => b.at.localeCompare(a.at));
}

/** Add entries to the log, newest first, keeping at most `limit`. */
export function addHistory(list, entries, limit = HISTORY_LIMIT) {
  return sortHistory(list.concat(entries)).slice(0, limit);
}

/** Client names in the log, A–Z, one per client. */
export function historyClients(list) {
  const names = new Map();
  for (const entry of list) {
    const key = clientKey(entry.client);
    if (key && !names.has(key)) names.set(key, entry.client);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

/** filters: {action, client, search}; blank ones match everything. */
export function filterHistory(list, { action = '', client = '', search = '' } = {}) {
  const wantClient = clientKey(client);
  const needle = entryText(search).toLowerCase();
  return list.filter(entry =>
    (!action || entry.action === action) &&
    (!wantClient || clientKey(entry.client) === wantClient) &&
    (!needle || [entry.title, entry.client, entry.detail].join(' ').toLowerCase().includes(needle)));
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", else the date. */
export function relativeTime(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const diff = now.getTime() - then.getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
