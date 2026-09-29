// History view: every change is logged, newest first, with filters, search
// and relative times. Local mode.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, fillForm, waitForImport } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date(2026, 8, 27, 10, 0, 0);

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.sheetjs.com/**', route =>
    route.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.clock.install({ time: NOW });
  await openApp(page);
  page.on('dialog', dialog => dialog.accept());
});

async function createEvent(page, fields) {
  await page.locator('#add-event').click();
  await fillForm(page, { date: '2026-09-28', time: '14:30', ...fields });
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
}

const entries = page => page.locator('#history-list .history-item');

test('the History button and the L key open the History view', async ({ page }) => {
  await page.locator('#view-history').click();
  await expect(page.locator('#history')).toBeVisible();
  await expect(page.locator('.calendar')).toBeHidden();
  await expect(page.locator('#view-history')).toHaveClass(/is-active/);
  await expect(page.locator('#history-list')).toContainText('No changes yet');
  await page.keyboard.press('m');
  await expect(page.locator('#history')).toBeHidden();
  await page.keyboard.press('l');
  await expect(page.locator('#history')).toBeVisible();
  await expect(page.locator('.nav')).toBeHidden();
});

test('create, edit, delete and status changes are logged newest first', async ({ page }) => {
  await createEvent(page, { title: 'Renewal call', clientName: 'Acme Ltd.' });
  await page.locator('#grid .chip-title', { hasText: 'Renewal call' }).click();
  await page.locator('#panel .event-actions button', { hasText: 'Edit' }).click();
  await fillForm(page, { title: 'Renewal call v2' });
  await page.locator('#event-form button[type="submit"]').click();

  await page.keyboard.press('h');
  await page.locator('.client-row[data-client="Acme Ltd."] .client-status').selectOption('active');

  await page.keyboard.press('m');
  await page.locator('#grid .chip-title', { hasText: 'Renewal call v2' }).click();
  await page.locator('#panel .event-actions button', { hasText: 'Delete' }).click();

  await page.keyboard.press('l');
  await expect(entries(page)).toHaveCount(4);
  await expect(entries(page).locator('.history-badge')).toHaveText(['Deleted', 'Status', 'Edited', 'Created']);
  await expect(entries(page).nth(0)).toContainText('Renewal call v2');
  await expect(entries(page).nth(1)).toContainText('Lead → Active');
  await expect(entries(page).nth(3)).toContainText('Acme Ltd.');
  await expect(entries(page).nth(3)).toContainText('Mon, 28 September 2026, 14:30');
  await expect(entries(page).nth(0).locator('.history-time')).toHaveText('just now');
  await expect(page.locator('#history-count')).toHaveText('(4)');
});

test('an Excel import is one History entry with the file name', async ({ page }) => {
  await page.locator('#import-file').setInputFiles(join(root, 'tests', 'fixtures', 'sample.xlsx'));
  await waitForImport(page);
  await page.keyboard.press('l');
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toHaveAttribute('data-action', 'import');
  await expect(entries(page).first()).toContainText('sample.xlsx');
});

test('filters by action and client, and the search box', async ({ page }) => {
  await createEvent(page, { title: 'Call Acme', clientName: 'Acme Ltd.' });
  await createEvent(page, { title: 'Visit Falcon', clientName: 'Falcon Trading' });
  await page.keyboard.press('l');
  await expect(entries(page)).toHaveCount(2);

  await expect(page.locator('#history-client option')).toHaveText(['All clients', 'Acme Ltd.', 'Falcon Trading']);
  await page.locator('#history-client').selectOption('Falcon Trading');
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('Visit Falcon');
  await expect(page.locator('#history-count')).toHaveText('(1 of 2)');

  await page.locator('#history-client').selectOption('');
  await page.locator('#history-action').selectOption('delete');
  await expect(page.locator('#history-list')).toContainText('No entries match');

  await page.locator('#history-action').selectOption('create');
  await page.locator('#history-search').fill('acme');
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page).first()).toContainText('Call Acme');
});

test('times age ("5 min ago") and the log survives a reload', async ({ page }) => {
  await createEvent(page, { title: 'Call Acme', clientName: 'Acme Ltd.' });
  await page.keyboard.press('l');
  await expect(entries(page).first().locator('.history-time')).toHaveText('just now');
  await page.clock.fastForward('05:00');
  await expect(entries(page).first().locator('.history-time')).toHaveText('5 min ago');
  await page.reload();
  await expect(page.locator('#history')).toBeVisible();
  await expect(entries(page)).toHaveCount(1);
});
