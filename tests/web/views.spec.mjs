// Day / Week / Month views: cell counts, labels, navigation, persistence.

import { test, expect } from './fixtures.mjs';
import { openApp, goToView } from './helpers.mjs';
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
    await goToView(page, view === 'month' ? 'week' : 'month');
    await page.locator(`#view-${view}`).click();

    await expect(page.locator(`#view-${view}`)).toHaveClass(/is-active/);
    await expect(page.locator('.views button.is-active')).toHaveCount(1);
    await expect(page.locator('#grid .day')).toHaveCount(CELLS[view]);
    // Month has the weekday row above the grid; Day and Week have their own head row.
    if (view === 'month') await expect(page.locator('#weekdays .weekday')).toHaveCount(7);
    else await expect(page.locator('#grid .tg-day-head')).toHaveCount(CELLS[view]);
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
  await goToView(page, 'week');
  await expect(page.locator('#grid .tg-day-head.is-today')).toHaveCount(1);
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
  await goToView(page, 'week');
  await page.reload();
  await page.waitForSelector('#grid .day');

  await expect(page.locator('#view-week')).toHaveClass(/is-active/);
  await expect(page.locator('#grid .day')).toHaveCount(7);
});

test('day and week are 24-hour grids that open at 7am, or around now on today', async ({ page }) => {
  await goToView(page, 'week');
  await expect(page.locator('#grid .tg-hours .tg-hour')).toHaveCount(24);
  await expect(page.locator('#grid .tg-body')).toHaveCSS('height', `${24 * 48}px`);
  await expect(page.locator('#grid .day.is-today .tg-now')).toHaveCount(1);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const expected = Math.max(0, nowMinutes - 60) * 48 / 60;
  const top = await page.locator('#grid .tg-scroll').evaluate(n => n.scrollTop);
  const max = await page.locator('#grid .tg-scroll').evaluate(n => n.scrollHeight - n.clientHeight);
  expect(Math.abs(top - Math.min(expected, max))).toBeLessThan(2);

  await page.locator('#next').click(); // next week: no today, so 7am
  expect(await page.locator('#grid .tg-scroll').evaluate(n => n.scrollTop)).toBe(7 * 48);
  await expect(page.locator('#grid .tg-now')).toHaveCount(0);
});
