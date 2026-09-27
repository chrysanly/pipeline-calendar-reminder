// Light / dark toggle and Font Awesome icons.

import { test, expect } from './fixtures.mjs';
import { openApp } from './helpers.mjs';

test('the toggle flips data-theme and the choice survives a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openApp(page);
  const html = page.locator('html');

  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('#theme-toggle .fa-moon')).toHaveCount(1);

  await page.locator('#theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#theme-toggle .fa-sun')).toHaveCount(1);

  await page.reload();
  await page.waitForSelector('#grid .day');
  await expect(html).toHaveAttribute('data-theme', 'dark');

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
  await page.locator('#theme-toggle').click();
  expect(await bg()).toBe('rgb(31, 20, 32)'); // #1f1420
});

test('the page uses Font Awesome icons', async ({ page }) => {
  await openApp(page);
  expect(await page.locator('.fa-solid').count()).toBeGreaterThan(0);
  await expect(page.locator('#prev .fa-chevron-left')).toHaveCount(1);
  await expect(page.locator('#next .fa-chevron-right')).toHaveCount(1);
  await expect(page.locator('#add-event .fa-plus')).toHaveCount(1);
});
