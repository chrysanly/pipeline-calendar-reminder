// QA check of the favicon, logo and head tags on a running server.
// Run with: node tests/manual/seo-check.mjs [baseUrl]   (default http://localhost:8000/)
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || 'http://localhost:8000/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });

const head = await page.evaluate(async () => {
  const attr = (sel, a) => document.querySelector(sel)?.getAttribute(a) ?? null;
  const links = [...document.querySelectorAll('link[rel*="icon"], link[rel="manifest"]')].map(l => l.href);
  const status = {};
  for (const url of links) status[url] = (await fetch(url)).status;
  const manifest = await (await fetch(document.querySelector('link[rel="manifest"]').href)).json();
  let ld = null;
  try { ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@type']; } catch { ld = 'INVALID'; }
  const logo = document.querySelector('.brand img');
  return {
    title: document.title,
    description: attr('meta[name="description"]', 'content')?.length,
    canonical: attr('link[rel="canonical"]', 'href'),
    ogImage: attr('meta[property="og:image"]', 'content'),
    twitter: attr('meta[name="twitter:card"]', 'content'),
    ld, links: status,
    manifest: { name: manifest.name, icons: manifest.icons.map(i => i.sizes + (i.purpose ? ' ' + i.purpose : '')) },
    logo: logo && { src: logo.getAttribute('src'), loaded: logo.complete && logo.naturalWidth > 0, w: logo.getBoundingClientRect().width },
    hearts: document.querySelectorAll('.fa-heart').length,
    blank: document.body.innerText.trim().length < 20
  };
});
console.log(JSON.stringify(head, null, 1));

// What DevTools → Application → Manifest shows: Chrome's own parse of the manifest.
const cdp = await page.context().newCDPSession(page);
const app = await cdp.send('Page.getAppManifest');
const parsed = JSON.parse(app.data || '{}');
console.log('devtools manifest:', JSON.stringify({ url: app.url, errors: app.errors, icons: (parsed.icons || []).length }));

for (const path of ['favicon.ico', 'robots.txt', 'sitemap.xml', 'og-image.png']) {
  const res = await page.request.get(new URL(path, BASE).href);
  console.log(`${path}: ${res.status()} ${res.headers()['content-type']} ${(await res.body()).length} bytes`);
}

// Headless has no tab strip: draw the favicon at 16/32px next to the top bar logo to compare.
const fav = new URL('favicon.ico', BASE).href;
await page.evaluate(fav => {
  const strip = document.createElement('div');
  strip.style.cssText = 'position:fixed;left:520px;top:12px;z-index:9999;display:flex;gap:10px;align-items:center;background:#fff;padding:4px 8px;border:1px solid #ccc;font:12px sans-serif';
  strip.innerHTML = `tab icon: <img src="${fav}" width="16" height="16"> <img src="${fav}" width="32" height="32">`;
  document.body.append(strip);
}, fav);
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/seo-topbar.png', clip: { x: 0, y: 0, width: 800, height: 64 } });
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
