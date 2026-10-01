// Top nav (Home, Calendar, Minutes, History), the calendar's own toolbar,
// where Import and New reminder live, and the loading states of actions.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, fillForm, openAccountMenu } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the top nav is Home, Calendar, then feature pages (Client, CladFlo Talk, To-Do), left of the profile menu', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await expect(page.locator('.topbar .views button .btn-label')).toHaveText(['Home', 'Calendar', 'Client', 'CladFlo Talk', 'To-Do']);
  await expect(page.locator('.topbar #view-day, .topbar #view-week, .topbar #view-month')).toHaveCount(0);
  await expect(page.locator('.topbar #add-event, .topbar #import-btn, .topbar #prev')).toHaveCount(0);

  const nav = await page.locator('.views').boundingBox();
  const menu = await page.locator('#account-btn').boundingBox();
  expect(nav.x + nav.width).toBeLessThan(menu.x);
  await expect(page.locator('#view-dashboard')).toHaveAttribute('aria-current', 'page');
});

test('History, theme and Settings are in the profile menu, in that order, not in the top bar', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  for (const id of ['#view-history', '#theme-toggle', '#settings-btn']) {
    await expect(page.locator(`.views ${id}, .topbar-actions > ${id}`)).toHaveCount(0);
    await expect(page.locator(id)).toBeHidden();
  }
  await openAccountMenu(page);
  await expect(page.locator('#account-menu .account-item .btn-label')).toHaveText(['History', 'Dark mode', 'One Piece theme', 'Settings']);
  await expect(page.locator('#account-menu [role="menuitem"]').first()).toBeFocused();
  // A click outside closes it.
  await page.locator('#dashboard').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#account-menu')).toBeHidden();
  await expect(page.locator('#account-btn')).toHaveAttribute('aria-expanded', 'false');
});

test('the logo goes Home from History; L still opens History with the menu closed', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await page.keyboard.press('l');
  await expect(page.locator('#history')).toBeVisible();
  await expect(page.locator('#account-menu')).toBeHidden();
  await expect(page.locator('#view-history')).toHaveAttribute('aria-current', 'page');

  await page.evaluate(() => window.scrollTo(0, 400));
  await page.locator('#brand-link').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#view-dashboard')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#view-history')).not.toHaveClass(/is-active/);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('#brand-link')).toHaveAccessibleName('CladFlo, go to Home');
});

test('local mode: the menu shows without a sign-in, with no name, email or Sign out', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await expect(page.locator('#account-btn')).toBeVisible();
  await expect(page.locator('#user-name')).toHaveText('Menu');
  await expect(page.locator('#sign-in')).toBeHidden();
  await openAccountMenu(page);
  await expect(page.locator('.account-info')).toBeHidden();
  await expect(page.locator('#sign-out')).toBeHidden();
  await page.locator('#settings-btn').click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#account-menu')).toBeHidden();
});

test('Home has Import Excel; the calendar has prev/next, Today, Day/Week/Month and New reminder', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await expect(page.locator('#import-btn')).toBeVisible();
  await expect(page.locator('#add-event')).toBeHidden();
  await expect(page.locator('#prev')).toBeHidden();

  await page.locator('#view-calendar').click();
  await expect(page.locator('#view-calendar')).toHaveClass(/is-active/);
  await expect(page.locator('#view-month')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['#prev', '#next', '#today', '#view-day', '#view-week', '#view-month', '#add-event']) {
    await expect(page.locator(`.cal-toolbar ${id}`)).toBeVisible();
  }
  await expect(page.locator('#import-btn')).toBeHidden();

  // History (and the other pages) have neither.
  await openAccountMenu(page);
  await page.locator('#view-history').click();
  await expect(page.locator('#add-event')).toBeHidden();
  await expect(page.locator('#import-btn')).toBeHidden();
});

test('Calendar comes back to the last of Day/Week/Month used, also with the C key', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await page.locator('#view-calendar').click();
  await page.locator('#view-week').click();
  await expect(page.locator('#grid .day')).toHaveCount(7);
  await expect(page.locator('#view-calendar')).toHaveClass(/is-active/);

  await page.locator('#view-dashboard').click();
  await expect(page.locator('#view-calendar')).not.toHaveClass(/is-active/);
  await page.locator('#view-calendar').click();
  await expect(page.locator('#view-week')).toHaveClass(/is-active/);

  await openAccountMenu(page);
  await page.locator('#view-history').click();
  await page.keyboard.press('c');
  await expect(page.locator('#view-week')).toHaveClass(/is-active/);

  // And after a reload.
  await page.locator('#view-day').click();
  await page.reload();
  await expect(page.locator('#view-day')).toHaveClass(/is-active/);
});

test('Import Excel shows a spinner while the file is read', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('https://cdn.sheetjs.com/**', async route => {
    await held; // keep the Excel reader "downloading"
    await route.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' });
  });
  await openApp(page, undefined, { view: null });
  const button = page.locator('#import-btn');
  await page.locator('#import-file').setInputFiles(join(root, 'tests', 'fixtures', 'sample.xlsx'));

  await expect(button).toHaveClass(/is-loading/);
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button).toBeDisabled();

  release();
  await expect(page.locator('#banner-title')).toContainText('Imported 4 reminders');
  await expect(button).not.toHaveClass(/is-loading/);
  await expect(button).toBeEnabled();
});

test('saving a reminder shows "Saving…" then "Saved" in the top bar', async ({ page }) => {
  await openApp(page);
  await page.locator('#add-event').click();
  await fillForm(page, { title: 'Call back', time: '15:00' });
  await page.locator('#event-form button[type="submit"]').click();

  const status = page.locator('#sync-status');
  await expect(status).toHaveText('Saved');
  await expect(status).toHaveClass(/is-saved/);
  await expect(status).toBeHidden({ timeout: 4000 });
});

test('switching pages fades in, and not at all with reduced motion', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await page.locator('#view-calendar').click();
  expect(await page.locator('.calendar').evaluate(n => getComputedStyle(n).animationName)).toBe('page-in');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#view-dashboard').click();
  expect(await page.locator('#dashboard').evaluate(n => getComputedStyle(n).animationName)).toBe('none');
});

test('menu icons sit level with their labels', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await openAccountMenu(page);
  // Measure once the pop-in (a small scale) has finished.
  await page.locator('#account-menu').evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));
  for (const item of await page.locator('#account-menu .account-item').all()) {
    const icon = await item.locator('i').boundingBox();
    const label = await item.locator('.btn-label').boundingBox();
    const middle = box => box.y + box.height / 2;
    expect(Math.abs(middle(icon) - middle(label))).toBeLessThanOrEqual(1.5);
  }
});
