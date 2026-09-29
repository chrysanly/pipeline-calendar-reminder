import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  findColumns, extractDateTime, rowsToEvents, mergeImported, importSummary,
  statusFromCell, locationsFromPhoneCount, mergeImportedAsync
} from '../js/importer.js';
import { hideFromCalendar } from '../js/storage.js';

const SEL = '2026-09-27';
const at = (text, time = '10:00') => extractDateTime(text, SEL, time);

// ---------- findColumns ----------

test('findColumns picks every company column, the name column and BD Notes', () => {
  const cols = findColumns(['Company Name', ' company_email ', 'COMPANY Phone', 'Industry', 'BD  Notes']);
  assertDeepEqual(cols.companyCols, ['Company Name', ' company_email ', 'COMPANY Phone']);
  assertEqual(cols.nameCol, 'Company Name');
  assertEqual(cols.notesCol, 'BD  Notes');
});

test('findColumns prefers an exact "Company" label for the name', () => {
  assertEqual(findColumns(['Company Email', ' company ', 'bd_notes']).nameCol, ' company ');
});

test('findColumns falls back to the first company column for the name', () => {
  assertEqual(findColumns(['Parent company', 'Company Email']).nameCol, 'Parent company');
});

test('findColumns accepts BD Notes written with _, . or odd case', () => {
  for (const label of ['bd_notes', 'B.D. Notes', 'BD NOTES', 'bdnotes']) {
    assertEqual(findColumns(['Company', label]).notesCol, label, label);
  }
  assertEqual(findColumns(['Company', 'BD Notes 2', 'Notes']).notesCol, null);
});

test('findColumns reports missing columns as null', () => {
  const cols = findColumns(['Name', 'Notes']);
  assertEqual(cols.nameCol, null);
  assertEqual(cols.notesCol, null);
  assertDeepEqual(cols.companyCols, []);
});

// ---------- extractDateTime ----------

test('extractDateTime reads each supported date format', () => {
  const cases = {
    'call 12/03/2026': '2026-03-12',
    'call 12-03-2026': '2026-03-12',
    'call 12.03.26': '2026-03-12',
    'call 2026-03-12': '2026-03-12',
    'call 12 Mar 2026': '2026-03-12',
    'call 12 March 2026': '2026-03-12',
    'call Mar 12, 2026': '2026-03-12',
    'call 12-Mar-26': '2026-03-12'
  };
  for (const [text, key] of Object.entries(cases)) {
    const r = at(text);
    assertEqual(r.date, key, text);
    assertEqual(r.dateFound, true, text);
  }
});

test('extractDateTime reads numeric dates day first, month first only when forced', () => {
  assertEqual(at('05/10/2026').date, '2026-10-05');
  assertEqual(at('10/13/2026').date, '2026-10-13');
});

test('extractDateTime reads a date with no year using the selected year (as in the real file)', () => {
  assertEqual(at('09-26 Called number 0501234567').date, '2026-09-26');
  assertEqual(at('call 05/10').date, '2026-10-05');
});

test('extractDateTime does not read phone numbers as dates', () => {
  const r = at('Called 0501234567 or +971 50 1234567 or +971-50-1234567');
  assertEqual(r.dateFound, false);
  assertEqual(r.date, SEL);
});

test('extractDateTime uses the latest of several dates', () => {
  assertEqual(at('Intro 02/10/2026. Follow up 05/10/2026. Met 01/10/2026').date, '2026-10-05');
  assertEqual(at('2026-01-05 then 3 Feb 2026').date, '2026-02-03');
});

test('extractDateTime takes a time written next to the date', () => {
  assertDeepEqual(at('05/10/2026 14:30'), { date: '2026-10-05', time: '14:30', dateFound: true, timeFound: true });
  assertEqual(at('Oct 8, 2026 at 3pm').time, '15:00');
  assertEqual(at('12 Mar 2026, 2:30 pm').time, '14:30');
  assertEqual(at('12 Mar 2026 12am').time, '00:00');
  assertEqual(at('12 Mar 2026 12pm').time, '12:00');
});

