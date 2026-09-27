// Regenerates tests/fixtures/sample.xlsx: `node tests/fixtures/make-sample.mjs`
// Known answers are asserted in tests/importer.xlsx.test.js and import.spec.mjs.

import XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const rows = [
  ['Company Name', ' company_email ', 'Company Phone', 'Industry', 'BD  Notes'],
  ['Falcon Trading', 'info@falcon.ae', '+971 4 111 2222', 'Logistics', 'Intro call 02/10/2026. Follow up 05/10/2026 14:30 re pricing'],
  ['Palm Holdings', 'hello@palm.ae', '', 'Real estate', 'Sent deck on Oct 8, 2026 at 3pm'],
  ['Desert Rose LLC', '', '050 123 4567', 'Retail', 'No date here, just call back'],
  ['', '', '', '', ''],
  ['', '', '', '', 'Orphan note without a company'],
  ['Oasis Group', 'bd@oasis.ae', '', 'Events', '12-Mar-26 met at expo']
];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Just a cover sheet']]), 'Cover');
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Pipeline');
writeFileSync(join(here, 'sample.xlsx'), XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
console.log('tests/fixtures/sample.xlsx written');
