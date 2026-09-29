// Home client list: pages of 25 / 50 / 100 / custom, prev/next, and the status filter.

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

async function openHome(page) {
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
}

const rows = page => page.locator('.client-row:not(.client-head)');

test('the client list shows 25 per page and pages with Next / Prev', async ({ page }) => {
  await openHome(page);
  await expect(rows(page)).toHaveCount(25);
  await expect(page.locator('#pager-info')).toHaveText('Showing 1–25 of 120');
  await expect(page.locator('#page-label')).toHaveText('Page 1 of 5');
  await expect(page.locator('#page-prev')).toBeDisabled();

  await page.locator('#page-next').click();
  await expect(page.locator('#pager-info')).toHaveText('Showing 26–50 of 120');
  await expect(page.locator('#page-label')).toHaveText('Page 2 of 5');
  await expect(page.locator('#page-prev')).toBeEnabled();

  for (let i = 0; i < 3; i++) await page.locator('#page-next').click();
  await expect(page.locator('#pager-info')).toHaveText('Showing 101–120 of 120');
  await expect(rows(page)).toHaveCount(20);
  await expect(page.locator('#page-next')).toBeDisabled();

  await page.locator('#page-prev').click();
  await expect(page.locator('#page-label')).toHaveText('Page 4 of 5');
});

test('page size 50, 100 and a custom number; the choice survives a reload', async ({ page }) => {
  await openHome(page);
  await page.locator('#page-size').selectOption('50');
  await expect(rows(page)).toHaveCount(50);
  await expect(page.locator('#page-label')).toHaveText('Page 1 of 3');

  await page.locator('#page-size').selectOption('100');
  await expect(rows(page)).toHaveCount(100);

  await expect(page.locator('#page-size-custom')).toBeHidden();
  await page.locator('#page-size').selectOption('custom');
  const custom = page.locator('#page-size-custom');
  await expect(custom).toBeVisible();
  await expect(custom).toBeFocused();
  await custom.fill('40');
  await custom.press('Enter');
  await expect(rows(page)).toHaveCount(40);
  await expect(page.locator('#page-label')).toHaveText('Page 1 of 3');

  await page.reload();
  await expect(rows(page)).toHaveCount(40);
  await expect(page.locator('#page-size')).toHaveValue('custom');
  await expect(page.locator('#page-size-custom')).toHaveValue('40');

  // Nonsense keeps the current size.
  await custom.fill('0');
  await custom.press('Enter');
  await expect(rows(page)).toHaveCount(40);
});

test('the status filter and search narrow the list and start again at page 1', async ({ page }) => {
  await openHome(page);
  await page.locator('#page-next').click();
  await expect(page.locator('#page-label')).toHaveText('Page 2 of 5');

  // The searchable status filter: typing highlights the best match, Enter picks it.
  await page.locator('#client-status-filter-search').fill('active');
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-label')).toHaveText('Page 1 of 2');
  await expect(page.locator('#pager-info')).toHaveText('Showing 1–25 of 30');
  await expect(page.locator('#client-count')).toHaveText('(30 of 120)');
  const statuses = await rows(page).locator('.client-status').evaluateAll(ns => ns.map(n => n.value));
  expect(statuses).toEqual(Array(25).fill('active'));
  // The status card shows the same filter.
  await expect(page.locator('.status-card.status-active')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#client-search').fill('Client 00');
  await expect(rows(page)).toHaveCount(2); // Client 003, Client 007
  await expect(page.locator('#client-pager')).toBeVisible();
  await expect(page.locator('#page-label')).toHaveText('Page 1 of 1');

  await page.locator('#client-status-filter-search').click();
  await page.locator('#dashboard .combo-option', { hasText: 'All statuses' }).click();
  await expect(rows(page)).toHaveCount(9);

  // A status card click updates the dropdown too.
  await page.locator('.status-card.status-lead').click();
  await expect(page.locator('#client-status-filter')).toHaveValue('lead');
});

test('no clients: the pager is hidden', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/index.html?backend=local');
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#client-pager')).toBeHidden();
});
