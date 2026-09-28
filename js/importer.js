// Excel / CSV import. Turns spreadsheet rows into reminders. No DOM: the
// SheetJS library is passed in, so Node tests can drive it with the npm build.

import { toDateKey, fromDateKey } from './calendar.js';
import { addEvent, updateEvent, applyClientFields, clientKey, STATUSES } from './storage.js';
import { eventDateTime } from './reminders.js';
import { locationFromPhone } from './phone-location.js';

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// Most specific first; a later pattern never re-reads text an earlier one used
// (so "2026-03-12" is not also read as "03-12").
const DATE_PATTERNS = [
  // 2026-03-12
  { re: /(?<![\d/.-])(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?![\d/.-]*\d)/g, parts: m => [[+m[1], +m[2], +m[3]]] },
  // 12 Mar 2026, 12-Mar-26, 12th March 2026
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s./-]+${MONTH_RE}\\.?[\\s./,-]+(\\d{4}|\\d{2})\\b`, 'gi'),
    parts: m => [[year(m[3]), month(m[2]), +m[1]]]
  },
  // Mar 12, 2026
  {
    re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    parts: m => [[+m[3], month(m[1]), +m[2]]]
  },
  // 12/03/2026, 12-03-2026, 12.03.26 — day first, month first only if that is impossible
  {
    re: /(?<![\d/.+-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![/.-]?\d)/g,
    parts: m => [[year(m[3]), +m[2], +m[1]], [year(m[3]), +m[1], +m[2]]]
  },
  // 12/03 or 09-26 with no year: the year of the fallback date
  {
    re: /(?<![\d/.+-])(\d{1,2})[/-](\d{1,2})(?![/.-]?\d)/g,
    parts: (m, y) => [[y, +m[2], +m[1]], [y, +m[1], +m[2]]]
  }
];

// "14:30", "2:30 pm", "2pm", "at 9.15am" right after the date.
const TIME_AFTER_RE = /^[\s,]*(?:(?:at|@|-)\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\.?(?![a-z])|^[\s,]*(?:(?:at|@|-)\s*)?(\d{1,2}):(\d{2})(?!\d)/i;

function year(text) {
  const n = Number(text);
  return text.length === 2 ? 2000 + n : n;
}

function month(name) {
  return MONTHS[name.slice(0, 3).toLowerCase()];
}

const pad = n => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for a real calendar date, else null (rejects 31/02). */
function validKey(y, m, d) {
  if (!y || !m || !d || m > 12 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return toDateKey(date);
}

function timeAfter(text) {
  const m = TIME_AFTER_RE.exec(text);
  if (!m) return null;
  let h;
  let min;
  if (m[1] !== undefined) {
    h = Number(m[1]);
    min = Number(m[2] || 0);
    if (h < 1 || h > 12) return null;
    const pm = m[3].toLowerCase() === 'p';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else {
    h = Number(m[4]);
    min = Number(m[5]);
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Every date written in `text`, in reading order: [{key, end}]. */
function findDates(text, defaultYear) {
  const taken = [];
  const found = [];
  for (const { re, parts } of DATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      const key = parts(m, defaultYear).map(p => validKey(...p)).find(Boolean);
      if (!key) continue;
      taken.push([start, end]);
      found.push({ key, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The newest date in a notes text, plus a time written right after it.
 * @returns {{date: string, time: string, dateFound: boolean, timeFound: boolean}}
 */
export function extractDateTime(text, fallbackDate, fallbackTime) {
  const source = String(text || '');
  const defaultYear = fromDateKey(fallbackDate).getFullYear();
  const dates = findDates(source, defaultYear);
  if (!dates.length) return { date: fallbackDate, time: fallbackTime, dateFound: false, timeFound: false };

  // Latest date wins; on a tie, the last mention.
  let best = dates[0];
  for (const d of dates) if (d.key >= best.key) best = d;

  const time = timeAfter(source.slice(best.end, best.end + 16));
  return {
    date: best.key,
    time: time || fallbackTime,
    dateFound: true,
    timeFound: Boolean(time)
  };
}

const normalizeLabel = label => String(label).trim().toLowerCase().replace(/\s+/g, ' ');

const firstMatching = (headers, re) => headers.find(h => re.test(normalizeLabel(h).replace(/_/g, ' '))) || null;

/**
 * Which headers hold the company name, other company fields, BD Notes, and
 * (optional) phone, city, country, location and status.
 */
export function findColumns(headers) {
  const companyCols = headers.filter(h => normalizeLabel(h).includes('company'));
  const nameCol =
    companyCols.find(h => ['company', 'company name'].includes(normalizeLabel(h))) ||
    companyCols[0] || null;
  const notesCol = headers.find(h => String(h).toLowerCase().replace(/[\s_.]+/g, '') === 'bdnotes') || null;
  return {
    companyCols,
    nameCol,
    notesCol,
    phoneCol: firstMatching(headers, /phone|mobile|\btel\b|telephone|contact (?:number|no)/),
    cityCol: firstMatching(headers, /\bcity\b/),
    countryCol: firstMatching(headers, /\bcountry\b/),
    locationCol: firstMatching(headers, /location|address|\barea\b/),
    statusCol: firstMatching(headers, /\bstatus\b|\bstage\b/)
  };
}

/** "Leads", " ACTIVE " → a known status; anything else → null. */
export function statusFromCell(value) {
  const word = String(value || '').trim().toLowerCase().replace(/s$/, '');
  return STATUSES.includes(word) ? word : null;
}

function cellText(value) {
  if (value instanceof Date) {
    const key = toDateKey(value);
    return value.getHours() || value.getMinutes() ? `${key} ${pad(value.getHours())}:${pad(value.getMinutes())}` : key;
  }
  return value === null || value === undefined ? '' : String(value).trim();
}

function headersOf(rows) {
  const seen = new Set();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/**
 * One reminder per row that has a company name.
 * @returns {{events: object[], skipped: number, warnings: string[]}}
 */
export function rowsToEvents(rows, { selectedKey, now = new Date() }) {
  const cols = findColumns(headersOf(rows));
  if (!cols.nameCol) throw new Error('No "Company" column found in the file.');
  if (!cols.notesCol) throw new Error('No "BD Notes" column found in the file.');

  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const events = [];
  const warnings = [];
  let skipped = 0;

  rows.forEach((row, i) => {
    const values = Object.values(row).map(cellText);
    if (values.every(v => !v)) return; // blank row
    const company = cellText(row[cols.nameCol]);
    if (!company) {
      skipped++;
      warnings.push(`Row ${i + 2}: no company name, skipped.`);
      return;
    }

    const bdNotes = cellText(row[cols.notesCol]);
    const when = extractDateTime(bdNotes, selectedKey, nowTime);

    const details = cols.companyCols
      .map(label => [String(label).trim(), cellText(row[label])])
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`);
    const notes = `Company details\n${details.join('\n')}\n\nBD Notes:\n${bdNotes}`;

    // City/country columns win; otherwise read them off the phone number.
    const phone = cols.phoneCol ? cellText(row[cols.phoneCol]) : '';
    const fromPhone = locationFromPhone(phone);
    const cityCell = cols.cityCol ? cellText(row[cols.cityCol]) : '';
    const countryCell = cols.countryCol ? cellText(row[cols.countryCol]) : '';
    const city = cityCell || (fromPhone && fromPhone.city) || '';
    const country = countryCell || (fromPhone && fromPhone.country) || '';
    const statusCell = cols.statusCol ? statusFromCell(row[cols.statusCol]) : null;

    const evt = {
      title: `Follow up: ${company}`,
      clientName: company,
      date: when.date,
      time: when.time,
      notes,
      reminderMinutesBefore: 0,
      source: 'import',
      // Undated rows follow the selected day, so their key must not include it
      // or re-importing from another day would duplicate them.
      importKey: `${company.toLowerCase()}|${when.dateFound ? when.date : 'undated'}`,
      status: statusCell || 'lead',
      phone,
      location: cols.locationCol ? cellText(row[cols.locationCol]) : '',
      city,
      country,
      updatedAt: now.toISOString(),
      dateFound: when.dateFound,
      timeFound: when.timeFound,
      statusFound: Boolean(statusCell),
      locFromPhone: Boolean(fromPhone && ((!cityCell && fromPhone.city) || (!countryCell && fromPhone.country)))
    };
    // Anything not in the future is marked done so an import doesn't set off
    // a flood of popups.
    evt.notified = eventDateTime(evt).getTime() <= now.getTime();
    events.push(evt);
  });

  return { events, skipped, warnings };
}

