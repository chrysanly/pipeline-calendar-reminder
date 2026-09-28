import { test, assertEqual, assertDeepEqual } from './runner.js';
import { buildClients, statusCounts, locationTree, filterClients, paginate, parsePageSize, NO_CLIENT } from '../js/dashboard.js';

const NOW = new Date(2026, 8, 27, 10, 0);
let n = 0;
const evt = (clientName, extra = {}) => ({
  id: `e${++n}`, clientName, title: `Call ${clientName}`, date: '2026-09-28', time: '09:00',
  status: 'lead', phone: '', location: '', city: '', country: '', updatedAt: '', ...extra
});

test('buildClients groups reminders by client, ignoring case and spacing', () => {
  const clients = buildClients([
    evt('Acme Ltd.'), evt('  acme   ltd. '), evt('ACME LTD.'), evt('Falcon')
  ], NOW);
  assertDeepEqual(clients.map(c => [c.name, c.reminderCount]), [['Acme Ltd.', 3], ['Falcon', 1]]);
});

test('buildClients: the latest save wins when reminders disagree', () => {
  const [acme] = buildClients([
    evt('Acme', { status: 'active', city: 'Dubai', updatedAt: '2026-09-27T09:00:00.000Z' }),
    evt('Acme', { status: 'inactive', city: 'Sharjah', updatedAt: '2026-09-27T11:00:00.000Z' }),
    evt('Acme', { status: 'potential', city: '', phone: '+971 4 111 2222', updatedAt: '2026-09-27T12:00:00.000Z' })
  ], NOW);
  assertEqual(acme.status, 'potential');
  assertEqual(acme.city, 'Sharjah', 'a blank in the newest falls back to the newest value');
  assertEqual(acme.phone, '+971 4 111 2222');
  assertEqual(acme.lastUpdated, '2026-09-27T12:00:00.000Z');
});

test('buildClients: without timestamps, the later reminder in the list wins', () => {
  const [acme] = buildClients([evt('Acme', { status: 'active' }), evt('Acme', { status: 'inactive' })], NOW);
  assertEqual(acme.status, 'inactive');
});

test('buildClients: next upcoming reminder, else the latest one', () => {
  const [acme, old] = buildClients([
    evt('Acme', { id: 'past', date: '2026-09-20' }),
    evt('Acme', { id: 'later', date: '2026-10-05' }),
    evt('Acme', { id: 'soon', date: '2026-09-27', time: '15:00' }),
    evt('Zed', { id: 'z1', date: '2026-01-01' }),
    evt('Zed', { id: 'z2', date: '2026-02-01' })
  ], NOW);
  assertEqual(acme.nextReminder.id, 'soon');
  assertEqual(old.nextReminder, null);
  assertEqual(old.latestReminder.id, 'z2');
});

test('buildClients puts reminders without a client under "(No client)", last', () => {
  const clients = buildClients([evt(''), evt('Zed'), evt('  ')], NOW);
  assertDeepEqual(clients.map(c => [c.name, c.reminderCount]), [['Zed', 1], [NO_CLIENT, 2]]);
});

test('statusCounts counts clients, not reminders', () => {
  const clients = buildClients([
    evt('A', { status: 'active' }), evt('A', { status: 'active' }),
    evt('B', { status: 'potential' }), evt('C'), evt('D', { status: 'inactive' }), evt('E', { status: 'active' })
  ], NOW);
  assertDeepEqual(statusCounts(clients), { lead: 1, potential: 1, active: 2, inactive: 1 });
  assertDeepEqual(statusCounts([]), { lead: 0, potential: 0, active: 0, inactive: 0 });
});

test('locationTree: countries and cities by count, "Unknown" last', () => {
  const clients = [
    { name: 'A', country: 'United Arab Emirates', city: 'Dubai' },
    { name: 'B', country: 'United Arab Emirates', city: 'Dubai' },
    { name: 'C', country: 'United Arab Emirates', city: '' },
    { name: 'D', country: 'United Arab Emirates', city: 'Abu Dhabi' },
    { name: 'E', country: '', city: '' },
    { name: 'F', country: 'Saudi Arabia', city: 'Riyadh' },
    { name: 'G', country: '', city: '' },
    { name: 'H', country: 'Qatar', city: '' }
  ];
  const tree = locationTree(clients);
  assertDeepEqual(tree.map(c => [c.name, c.count]), [
    ['United Arab Emirates', 4], ['Qatar', 1], ['Saudi Arabia', 1], ['Unknown', 2]
  ]);
  assertDeepEqual(tree[0].cities, [
    { name: 'Dubai', count: 2 }, { name: 'Abu Dhabi', count: 1 }, { name: 'Unknown', count: 1 }
  ]);
});

test('filterClients by status, country, city and search', () => {
  const clients = [
    { name: 'Acme', status: 'active', country: 'United Arab Emirates', city: 'Dubai', phone: '+971 4 1', location: 'JLT' },
    { name: 'Falcon', status: 'lead', country: 'United Arab Emirates', city: 'Abu Dhabi', phone: '', location: '' },
    { name: 'Palm', status: 'active', country: '', city: '', phone: '', location: '' }
  ];
  const names = f => filterClients(clients, f).map(c => c.name);
  assertDeepEqual(names({}), ['Acme', 'Falcon', 'Palm']);
  assertDeepEqual(names({ status: 'active' }), ['Acme', 'Palm']);
  assertDeepEqual(names({ country: 'United Arab Emirates' }), ['Acme', 'Falcon']);
  assertDeepEqual(names({ country: 'United Arab Emirates', city: 'Dubai' }), ['Acme']);
  assertDeepEqual(names({ country: 'Unknown' }), ['Palm']);
  assertDeepEqual(names({ status: 'active', country: 'Unknown' }), ['Palm']);
  assertDeepEqual(names({ search: 'jlt' }), ['Acme']);
  assertDeepEqual(names({ search: '  FAL ' }), ['Falcon']);
  assertDeepEqual(names({ search: 'abu' }), ['Falcon']);
});

// ---------- pagination ----------

const range = n => Array.from({ length: n }, (_, i) => i + 1);

test('paginate: pages of 25, with 1-based start and end', () => {
  const first = paginate(range(60), 1, 25);
  assertDeepEqual([first.page, first.pages, first.start, first.end, first.total], [1, 3, 1, 25, 60]);
  assertEqual(first.items.length, 25);
  const last = paginate(range(60), 3, 25);
  assertDeepEqual([last.start, last.end, last.items[0]], [51, 60, 51]);
});

test('paginate clamps the page into range and handles an empty list', () => {
  assertEqual(paginate(range(10), 9, 25).page, 1);
  assertEqual(paginate(range(60), 0, 25).page, 1);
  assertEqual(paginate(range(60), 7, 25).page, 3);
  assertDeepEqual(paginate([], 1, 25), { items: [], page: 1, pages: 1, start: 0, end: 0, total: 0 });
});

test('parsePageSize accepts whole numbers 1–1000, else the fallback', () => {
  assertEqual(parsePageSize('40'), 40);
  assertEqual(parsePageSize(100), 100);
  assertEqual(parsePageSize('5000'), 1000);
  for (const bad of ['', '0', '-3', '2.5', 'abc', null]) assertEqual(parsePageSize(bad, 50), 50);
});
