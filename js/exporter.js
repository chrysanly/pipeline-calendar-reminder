// CSV / Excel export of every reminder that has a client, in the columns the
// importer reads (importer.js): Company, Status, Phone, Location, City,
// Country and BD Notes, whose text carries the reminder's date and time. So a
// file exported here imports back as the same reminders. Date, Time, Deal
// value and Currency are extra columns for people; the importer skips them.
// Pure: SheetJS is passed in.

import { extractDateTime } from './importer.js';
import { clientKey } from './storage.js';
import { dealFor } from './deals.js';

export const EXPORT_COLUMNS = [
  'Company', 'Status', 'Phone', 'Location', 'City', 'Country', 'Date', 'Time', 'Deal value', 'Currency', 'BD Notes'
];

const cell = value => (value === null || value === undefined ? '' : String(value).trim());

/** The BD Notes part of an imported reminder's notes; other notes as they are. */
export function bdNotesOf(notes) {
  const text = cell(notes);
  const match = text.match(/^Company details\n[\s\S]*?\n\nBD Notes:\n([\s\S]*)$/);
  return match ? match[1].trim() : text;
}

/**
 * BD Notes for the file: the notes, plus a "Reminder: 2026-09-28 14:30" line
 * unless the importer would already read that date and time off them. Titles
 * the importer makes itself ("Follow up: <company>") are left out.
 */
export function exportNotes(evt) {
  const notes = bdNotesOf(evt.notes);
  const company = cell(evt.clientName);
  const title = cell(evt.title);
  const lines = [];
  if (evt.date) {
    const found = extractDateTime(notes, evt.date, '');
    const sameDate = found.dateFound && found.date === evt.date;
    const sameTime = !evt.time || (found.timeFound && found.time === evt.time);
    if (!sameDate || !sameTime) lines.push(`Reminder: ${evt.date}${evt.time ? ` ${evt.time}` : ''}`);
  }
  if (title && title !== `Follow up: ${company}`) lines.push(title);
  if (notes) lines.push(notes);
  return lines.join('\n');
}

const byDateThenCompany = (a, b) =>
  cell(a.date).localeCompare(cell(b.date)) || cell(a.time).localeCompare(cell(b.time)) ||
  cell(a.clientName).localeCompare(cell(b.clientName));

/** One row per reminder with a client, oldest first; each deal on its client's rows. */
export function exportRows(events, deals = []) {
  return events
    .filter(evt => clientKey(evt.clientName))
    .slice()
    .sort(byDateThenCompany)
    .map(evt => {
      const deal = dealFor(deals, evt.clientName);
      return {
        Company: cell(evt.clientName),
        Status: cell(evt.status) || 'lead',
        Phone: cell(evt.phone),
        Location: cell(evt.location),
        City: cell(evt.city),
        Country: cell(evt.country),
        Date: cell(evt.date),
        Time: cell(evt.time),
        'Deal value': deal ? deal.value : '',
        Currency: deal ? deal.currency : '',
        'BD Notes': exportNotes(evt)
      };
    });
}

// A leading = + - @ makes spreadsheets run a CSV cell as a formula; a quote
// keeps it text. Phone numbers (+971 4 123 4567) stay as they are.
const FORMULA_RE = /^[=@\t\r]|^[+-](?![\d\s().-]*$)/;
const safeText = value => (typeof value === 'string' && FORMULA_RE.test(value) ? `'${value}` : value);

function csvField(value) {
  const text = String(safeText(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV with a BOM, so Excel opens the Arabic and accented names right. */
export function toCsv(rows, columns = EXPORT_COLUMNS) {
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) lines.push(columns.map(col => csvField(row[col] ?? '')).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** An .xlsx file (ArrayBuffer) with one "Clients" sheet; its text cells are never formulas. */
export function toXlsx(XLSX, rows, columns = EXPORT_COLUMNS) {
  const cells = rows.map(row => Object.fromEntries(columns.map(col => [col, row[col] ?? ''])));
  const sheet = XLSX.utils.json_to_sheet(cells, { header: columns });
  sheet['!cols'] = columns.map(col => ({ wch: col === 'BD Notes' ? 60 : Math.max(10, col.length + 2) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Clients');
  return XLSX.write(book, { bookType: 'xlsx', type: 'array' });
}

/** "cladflo-clients-2026-09-28.csv" */
export function exportFileName(extension, now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `cladflo-clients-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${extension}`;
}
