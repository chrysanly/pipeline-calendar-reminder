// Covers build.mjs: the single-file dist/index.html must be self-contained.
// Node-only (it shells out and reads files); tests.html skips this file.

import { test, assert } from './runner.js';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distFile = join(root, 'dist', 'index.html');

function runBuild() {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe' });
  return readFileSync(distFile, 'utf8');
}

rmSync(join(root, 'dist'), { recursive: true, force: true });
const output = runBuild();

/** The contents of the emitted <script> block. */
const bundledJs = output.slice(output.indexOf('<script>'), output.lastIndexOf('</script>'));

test('build emits dist/index.html', () => {
  assert(existsSync(distFile), 'dist/index.html was not created');
  assert(output.includes('<!DOCTYPE html>'), 'output is not an HTML document');
});

test('build inlines the stylesheet', () => {
  assert(output.includes('<style>'), 'no inline <style> block');
  assert(!output.includes('href="css/'), 'still links an external stylesheet');
});

test('build emits a classic, non-module script', () => {
  assert(!output.includes('type="module"'), 'output still uses type="module"');
  assert(!output.includes('src="js/'), 'output still loads an external script');
});

test('build strips all import/export statements', () => {
  assert(!/^\s*import\s/m.test(bundledJs), 'residual import statement in bundle');
  assert(!/^\s*export\s/m.test(bundledJs), 'residual export statement in bundle');
});

