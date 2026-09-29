// Client tab list (js/views/client-list.js): pages of 25 / 50 / 100, prev/next,
// and the status filter and search. Home has no client table any more.

import { test, expect } from './fixtures.mjs';
import { STORAGE_KEY } from './helpers.mjs';

const NOW = new Date(2026, 8, 27, 10, 0, 0);
const STATUSES = ['lead', 'potential', 'active', 'inactive'];

/** 120 clients, "Client 001" … "Client 120", statuses in turn (30 each). */
const SEED = Array.from({ length: 120 }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  return {
    id: `c${n}`, clientName: `Client ${n}`, title: `Call ${n}`, date: '2026-09-28', time: '10:00',
    status: STATUSES[i % 4], notes: '', reminderMinutesBefore: 0, notified: true
  };
});

/** Load the app (Home), then open the Client tab's list of every client. */
async function openClients(page) {
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ key, events }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(events));
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { key: STORAGE_KEY, events: SEED });
  await page.goto('/index.html?backend=local');
  await expect(page.locator('#dashboard')).toBeVisible();
  await page.locator('#view-client').click();
  await expect(page.locator('#page-client')).toBeVisible();
}

const rows = page => page.locator('#clients-table .client-row:not(.client-head)');
const info = page => page.locator('#page-client .pager-info');
const label = page => page.locator('#page-client .page-label');

test('the client list shows 25 per page and pages with Next / Prev', async ({ page }) => {
  await openClients(page);
  await expect(rows(page)).toHaveCount(25);
  await expect(info(page)).toHaveText('Showing 1–25 of 120');
  await expect(label(page)).toHaveText('Page 1 of 5');
  await expect(page.locator('#clients-page-prev')).toBeDisabled();

  await page.locator('#clients-page-next').click();
  await expect(info(page)).toHaveText('Showing 26–50 of 120');
  await expect(label(page)).toHaveText('Page 2 of 5');
  await expect(page.locator('#clients-page-prev')).toBeEnabled();

  for (let i = 0; i < 3; i++) await page.locator('#clients-page-next').click();
  await expect(info(page)).toHaveText('Showing 101–120 of 120');
  await expect(rows(page)).toHaveCount(20);
  await expect(page.locator('#clients-page-next')).toBeDisabled();

  await page.locator('#clients-page-prev').click();
  await expect(label(page)).toHaveText('Page 4 of 5');
});

test('page size 50 and 100', async ({ page }) => {
  await openClients(page);
  await page.locator('#clients-page-size').selectOption('50');
  await expect(rows(page)).toHaveCount(50);
  await expect(label(page)).toHaveText('Page 1 of 3');

  await page.locator('#clients-page-size').selectOption('100');
  await expect(rows(page)).toHaveCount(100);
  await expect(label(page)).toHaveText('Page 1 of 2');
});

test('the status filter and search narrow the list and start again at page 1', async ({ page }) => {
  await openClients(page);
  await page.locator('#clients-page-next').click();
  await expect(label(page)).toHaveText('Page 2 of 5');

  // The searchable status filter: typing highlights the best match, Enter picks it.
  await page.locator('#clients-status-filter-search').fill('active');
  await page.keyboard.press('Enter');
  await expect(label(page)).toHaveText('Page 1 of 2');
  await expect(info(page)).toHaveText('Showing 1–25 of 30');
  await expect(page.locator('#page-client .client-count')).toHaveText('(30 of 120)');
  const statuses = await rows(page).locator('.client-status').evaluateAll(ns => ns.map(n => n.value));
  expect(statuses).toEqual(Array(25).fill('active'));

  await page.locator('#clients-search').fill('Client 00');
  await expect(rows(page)).toHaveCount(2); // Client 003, Client 007
  await expect(page.locator('#page-client .pager')).toBeVisible();
  await expect(label(page)).toHaveText('Page 1 of 1');

  await page.locator('#clients-status-filter-search').click();
  await page.locator('#page-client .combo-option', { hasText: 'All statuses' }).click();
  await expect(rows(page)).toHaveCount(9);
});

test('no clients: the pager is hidden', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/index.html?backend=local');
  await expect(page.locator('#dashboard')).toBeVisible();
  await page.locator('#view-client').click();
  await expect(page.locator('#clients-table')).toContainText('No clients yet');
  await expect(page.locator('#page-client .pager')).toBeHidden();
});