/**
 * Add imported reminders, updating (not duplicating) ones with the same importKey.
 * @returns {{events: object[], added: number, updated: number}}
 */
const LOCATION_FIELDS = ['phone', 'location', 'city', 'country'];

export function mergeImported(existing, imported) {
  let events = existing;
  let added = 0;
  let updated = 0;
  for (const { dateFound, timeFound, statusFound, locFromPhone, ...data } of imported) {
    // What we already know about this client wins over the file: a status set
    // by hand is kept, and the file only fills location fields that are blank.
    const known = latestForClient(events, data.clientName);
    if (known) {
      // 'lead' is only the default, so a Status column may still move it on.
      const fileUpgradesDefault = statusFound && known.status === 'lead';
      if (!fileUpgradesDefault) data.status = known.status;
      for (const field of LOCATION_FIELDS) data[field] = known[field] || data[field];
    }

    const match = events.find(e => e.importKey && e.importKey === data.importKey);
    if (match) {
      events = updateEvent(events, match.id, {
        ...data,
        // A guessed date or time (selected day / import time) must not drift
        // on every re-import.
        date: dateFound ? data.date : match.date,
        time: timeFound ? data.time : match.time,
        notified: match.notified || data.notified
      });
      updated++;
    } else {
      events = addEvent(events, data);
      added++;
    }
    // Status and filled-in blanks belong to the whole client, not just this reminder.
    const shared = Object.fromEntries(LOCATION_FIELDS.filter(f => data[f]).map(f => [f, data[f]]));
    events = applyClientFields(events, data.clientName, { status: data.status, ...shared }, data.updatedAt);
  }
  return { events, added, updated };
}

