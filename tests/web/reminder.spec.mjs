// Real-time reminders: "Hey you have a {title}" as both a desktop
// Notification (mocked) and the in-app banner.

import { test, expect } from './fixtures.mjs';
import { STORAGE_KEY, fillForm } from './helpers.mjs';

const NOW = new Date(2026, 8, 27, 10, 0, 0);

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.addInitScript(key => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.setItem('view', 'month');
      localStorage.removeItem(key);
      sessionStorage.setItem('__test_reset', '1');
    }
    window.__notifications = [];
    window.Notification = class {
      static permission = 'granted';
      static requestPermission() { return Promise.resolve('granted'); }
      constructor(title, options) {
        this.title = title;
        this.options = options;
        window.__notifications.push(this);
      }
      close() {}
    };
  }, STORAGE_KEY);
  await page.goto('/index.html?backend=local');
  await page.waitForSelector('#grid .day');
});

async function createReminder(page, fields) {
  await page.locator('#add-event').click();
  await fillForm(page, { date: '2026-09-27', reminderMinutesBefore: 0, ...fields });
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
}

test('a reminder due now pops up "Hey you have a …" in the banner and as a Notification', async ({ page }) => {
  await createReminder(page, { title: 'Renewal call', clientName: 'Acme Ltd.', time: '10:00' });

  const banner = page.locator('#banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Hey you have a Renewal call');
  await expect(banner.locator('.fa-bell')).toHaveCount(1);

  const calls = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, options: n.options })));
  expect(calls).toHaveLength(1);
  expect(calls[0].title).toBe('Hey you have a Renewal call');
  expect(calls[0].options.body).toBe('10:00 · Acme Ltd. — Reminder');
  expect(calls[0].options.requireInteraction).toBe(true);
  const id = await page.locator('#grid .chip').first().getAttribute('data-id');
  expect(calls[0].options.tag).toBe(id);
});

test('a future reminder fires on the loop once its time arrives, and only once', async ({ page }) => {
  await createReminder(page, { title: 'Standup', time: '10:01' });
  await expect(page.locator('#banner')).toBeHidden();

  await page.clock.runFor(30000);
  await expect(page.locator('#banner')).toBeHidden();

  await page.clock.runFor(31000);
  await expect(page.locator('#banner')).toContainText('Hey you have a Standup');

  await page.clock.runFor(20000);
  expect(await page.evaluate(() => window.__notifications.length)).toBe(1);
});

test('clicking the notification opens the panel for that reminder', async ({ page }) => {
  await createReminder(page, { title: 'Renewal call', time: '10:00' });
  await expect(page.locator('#panel')).toBeHidden();

  await page.evaluate(() => window.__notifications[0].onclick());
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#day-events .event-title')).toHaveText('Renewal call');
});

test('the banner close button dismisses it', async ({ page }) => {
  await createReminder(page, { title: 'Renewal call', time: '10:00' });
  await expect(page.locator('#banner')).toBeVisible();

  await page.locator('#banner-close').click();
  await expect(page.locator('#banner')).toBeHidden();
});
