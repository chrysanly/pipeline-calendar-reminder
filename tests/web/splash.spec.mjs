// The C-and-sun logo and the splash screen: the splash (animated logo,
// CladFlo, "Loading your reminders…") covers the page until the first render,
// then fades out; the navbar logo's rays turn; everything is still under
// reduced motion.

import { test, expect } from './fixtures.mjs';

async function openSlow(page) {
  // Hold the app module back so the splash can be seen.
  let release;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/js/app.js', async route => {
    await held;
    await route.continue();
  });
  await page.addInitScript(() => {
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  });
  // Module scripts hold DOMContentLoaded back, so wait for the page to arrive only.
  await page.goto('/index.html?backend=local', { waitUntil: 'commit' });
  await page.waitForSelector('#app-loading');
  return release;
}

test('the splash shows the logo, the name and a loading line, then goes', async ({ page }) => {
  const release = await openSlow(page);
  const splash = page.locator('#app-loading');
  await expect(splash).toBeVisible();
  await expect(splash.locator('.splash-logo')).toBeVisible();
  await expect(splash.locator('.splash-name')).toHaveText('CladFlo');
  await expect(splash.locator('.splash-text')).toHaveText('Loading your reminders…');
  const box = await splash.boundingBox();
  const viewport = page.viewportSize();
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
  expect(await splash.locator('.logo-rays').evaluate(n => getComputedStyle(n).animationName)).toBe('sun-turn');

  release();
  await expect(splash).toHaveCount(0);
  await expect(page.locator('#dashboard')).toBeVisible();
});

test('the navbar logo is the C with the sun, its rays turning; still with reduced motion', async ({ page }) => {
  await openSlow(page).then(release => release());
  const logo = page.locator('.brand .brand-logo');
  await expect(logo).toBeVisible();
  await expect(logo.locator('.logo-sun')).toHaveCount(1);
  expect(await logo.locator('.logo-rays').evaluate(n => getComputedStyle(n).animationName)).toBe('sun-turn');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await logo.locator('.logo-rays').evaluate(n => getComputedStyle(n).animationName)).toBe('none');
});

test('a saved dark theme applies to the splash before the app loads', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await page.emulateMedia({ colorScheme: 'light' });
  const release = await openSlow(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('#app-loading').evaluate(n => getComputedStyle(n).backgroundColor)).toBe('rgb(26, 16, 22)');
  release();
});

test('loading states use the turning sun: the board while the cloud loads', async ({ page }) => {
  await openSlow(page).then(release => release());
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'probe';
    document.body.appendChild(host);
  });
  // The shared loading state renders the sun spinner with its text.
  const html = await page.evaluate(async () => {
    const { loadingState } = await import('/js/ui.js');
    const node = loadingState('Loading your clients…');
    document.querySelector('#probe').appendChild(node);
    return node.outerHTML;
  });
  expect(html).toContain('sun-spinner');
  await expect(page.locator('#probe .loading-state')).toHaveText('Loading your clients…');
});
