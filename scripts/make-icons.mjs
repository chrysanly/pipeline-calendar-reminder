// Renders assets/logo.svg to every icon the site needs, plus the social
// preview image, with Playwright's Chromium (already a dev dependency).
// Run after changing the logo: `npm run icons`. The outputs are committed.

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
const logo = readFileSync(join(assets, 'logo.svg'), 'utf8');
const logoUrl = `data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`;

const RED = '#e60039';
const INK = '#2b1b22';

// Transparent-background PNGs of the logo at each size.
const PLAIN = [
  ['favicon-16.png', 16],
  ['favicon-32.png', 32],
  ['icon-192.png', 192],
  ['icon-512.png', 512]
];

const logoPage = (size, { scale = 1, background = 'transparent' } = {}) => `<!DOCTYPE html>
<html><body style="margin:0;width:${size}px;height:${size}px;background:${background};display:grid;place-items:center">
<img src="${logoUrl}" width="${Math.round(size * scale)}" height="${Math.round(size * scale)}" alt="">
</body></html>`;

// Sunburst rays over blush, a white sticker card (ink outline, hard shadow) with the mark and name.
const ogPage = `<!DOCTYPE html>
<html><body style="margin:0;width:1200px;height:630px;display:grid;place-items:center;
  background:repeating-conic-gradient(from -90deg at 50% 118%, rgba(255,212,0,.2) 0deg 7deg, transparent 7deg 16deg), #ffb6cc;
  font-family:ui-rounded,'SF Pro Rounded',Nunito,'Segoe UI',system-ui,sans-serif;color:${INK}">
  <div style="display:flex;align-items:center;gap:48px;padding:56px 72px 56px 56px;background:#ffffff;
       border:6px solid ${INK};border-radius:48px;box-shadow:0 14px 0 ${INK}">
    <img src="${logoUrl}" width="220" height="220" alt="">
    <div>
      <div style="font-size:120px;font-weight:800;letter-spacing:-3px;line-height:1">CladFlo</div>
      <div style="margin-top:18px;font-size:40px;font-weight:700">Client reminders &amp; BD calendar</div>
      <div style="margin-top:24px;display:flex;gap:12px;font-size:26px;font-weight:700">
        <span style="padding:8px 20px;border-radius:999px;background:${RED};color:#ffffff">Reminders</span>
        <span style="padding:8px 20px;border-radius:999px;background:#ffd400">Dashboard</span>
        <span style="padding:8px 20px;border-radius:999px;background:#ffe4ee">Minutes</span>
      </div>
    </div>
  </div>
</body></html>`;

async function render(page, html, width, height, file, transparent) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  const png = await page.screenshot({ clip: { x: 0, y: 0, width, height }, omitBackground: transparent });
  writeFileSync(join(assets, file), png);
  console.log(`assets/${file} (${width}×${height})`);
  return png;
}

/** A real .ico: 6-byte header, one 16-byte entry per image, then the PNGs. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map(i => i.png)]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = {};
for (const [file, size] of PLAIN) pngs[size] = await render(page, logoPage(size), size, size, file, true);
// iOS shows transparency as black and rounds the corners itself: solid bow red, full bleed.
await render(page, logoPage(180, { background: RED }), 180, 180, 'apple-touch-icon.png', false);
// Maskable: launchers crop to a circle/squircle, so keep the logo in the 80% safe zone.
await render(page, logoPage(512, { scale: 0.8, background: RED }), 512, 512, 'icon-maskable-512.png', false);
await render(page, ogPage, 1200, 630, 'og-image.png', false);
await browser.close();

writeFileSync(join(assets, 'favicon.ico'), buildIco([{ size: 16, png: pngs[16] }, { size: 32, png: pngs[32] }]));
console.log('assets/favicon.ico (16 + 32)');
