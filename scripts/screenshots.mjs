// README screenshots → docs/screenshots/*.png. `npm run screenshots`
// Starts its own copy of the dev server, runs the app in local mode and seeds
// made-up demo data only (fictional companies, 555 / Ofcom drama numbers).

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
const PORT = 8131;
const APP = `http://localhost:${PORT}/index.html?backend=local`;
const STORAGE_KEY = 'client-calendar.events.v1';

// A fixed "now" (Wed 14 Oct 2026, 10:00): mid-month, so month view is full.
const NOW = new Date(2026, 9, 14, 10, 0, 0);
const pad = n => String(n).padStart(2, '0');
const day = offset => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const CLIENTS = [
  ['Blue Dune Logistics', 'active', '+971 4 555 0101', 'Business Bay', 'Dubai', 'United Arab Emirates'],
  ['Saffron Tech', 'potential', '+971 2 555 0102', 'Al Reem Island', 'Abu Dhabi', 'United Arab Emirates'],
  ['Coral Bay Hotels', 'lead', '+971 4 555 0103', 'Jumeirah', 'Dubai', 'United Arab Emirates'],
  ['Pearl Gate Trading', 'active', '+971 6 555 0104', 'Al Majaz', 'Sharjah', 'United Arab Emirates'],
  ['Oryx Engineering', 'potential', '+966 11 555 0105', 'Olaya', 'Riyadh', 'Saudi Arabia'],
  ['Najd Foods', 'inactive', '+966 11 555 0106', '', 'Riyadh', 'Saudi Arabia'],
  ['Thames & Co. Consulting', 'lead', '+44 20 7946 0107', 'Canary Wharf', 'London', 'United Kingdom'],
  ['Falcon Crest Realty', 'active', '+971 2 555 0108', 'Corniche', 'Abu Dhabi', 'United Arab Emirates'],
  ['Harbor Lane Media', 'inactive', '+971 4 555 0109', 'Media City', 'Dubai', 'United Arab Emirates'],
  ['Desert Bloom Events', 'lead', '+971 6 555 0110', '', 'Sharjah', 'United Arab Emirates']
];

// [client index, title, day offset, time, notes]
const REMINDERS = [
  [0, 'Contract renewal call', 0, '14:30', 'Discuss 2027 rates and the new Jebel Ali lane.'],
  [0, 'Send revised quote', 2, '09:00', ''],
  [1, 'Product demo', 0, '16:00', 'Demo the reporting module to the ops team.'],
  [2, 'Intro meeting', 1, '11:00', 'Warm lead from the hospitality expo.'],
  [3, 'Quarterly review', -1, '10:00', ''],
  [3, 'Invoice follow-up', 3, '15:30', ''],
  [4, 'Site visit', 2, '13:00', 'Visit the Olaya office; bring the case study.'],
  [5, 'Check in after pause', 5, '10:30', ''],
  [6, 'Proposal call', 1, '15:00', 'Time zone: London is 3 hours behind.'],
  [7, 'Sign-off meeting', 4, '12:00', ''],
  [7, 'Welcome pack', -2, '09:30', ''],
  [8, 'Win-back email', 3, '11:30', ''],
  [9, 'Venue walkthrough', 0, '17:30', 'Wedding season package.'],
  [1, 'Pricing follow-up', 6, '10:00', '']
];

function demoEvents({ dueNow = false } = {}) {
  const events = REMINDERS.map(([c, title, offset, time, notes], i) => {
    const [clientName, status, phone, location, city, country] = CLIENTS[c];
    return {
      id: `demo${i}`, clientName, title, date: day(offset), time, notes,
      reminderMinutesBefore: 15, notified: true, status, phone, location, city, country,
      updatedAt: `2026-10-0${i % 10}T08:00:00.000Z`
    };
  });
  if (dueNow) {
    const [clientName, status, phone, location, city, country] = CLIENTS[4];
    events.push({
      id: 'due', clientName, title: 'Call with Oryx procurement', date: day(0), time: '10:00',
      notes: 'Confirm the site-visit agenda.', reminderMinutesBefore: 0, notified: false,
      status, phone, location, city, country, updatedAt: '2026-10-13T08:00:00.000Z'
    });
  }
  return events;
}