test('every element id the bundle queries exists in the emitted HTML', () => {
  const ids = new Set();
  for (const m of bundledJs.matchAll(/['"`]#([A-Za-z][\w-]*)['"`]/g)) {
    // '#ff6fa5' is a colour (theme-color meta), not an element id.
    if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(m[1])) ids.add(m[1]);
  }
  assert(ids.size > 0, 'found no id selectors to check — the scan is broken');
  for (const id of ids) {
    assert(output.includes(`id="${id}"`), `bundle queries #${id} but no such id in the HTML`);
  }
});

test('build keeps the [hidden] display rule', () => {
  // Without it, `.modal { display: grid }` outranks the browser default and the
  // modal is stuck on screen — the bug this rule exists to prevent.
  assert(
    /\[hidden\]\s*\{[^}]*display:\s*none/.test(output),
    'inlined CSS lost the [hidden] { display: none } rule'
  );
});

test('build is deterministic', () => {
  const again = runBuild();
  assert(again === output, 'rebuilding the same sources produced different output');
});

// ---------- SEO, icons and install ----------

const dist = join(root, 'dist');
const head = output.slice(0, output.indexOf('</head>'));

/** Relative href/src values (not http:, data:, //, #), without ?query/#hash. */
function localRefs(html) {
  return [...html.matchAll(/<(?:link|img|script)\b[^>]*?\s(?:href|src)="([^"]+)"/g)]
    .map(m => m[1])
    .filter(u => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u))
    .map(u => u.split(/[?#]/)[0]);
}

test('the built page has the SEO, social and manifest tags', () => {
  for (const needle of [
    '<title>Pipeline — Client Reminders &amp; BD Calendar</title>',
    '<meta name="description" content="Track client leads',
    '<meta name="robots" content="index,follow">',
    '<link rel="canonical" href="https://pipeline-9944d.web.app/">',
    '<link rel="icon" href="assets/favicon.ico?v=2" sizes="any">',
    '<link rel="icon" href="assets/logo.svg?v=2" type="image/svg+xml">',
    '<link rel="icon" href="assets/favicon-32.png?v=2" type="image/png" sizes="32x32">',
    '<link rel="apple-touch-icon" href="assets/apple-touch-icon.png?v=2">',
    '<link rel="manifest" href="assets/manifest.webmanifest">',
    '<meta name="apple-mobile-web-app-title" content="Pipeline">',
    '<meta property="og:type" content="website">',
    '<meta property="og:title"',
    '<meta property="og:description"',
    '<meta property="og:url" content="https://pipeline-9944d.web.app/">',
    '<meta property="og:image" content="https://pipeline-9944d.web.app/assets/og-image.png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:image" content="https://pipeline-9944d.web.app/assets/og-image.png">',
    '<meta name="theme-color" content="#ff6fa5">'
  ]) {
    assert(head.includes(needle), `missing from <head>: ${needle}`);
  }
  const description = head.match(/<meta name="description" content="([^"]+)"/)[1];
  assert(description.length >= 120 && description.length <= 170, `description is ${description.length} chars`);
});

test('the JSON-LD block is valid JSON describing the web app', () => {
  const m = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert(m, 'no JSON-LD block');
  const data = JSON.parse(m[1]);
  assert(data['@type'] === 'WebApplication', data['@type']);
  assert(data.name === 'Pipeline' && data.url === 'https://pipeline-9944d.web.app/', 'name/url');
  assert(data.applicationCategory === 'BusinessApplication' && data.operatingSystem === 'Web', 'category/os');
  assert(data.offers && data.offers.price === '0', 'free offer');
  assert(data.image === 'https://pipeline-9944d.web.app/assets/og-image.png', data.image);
});

test('source index.html: every local href/src points to a real file', () => {
  const source = readFileSync(join(root, 'index.html'), 'utf8');
  const refs = localRefs(source);
  assert(refs.includes('assets/favicon.ico') && refs.includes('assets/manifest.webmanifest'), refs.join(','));
  for (const ref of refs) assert(existsSync(join(root, ref)), `index.html links ${ref}, which does not exist`);
});

test('dist/index.html: every local href/src points to a file in dist/', () => {
  const refs = localRefs(output);
  assert(refs.includes('assets/logo.svg') && refs.includes('assets/apple-touch-icon.png'), refs.join(','));
  for (const ref of refs) assert(existsSync(join(dist, ref)), `dist/${ref} is missing`);
  for (const file of ['og-image.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon-16.png']) {
    assert(existsSync(join(dist, 'assets', file)), `dist/assets/${file} is missing`);
  }
});

test('favicon.ico, robots.txt and sitemap.xml are also at the root of dist/', () => {
  for (const file of ['favicon.ico', 'robots.txt', 'sitemap.xml']) {
    assert(existsSync(join(dist, file)), `dist/${file} is missing`);
    assert(readFileSync(join(dist, file)).equals(readFileSync(join(root, 'assets', file))), `dist/${file} differs from assets/`);
  }
});

test('the brand logo is inline SVG, the same drawing as assets/logo.svg', () => {
  const brand = output.match(/<h1 class="brand">([\s\S]*?)<\/h1>/);
  assert(brand, 'no brand');
  assert(/<svg class="brand-logo"[^>]*aria-hidden="true"/.test(brand[1]), 'brand has no inline aria-hidden <svg>');
  assert(!/<img\b/.test(brand[1]), 'brand still uses an <img>, which can fail to load');
  const logo = readFileSync(join(root, 'assets', 'logo.svg'), 'utf8');
  const shapes = svg => [...svg.matchAll(/<(rect|path|circle)\b([^>]*?)\/?>/g)]
    .map(([, tag, attrs]) => `${tag} ${attrs.replace(/\s+/g, ' ').trim()}`);
  assert(JSON.stringify(shapes(brand[1])) === JSON.stringify(shapes(logo)),
    `inline logo differs from assets/logo.svg:\n${shapes(brand[1]).join('\n')}\nvs\n${shapes(logo).join('\n')}`);
});

test('favicon.ico is a real icon file holding 16px and 32px PNGs', () => {
  const ico = readFileSync(join(dist, 'favicon.ico'));
  assert(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, 'bad ICO header');
  const count = ico.readUInt16LE(4);
  assert(count === 2, `expected 2 images, got ${count}`);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    sizes.push(ico.readUInt8(entry));
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert(offset + length <= ico.length, `image ${i} runs past the end of the file`);
    assert(ico.subarray(offset, offset + 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `image ${i} is not a PNG`);
  }
  assert(sizes.join() === '16,32', `sizes ${sizes}`);
});

test('the manifest parses and every icon it lists exists next to it', () => {
  const manifest = JSON.parse(readFileSync(join(dist, 'assets', 'manifest.webmanifest'), 'utf8'));
  assert(manifest.name === 'Pipeline' && manifest.short_name === 'Pipeline', 'name');
  assert(manifest.start_url === '/' && manifest.scope === '/' && manifest.display === 'standalone', 'start_url/scope/display');
  const icons = manifest.icons.map(i => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`);
  for (const want of ['192x192', '512x512', '512x512:maskable']) assert(icons.includes(want), `no ${want} icon`);
  for (const icon of manifest.icons) {
    assert(!icon.src.includes('/'), `${icon.src}: icons are relative to the manifest`);
    assert(existsSync(join(dist, 'assets', icon.src)), `dist/assets/${icon.src} is missing`);
  }
});

test('robots.txt allows crawling and points at the sitemap, which lists the site', () => {
  const robots = readFileSync(join(dist, 'robots.txt'), 'utf8');
  assert(/User-agent: \*/.test(robots) && /Allow: \//.test(robots), 'robots rules');
  assert(robots.includes('Sitemap: https://pipeline-9944d.web.app/sitemap.xml'), 'sitemap line');
  assert(readFileSync(join(dist, 'sitemap.xml'), 'utf8').includes('<loc>https://pipeline-9944d.web.app/</loc>'), 'sitemap url');
});
