// Real spreadsheet files through SheetJS (npm dev dependency `xlsx`).
// Node-only (reads files); tests.html skips this file.

import { test, skip, assert, assertEqual, assertDeepEqual } from './runner.js';
import XLSX from 'xlsx';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importWorkbook } from '../js/importer.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = name => readFileSync(join(fixtures, name));
const OPTS = { selectedKey: '2026-09-27', now: new Date(2026, 8, 27, 10, 5) };

test('sample.xlsx: uses the first sheet with a Company column', () => {
  const result = importWorkbook(XLSX, read('sample.xlsx'), OPTS);
  assertEqual(result.sheetName, 'Pipeline');
  assertEqual(result.skipped, 1);
  assertDeepEqual(result.events.map(e => [e.clientName, e.date, e.time]), [
    ['Falcon Trading', '2026-10-05', '14:30'],
    ['Palm Holdings', '2026-10-08', '15:00'],
    ['Desert Rose LLC', '2026-09-27', '10:05'],
    ['Oasis Group', '2026-03-12', '10:05']
  ]);
  const falcon = result.events[0].notes;
  assert(falcon.includes('company_email: info@falcon.ae'), falcon);
  assert(falcon.includes('Company Phone: +971 4 111 2222'), falcon);
  assert(!falcon.includes('Logistics'), 'Industry is not a company column');
});

// The user's real export holds client data, so it is git-ignored: on a fresh
// clone this test is skipped and sample.xlsx covers the same import path.
const REAL_FILE = 'test-data-pipeline.xlsx';
const realFileTest = existsSync(join(fixtures, REAL_FILE))
  ? test
  : name => skip(name, `tests/fixtures/${REAL_FILE} not present (private, not in git)`);

realFileTest('the user\'s test-data-pipeline.xlsx imports its company row', () => {
  const result = importWorkbook(XLSX, read(REAL_FILE), OPTS);
  assertEqual(result.events.length, 1);
  assertEqual(result.skipped, 0);
  const [evt] = result.events;
  assertEqual(evt.title, 'Follow up: Acme Lt.');
  assertEqual(evt.date, '2026-09-26', '"09-26" in the notes');
  assertEqual(evt.time, '10:05', 'no time in the notes → import time');
  assert(evt.notes.startsWith('Company details\nCompany Name: Acme Lt.\n\nBD Notes:\n09-26 Called number'), evt.notes);
});

test('a non-spreadsheet file is reported as unreadable or missing columns', () => {
  let message = '';
  try { importWorkbook(XLSX, new TextEncoder().encode('just,some\ntext,here'), OPTS); } catch (e) { message = e.message; }
  assertEqual(message, 'No "Company" column found in the file.');
});
