// Day / Week / Month views: cell counts, labels, navigation, persistence.

import { test, expect } from './fixtures.mjs';
import { openApp } from './helpers.mjs';
import { formatRangeLabel, shiftCursor } from '../../js/calendar.js';

const now = new Date();
const TODAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());

const CELLS = { day: 1, week: 7, month: 42 };

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('month view: 42 days, weekday headers and the month label', async ({ page }) => {
  await expect(page.locator('#view-month')).toHaveClass(/is-active/);
  await expect(page.locator('#grid .day')).toHaveCount(42);
  await expect(page.locator('#weekdays .weekday')).toHaveCount(7);
  await expect(page.locator('#month-label')).toHaveText(formatRangeLabel('month', TODAY));
});

for (const view of ['day', 'week', 'month']) {
  test(`${view} view renders ${CELLS[view]} cell(s) and the right label`, async ({ page }) => {
    // Start from a different view so every switch really changes something.
    await page.locator(view === 'month' ? '#view-week' : '#view-month').click();
    await page.locator(`#view-${view}`).click();

    await expect(page.locator(`#view-${view}`)).toHaveClass(/is-active/);
    await expect(page.locator('.views button.is-active')).toHaveCount(1);
    await expect(page.locator('#grid .day')).toHaveCount(CELLS[view]);
    await expect(page.locator('#weekdays .weekday')).toHaveCount(view === 'day' ? 1 : 7);
    await expect(page.locator('#month-label')).toHaveText(formatRangeLabel(view, TODAY));
  });

  test(`${view} view: prev and next move by one ${view}, Today returns`, async ({ page }) => {
    await page.locator(`#view-${view}`).click();

    await page.locator('#next').click();
    await expect(page.locator('#month-label')).toHaveText(formatRangeLabel(view, shiftCursor(view, TODAY, 1)));

    await page.locator('#prev').click();
    await page.locator('#prev').click();
    await expect(page.locator('#month-label')).toHaveText(formatRangeLabel(view, shiftCursor(view, TODAY, -1)));

    await page.locator('#today').click();
    await expect(page.locator('#month-label')).toHaveText(formatRangeLabel(view, TODAY));
  });
}

test('week view marks today in the header and the column', async ({ page }) => {
  await page.locator('#view-week').click();
  await expect(page.locator('#weekdays .weekday.is-today')).toHaveCount(1);
  await expect(page.locator('#grid .day.is-today')).toHaveCount(1);
});

test('keys D, W, M switch views and arrows follow the current view', async ({ page }) => {
  await page.keyboard.press('w');
  await expect(page.locator('#grid .day')).toHaveCount(7);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#month-label')).toHaveText(formatRangeLabel('week', shiftCursor('week', TODAY, 1)));

  await page.keyboard.press('t');
  await page.keyboard.press('d');
  await expect(page.locator('#grid .day')).toHaveCount(1);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#month-label')).toHaveText(formatRangeLabel('day', shiftCursor('day', TODAY, -1)));

  await page.keyboard.press('m');
  await expect(page.locator('#grid .day')).toHaveCount(42);
});

test('the chosen view survives a reload', async ({ page }) => {
  await page.locator('#view-week').click();
  await page.reload();
  await page.waitForSelector('#grid .day');

  await expect(page.locator('#view-week')).toHaveClass(/is-active/);
  await expect(page.locator('#grid .day')).toHaveCount(7);
});
