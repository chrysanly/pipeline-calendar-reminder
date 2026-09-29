import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import { buildClients, statusCounts, locationTree, filterClients, paginate, parsePageSize, progressData, homeRows, pipelineClients, homeStatusFilter, duplicateCount, filterBoard, parseBoardFilters, hasBoardFilters, EMPTY_BOARD_FILTERS, NO_CLIENT } from '../js/dashboard.js';

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

test('buildClients counts the duplicate reminders an import added', () => {
  const [acme, falcon] = buildClients([
    evt('Acme', { duplicate: true }), evt('Acme'), evt('Acme', { duplicate: true }), evt('Falcon')
  ], NOW);
  assertDeepEqual([acme.duplicateCount, falcon.duplicateCount], [2, 0]);
});

test('progressData: Potential and Active at the end of each of the last 6 months', () => {
  const clients = [
    { status: 'potential', lastUpdated: new Date(2026, 5, 10).toISOString() }, // June
    { status: 'active', lastUpdated: new Date(2026, 7, 3).toISOString() }, // August
    { status: 'active', lastUpdated: new Date(2026, 8, 20).toISOString() }, // September
    { status: 'potential', lastUpdated: '' }, // no timestamp: every month
    { status: 'lead', lastUpdated: new Date(2026, 8, 1).toISOString() },
    { status: 'inactive', lastUpdated: '' }
  ];
  const data = progressData(clients, NOW);
  assertDeepEqual(data.months.map(m => m.label), ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
  assertDeepEqual(data.months.map(m => m.key), ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assertDeepEqual(data.months.map(m => [m.potential, m.active]), [[1, 0], [1, 0], [2, 0], [2, 0], [2, 1], [2, 2]]);
  assertDeepEqual(data.totals, { potential: 2, active: 2 });
  assertDeepEqual(data.share, { potential: 33, active: 33 }, '2 of 6 clients each');
  assertEqual(data.max, 2);
});

test('progressData: no clients still gives 6 empty months; the year rolls over; max is at least 1', () => {
  const data = progressData([], new Date(2027, 1, 15), 6);
  assertDeepEqual(data.months.map(m => m.key), ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
  assert(data.months.every(m => m.potential === 0 && m.active === 0));
  assertDeepEqual([data.totals.potential, data.totals.active, data.max], [0, 0, 1]);
  assertDeepEqual(data.share, { potential: 0, active: 0 }, 'no clients: no division by zero');
  assertEqual(progressData([], NOW, 3).months.length, 3);
});

const BOARD = {
  lead: [{ key: 'a', name: 'Acme', status: 'lead', city: 'Dubai', country: 'UAE', phone: '', location: '' }],
  potential: [],
  active: [
    { key: 'f', name: 'Falcon', status: 'active', city: 'Riyadh', country: 'Saudi Arabia', phone: '+966 1', location: '' },
    { key: 'p', name: 'Palm', status: 'active', city: '', country: '', phone: '', location: '' }
  ],
  inactive: []
};

test('filterBoard narrows every column and counts shown of total', () => {
  const all = filterBoard(BOARD);
  assertDeepEqual([all.shown, all.total], [3, 3]);
  const uae = filterBoard(BOARD, { ...EMPTY_BOARD_FILTERS, country: 'UAE' });
  assertDeepEqual(uae.columns.lead.map(c => c.name), ['Acme']);
  assertDeepEqual(uae.columns.active, []);
  assertDeepEqual([uae.shown, uae.total], [1, 3]);
  assertDeepEqual(filterBoard(BOARD, { status: 'active', search: 'riy' }).columns.active.map(c => c.name), ['Falcon']);
  assertDeepEqual(filterBoard(BOARD, { city: 'Unknown' }).columns.active.map(c => c.name), ['Palm'], 'Unknown matches a blank city');
  assertEqual(filterBoard(BOARD, { search: 'nobody' }).shown, 0);
  assertEqual(BOARD.active.length, 2, 'the input is untouched');
});

test('parseBoardFilters reads saved filters and drops anything odd', () => {
  assertDeepEqual(parseBoardFilters(JSON.stringify({ search: 'acme', status: 'active', country: 'UAE', city: 'Dubai' })),
    { search: 'acme', status: 'active', country: 'UAE', city: 'Dubai' });
  assertDeepEqual(parseBoardFilters(JSON.stringify({ status: 'won', country: '  ', city: 7, search: 5 })),
    { search: '', status: null, country: null, city: null });
  for (const raw of [null, '', '{broken', '"text"', '[]']) assertDeepEqual(parseBoardFilters(raw), { ...EMPTY_BOARD_FILTERS }, String(raw));
  assertEqual(parseBoardFilters(JSON.stringify({ search: 'x'.repeat(500) })).search.length, 200);
});

test('hasBoardFilters is true only when something filters', () => {
  assertEqual(hasBoardFilters(EMPTY_BOARD_FILTERS), false);
  assertEqual(hasBoardFilters({ search: '   ' }), false);
  assertEqual(hasBoardFilters({ search: 'a' }), true);
  assertEqual(hasBoardFilters({ city: 'Dubai' }), true);
});

test('homeRows: each client, then one line per duplicate row, so every imported row shows', () => {
  const events = [
    evt('Acme', { id: 'a1', importKey: 'acme|2026-09-28', date: '2026-09-28' }),
    evt('Acme', { id: 'a2', importKey: 'acme|2026-09-28#1', duplicate: true, date: '2026-10-02', phone: '+971 4 999' }),
    evt('Acme', { id: 'a3', importKey: 'acme|2026-09-20', duplicate: true, date: '2026-09-20' }),
    evt('Falcon', { id: 'f1' })
  ];
  const rows = homeRows(buildClients(events, NOW), events, NOW);
  assertDeepEqual(rows.map(r => [r.name, r.isDuplicate, r.rowId]), [
    ['Acme', false, 'client:acme'], ['Acme', true, 'dup:a3'], ['Acme', true, 'dup:a2'], ['Falcon', false, 'client:falcon']
  ]);
  assertEqual(rows.length, events.length, 'one line per reminder here');
  assertEqual(rows[0].reminderCount, 1, 'the client line counts its own reminders, not the duplicates');
  assertEqual(rows[2].phone, '+971 4 999', 'a duplicate line shows its own phone');
  assertEqual(rows[1].nextReminder, null, 'in the past: no next reminder');
  assertEqual(rows[2].nextReminder.id, 'a2');
  assertEqual(filterClients(rows, { search: 'falcon' }).length, 1, 'the Home filters work on the lines');
  assertEqual(filterClients(rows, { search: 'acme' }).length, 3);
  assertDeepEqual(homeRows([], []), []);
});

test('Home lists only potential and active clients; its status filter takes only those two', () => {
  const clients = ['lead', 'potential', 'active', 'inactive'].map(status => ({ key: status, name: status, status }));
  assertDeepEqual(pipelineClients(clients).map(c => c.status), ['potential', 'active']);
  assertEqual(homeStatusFilter('potential'), 'potential');
  assertEqual(homeStatusFilter('active'), 'active');
  assertEqual(homeStatusFilter('lead'), null);
  assertEqual(homeStatusFilter(null), null);
});

test('duplicateCount counts the reminders an import added again', () => {
  assertEqual(duplicateCount([evt('Acme'), evt('Acme', { duplicate: true }), evt('Falcon', { duplicate: true }), evt('Palm', { duplicate: false })]), 2);
  assertEqual(duplicateCount([]), 0);
});
