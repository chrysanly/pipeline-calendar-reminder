// Favicon, logo, manifest and crawler files, as the browser gets them from the
// server. The server has no fallbacks, so a path that works here works live.
// (build.test checks dist/, incl. root favicon.ico/robots.txt/sitemap.xml;
// build.spec opens dist/index.html over file://.)

import { test, expect } from './fixtures.mjs';
import { openApp } from './helpers.mjs';

const FILES = [
  ['/assets/favicon.ico', /^image\/(x-icon|vnd\.microsoft\.icon)/],
  ['/assets/logo.svg', /^image\/svg\+xml/],
  ['/assets/favicon-32.png', /^image\/png/],
  ['/assets/apple-touch-icon.png', /^image\/png/],
  ['/assets/icon-192.png', /^image\/png/],
  ['/assets/icon-512.png', /^image\/png/],
  ['/assets/icon-maskable-512.png', /^image\/png/],
  ['/assets/og-image.png', /^image\/png/],
  ['/assets/manifest.webmanifest', /^application\/manifest\+json/],
  ['/assets/robots.txt', /^text\/plain/],
  ['/assets/sitemap.xml', /^application\/xml/]
];

for (const [path, type] of FILES) {
  test(`${path} is served with the right content type`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(type);
    expect((await res.body()).length).toBeGreaterThan(0);
  });
}

test('every <link rel=icon>, the apple-touch-icon and the manifest the page links to load', async ({ page, request }) => {
  await openApp(page);
  const hrefs = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')
    .evaluateAll(links => links.map(l => l.href)); // absolute, resolved like the browser does
  expect(hrefs.length).toBe(5);
  for (const href of hrefs) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test('the manifest loads and every icon it lists loads, relative to the manifest', async ({ page, request }) => {
  await openApp(page);
  const href = await page.locator('link[rel="manifest"]').evaluate(l => l.href);
  const manifest = await (await request.get(href)).json();
  expect(manifest.name).toBe('Pipeline');
  expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, href).href;
    expect((await request.get(url)).status(), url).toBe(200);
  }
});

test('the head has the SEO and social tags', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle('Pipeline — Client Reminders & BD Calendar');
  const meta = sel => page.locator(sel).first().getAttribute('content');
  expect((await meta('meta[name="description"]')).length).toBeGreaterThan(100);
  expect(await meta('meta[property="og:image"]')).toBe('https://pipeline-9944d.web.app/assets/og-image.png');
  expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('https://pipeline-9944d.web.app/');
  const ld = await page.locator('script[type="application/ld+json"]').textContent();
  expect(JSON.parse(ld)['@type']).toBe('WebApplication');
});

test('the top-bar logo is an inline SVG, visible at 28px; still no heart', async ({ page }) => {
  await openApp(page);
  const logo = page.locator('.brand svg.brand-logo');
  await expect(logo).toBeVisible();
  expect(await logo.getAttribute('aria-hidden')).toBe('true');
  const box = await logo.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(20);
  expect(box.height).toBeGreaterThanOrEqual(20);
  expect(Math.round(box.width)).toBe(28);
  // It really paints the pink tile (not an empty box).
  expect(await logo.locator('rect').getAttribute('fill')).toBe('#ff6fa5');
  await expect(page.locator('.brand')).toHaveText('Pipeline');
  await expect(page.locator('.fa-heart')).toHaveCount(0);
});

test('Home loads with no failed same-origin requests and renders the dashboard', async ({ page, baseURL }) => {
  const failures = [];
  const origin = new URL(baseURL).origin;
  page.on('requestfailed', r => { if (r.url().startsWith(origin)) failures.push(`failed ${r.url()}`); });
  page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  page.on('pageerror', e => failures.push(`pageerror ${e.message}`));

  // A first visit: no saved view, so Home.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('__seo_reset')) { localStorage.clear(); sessionStorage.setItem('__seo_reset', '1'); }
  });
  await page.goto('/index.html?backend=local', { waitUntil: 'networkidle' });

  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('.status-card')).toHaveCount(4);
  await expect(page.locator('.brand svg.brand-logo')).toBeVisible();
  await page.locator('#view-month').click();
  await expect(page.locator('#month-label')).not.toHaveText(/^\s*—?\s*$/);
  expect(failures).toEqual([]);
});
