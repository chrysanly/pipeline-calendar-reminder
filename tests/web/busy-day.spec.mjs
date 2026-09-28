// A day with many reminders: week/day columns scroll inside instead of
// stretching the page, and "+N more" lists the whole day in the sheet.

import { test, expect } from './fixtures.mjs';
import { STORAGE_KEY } from './helpers.mjs';

const NOW = new Date(2026, 8, 27, 10, 0, 0); // Sun 27 Sep 2026
const BUSY = '2026-09-28';

/** 30 reminders on Monday 28 September, one on Tuesday. */
const SEED = [
  ...Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`, title: `Follow up: Logistics company number ${i + 1} with a long name`, clientName: `Company ${i + 1}`,
    date: BUSY, time: `${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`
  })),
  { id: 't1', title: 'Follow up: ASD Test', clientName: 'ASD Test', date: '2026-09-29', time: '17:07' }
].map(e => ({ status: 'lead', notes: '', reminderMinutesBefore: 0, notified: true, ...e }));

async function open(page, view) {
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ key, events, view }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(events));
      localStorage.setItem('view', view);
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { key: STORAGE_KEY, events: SEED, view });
  await page.goto('/index.html?backend=local');
  await page.waitForSelector('#grid .day');
}

for (const view of ['week', 'day']) {
  test(`${view} view: a busy day scrolls inside its column, the page stays one screen`, async ({ page }) => {
    await open(page, view);
    if (view === 'day') {
      await page.locator('#next').click(); // Sun → Mon, the busy day
    }
    const day = page.locator(`#grid .day[data-key="${BUSY}"]`);
    await expect(day.locator('.chip')).toHaveCount(30);

    const chips = day.locator('.chips');
    const box = await chips.evaluate(n => ({
      overflowY: getComputedStyle(n).overflowY,
      scrollHeight: n.scrollHeight,
      clientHeight: n.clientHeight
    }));
    expect(box.overflowY).toBe('auto');
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);

    // The page itself is not stretched by the 30 reminders.
    const viewport = page.viewportSize();
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(pageHeight).toBeLessThan(viewport.height + 200);

    // Every day column in the week has the same height.
    if (view === 'week') {
      const heights = await page.locator('#grid .day').evaluateAll(ns => ns.map(n => Math.round(n.getBoundingClientRect().height)));
      expect(new Set(heights).size).toBe(1);
    }

    // The last reminder can be scrolled to and opened.
    const last = day.locator('.chip-title').last();
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(page.locator('#day-events .event-title')).toHaveText('Follow up: Logistics company number 30 with a long name');
  });
}

test('month: "+27 more" lists all 30 reminders in a sheet that scrolls', async ({ page }) => {
  await open(page, 'month');
  const cell = page.locator(`#grid .day[data-key="${BUSY}"]`);
  await expect(cell.locator('.more')).toHaveText('+27 more');
  await cell.locator('.more').click();

  const panel = page.locator('#panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#day-label')).toHaveText('Mon, 28 September 2026 · 30 reminders');
  await expect(panel.locator('.day-list .chip')).toHaveCount(30);
  await expect(panel.locator('.day-list .chip-client').first()).toHaveText('Company 1');

  const box = await panel.evaluate(n => ({ scrollHeight: n.scrollHeight, clientHeight: n.clientHeight, bottom: n.getBoundingClientRect().bottom }));
  expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
  expect(box.bottom).toBeLessThanOrEqual(page.viewportSize().height);

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
