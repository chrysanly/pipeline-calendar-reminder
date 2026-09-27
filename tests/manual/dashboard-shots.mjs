// Screenshots of the real dashboard on the running dev server (local mode,
// seeded demo clients), taken after the network goes quiet. Clears the seed after.
// Run with: node tests/manual/dashboard-shots.mjs [baseUrl]   (default http://localhost:8000/)
import { chromium, devices } from '@playwright/test';
import { STORAGE_KEY } from '../web/helpers.mjs';

const BASE = process.argv[2] || 'http://localhost:8000/';
const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const SEED = [
  { id: 'd1', clientName: 'Acme Ltd.', title: 'Renewal call', date: day(1), time: '10:00', status: 'active', phone: '+971 4 123 4567', city: 'Dubai', country: 'United Arab Emirates' },
  { id: 'd2', clientName: 'Falcon Trading', title: 'Intro call', date: day(2), time: '09:00', status: 'potential', phone: '02 555 1234', city: 'Abu Dhabi', country: 'United Arab Emirates' },
  { id: 'd3', clientName: 'Oasis Group', title: 'Budget sign-off', date: day(3), time: '11:30', status: 'inactive', phone: '+966 11 234 5678', city: 'Riyadh', country: 'Saudi Arabia' },
  { id: 'd4', clientName: 'Palm Holdings', title: 'First meeting', date: day(0), time: '17:00', status: 'lead', phone: '0501234567', country: 'United Arab Emirates' }
].map(e => ({ notes: '', reminderMinutesBefore: 0, notified: true, ...e }));

const browser = await chromium.launch();
for (const [name, options] of [
  ['desktop', { viewport: { width: 1280, height: 800 } }],
  ['phone', { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }]
]) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}index.html?backend=local`);
  await page.evaluate(({ key, seed }) => {
    localStorage.setItem(key, JSON.stringify(seed));
    localStorage.setItem('view', 'dashboard');
  }, { key: STORAGE_KEY, seed: SEED });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  const seen = await page.evaluate(() => ({
    cards: document.querySelectorAll('.status-card').length,
    clients: document.querySelectorAll('.client-row:not(.client-head)').length,
    sideways: document.documentElement.scrollWidth > innerWidth,
    hearts: document.querySelectorAll('.fa-heart').length
  }));
  await page.screenshot({ path: `test-results/local-dashboard-${name}.png` });
  console.log(name, JSON.stringify(seen), 'errors:', errors.length ? errors : 'none');
  await page.evaluate(() => localStorage.clear());
  await context.close();
}
await browser.close();
