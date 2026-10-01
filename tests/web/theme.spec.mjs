// Light / dark toggle and Font Awesome icons.

import { test, expect } from './fixtures.mjs';
import { openApp, openAccountMenu } from './helpers.mjs';

test('the toggle flips data-theme and the choice survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  const html = page.locator('html');

  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#theme-toggle .fa-moon')).toHaveCount(1);
  await expect(page.locator('#theme-toggle')).toContainText('Dark mode');

  // The toggle lives in the profile menu, which closes after a pick.
  await openAccountMenu(page);
  await page.locator('#theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#account-menu')).toBeHidden();
  await expect(page.locator('#theme-toggle .fa-sun')).toHaveCount(1);
  await expect(page.locator('#theme-toggle')).toContainText('Light mode');

  await page.reload();
  await page.waitForSelector('#grid .day');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await openAccountMenu(page);
  await page.locator('#theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('with nothing saved the theme follows the system setting', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the palette variables change with the theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  expect(await bg()).toBe('rgb(255, 245, 248)'); // #fff5f8
  await openAccountMenu(page);
  await page.locator('#theme-toggle').click();
  expect(await bg()).toBe('rgb(26, 16, 22)'); // #1a1016
});

test('the page uses Font Awesome icons', async ({ page }) => {
  await openApp(page);
  expect(await page.locator('.fa-solid').count()).toBeGreaterThan(0);
  await expect(page.locator('#prev .fa-chevron-left')).toHaveCount(1);
  await expect(page.locator('#next .fa-chevron-right')).toHaveCount(1);
  await expect(page.locator('#add-event .fa-plus')).toHaveCount(1);
});

test('the logo is a button that opens Home', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.brand')).toHaveText('CladFlo');
  await page.locator('#brand-link').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#view-dashboard')).toHaveAttribute('aria-current', 'page');
});

test('local mode: the menu holds History, theme and Settings, not the top bar; History is marked when open', async ({ page }) => {
  await openApp(page);
  for (const id of ['#view-history', '#theme-toggle', '#settings-btn']) {
    await expect(page.locator(`.topbar-actions > ${id}, .views ${id}`)).toHaveCount(0);
    await expect(page.locator(`#account-menu ${id}`)).toHaveCount(1);
  }
  await expect(page.locator('#account-btn')).toBeVisible();
  await openAccountMenu(page);
  await expect(page.locator('#sign-out')).toBeHidden();
  await page.locator('#view-history').click();
  await expect(page.locator('#account-menu')).toBeHidden();
  await openAccountMenu(page);
  await expect(page.locator('#view-history')).toHaveClass(/is-active/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#account-menu')).toBeHidden();

  await openAccountMenu(page);
  await page.locator('#settings-btn').click();
  await expect(page.locator('#settings')).toBeVisible();
  await page.locator('#settings-close').click();
  await expect(page.locator('#account-btn')).toBeFocused();
});

test('Hello Kitty is the default skin; One Piece from the menu recolours the app and is kept, in light and dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  const html = page.locator('html');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());

  await expect(html).not.toHaveAttribute('data-skin', /.+/);
  expect(await bg()).toBe('rgb(255, 245, 248)'); // Hello Kitty #fff5f8
  await expect(page.locator('#skin-toggle')).toContainText('One Piece theme');

  await openAccountMenu(page);
  await page.locator('#skin-toggle').click();
  await expect(html).toHaveAttribute('data-skin', 'onepiece');
  await expect(page.locator('#account-menu')).toBeHidden();
  expect(await bg()).toBe('rgb(251, 244, 228)'); // parchment #fbf4e4
  expect(await primary()).toBe('#c8102e');
  await expect(page.locator('#skin-toggle')).toContainText('Hello Kitty theme');
  await expect(page.locator('#skin-toggle .fa-ribbon')).toHaveCount(1);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b5ea8');

  // Dark mode on top of the skin: the night sea.
  await openAccountMenu(page);
  await page.locator('#theme-toggle').click();
  expect(await bg()).toBe('rgb(11, 22, 38)'); // #0b1626
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b1626');

  // Kept after a reload, painted before the app script runs.
  await page.reload();
  await page.waitForSelector('#grid .day');
  await expect(html).toHaveAttribute('data-skin', 'onepiece');
  expect(await bg()).toBe('rgb(11, 22, 38)');

  // And back to Hello Kitty.
  await openAccountMenu(page);
  await page.locator('#skin-toggle').click();
  await expect(html).not.toHaveAttribute('data-skin', /.+/);
  expect(await bg()).toBe('rgb(26, 16, 22)'); // Hello Kitty dark #1a1016
});

test('profile menu icons sit level with their labels (Sign out too)', async ({ page }) => {
  await openApp(page);
  await openAccountMenu(page);
  await page.locator('#account-menu').evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));
  const offsets = await page.locator('#account-menu .ghost').evaluateAll(buttons => buttons.map(b => {
    b.hidden = false; // Sign out is hidden in local mode; measure it anyway
    const i = b.querySelector('i').getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(b.querySelector('.btn-label') || b.lastChild);
    const t = range.getBoundingClientRect();
    // The glyph is nudged down a little so it centres on the capitals, not the line box.
    return Math.abs((i.top + i.height / 2) - (t.top + t.height / 2));
  }));
  expect(offsets.length).toBe(5);
  for (const offset of offsets) expect(offset).toBeLessThanOrEqual(2);
});
