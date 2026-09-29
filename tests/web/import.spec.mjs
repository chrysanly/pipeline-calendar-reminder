// Excel import through the real UI. The SheetJS CDN script is served from the
// npm copy so the spec runs offline and always against the same version.
// Imports are raw data (Home only), so the calendar checks first put the
// clients on it from the Client page.

import { test, expect } from './fixtures.mjs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, waitForImport } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = name => join(root, 'tests', 'fixtures', name);

// Fixed clock: today is Sun 27 Sep 2026, 10:00.
const NOW = new Date(2026, 8, 27, 10, 0, 0);

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.sheetjs.com/**', route =>
    route.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.clock.install({ time: NOW });
  await openApp(page);
});

/** Import a fixture and wait for its result; an earlier toast is closed first. */
async function importFile(page, name) {
  if (await page.locator('#banner').isVisible()) await page.locator('#banner-close').click();
  await page.locator('#import-file').setInputFiles(fixture(name));
  await waitForImport(page);
}

const cell = (page, key) => page.locator(`#grid .day[data-key="${key}"]`);

/** Home → each client → Add to calendar, then back to Month view (September). */
async function showOnCalendar(page, names) {
  for (const name of names) {
    if (await page.locator('#banner').isVisible()) await page.locator('#banner-close').click();
    await page.locator('#view-dashboard').click();
    await page.locator('.client-name', { hasText: name }).click();
    await page.locator('#page-client .calendar-add').click();
    await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(`Added 1 reminder for ${name} to the calendar`);
  }
  await page.locator('#banner-close').click();
  await page.locator('#view-calendar').click();
  await page.locator('#view-month').click();
}

test('the Import Excel button on Home opens the file picker', async ({ page }) => {
  await page.locator('#view-dashboard').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#import-btn').click();
  expect((await chooser).isMultiple()).toBe(false);
});

test('sample.xlsx: Home only at first; on the calendar, chips land on the dates from the BD Notes', async ({ page }) => {
  await importFile(page, 'sample.xlsx');

  await expect(page.locator('#banner-title')).toHaveText(
    'Imported 4 reminders: 4 new (1 without a date → Sun, 27 September 2026, 1 skipped)');
  await expect(page.locator('#banner-body')).toContainText('They are on Home, not the calendar');
  await expect(page.locator('#grid .chip')).toHaveCount(0);

  await showOnCalendar(page, ['Falcon Trading', 'Palm Holdings']);
  await page.locator('#next').click();
  await expect(page.locator('#month-label')).toHaveText('October 2026');

  const falcon = cell(page, '2026-10-05').locator('.chip');
  await expect(falcon.locator('.chip-title')).toHaveText('Follow up: Falcon Trading');
  await expect(falcon.locator('.chip-client')).toHaveText('Falcon Trading');
  await expect(falcon.locator('.chip-time')).toHaveText('14:30');
  await expect(falcon.locator('.fa-file-import')).toHaveCount(1);

  await expect(cell(page, '2026-10-08').locator('.chip-title')).toHaveText('Follow up: Palm Holdings');
  await expect(cell(page, '2026-10-08').locator('.chip-time')).toHaveText('15:00');
});

test('the panel shows the company details and the BD Notes', async ({ page }) => {
  await importFile(page, 'sample.xlsx');
  await showOnCalendar(page, ['Falcon Trading']);
  await page.locator('#next').click();
  await cell(page, '2026-10-05').locator('.chip-title').click();

  const notes = page.locator('#day-events .event-notes');
  await expect(notes).toContainText('Company details');
  await expect(notes).toContainText('Company Name: Falcon Trading');
  await expect(notes).toContainText('company_email: info@falcon.ae');
  await expect(notes).toContainText('Company Phone: +971 4 111 2222');
  await expect(notes).toContainText('BD Notes:');
  await expect(notes).toContainText('Intro call 02/10/2026. Follow up 05/10/2026 14:30 re pricing');
  await expect(notes).not.toContainText('Logistics');
  await expect(page.locator('#day-events .event-client')).toHaveText('Falcon Trading');
});

test('a row with no date lands on the selected day at the import time', async ({ page }) => {
  // Select Tue 29 Sep first; the undated row should go there.
  await cell(page, '2026-09-29').click({ position: { x: 8, y: 60 } });
  await importFile(page, 'sample.xlsx');

  await expect(page.locator('#banner-title')).toContainText('1 without a date → Tue, 29 September 2026');
  await expect(cell(page, '2026-09-29').locator('.chip')).toHaveCount(0);
  await showOnCalendar(page, ['Desert Rose LLC']);
  const rose = cell(page, '2026-09-29').locator('.chip');
  await expect(rose.locator('.chip-title')).toHaveText('Follow up: Desert Rose LLC');
  await expect(rose.locator('.chip-time')).toHaveText('10:00');
});

test('importing the same file again adds every row as a duplicate, with a badge on Home', async ({ page }) => {
  await importFile(page, 'sample.xlsx');
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('client-calendar.events.v1')));
  expect((await stored()).length).toBe(4);

  await page.locator('#banner-close').click();
  await importFile(page, 'sample.xlsx');
  await expect(page.locator('#banner-title')).toContainText('Imported 4 reminders: 0 new, 4 duplicates (added)');
  const events = await stored();
  expect(events.length).toBe(8);
  expect(events.filter(e => e.duplicate).length).toBe(4);
  expect(new Set(events.map(e => e.importKey)).size).toBe(8);
  await page.locator('#view-dashboard').click();
  await expect(page.locator('.client-row[data-client="Falcon Trading"] .dup-badge')).toHaveText('Duplicate');
});

test('the user\'s test-data-pipeline.xlsx imports without errors', async ({ page }) => {
  // Real client data: git-ignored, so absent on a fresh clone. sample.xlsx
  // covers the same import path above.
  test.skip(!existsSync(fixture('test-data-pipeline.xlsx')),
    'tests/fixtures/test-data-pipeline.xlsx not present (private, not in git)');
  await importFile(page, 'test-data-pipeline.xlsx');

  await expect(page.locator('#banner-title')).toHaveText(
    'Imported 1 reminder: 1 new (0 without a date → Sun, 27 September 2026, 0 skipped)');
  await showOnCalendar(page, ['Acme Lt.']);
  const chip = cell(page, '2026-09-26').locator('.chip');
  await expect(chip.locator('.chip-title')).toHaveText('Follow up: Acme Lt.');
  await expect(chip.locator('.chip-time')).toHaveText('10:00');

  await chip.locator('.chip-title').click();
  await expect(page.locator('#day-events .event-notes')).toContainText('Company Name: Acme Lt.');
  await expect(page.locator('#day-events .event-notes')).toContainText('BD Notes:');
});

test('a file without the needed columns shows an error in the banner', async ({ page }) => {
  await page.locator('#import-file').setInputFiles({
    name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Notes\nSam,call back\n')
  });
  await expect(page.locator('#banner-title')).toHaveText('Import failed');
  await expect(page.locator('#banner-body')).toHaveText('No "Company" column found in the file.');

  await page.locator('#import-file').setInputFiles({
    name: 'companies.csv', mimeType: 'text/csv', buffer: Buffer.from('Company,Phone\nAcme,123\n')
  });
  await expect(page.locator('#banner-body')).toHaveText('No "BD Notes" column found in the file.');
  await expect(page.locator('#grid .chip')).toHaveCount(0);
});
