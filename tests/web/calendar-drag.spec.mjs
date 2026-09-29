// Day / Week hour grid like Google Calendar (js/time-grid.js): drag a reminder
// to a new time (Week: to another day too), drag its bottom edge to change its
// length, snapping to 15 minutes; tap still opens it. Saved, so it survives a reload.

import { test, expect } from './fixtures.mjs';
import { STORAGE_KEY, mouseDrag, touchDrag } from './helpers.mjs';

const NOW = new Date(2026, 8, 27, 6, 0, 0); // Sun 27 Sep 2026, 06:00
const HOUR = 48;

const SEED = [
  { id: 'r1', title: 'Call Acme', clientName: 'Acme Ltd.', date: '2026-09-28', time: '09:00' },
  { id: 'r2', title: 'Visit Falcon', clientName: 'Falcon Trading', date: '2026-09-28', time: '13:00', durationMinutes: 60 },
  { id: 'r3', title: 'No time yet', clientName: 'Palm', date: '2026-09-29', time: '' }
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
  await page.waitForSelector('#grid .tg-body');
}

const chip = (page, id) => page.locator(`#grid .tg-event[data-id="${id}"]`);
const column = (page, key) => page.locator(`#grid .tg-col[data-key="${key}"]`);
const stored = async (page, id) => (await page.evaluate(k => JSON.parse(localStorage.getItem(k)), STORAGE_KEY)).find(e => e.id === id);

/** A point near the top of a reminder, clear of its resize edge. */
async function grip(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + 6 };
}

test('week: reminders sit at their time; a timeless one is in the all-day row', async ({ page }) => {
  await open(page, 'week');
  const body = await page.locator('#grid .tg-body').boundingBox();
  const acme = await chip(page, 'r1').boundingBox();
  expect(Math.round(acme.y - body.y)).toBe(9 * HOUR);
  expect(Math.round(acme.height)).toBe(HOUR / 2 - 2);
  const falcon = await chip(page, 'r2').boundingBox();
  expect(Math.round(falcon.height)).toBe(HOUR - 2);
  await expect(page.locator('#grid .tg-allday')).toBeVisible();
  await expect(page.locator('#grid .tg-allday-cell[data-key="2026-09-29"] .chip-title')).toHaveText('No time yet');
});

test('week: dragging a reminder moves it to another day and time, snapped to 15 minutes', async ({ page }) => {
  await open(page, 'week');
  const from = await grip(chip(page, 'r1'));
  const wed = await column(page, '2026-09-30').boundingBox();
  await mouseDrag(page, null, { x: wed.x + wed.width / 2, y: from.y + 1.5 * HOUR + 4 }, { fromPoint: from });

  await expect(column(page, '2026-09-30').locator('.tg-event[data-id="r1"]')).toBeVisible();
  expect(await stored(page, 'r1')).toMatchObject({ date: '2026-09-30', time: '10:30', notified: false });
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('client-calendar.history.v1')));
  expect(history[0]).toMatchObject({ action: 'edit', title: 'Call Acme', detail: 'Moved to Wed, 30 September 2026, 10:30' });

  await page.reload();
  await page.waitForSelector('#grid .tg-event');
  await expect(column(page, '2026-09-30').locator('.tg-event[data-id="r1"] .chip-time')).toContainText('10:30');
});

test('day: dragging changes the time, the bottom edge changes the length, both survive a reload', async ({ page }) => {
  await open(page, 'day');
  await page.locator('#next').click(); // Sun → Mon 28
  const acme = chip(page, 'r1');
  const from = await grip(acme);
  await mouseDrag(page, null, { x: from.x, y: from.y - HOUR }, { fromPoint: from });
  await expect(acme.locator('.chip-time')).toContainText('08:00');
  expect((await stored(page, 'r1')).time).toBe('08:00');

  const box = await acme.boundingBox();
  const edge = { x: box.x + box.width / 2, y: box.y + box.height - 2 };
  await mouseDrag(page, null, { x: edge.x, y: edge.y + HOUR }, { fromPoint: edge });
  expect((await stored(page, 'r1')).durationMinutes).toBe(90);
  await expect(acme).toHaveAttribute('data-duration', '90');

  await page.reload();
  await page.locator('#next').click(); // the day view opens on today again
  const again = await chip(page, 'r1').boundingBox();
  expect(Math.round(again.height)).toBe(1.5 * HOUR - 2);
  await expect(chip(page, 'r1').locator('.chip-time')).toContainText('08:00');
});

test('a tap (click) still opens the reminder, and a drag does not', async ({ page }) => {
  await open(page, 'week');
  await chip(page, 'r2').locator('.chip-title').click();
  await expect(page.locator('#day-events .event-title')).toHaveText('Visit Falcon');
  await page.keyboard.press('Escape');

  const from = await grip(chip(page, 'r1'));
  await mouseDrag(page, null, { x: from.x, y: from.y + HOUR }, { fromPoint: from });
  await expect(page.locator('#panel')).toBeHidden();
});

test('Escape cancels a drag and nothing is saved', async ({ page }) => {
  await open(page, 'week');
  const from = await grip(chip(page, 'r1'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 2 * HOUR, { steps: 6 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await stored(page, 'r1')).time).toBe('09:00');
  await expect(chip(page, 'r1')).toHaveCSS('transform', 'none');
});

test('the length can be typed in the reminder form too', async ({ page }) => {
  await open(page, 'week');
  await chip(page, 'r1').locator('.chip-title').click();
  await page.locator('#day-events .link', { hasText: 'Edit' }).click();
  const length = page.locator('#event-form [name="durationMinutes"]');
  await expect(length).toHaveValue('30');
  await length.fill('45');
  await page.locator('#event-form button[type="submit"]').click();
  expect((await stored(page, 'r1')).durationMinutes).toBe(45);
});

test('tablet touch: a long-press drags a reminder to a new time; a quick swipe does not', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await open(page, 'week');
  const from = await grip(chip(page, 'r1'));
  await touchDrag(page, null, { x: from.x, y: from.y + 2 * HOUR }, { fromPoint: from, hold: 0 });
  expect((await stored(page, 'r1')).time).toBe('09:00');

  await touchDrag(page, null, { x: from.x, y: from.y + 2 * HOUR }, { fromPoint: from });
  await expect.poll(async () => (await stored(page, 'r1')).time).toBe('11:00');
  // The week did not change under the finger.
  await expect(page.locator('#grid .tg-col[data-key="2026-09-28"]')).toHaveCount(1);
});
