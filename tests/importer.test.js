import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  findColumns, extractDateTime, rowsToEvents, mergeImported, importSummary,
  statusFromCell, locationsFromPhoneCount
} from '../js/importer.js';

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

test('mergeImported: importing twice does not duplicate', () => {
  const first = mergeImported([{ id: 'own', title: 'Mine', date: SEL, time: '09:00' }],
    rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  const laterNow = new Date(2026, 8, 27, 16, 40);
  // Second import from a different selected day and later time.
  const again = mergeImported(first.events, rowsToEvents(ROWS, { selectedKey: '2026-10-05', now: laterNow }).events);
  assertEqual(again.added, 0);
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
    'Imported 3 reminders: 3 new, 0 duplicates (1 without a date → Sun, 27 September 2026, 1 skipped)');
  // The same file again: every row is a duplicate.
  const again = mergeImported(first.events, rowsToEvents(ROWS, { selectedKey: SEL, now: NOW }).events);
  assertEqual(importSummary(result, 'Sun, 27 September 2026', again),
    'Imported 3 reminders: 0 new, 3 duplicates (1 without a date → Sun, 27 September 2026, 1 skipped)');
  assertEqual(importSummary({ events: result.events.slice(0, 1), skipped: 0 }, 'X', { added: 0, updated: 1 }),
    'Imported 1 reminder: 0 new, 1 duplicate (0 without a date → X, 0 skipped)');
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
  const again = mergeImported(edited, rowsToEvents(LOC_ROWS, { selectedKey: SEL, now: NOW }).events).events;
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