test('extractDateTime keeps the fallback time when none is written', () => {
  const r = at('05/10/2026 call back', '08:15');
  assertEqual(r.time, '08:15');
  assertEqual(r.timeFound, false);
  // A time next to a different, older date does not count.
  assertEqual(at('01/10/2026 14:30 then 05/10/2026', '08:15').time, '08:15');
});

test('extractDateTime rejects impossible dates', () => {
  assertEqual(at('31/02/2026').dateFound, false);
  assertEqual(at('2026-13-01').dateFound, false);
  assertEqual(at('30 Feb 2026').dateFound, false);
  assertEqual(at('29/02/2024').date, '2024-02-29');
});

test('extractDateTime falls back to the selected day when there is no date', () => {
  assertDeepEqual(at('No date, just call back', '11:45'), { date: SEL, time: '11:45', dateFound: false, timeFound: false });
  assertDeepEqual(at('', '11:45'), { date: SEL, time: '11:45', dateFound: false, timeFound: false });
});

// ---------- rowsToEvents ----------

const NOW = new Date(2026, 8, 27, 10, 5);
const ROWS = [
  { 'Company Name': 'Falcon Trading', 'Company Email': 'info@falcon.ae', Industry: 'Logistics', 'BD Notes': 'Follow up 05/10/2026 14:30' },
  { 'Company Name': '', 'Company Email': '', Industry: '', 'BD Notes': '' },
  { 'Company Name': '', 'Company Email': '', Industry: '', 'BD Notes': 'orphan' },
  { 'Company Name': 'Desert Rose', 'Company Email': '', Industry: 'Retail', 'BD Notes': 'call back' },
  { 'Company Name': 'Oasis', 'Company Email': '', Industry: '', 'BD Notes': '12-Mar-26 met at expo' }
];

test('rowsToEvents builds one reminder per company row', () => {
  const { events, skipped, warnings } = rowsToEvents(ROWS, { selectedKey: SEL, now: NOW });
  assertEqual(events.length, 3);
  assertEqual(skipped, 1, 'the orphan note row is skipped; the blank row is ignored');
  assertEqual(warnings.length, 1);

  const [falcon, rose] = events;
  assertEqual(falcon.title, 'Follow up: Falcon Trading');
  assertEqual(falcon.clientName, 'Falcon Trading');
  assertEqual(falcon.date, '2026-10-05');
  assertEqual(falcon.time, '14:30');
  assertEqual(falcon.reminderMinutesBefore, 0);
  assertEqual(falcon.source, 'import');
  assertEqual(falcon.importKey, 'falcon trading|2026-10-05');

  assertEqual(rose.date, SEL, 'no date → selected day');
  assertEqual(rose.importKey, 'desert rose|undated');
  assertEqual(rose.time, '10:05', 'no time → import time');
});

test('rowsToEvents notes: company columns only, then BD Notes', () => {
  const [falcon, rose] = rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events;
  assertEqual(falcon.notes,
    'Company details\nCompany Name: Falcon Trading\nCompany Email: info@falcon.ae\n\nBD Notes:\nFollow up 05/10/2026 14:30');
  assert(!falcon.notes.includes('Logistics'), 'non-company columns must be left out');
  assertEqual(rose.notes, 'Company details\nCompany Name: Desert Rose\n\nBD Notes:\ncall back');
});

test('rowsToEvents marks reminders that are not in the future as notified', () => {
  const [falcon, rose, oasis] = rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events;
  assertEqual(falcon.notified, false);
  assertEqual(rose.notified, true, 'at the import time is not in the future');
  assertEqual(oasis.notified, true, 'March is past');
  const later = rowsToEvents(ROWS, { selectedKey: '2026-09-28', now: NOW }).events[1];
  assertEqual(later.notified, false, 'a future selected day will still pop up');
});

test('rowsToEvents throws when a required column is missing', () => {
  let message = '';
  try { rowsToEvents([{ Name: 'x', 'BD Notes': '' }], { selectedKey: SEL, now: NOW }); } catch (e) { message = e.message; }
  assertEqual(message, 'No "Company" column found in the file.');
  try { rowsToEvents([{ Company: 'x', Notes: '' }], { selectedKey: SEL, now: NOW }); } catch (e) { message = e.message; }
  assertEqual(message, 'No "BD Notes" column found in the file.');
});

// ---------- mergeImported ----------

