// Import tools: the progress toast, Re-import from History (files kept in
// IndexedDB), and Clear calendar with an optional date range. Imports start
// off the calendar (Home only), so these put clients on it from the Client page.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';
import XLSX from 'xlsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE = join(root, 'tests', 'fixtures', 'sample.xlsx');

// Fixed clock: today is Sun 27 Sep 2026, 10:00.
const NOW = new Date(2026, 8, 27, 10, 0, 0);

const FIRST_IMPORT = 'Imported 4 reminders: 4 new (1 without a date → Sun, 27 September 2026, 1 skipped)';
// Re-import from History updates the same rows.
const SAME_AGAIN = /^Imported 4 reminders: 0 new, 4 updated/;
const ALL_NEW = /^Imported 4 reminders: 4 new \(/;
const ALL_CLIENTS = ['Desert Rose LLC', 'Falcon Trading', 'Oasis Group', 'Palm Holdings'];

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.sheetjs.com/**', route =>
    route.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.clock.install({ time: NOW });
  await openApp(page);
});

/** The result toast sits over the top nav: close it the way a user would. */
async function dismissToast(page) {
  await page.locator('#banner-close').click();
  await expect(page.locator('#banner')).toBeHidden();
}

async function importSample(page) {
  await page.locator('#import-file').setInputFiles(SAMPLE);
  await expect(page.locator('#banner-title')).toHaveText(FIRST_IMPORT);
  await dismissToast(page);
}

/** An .xlsx with `count` dated company rows, big enough to import in several chunks. */
function bigWorkbook(count) {
  const rows = Array.from({ length: count }, (_, i) =>
    ({ Company: `Firm ${i}`, 'BD Notes': `Call on ${String(1 + (i % 28)).padStart(2, '0')}/10/2026` }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Leads');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}

const cell = (page, key) => page.locator(`#grid .day[data-key="${key}"]`);

/** Home → a client → Add to calendar, for each name. */
async function putOnCalendar(page, names) {
  for (const name of names) {
    await page.locator('#view-dashboard').click();
    await page.locator('.client-name', { hasText: name }).click();
    await expect(page.locator('#page-client .profile-name')).toHaveText(name);
    await page.locator('#page-client .calendar-add').click();
    await expect(page.locator('#banner-title')).toHaveText(`Added 1 reminder for ${name} to the calendar`);
    await dismissToast(page);
  }
}

async function openMonth(page) {
  await page.locator('#view-calendar').click();
  await page.locator('#view-month').click();
}

/** Calendar -> Day / Week / Month (on today, Sun 27 Sep 2026), `steps` ahead with Next. */
async function openView(page, view, steps = 0) {
  await page.locator('#view-calendar').click();
  await page.locator(`#view-${view}`).click();
  await page.locator('#today').click();
  for (let i = 0; i < steps; i++) await page.locator('#next').click();
}

/** Clear calendar from the toolbar: the dialog is fixed to the period on screen. */
async function clearShown(page, { title, count }) {
  await page.locator('.cal-toolbar #clear-calendar-btn').click();
  const dialog = page.locator('#clear-calendar');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#clear-calendar-title')).toHaveText(title);
  await expect(page.locator('#clear-calendar-count')).toHaveText(count);
  await expect(page.locator('#clear-calendar-warning')).toContainText('Home, your clients and all their data stay');
  await expect(dialog.locator('[name="from"], [name="to"]')).toHaveCount(0);
  await page.locator('#clear-calendar-submit').click();
  await expect(dialog).toBeHidden();
}

/** Every title the toast shows, with whether it was the busy (spinner) one. */
async function recordToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const title = document.querySelector('#banner-title');
    new MutationObserver(() => window.__toasts.push({
      text: title.textContent,
      busy: document.querySelector('#banner').classList.contains('is-busy')
    })).observe(title, { childList: true, characterData: true, subtree: true });
  });
}

async function expectBusyThenDone(page, busy, done) {
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(done);
  const toasts = await page.evaluate(() => window.__toasts);
  const busyAt = toasts.findIndex(t => t.busy && t.text === busy);
  expect(busyAt, JSON.stringify(toasts)).toBeGreaterThanOrEqual(0);
  expect(toasts.findIndex(t => !t.busy && t.text === done)).toBeGreaterThan(busyAt);
}

const historyItems = page => page.locator('#history-list .history-item');

test('the import toast shows a spinner and "Importing n/total" per chunk, then the summary', async ({ page }) => {
  // Record every title the toast shows, since the progress steps are quick.
  await page.evaluate(() => {
    window.__toasts = [];
    const title = document.querySelector('#banner-title');
    new MutationObserver(() => window.__toasts.push({
      text: title.textContent,
      busy: document.querySelector('#banner').classList.contains('is-busy')
    })).observe(title, { childList: true, characterData: true, subtree: true });
  });
  await page.locator('#import-file').setInputFiles({
    name: 'big.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: bigWorkbook(120)
  });
  await expect(page.locator('#banner-title')).toHaveText(/^Imported 120 reminders: 120 new/);
  const toasts = await page.evaluate(() => window.__toasts);
  const steps = toasts.map(t => t.text).filter(text => text.startsWith('Importing '));
  expect(steps).toEqual(expect.arrayContaining(['Importing 50/120', 'Importing 100/120', 'Importing 120/120']));
  expect(toasts.filter(t => t.text.startsWith('Importing')).every(t => t.busy)).toBe(true);
  await expect(page.locator('#banner')).not.toHaveClass(/is-busy/);
  await expect(page.locator('#banner')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#banner-body')).toHaveText('They are on Home, not the calendar: open a client and pick Add to calendar.');
});

test('History keeps the file: Re-import updates the same reminders (no duplicates) and logs it, even after a reload', async ({ page }) => {
  await importSample(page);
  await page.reload();
  await page.locator('#view-history').click();
  const imported = historyItems(page).filter({ hasText: 'sample.xlsx' });
  await expect(imported).toHaveCount(1);
  await imported.locator('.history-reimport').click();
  await expect(page.locator('#banner-title')).toHaveText(SAME_AGAIN);
  await dismissToast(page);

  await expect(historyItems(page).first()).toContainText('Re-import · Imported 4 reminders');
  await expect(historyItems(page).locator('.history-reimport')).toHaveCount(2);
  await page.locator('#view-dashboard').click();
  await expect(page.locator('.client-row:not(.client-head)')).toHaveCount(4);
  await expect(page.locator('#client-list .dup-badge')).toHaveCount(0);
  // Still raw data: Re-import does not put them on the calendar.
  await openMonth(page);
  await expect(cell(page, '2026-10-05').locator('.chip')).toHaveCount(0);
});

test('Clear calendar is in the Calendar toolbar on Day, Week and Month, not on Home', async ({ page }) => {
  await page.locator('#view-dashboard').click();
  await expect(page.locator('#dashboard #clear-calendar-btn')).toHaveCount(0);
  await expect(page.locator('#clear-calendar-btn')).toBeHidden();
  for (const view of ['day', 'week', 'month']) {
    await openView(page, view);
    await expect(page.locator('.cal-toolbar #clear-calendar-btn')).toBeVisible();
  }
});

test('Month: clears only that month; Home keeps the clients, other months keep theirs, History logs the period', async ({ page }) => {
  await importSample(page);
  await putOnCalendar(page, ALL_CLIENTS);
  await openView(page, 'month', 1);
  await expect(page.locator('#month-label')).toHaveText('October 2026');
  await recordToasts(page);
  await clearShown(page, { title: 'Clear October 2026', count: '2 reminders on the calendar this month will be cleared.' });
  await expectBusyThenDone(page, 'Clearing 2 reminders from October 2026…', 'Cleared 2 reminders from October 2026');
  await dismissToast(page);
  await expect(cell(page, '2026-10-05').locator('.chip')).toHaveCount(0);
  await expect(cell(page, '2026-10-08').locator('.chip')).toHaveCount(0);
  // The grid's leading days are September's: Desert Rose (27 Sep) stays.
  await expect(cell(page, '2026-09-27').locator('.chip')).toHaveCount(1);

  // September keeps its reminder, and Home keeps everyone.
  await page.locator('#prev').click();
  await expect(cell(page, '2026-09-27').locator('.chip')).toHaveCount(1);
  await page.locator('#view-dashboard').click();
  await expect(page.locator('#client-list')).toContainText('Falcon Trading');
  await expect(page.locator('#client-list')).toContainText('Palm Holdings');

  await page.locator('#view-history').click();
  await expect(historyItems(page).first()).toContainText('Cleared 2 reminders from October 2026');
  await expect(historyItems(page).first()).toContainText('Month: October 2026');
});

test('Day clears only that day and Week only that week; the same reminders leave the other views too', async ({ page }) => {
  await importSample(page);
  await putOnCalendar(page, ALL_CLIENTS);

  // Day: Sun 27 Sep holds Desert Rose (the undated row).
  await openView(page, 'day');
  await recordToasts(page);
  await clearShown(page, { title: 'Clear Sun, 27 Sep 2026', count: '1 reminder on the calendar this day will be cleared.' });
  await expectBusyThenDone(page, 'Clearing 1 reminder from Sun, 27 Sep 2026…', 'Cleared 1 reminder from Sun, 27 Sep 2026');
  await dismissToast(page);
  await openMonth(page);
  await expect(cell(page, '2026-09-27').locator('.chip')).toHaveCount(0);

  // Week of 4-10 Oct: Falcon (5 Oct) and Palm (8 Oct).
  await openView(page, 'week', 1);
  await clearShown(page, { title: 'Clear 4 – 10 Oct 2026', count: '2 reminders on the calendar this week will be cleared.' });
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText('Cleared 2 reminders from 4 – 10 Oct 2026');
  await dismissToast(page);
  await openView(page, 'month', 1);
  await expect(page.locator('#grid .chip')).toHaveCount(0);

  // Re-import keeps them cleared; Add to calendar brings one back.
  await page.locator('#view-history').click();
  await historyItems(page).filter({ hasText: 'sample.xlsx' }).locator('.history-reimport').click();
  await expect(page.locator('#banner-title')).toHaveText(SAME_AGAIN);
  await dismissToast(page);
  await putOnCalendar(page, ['Falcon Trading']);
  await openView(page, 'month', 1);
  await expect(cell(page, '2026-10-05').locator('.chip-title')).toHaveText('Follow up: Falcon Trading');
});

test('an empty period cannot be cleared; Cancel and Escape close without clearing', async ({ page }) => {
  await importSample(page);
  await putOnCalendar(page, ['Falcon Trading']);
  await openView(page, 'week');
  await page.locator('.cal-toolbar #clear-calendar-btn').click();
  await expect(page.locator('#clear-calendar-count')).toHaveText('Nothing on the calendar this week: there is nothing to clear.');
  await expect(page.locator('#clear-calendar-submit')).toBeDisabled();
  await page.locator('#clear-calendar-cancel').click();
  await expect(page.locator('#clear-calendar')).toBeHidden();

  await openView(page, 'week', 1);
  await page.locator('.cal-toolbar #clear-calendar-btn').click();
  await expect(page.locator('#clear-calendar-submit')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#clear-calendar')).toBeHidden();
  await openView(page, 'month', 1);
  await expect(cell(page, '2026-10-05').locator('.chip')).toHaveCount(1);
});

test('Clear all data keeps History and the file, so Re-import brings the reminders back', async ({ page }) => {
  await importSample(page);
  await page.locator('#settings-btn').click();
  await page.locator('#clear-confirm').fill('CLEAR');
  await page.locator('#clear-all').click();
  await expect(page.locator('#clear-status')).toHaveText('Cleared 4 reminders, 0 minutes.');
  await page.locator('#settings-close').click();

  await page.locator('#view-history').click();
  await historyItems(page).filter({ hasText: 'sample.xlsx' }).locator('.history-reimport').click();
  await expect(page.locator('#banner-title')).toHaveText(ALL_NEW);
  await dismissToast(page);
  await page.locator('#view-dashboard').click();
  await expect(page.locator('#client-list')).toContainText('Falcon Trading');
});
