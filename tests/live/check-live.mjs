// Smoke check of the deployed site: status, markup, console errors and two
// screenshots once the network is quiet. Run with: node tests/live/check-live.mjs
import { chromium, devices } from '@playwright/test';

const URL = 'https://pipeline-9944d.web.app/';
const out = 'test-results';

const res = await fetch(`${URL}?t=${Date.now()}`);
const html = await res.text();
console.log('status', res.status, '| view-dashboard', html.includes('view-dashboard'), '| fa-heart', html.includes('fa-heart'),
  '| Groq key in page', /gsk_[A-Za-z0-9]{8,}/.test(html));

const browser = await chromium.launch();
const shots = [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }]
];
for (const [name, options] of shots) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  const shown = await page.evaluate(() => {
    const visible = sel => { const n = document.querySelector(sel); return !!n && !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden'; };
    return {
      title: document.title,
      brand: document.querySelector('.brand')?.textContent.trim(),
      signIn: visible('#sign-in') && visible('#prompt-sign-in'),
      minutes: visible('#view-minutes'),
      history: visible('#view-history'),
      settings: visible('#settings-btn'),
      signedOut: visible('#signed-out'),
      dashboard: visible('#dashboard') || visible('.status-card'),
      label: document.querySelector('#month-label')?.textContent.trim(),
      hearts: document.querySelectorAll('.fa-heart').length,
      textLength: document.body.innerText.trim().length
    };
  });
  await page.screenshot({ path: `${out}/live-${name}.png` });
  console.log(name, JSON.stringify(shown), 'errors:', errors.length ? errors : 'none');
  await context.close();
}
await browser.close();
