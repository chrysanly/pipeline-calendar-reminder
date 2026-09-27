// Excel import through the real UI. The SheetJS CDN script is served from the
// npm copy so the spec runs offline and always against the same version.

import { test, expect } from './fixtures.mjs';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';

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

async function importFile(page, name) {
  await page.locator('#import-file').setInputFiles(fixture(name));
  await expect(page.locator('#banner')).toBeVisible();
}

const cell = (page, key) => page.locator(`#grid .day[data-key="${key}"]`);

test('the Import Excel button opens the file picker', async ({ page }) => {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#import-btn').click();
  expect((await chooser).isMultiple()).toBe(false);
});

test('sample.xlsx: chips land on the dates from the BD Notes', async ({ page }) => {
  await importFile(page, 'sample.xlsx');

  await expect(page.locator('#banner-title')).toHaveText(
    'Imported 4 reminders (1 without a date → Sun, 27 September 2026, 1 skipped)');
  // Jumped to the first imported date's month.
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
  const rose = cell(page, '2026-09-29').locator('.chip');
  await expect(rose.locator('.chip-title')).toHaveText('Follow up: Desert Rose LLC');
  await expect(rose.locator('.chip-time')).toHaveText('10:00');
});

test('importing the same file again adds no duplicates', async ({ page }) => {
  await importFile(page, 'sample.xlsx');
  const count = () => page.evaluate(() => JSON.parse(localStorage.getItem('client-calendar.events.v1')).length);
  expect(await count()).toBe(4);

  await page.locator('#banner-close').click();
  await importFile(page, 'sample.xlsx');
  expect(await count()).toBe(4);
  await expect(cell(page, '2026-10-05').locator('.chip')).toHaveCount(1);
});

test('the user\'s test-data-pipeline.xlsx imports without errors', async ({ page }) => {
  // Real client data: git-ignored, so absent on a fresh clone. sample.xlsx
  // covers the same import path above.
  test.skip(!existsSync(fixture('test-data-pipeline.xlsx')),
    'tests/fixtures/test-data-pipeline.xlsx not present (private, not in git)');
  await importFile(page, 'test-data-pipeline.xlsx');

  await expect(page.locator('#banner-title')).toHaveText(
    'Imported 1 reminder (0 without a date → Sun, 27 September 2026, 0 skipped)');
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