/** The most recently saved reminder for a client, or null. */
function latestForClient(events, clientName) {
  const key = clientKey(clientName);
  let best = null;
  for (const evt of events) {
    if (clientKey(evt.clientName) !== key) continue;
    if (!best || (evt.updatedAt || '') >= (best.updatedAt || '')) best = evt;
  }
  return best;
}

/** How many imported rows got their city or country from the phone number. */
export function locationsFromPhoneCount(events) {
  return events.filter(e => e.locFromPhone).length;
}

/** Read a workbook and convert its first sheet that has a Company column. */
export function importWorkbook(XLSX, data, options) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let workbook;
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: true });
  } catch (err) {
    throw new Error('The file could not be read as a spreadsheet.');
  }
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    if (findColumns(headersOf(rows)).nameCol) {
      return { sheetName, ...rowsToEvents(rows, options) };
    }
  }
  throw new Error('No "Company" column found in the file.');
}

/**
 * "Imported 3 reminders: 2 new, 1 duplicate (1 without a date → Sun, 27 September 2026, 1 skipped)".
 * `merged` is what mergeImported returned: a duplicate is a row whose reminder
 * already existed (or came earlier in the same file) and was updated, not added.
 */
export function importSummary({ events, skipped }, selectedLabel, { added, updated }) {
  const n = events.length;
  const undated = events.filter(e => !e.dateFound).length;
  return `Imported ${n} reminder${n === 1 ? '' : 's'}: ${added} new, ${updated} duplicate${updated === 1 ? '' : 's'}`
    + ` (${undated} without a date → ${selectedLabel}, ${skipped} skipped)`;
}
