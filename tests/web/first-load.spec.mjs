// Before the app module runs (it waits for the Firebase scripts), the page
// shows a loading line, not an empty calendar with a "—" title.

import { test, expect } from './fixtures.mjs';

test('while the Firebase scripts load: a loading line, no bare calendar; then the app replaces it', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('https://www.gstatic.com/firebasejs/**', async route => {
    await held;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
  });
  await page.addInitScript(() => localStorage.setItem('view', 'month'));
  await page.goto('/index.html?backend=local', { waitUntil: 'commit' });

  await expect(page.locator('#app-loading')).toBeVisible();
  await expect(page.locator('#app-loading .splash-text')).toHaveText('Loading your reminders…');
  await expect(page.locator('.calendar')).toBeHidden();
  await expect(page.locator('#month-label')).toBeHidden();

  release();
  await expect(page.locator('#grid .day').first()).toBeVisible();
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.locator('#month-label')).not.toHaveText('—');
});

test('first visit lands on Home with its empty-state message, not a blank page', async ({ page }) => {
  await page.goto('/index.html?backend=local');
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await expect(page.locator('.calendar')).toBeHidden();
  await expect(page.locator('#home-board .board-card')).toHaveCount(0);
  await expect(page.locator('#home-board .board-empty')).toHaveText(Array(4).fill('Drop a client here'));
});

// Loaded states, saved as screenshots for review: test-results/screens/*.png
const FAKE_CONFIG = 'export const FIREBASE_CONFIG = {"apiKey":"fake","projectId":"demo-calendar","appId":"1:1:web:1"};';
const SCREENS = [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]];

for (const [name, viewport] of SCREENS) {
  test(`loaded, signed out (${name}): the sign-in prompt replaces the loading line`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/js/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: FAKE_CONFIG }));
    await page.addInitScript({ path: new URL('./fake-firebase.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    await page.goto('/index.html');
    await expect(page.locator('#signed-out')).toBeVisible();
    await expect(page.locator('#signed-out h2')).toHaveText('Sign in to see your reminders');
    await expect(page.locator('#prompt-sign-in')).toBeVisible();
    await expect(page.locator('#app-loading')).toHaveCount(0);
    await expect(page.locator('.calendar')).toBeHidden();
    await page.screenshot({ path: `test-results/screens/signed-out-${name}.png`, fullPage: true });
  });

  test(`loaded, no data yet (${name}): Home shows an empty board and offers Import Excel`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/index.html?backend=local');
    await expect(page.locator('#home-board .board-empty')).toHaveText(Array(4).fill('Drop a client here'));
    await expect(page.locator('#home-board .loading-state')).toHaveCount(0);
    await expect(page.locator('#import-btn')).toBeVisible();
    await expect(page.locator('#app-loading')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `test-results/screens/home-empty-${name}.png`, fullPage: true });
  });
}

test('phone: with more pages than fit, the nav scrolls and the last page can be reached', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html?backend=local');
  const nav = page.locator('.topbar .views');
  const { scrollWidth, clientWidth } = await nav.evaluate(n => ({ scrollWidth: n.scrollWidth, clientWidth: n.clientWidth }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  expect(await nav.evaluate(n => getComputedStyle(n).maskImage || getComputedStyle(n).webkitMaskImage)).toContain('linear-gradient');
  const last = nav.locator('button').last();
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(last).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/screens/nav-scroll-phone.png' });
});