test('mergeImported adds new reminders with ids and no helper flags', () => {
  const { events } = rowsToEvents(ROWS, { selectedKey: SEL, now: NOW });
  const merged = mergeImported([], events);
  assertEqual(merged.added, 3);
  assertEqual(merged.events.length, 3);
  assert(merged.events.every(e => typeof e.id === 'string' && e.importKey && e.source === 'import'));
  assert(merged.events.every(e => !('dateFound' in e) && !('timeFound' in e)));
});

test('mergeImported: uploading again adds each row once more, marked duplicate with its own key', () => {
  const first = mergeImported([], rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  assert(first.events.every(e => !e.duplicate), 'the first upload has no duplicates');
  const again = mergeImported(first.events, rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  assertDeepEqual([again.added, again.duplicates, again.updated], [0, 3, 0]);
  assertEqual(again.events.length, 6);
  const copies = again.events.filter(e => e.duplicate);
  assertEqual(copies.length, 3);
  assertDeepEqual(copies.map(e => e.importKey), first.events.map(e => `${e.importKey}#1`));
  const third = mergeImported(again.events, rowsToEvents(ROWS.slice(0, 1), { selectedKey: SEL, now: NOW }).events);
  assertEqual(third.events.at(-1).importKey, `${first.events[0].importKey}#2`, 'every copy gets a key of its own');
  assertEqual(new Set(third.events.map(e => e.id)).size, third.events.length);
});

test('mergeImported with reimport (History): rows already there are updated, not duplicated', () => {
  const first = mergeImported([{ id: 'own', title: 'Mine', date: SEL, time: '09:00' }],
    rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  const laterNow = new Date(2026, 8, 27, 16, 40);
  // Second import from a different selected day and later time.
  const again = mergeImported(first.events, rowsToEvents(ROWS, { selectedKey: '2026-10-05', now: laterNow }).events, { reimport: true });
  assertEqual(again.added, 0);
  assertEqual(again.duplicates, 0);
  assertEqual(again.updated, 3);
  assertEqual(again.events.length, 4);
  const rose = again.events.find(e => e.clientName === 'Desert Rose');
  assertEqual(rose.date, SEL, 'a guessed date stays on the first import day');
  assertEqual(rose.time, '10:05', 'a guessed time stays at the first import time');
  assertEqual(again.events.find(e => e.id === 'own').title, 'Mine');
});

test('importSummary reports new and duplicate counts and where undated rows went', () => {
  const result = rowsToEvents(ROWS, { selectedKey: SEL, now: NOW });
  const first = mergeImported([], result.events);
  assertEqual(importSummary(result, 'Sun, 27 September 2026', first),
    'Imported 3 reminders: 3 new (1 without a date → Sun, 27 September 2026, 1 skipped)');
  // The same file again: every row is added again as a duplicate.
  const again = mergeImported(first.events, rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  assertEqual(importSummary(result, 'Sun, 27 September 2026', again),
    'Imported 3 reminders: 0 new, 3 duplicates (added) (1 without a date → Sun, 27 September 2026, 1 skipped)');
  assertEqual(importSummary({ events: result.events.slice(0, 1), skipped: 0 }, 'X', { added: 0, duplicates: 1 }),
    'Imported 1 reminder: 0 new, 1 duplicate (added) (0 without a date → X, 0 skipped)');
  // Re-import from History updates.
  assertEqual(importSummary({ events: result.events.slice(0, 2), skipped: 0 }, 'X', { added: 1, updated: 1 }),
    'Imported 2 reminders: 1 new, 1 updated (1 without a date → X, 0 skipped)');
});

// ---------- phone, location and status columns ----------

test('findColumns finds phone, city, country, location and status columns', () => {
  const cols = findColumns(['Company Name', 'BD Notes', 'Phone Number', 'City', 'Country', 'Office Address', 'Stage']);
  assertEqual(cols.phoneCol, 'Phone Number');
  assertEqual(cols.cityCol, 'City');
  assertEqual(cols.countryCol, 'Country');
  assertEqual(cols.locationCol, 'Office Address');
  assertEqual(cols.statusCol, 'Stage');
  for (const label of ['Mobile', 'Tel', 'Telephone', 'contact_number', 'Contact No', 'Company Phone']) {
    assertEqual(findColumns(['Company', label]).phoneCol, label, label);
  }
  assertEqual(findColumns(['Company', 'Area']).locationCol, 'Area');
  assertEqual(findColumns(['Company', 'Lead Status']).statusCol, 'Lead Status');
  const none = findColumns(['Company', 'BD Notes', 'Email', 'Website']);
  assertDeepEqual([none.phoneCol, none.cityCol, none.countryCol, none.locationCol, none.statusCol], [null, null, null, null, null]);
});

test('statusFromCell accepts the 4 statuses in any case, plural too', () => {
  assertEqual(statusFromCell(' Active '), 'active');
  assertEqual(statusFromCell('LEADS'), 'lead');
  assertEqual(statusFromCell('potential'), 'potential');
  assertEqual(statusFromCell('Inactive'), 'inactive');
  assertEqual(statusFromCell('Won'), null);
  assertEqual(statusFromCell(''), null);
});

const LOC_ROWS = [
  { 'Company Name': 'Dubai Landline Co', 'Phone Number': '+971 4 123 4567', City: '', Country: '', Status: '', 'BD Notes': 'call' },
  { 'Company Name': 'Mobile Only', 'Phone Number': 501234567, City: '', Country: '', Status: 'Active', 'BD Notes': 'call' },
  { 'Company Name': 'Column Wins', 'Phone Number': '+971 4 123 4567', City: 'Sharjah', Country: 'UAE', Status: 'potential', 'BD Notes': 'call' },
  { 'Company Name': 'No Phone', 'Phone Number': '', City: '', Country: '', Status: 'nonsense', 'BD Notes': 'call' }
];

test('rowsToEvents fills city and country from the phone when the columns are blank', () => {
  const { events } = rowsToEvents(LOC_ROWS, { selectedKey: SEL, now: NOW });
  const [landline, mobile, columns, none] = events;
  assertDeepEqual([landline.phone, landline.city, landline.country], ['+971 4 123 4567', 'Dubai', 'United Arab Emirates']);
  assertDeepEqual([mobile.phone, mobile.city, mobile.country], ['501234567', '', 'United Arab Emirates']);
  assertDeepEqual([columns.city, columns.country], ['Sharjah', 'UAE'], 'column values beat the phone');
  assertDeepEqual([none.city, none.country], ['', '']);
  assertEqual(locationsFromPhoneCount(events), 2);
});

test('rowsToEvents takes the status from a Status column, else lead', () => {
  const statuses = rowsToEvents(LOC_ROWS, { selectedKey: SEL, now: NOW }).events.map(e => e.status);
  assertDeepEqual(statuses, ['lead', 'active', 'potential', 'lead']);
});

test('re-import keeps a status set by hand and only fills blank location fields', () => {
  const first = mergeImported([], rowsToEvents(LOC_ROWS, { selectedKey: SEL, now: NOW }).events).events;
  // By hand: Mobile Only → inactive and a city.
  const edited = first.map(e => e.clientName === 'Mobile Only' ? { ...e, status: 'inactive', city: 'Al Ain', updatedAt: 'Z' } : e);
  const again = mergeImported(edited, rowsToEvents(LOC_ROWS, { selectedKey: SEL, now: NOW }).events, { reimport: true }).events;
  const mobile = again.filter(e => e.clientName === 'Mobile Only');
  assertEqual(mobile.length, 1);
  assertEqual(mobile[0].status, 'inactive', 'the file says Active but the hand-set status wins');
  assertEqual(mobile[0].city, 'Al Ain', 'a filled field is not overwritten');
});

test('a Status column can move a client on from the default lead', () => {
  const first = mergeImported([], rowsToEvents(LOC_ROWS, { selectedKey: SEL, now: NOW }).events).events;
  const rows = LOC_ROWS.map(r => r['Company Name'] === 'Dubai Landline Co' ? { ...r, Status: 'Active' } : r);
  const again = mergeImported(first, rowsToEvents(rows, { selectedKey: SEL, now: NOW }).events).events;
  assertEqual(again.find(e => e.clientName === 'Dubai Landline Co').status, 'active');
});

test('a new reminder for a known client takes the client\'s status and location', () => {
  const existing = [{ id: 'x', clientName: 'Falcon Trading', title: 'Old', date: SEL, time: '09:00', status: 'active', city: 'Dubai', country: 'United Arab Emirates', phone: '', location: '', updatedAt: 'Z' }];
  const merged = mergeImported(existing, rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events).events;
  const falcon = merged.filter(e => e.clientName === 'Falcon Trading');
  assertEqual(falcon.length, 2);
  assert(falcon.every(e => e.status === 'active' && e.city === 'Dubai'), JSON.stringify(falcon.map(e => [e.status, e.city])));
});

test('merged reminders carry no import-only flags', () => {
  const { events } = mergeImported([], rowsToEvents(LOC_ROWS, { selectedKey: SEL, now: NOW }).events);
  assert(events.every(e => !('statusFound' in e) && !('locFromPhone' in e)));
});

// ---------- re-import and the chunked import ----------

test('imported reminders start off the calendar (Home only); a hand-made one stays on it', () => {
  const first = mergeImported([{ id: 'own', title: 'Mine', date: SEL, time: '09:00' }],
    rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  assert(first.events.filter(e => e.source === 'import').every(e => e.calendarHidden));
  assertEqual(first.events.find(e => e.id === 'own').calendarHidden, undefined);
  const copies = mergeImported(first.events, rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  assert(copies.events.filter(e => e.duplicate).every(e => e.calendarHidden), 'duplicates start off it too');
});

test('re-import keeps each reminder where it is: on the calendar stays on, off stays off', () => {
  const first = mergeImported([], rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  const falcon = first.events.find(e => e.clientName === 'Falcon Trading');
  const shown = first.events.map(e => (e.id === falcon.id ? { ...e, calendarHidden: false } : e));
  const again = mergeImported(shown, rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events, { reimport: true });
  assertEqual(again.events.length, 3);
  assertEqual(again.events.find(e => e.id === falcon.id).calendarHidden, undefined, 'still on the calendar');
  assert(again.events.filter(e => e.id !== falcon.id).every(e => e.calendarHidden), 'the rest stay off it');
  const cleared = hideFromCalendar(again.events, {}).events;
  const afterClear = mergeImported(cleared, rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events, { reimport: true });
  assert(afterClear.events.every(e => e.calendarHidden), 're-import no longer brings cleared reminders back');
});

const pendingImports = [];
const later = (name, fn) => pendingImports.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

// 120 rows, one company each, dated in October.
const manyRows = Array.from({ length: 120 }, (_, i) =>
  ({ Company: `Firm ${i}`, 'BD Notes': `Call on ${String(1 + (i % 28)).padStart(2, '0')}/10/2026` }));

later('mergeImportedAsync reports n/total per chunk, pauses between chunks and matches mergeImported', async () => {
  const rows = rowsToEvents(manyRows, { selectedKey: SEL, now: NOW }).events;
  const progress = [];
  let pauses = 0;
  const merged = await mergeImportedAsync([], rows, {
    chunkSize: 50,
    onProgress: (done, total) => progress.push(`${done}/${total}`),
    pause: async () => { pauses++; }
  });
  assertDeepEqual(progress, ['0/120', '50/120', '100/120', '120/120']);
  assertEqual(pauses, 2);
  const sync = mergeImported([], rows);
  assertEqual(merged.added, 120);
  assertEqual(merged.updated, 0);
  assertDeepEqual(merged.events.map(e => [e.importKey, e.date]), sync.events.map(e => [e.importKey, e.date]));
});

later('mergeImportedAsync: duplicates across chunks, the default pause, and nothing to import', async () => {
  const rows = rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events;
  const first = await mergeImportedAsync([], rows, { chunkSize: 1 });
  const again = await mergeImportedAsync(first.events, rows, { chunkSize: 2, reimport: true });
  assertEqual(again.added, 0);
  assertEqual(again.updated, 3);
  assertEqual(again.events.length, 3);
  const copies = await mergeImportedAsync(first.events, rows, { chunkSize: 2 });
  assertDeepEqual([copies.added, copies.duplicates, copies.updated, copies.events.length], [0, 3, 0, 6]);
  const progress = [];
  const empty = await mergeImportedAsync(first.events, [], { onProgress: (d, t) => progress.push(`${d}/${t}`) });
  assertDeepEqual(progress, ['0/0']);
  assertEqual(empty.events, first.events);
});


// ---------- every row kept (a 3867-row file shows 3867 rows) ----------

const REPEATS = [
  { Company: 'Acme', 'BD Notes': 'Call on 05/10/2026' },
  { Company: 'Acme', 'BD Notes': 'Call on 05/10/2026' },
  { Company: 'ACME ', 'BD Notes': 'Call on 09/10/2026' },
  { Company: 'Falcon', 'BD Notes': 'no date' },
  { Company: 'Falcon', 'BD Notes': 'still no date' }
];

test('an upload keeps every row: repeats of a company are added as duplicates with keys of their own', () => {
  const rows = rowsToEvents(REPEATS, { selectedKey: SEL, now: NOW }).events;
  const merged = mergeImported([], rows);
  assertEqual(merged.events.length, 5, 'one reminder per row');
  assertDeepEqual([merged.added, merged.duplicates, merged.updated], [2, 3, 0]);
  assertDeepEqual(merged.events.map(e => [e.importKey, Boolean(e.duplicate)]), [
    ['acme|2026-10-05', false], ['acme|2026-10-05#1', true], ['acme|2026-10-09', true],
    ['falcon|undated', false], ['falcon|undated#1', true]
  ]);
});

test('an upload marks a company that was already there (even added by hand) as a duplicate', () => {
  const existing = [{ id: 'own', clientName: 'Falcon', title: 'Call', date: SEL, time: '09:00' }];
  const merged = mergeImported(existing, rowsToEvents(REPEATS.slice(0, 1).concat(REPEATS[3]), { selectedKey: SEL, now: NOW }).events);
  assertDeepEqual(merged.events.map(e => [e.clientName, Boolean(e.duplicate)]), [['Falcon', false], ['Acme', false], ['Falcon', true]]);
});

test('re-import updates row for row: the same file again adds nothing and keeps the duplicate marks', () => {
  const rows = () => rowsToEvents(REPEATS, { selectedKey: SEL, now: NOW }).events;
  const first = mergeImported([], rows());
  const again = mergeImported(first.events, rows(), { reimport: true });
  assertDeepEqual([again.added, again.duplicates, again.updated], [0, 0, 5]);
  assertDeepEqual(again.events.map(e => e.id), first.events.map(e => e.id), 'the same reminders');
  assertDeepEqual(again.events.map(e => Boolean(e.duplicate)), [false, true, true, false, true]);
});

test('re-import fills in the rows an older import merged away, as duplicates', () => {
  // What an older version kept of REPEATS: one reminder per importKey.
  const rows = rowsToEvents(REPEATS, { selectedKey: SEL, now: NOW }).events;
  const collapsed = mergeImported([], [rows[0], rows[2], rows[3]]).events;
  assertEqual(collapsed.length, 3);
  const fixed = mergeImported(collapsed, rowsToEvents(REPEATS, { selectedKey: SEL, now: NOW }).events, { reimport: true });
  assertEqual(fixed.events.length, 5);
  assertDeepEqual([fixed.added, fixed.duplicates, fixed.updated], [0, 2, 3]);
  assertEqual(new Set(fixed.events.map(e => e.importKey)).size, 5);
});

later('mergeImportedAsync keeps every row across chunks: 500 rows of 120 companies give 500 reminders', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ Company: `Firm ${i % 120}`, 'BD Notes': `Call on ${String(1 + (i % 3)).padStart(2, '0')}/10/2026` }));
  const events = rowsToEvents(rows, { selectedKey: SEL, now: NOW }).events;
  const merged = await mergeImportedAsync([], events, { chunkSize: 50, pause: async () => {} });
  assertEqual(merged.events.length, 500);
  assertDeepEqual([merged.added, merged.duplicates], [120, 380]);
  assertEqual(new Set(merged.events.map(e => e.importKey)).size, 500, 'every key unique, also across chunks');
  const again = await mergeImportedAsync(merged.events, events, { chunkSize: 50, pause: async () => {}, reimport: true });
  assertDeepEqual([again.events.length, again.updated, again.added + again.duplicates], [500, 500, 0]);
});

export const importerTestsDone = Promise.all(pendingImports);
