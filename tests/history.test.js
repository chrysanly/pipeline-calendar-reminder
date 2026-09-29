import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  HISTORY_ACTIONS, HISTORY_LIMIT, logEntry, normalizeEntry, addHistory, sortHistory,
  historyClients, filterHistory, relativeTime, canReimport
} from '../js/history.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const at = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60000);

test('logEntry builds an entry for each of the 7 actions and rejects others', () => {
  assertDeepEqual(HISTORY_ACTIONS, ['create', 'edit', 'delete', 'status', 'import', 'minutes', 'clear']);
  const entry = logEntry({ action: 'create', kind: 'reminder', title: ' Call ', client: 'Acme', detail: 'Mon' }, NOW);
  assert(/^log_/.test(entry.id), entry.id);
  assertEqual(entry.at, NOW.toISOString());
  assertDeepEqual({ ...entry, id: 'x' }, { id: 'x', at: NOW.toISOString(), action: 'create', kind: 'reminder', title: 'Call', client: 'Acme', detail: 'Mon' });
  let message = '';
  try { logEntry({ action: 'rename' }); } catch (err) { message = err.message; }
  assert(/Unknown history action/.test(message), message);
});

test('normalizeEntry fills blanks and reads unknown stored actions as edits', () => {
  const entry = normalizeEntry({ id: 'h1', action: 'weird', title: null });
  assertDeepEqual(entry, { id: 'h1', at: '', action: 'edit', kind: 'reminder', title: '', client: '', detail: '' });
});

test('addHistory keeps entries newest first', () => {
  const old = logEntry({ action: 'create', title: 'old' }, at(10));
  const mid = logEntry({ action: 'edit', title: 'mid' }, at(5));
  const fresh = logEntry({ action: 'delete', title: 'new' }, at(0));
  assertDeepEqual(addHistory([mid, old], [fresh]).map(e => e.title), ['new', 'mid', 'old']);
  assertDeepEqual(sortHistory([old, fresh, mid]).map(e => e.title), ['new', 'mid', 'old']);
});

test('addHistory caps the log at 500 and drops the oldest', () => {
  assertEqual(HISTORY_LIMIT, 500);
  const list = Array.from({ length: 500 }, (_, i) => logEntry({ action: 'edit', title: `e${i}` }, at(1000 - i)));
  const next = addHistory(list, [logEntry({ action: 'create', title: 'newest' }, NOW)]);
  assertEqual(next.length, 500);
  assertEqual(next[0].title, 'newest');
  assert(!next.some(e => e.title === 'e0'), 'the oldest entry is trimmed');
  assertEqual(addHistory([], [logEntry({ action: 'edit' }, NOW)], 0).length, 0);
});

const LOG = [
  logEntry({ action: 'create', kind: 'reminder', title: 'Renewal call', client: 'Acme Ltd.', detail: 'Mon' }, at(1)),
  logEntry({ action: 'status', kind: 'client', title: 'acme  ltd.', client: 'acme  ltd.', detail: 'Lead → Active' }, at(2)),
  logEntry({ action: 'minutes', kind: 'minutes', title: 'Kickoff', client: 'Falcon Trading', detail: 'Saved minutes' }, at(3)),
  logEntry({ action: 'import', kind: 'reminder', title: 'pipeline.xlsx', client: '', detail: '12 reminders' }, at(4))
];

test('historyClients lists each client once, A–Z, ignoring case and spacing', () => {
  assertDeepEqual(historyClients(LOG), ['Acme Ltd.', 'Falcon Trading']);
});

test('filterHistory by action, client and search', () => {
  assertEqual(filterHistory(LOG).length, 4);
  assertDeepEqual(filterHistory(LOG, { action: 'status' }).map(e => e.detail), ['Lead → Active']);
  assertEqual(filterHistory(LOG, { client: 'ACME LTD.' }).length, 2);
  assertDeepEqual(filterHistory(LOG, { search: 'xlsx' }).map(e => e.action), ['import']);
  assertDeepEqual(filterHistory(LOG, { search: 'active' }).map(e => e.action), ['status']);
  assertEqual(filterHistory(LOG, { action: 'create', client: 'Falcon Trading' }).length, 0);
});

test('relativeTime reads like a person would say it', () => {
  const ago = ms => new Date(NOW.getTime() - ms).toISOString();
  assertEqual(relativeTime(ago(20 * 1000), NOW), 'just now');
  assertEqual(relativeTime(ago(5 * 60000), NOW), '5 min ago');
  assertEqual(relativeTime(ago(3 * 3600000), NOW), '3 h ago');
  assertEqual(relativeTime(ago(30 * 3600000), NOW), 'yesterday');
  assertEqual(relativeTime(ago(4 * 86400000), NOW), '4 days ago');
  assert(/2026/.test(relativeTime(ago(30 * 86400000), NOW)), 'older entries show the date');
  assertEqual(relativeTime('not a date', NOW), '');
});

test('an import entry keeps its fileId and can be re-imported; others cannot', () => {
  const entry = logEntry({ action: 'import', kind: 'reminder', title: 'leads.xlsx', detail: 'Imported 3', fileId: ' file_1 ' }, NOW);
  assertEqual(entry.fileId, 'file_1');
  assert(canReimport(entry));
  assertEqual(normalizeEntry({ ...entry }).fileId, 'file_1', 'the id survives a save and load');
  assert(!('fileId' in logEntry({ action: 'import', title: 'old.xlsx' }, NOW)), 'no file, no key');
  assert(!canReimport(logEntry({ action: 'import', title: 'old.xlsx' }, NOW)));
  assert(!canReimport(logEntry({ action: 'clear', kind: 'calendar', title: 'Cleared', fileId: 'file_1' }, NOW)));
});
