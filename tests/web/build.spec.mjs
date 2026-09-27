// The double-click build is a separate artefact: it inlines CSS and JS, so it
// can regress on its own. Re-run the modal open/close assertions against
// dist/index.html over file://, the way a user actually opens it.

import { test, expect } from './fixtures.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distUrl = `${pathToFileURL(join(root, 'dist', 'index.html')).href}?backend=local`;

// file:// documents get an opaque origin; without this the app's localStorage
// access throws before the calendar renders.
test.use({ launchOptions: { args: ['--allow-file-access-from-files'] } });

// Build with a made-up Firebase config passed as environment variables (they
// override .env), so the cloud-mode check works on a fresh clone with no .env
// and never needs the real key.
const TEST_FIREBASE_ENV = {
  FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_AUTH_DOMAIN: 'demo-calendar.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'demo-calendar',
  FIREBASE_STORAGE_BUCKET: 'demo-calendar.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '123',
  FIREBASE_APP_ID: '1:123:web:abc'
};

test.afterAll(() => {
  // Put js/firebase-config.js back to what .env says (or empty without one).
  const env = { ...process.env };
  for (const key of Object.keys(TEST_FIREBASE_ENV)) delete env[key];
  execFileSync(process.execPath, ['scripts/gen-config.mjs'], { cwd: root, stdio: 'pipe', env });
});

test.beforeAll(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe', env: { ...process.env, ...TEST_FIREBASE_ENV } });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem('view', 'month'); } catch { /* opaque origin */ }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  });
  await page.goto(distUrl);
  await page.waitForSelector('#grid .day');
});

test('dist: modal is not visible on load', async ({ page }) => {
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#banner')).toBeHidden();
});

test('dist: + New reminder opens the modal', async ({ page }) => {
  await page.locator('#add-event').click();
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('New reminder');
});

test('dist: Cancel, close and Escape all hide the modal', async ({ page }) => {
  for (const close of [
    p => p.locator('#modal-cancel').click(),
    p => p.locator('#modal-close').click(),
    p => p.keyboard.press('Escape')
  ]) {
    await page.locator('#add-event').click();
    await expect(page.locator('#modal')).toBeVisible();
    await close(page);
    await expect(page.locator('#modal')).toBeHidden();
  }
});

test('dist: saving a reminder closes the modal and renders it', async ({ page }) => {
  await page.locator('#add-event').click();
  await page.locator('#event-form [name="title"]').fill('Built reminder');
  await page.locator('#event-form button[type="submit"]').click();

  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#panel')).toBeHidden();
  await page.locator('#grid .chip-title', { hasText: 'Built reminder' }).click();
  await expect(page.locator('#day-events .event-title')).toHaveText('Built reminder');
});

test('dist: view switch and theme toggle work in the bundle', async ({ page }) => {
  await page.locator('#view-week').click();
  await expect(page.locator('#grid .day')).toHaveCount(7);
  const before = await page.locator('html').getAttribute('data-theme');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before);
});

// Regression: the live site came up in local mode. The Firebase <script defer>
// tags run after an inlined classic script, so the bundle must wait for
// DOMContentLoaded or it never sees `firebase`. Serve the fake SDK *as* the
// deferred gstatic script, exactly where the real one comes from.
test('dist: the bundle waits for the deferred Firebase SDK and starts in cloud mode', async ({ page }) => {
  const fake = join(root, 'tests', 'web', 'fake-firebase.js');
  await page.route('https://www.gstatic.com/firebasejs/**/firebase-app-compat.js', route =>
    route.fulfill({ path: fake, contentType: 'text/javascript' }));
  await page.goto(distUrl.replace('?backend=local', ''));

  await expect(page.locator('body')).toHaveAttribute('data-auth', 'signed-out');
  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#banner')).toBeHidden(); // no "Working offline"
});

// Regression: the logo and favicon went missing when dist/index.html was opened
// straight from disk. The logo is inline now, and every icon link resolves to a
// file next to the page.
test('dist over file://: the logo shows, every icon link loads, Home renders', async ({ page }) => {
  const failed = [];
  page.on('requestfailed', r => { if (r.url().startsWith('file:')) failed.push(r.url()); });
  await page.locator('#view-dashboard').click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('.status-card')).toHaveCount(4);

  const logo = page.locator('.brand svg.brand-logo');
  await expect(logo).toBeVisible();
  const box = await logo.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(20);
  expect(box.height).toBeGreaterThanOrEqual(20);

  // Each <link rel=icon|apple-touch-icon|manifest> resolves (as the browser
  // resolves it) to a real file. fetch() can't read file://, so check the disk…
  const links = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')
    .evaluateAll(els => els.map(l => ({ href: l.href, type: l.getAttribute('type') || '', rel: l.rel })));
  expect(links.length).toBe(5);
  for (const { href } of links) {
    expect(existsSync(fileURLToPath(href.split(/[?#]/)[0])), href).toBe(true);
  }
  // …and have the browser really decode each image icon, as a tab would.
  for (const { href, rel } of links.filter(l => l.rel !== 'manifest')) {
    const size = await page.evaluate(url => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth);
      img.onerror = () => resolve(0);
      img.src = url;
    }), href);
    expect(size, `${rel} ${href}`).toBeGreaterThan(0);
  }
  expect(failed).toEqual([]);
});