async function startServer() {
  const server = spawn(process.execPath, [join(root, 'tests', 'web', 'server.mjs'), String(PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://localhost:${PORT}/index.html`)).ok) return server; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  server.kill();
  throw new Error('dev server did not start');
}

async function open(browser, { width = 1280, height = 800, mobile = false, view = 'dashboard', theme = 'light', events = demoEvents() } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile
  });
  const page = await context.newPage();
  await page.clock.install({ time: NOW });
  // No real Firebase in screenshots; the Excel reader comes from node_modules.
  await page.route('https://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('https://cdn.sheetjs.com/**', r =>
    r.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.addInitScript(({ key, events, view, theme }) => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify(events));
    localStorage.setItem('view', view);
    localStorage.setItem('theme', theme);
    window.Notification = class { static permission = 'denied'; static requestPermission() { return Promise.resolve('denied'); } };
  }, { key: STORAGE_KEY, events, view, theme });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await rendered(page, view);
  return { page, context };
}

/** Never shoot a half-drawn page: Home has its cards, calendars have days and a real label. */
async function rendered(page, view) {
  if (view === 'dashboard') {
    await page.waitForFunction(() => document.querySelectorAll('.status-card').length === 4
      && document.querySelectorAll('.client-row:not(.client-head)').length > 0);
  } else {
    await page.waitForFunction(() => document.querySelectorAll('#grid .day').length > 0
      && !/^\s*—?\s*$/.test(document.querySelector('#month-label').textContent));
  }
  // Font Awesome icons are a web font: wait until they are drawn.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

async function shoot(page, name) {
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file });
  const kb = Math.round(statSync(file).size / 1024);
  console.log(`docs/screenshots/${name}.png  ${kb} KB${kb > 400 ? '  (over 400 KB!)' : ''}`);
}

mkdirSync(out, { recursive: true });
const server = await startServer();
const browser = await chromium.launch();
try {
  let s;

  s = await open(browser);
  await shoot(s.page, 'dashboard-light');
  // Details panel, opened from the client list.
  await s.page.locator('.client-row[data-client="Blue Dune Logistics"] .client-name').click();
  await s.page.locator('#panel').waitFor();
  await s.page.waitForTimeout(300); // sheet slide-in on narrower screens
  await shoot(s.page, 'panel');
  await s.context.close();

  s = await open(browser, { theme: 'dark' });
  await shoot(s.page, 'dashboard-dark');
  await s.context.close();

  s = await open(browser, { view: 'month' });
  await shoot(s.page, 'month');
  await s.context.close();

  s = await open(browser, { view: 'week' });
  await shoot(s.page, 'week');
  await s.context.close();

  // New reminder: a known client brings its status; the phone fills city/country.
  s = await open(browser, { view: 'week' });
  await s.page.locator('#add-event').click();
  const form = s.page.locator('#event-form');
  await form.locator('[name="title"]').fill('Follow-up on proposal');
  await form.locator('[name="clientName"]').fill('Marina Point Properties');
  await form.locator('[name="status"]').selectOption('potential');
  await form.locator('[name="phone"]').fill('+971 4 555 0188');
  await form.locator('[name="location"]').fill('Dubai Marina');
  await form.locator('[name="time"]').fill('11:30');
  await form.locator('[name="notes"]').fill('Share the updated floor plans.');
  await s.page.waitForTimeout(150);
  await shoot(s.page, 'form');
  await s.context.close();

  // Excel import of the made-up sample file.
  s = await open(browser);
  await s.page.locator('#import-file').setInputFiles(join(root, 'tests', 'fixtures', 'sample.xlsx'));
  await s.page.locator('#banner').waitFor();
  await s.page.waitForTimeout(200);
  await shoot(s.page, 'import');
  await s.context.close();

  // A reminder due now: the in-app "Hey you have a …" popup.
  s = await open(browser, { view: 'week', events: demoEvents({ dueNow: true }) });
  await s.page.locator('#banner').waitFor();
  await s.page.waitForTimeout(200);
  await shoot(s.page, 'popup');
  await s.context.close();

  s = await open(browser, { width: 390, height: 844, mobile: true });
  await shoot(s.page, 'mobile-dashboard');
  await s.context.close();

  s = await open(browser, { width: 390, height: 844, mobile: true, view: 'month' });
  await s.page.locator(`#grid .day[data-key="${day(0)}"]`).click();
  await s.page.locator('#day-agenda').waitFor();
  await shoot(s.page, 'mobile-month');
  await s.context.close();
} finally {
  await browser.close();
  server.kill();
}
