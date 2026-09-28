// CSV / Excel export, and that the files import back as the same reminders.
// Node-only (SheetJS from npm); tests.html skips this file.

import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import XLSX from 'xlsx';
import {
  EXPORT_COLUMNS, bdNotesOf, exportNotes, exportRows, toCsv, toXlsx, exportFileName
} from '../js/exporter.js';
import { importWorkbook, mergeImported } from '../js/importer.js';

const OPTS = { selectedKey: '2026-09-27', now: new Date(2026, 8, 27, 10, 5) };

const EVENTS = [
  {
    id: 'e1', title: 'Renewal call', clientName: 'Acme Ltd.', date: '2026-10-05', time: '14:30', status: 'potential',
    phone: '+971 4 123 4567', location: 'JLT Cluster X', city: 'Dubai', country: 'United Arab Emirates',
    notes: 'Discuss renewal, "gold" plan, 3 seats'
  },
  {
    id: 'e2', title: 'Follow up: Falcon Trading', clientName: 'Falcon Trading', date: '2026-10-08', time: '09:00', status: 'lead',
    phone: '', location: '', city: 'Abu Dhabi', country: 'United Arab Emirates',
    notes: 'Company details\nCompany: Falcon Trading\n\nBD Notes:\nMet at GITEX, call on 08/10/2026 9:00am'
  },
  { id: 'e3', title: 'Call Pedro', clientName: 'Pédro & Söhne, GmbH', date: '2026-09-30', time: '', status: 'active', notes: '' },
  { id: 'e4', title: 'Personal', clientName: '', date: '2026-09-29', time: '10:00', notes: 'not a client' }
];
const DEALS = [{ id: 'd1', key: 'acme ltd.', name: 'Acme Ltd.', value: 12500.5, currency: 'AED' }];

test('bdNotesOf takes the BD Notes part of an imported reminder', () => {
  assertEqual(bdNotesOf(EVENTS[1].notes), 'Met at GITEX, call on 08/10/2026 9:00am');
  assertEqual(bdNotesOf('plain notes'), 'plain notes');
  assertEqual(bdNotesOf(undefined), '');
});

test('exportNotes adds the reminder date only when the notes do not already say it', () => {
  assertEqual(exportNotes(EVENTS[0]), 'Reminder: 2026-10-05 14:30\nRenewal call\nDiscuss renewal, "gold" plan, 3 seats');
  assertEqual(exportNotes(EVENTS[1]), 'Met at GITEX, call on 08/10/2026 9:00am', 'importer title and known date left out');
  assertEqual(exportNotes(EVENTS[2]), 'Reminder: 2026-09-30\nCall Pedro');
});

test('exportRows: one row per client reminder, oldest first, with the deal on its client', () => {
  const rows = exportRows(EVENTS, DEALS);
  assertDeepEqual(rows.map(r => r.Company), ['Pédro & Söhne, GmbH', 'Acme Ltd.', 'Falcon Trading']);
  assertDeepEqual(Object.keys(rows[0]), EXPORT_COLUMNS);
  assertEqual(rows[1]['Deal value'], 12500.5);
  assertEqual(rows[1].Currency, 'AED');
  assertEqual(rows[2]['Deal value'], '');
  assertEqual(rows[1].Status, 'potential');
});

test('toCsv quotes commas, quotes and new lines, starts with a BOM and defuses formulas', () => {
  const csv = toCsv([{ Company: 'A, "B"', 'BD Notes': 'line 1\nline 2', Phone: '+971 4 123 4567', City: '=HYPERLINK("x")', Country: '-cmd' }]);
  assert(csv.startsWith('﻿Company,Status,Phone,'), csv.slice(0, 40));
  const [, row] = csv.slice(1).split('\r\n');
  assert(row.startsWith('"A, ""B""",,+971 4 123 4567,,"\'=HYPERLINK(""x"")",\'-cmd,'), row);
  assert(csv.includes('"line 1\nline 2"'), 'multi-line notes quoted');
  assert(csv.endsWith('\r\n'));
});

test('exportFileName is dated', () => {
  assertEqual(exportFileName('csv', new Date(2026, 8, 5)), 'cladflo-clients-2026-09-05.csv');
});

/** Import `bytes` into an empty app and return what matters about each reminder. */
function reimport(bytes) {
  const result = importWorkbook(XLSX, bytes, OPTS);
  const { events } = mergeImported([], result.events);
  return events.map(e => ({
    clientName: e.clientName, date: e.date, time: e.time, status: e.status,
    phone: e.phone, location: e.location, city: e.city, country: e.country
  }));
}

const EXPECTED = [
  { clientName: 'Pédro & Söhne, GmbH', date: '2026-09-30', time: '10:05', status: 'active', phone: '', location: '', city: '', country: '' },
  {
    clientName: 'Acme Ltd.', date: '2026-10-05', time: '14:30', status: 'potential',
    phone: '+971 4 123 4567', location: 'JLT Cluster X', city: 'Dubai', country: 'United Arab Emirates'
  },
  { clientName: 'Falcon Trading', date: '2026-10-08', time: '09:00', status: 'lead', phone: '', location: '', city: 'Abu Dhabi', country: 'United Arab Emirates' }
];

test('an exported CSV imports back as the same reminders', () => {
  const csv = toCsv(exportRows(EVENTS, DEALS));
  // Without a time, the importer uses the import time, as for any undated row.
  assertDeepEqual(reimport(new TextEncoder().encode(csv)), EXPECTED);
});

test('an exported .xlsx imports back as the same reminders, notes and all', () => {
  const bytes = new Uint8Array(toXlsx(XLSX, exportRows(EVENTS, DEALS)));
  assertDeepEqual(reimport(bytes), EXPECTED);
  const book = XLSX.read(bytes, { type: 'array' });
  assertDeepEqual(book.SheetNames, ['Clients']);
  const rows = XLSX.utils.sheet_to_json(book.Sheets.Clients, { defval: '' });
  assertEqual(rows[1]['Deal value'], 12500.5);
  const acme = importWorkbook(XLSX, bytes, OPTS).events[1].notes;
  assert(acme.endsWith('BD Notes:\nReminder: 2026-10-05 14:30\nRenewal call\nDiscuss renewal, "gold" plan, 3 seats'), acme);
});

test('importing the export over the same data a second time adds nothing', () => {
  const bytes = new Uint8Array(toXlsx(XLSX, exportRows(EVENTS, DEALS)));
  const once = mergeImported([], importWorkbook(XLSX, bytes, OPTS).events).events;
  const again = mergeImported(once, importWorkbook(XLSX, bytes, OPTS).events);
  assertEqual(again.added, 0);
  assertEqual(again.updated, 3);
  assertEqual(again.events.length, 3);
});
