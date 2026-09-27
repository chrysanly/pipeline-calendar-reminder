// Home dashboard: client statuses, locations and the client list.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY, fillForm } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date(2026, 8, 27, 10, 0, 0);

const SEED = [
  { id: 'a1', clientName: 'Acme Ltd.', title: 'Renewal call', date: '2026-09-28', time: '10:00', status: 'active', phone: '+971 4 123 4567', city: 'Dubai', country: 'United Arab Emirates' },
  { id: 'a2', clientName: 'acme  ltd.', title: 'Contract review', date: '2026-10-02', time: '11:00', status: 'active' },
  { id: 'f1', clientName: 'Falcon Trading', title: 'Intro call', date: '2026-09-29', time: '09:00', status: 'potential', city: 'Abu Dhabi', country: 'United Arab Emirates' },
  { id: 'o1', clientName: 'Oasis Group', title: 'Budget sign-off', date: '2026-09-20', time: '09:00', status: 'inactive', city: 'Riyadh', country: 'Saudi Arabia' },
  { id: 'p1', clientName: 'Palm Holdings', title: 'First meeting', date: '2026-10-01', time: '15:00' },
  { id: 'n1', clientName: '', title: 'Personal errand', date: '2026-09-30', time: '12:00' }
].map(e => ({ notes: '', reminderMinutesBefore: 0, notified: true, ...e }));

async function openHome(page, { events = SEED, view = null } = {}) {
  await page.clock.install({ time: NOW });
  await page.route('https://cdn.sheetjs.com/**', route =>
    route.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.addInitScript(({ key, events, view }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(events));
      if (view) localStorage.setItem('view', view);
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { key: STORAGE_KEY, events, view });
  await page.goto('/index.html?backend=local');
  if (!view || view === 'dashboard') await expect(page.locator('#dashboard')).toBeVisible();
  else await page.waitForSelector('#grid .day');
}

const count = (page, status) => page.locator(`.status-card[data-status="${status}"] .status-count`);
const clientNames = page => page.locator('.client-row:not(.client-head) .client-name');
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);

async function expectCounts(page, { lead, potential, active, inactive }) {
  await expect(count(page, 'lead')).toHaveText(String(lead));
  await expect(count(page, 'potential')).toHaveText(String(potential));
  await expect(count(page, 'active')).toHaveText(String(active));
  await expect(count(page, 'inactive')).toHaveText(String(inactive));
}

test('the dashboard is the home page on a first visit', async ({ page }) => {
  await openHome(page, { events: [] });
  await expect(page.locator('#view-dashboard')).toHaveClass(/is-active/);
  await expect(page.locator('.calendar')).toBeHidden();
  await expect(page.locator('#prev')).toBeHidden();
  await expect(page.locator('#next')).toBeHidden();
  await expect(page.locator('#today')).toBeHidden();
  await expect(page.locator('#month-label')).toBeHidden();
  await expect(page.locator('#client-list')).toHaveText('No clients yet: add a reminder or import Excel');
  await expectCounts(page, { lead: 0, potential: 0, active: 0, inactive: 0 });
  await expect(page.locator('.status-card .status-label')).toHaveText(['Leads', 'Potential', 'Active', 'Inactive']);
  for (const icon of ['fa-seedling', 'fa-star', 'fa-circle-check', 'fa-circle-pause']) {
    await expect(page.locator(`.status-card .${icon}`)).toHaveCount(1);
  }
});

test('H and the Home button switch to the dashboard, and it is remembered', async ({ page }) => {
  await openHome(page, { view: 'month' });
  await expect(page.locator('#grid .day')).toHaveCount(42);
  await page.keyboard.press('h');
  await expect(page.locator('#dashboard')).toBeVisible();
  await page.locator('#view-week').click();
  await expect(page.locator('#dashboard')).toBeHidden();
  await page.locator('#view-dashboard').click();
  await page.reload();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#view-dashboard')).toHaveClass(/is-active/);
});

test('clients are grouped by name and counted by status', async ({ page }) => {
  await openHome(page);
  await expectCounts(page, { lead: 2, potential: 1, active: 1, inactive: 1 });
  await expect(clientNames(page)).toHaveText(['Acme Ltd.', 'Falcon Trading', 'Oasis Group', 'Palm Holdings', '(No client)']);
  await expect(page.locator('#client-count')).toHaveText('(5)');

  const acme = page.locator('.client-row[data-client="Acme Ltd."]');
  await expect(acme.locator('.client-status')).toHaveValue('active');
  await expect(acme.locator('.client-place')).toHaveText('Dubai, United Arab Emirates');
  await expect(acme.locator('.client-phone')).toHaveText('+971 4 123 4567');
  await expect(acme.locator('.client-reminders')).toHaveText('2');
  await expect(acme.locator('.client-next')).toHaveText('Mon, 28 September 2026, 10:00');
  await expect(page.locator('.client-row[data-client="Oasis Group"] .client-next')).toHaveText('No upcoming reminder');
  await expect(page.locator('.client-row[data-client="(No client)"] .client-status')).toBeDisabled();
});

test('clicking a status card filters the clients; clicking again clears it', async ({ page }) => {
  await openHome(page);
  const active = page.locator('.status-card[data-status="active"]');
  await active.click();
  await expect(active).toHaveAttribute('aria-pressed', 'true');
  await expect(clientNames(page)).toHaveText(['Acme Ltd.']);
  await expect(page.locator('.filter-tag')).toHaveText(['Status: Active']);
  await expect(page.locator('#client-count')).toHaveText('(1 of 5)');

  await page.locator('.status-card[data-status="lead"]').click();
  await expect(clientNames(page)).toHaveText(['Palm Holdings', '(No client)']);

  await page.locator('.status-card[data-status="lead"]').click();
  await expect(clientNames(page)).toHaveCount(5);
  await expect(page.locator('.filter-tag')).toHaveCount(0);
});

test('locations: countries and cities with counts; clicking filters, tags remove', async ({ page }) => {
  await openHome(page);
  const countries = page.locator('.loc-country');
  await expect(countries.locator('.loc-name')).toHaveText(['United Arab Emirates', 'Saudi Arabia', 'Unknown']);
  await expect(countries.locator('.loc-count')).toHaveText(['2', '1', '2']);
  await expect(page.locator('.loc-city[data-country="United Arab Emirates"] .loc-name')).toHaveText(['Abu Dhabi', 'Dubai']);

  await page.locator('.loc-country[data-country="United Arab Emirates"]').click();
  await expect(clientNames(page)).toHaveText(['Acme Ltd.', 'Falcon Trading']);

  await page.locator('.loc-city[data-city="Dubai"]').click();
  await expect(clientNames(page)).toHaveText(['Acme Ltd.']);
  await expect(page.locator('.filter-tag')).toHaveText(['United Arab Emirates', 'Dubai']);

  await page.locator('.filter-tag', { hasText: 'Dubai' }).click();
  await expect(clientNames(page)).toHaveText(['Acme Ltd.', 'Falcon Trading']);
  await page.locator('.filter-tag', { hasText: 'United Arab Emirates' }).click();
  await expect(clientNames(page)).toHaveCount(5);

  await page.locator('.loc-country[data-country="Unknown"]').click();
  await expect(clientNames(page)).toHaveText(['Palm Holdings', '(No client)']);
});

test('search narrows the client list by name, phone or city', async ({ page }) => {
  await openHome(page);
  const search = page.locator('#client-search');
  await search.fill('riyadh');
  await expect(clientNames(page)).toHaveText(['Oasis Group']);
  await search.fill('+971 4');
  await expect(clientNames(page)).toHaveText(['Acme Ltd.']);
  await search.fill('nobody');
  await expect(page.locator('#client-list')).toHaveText('No clients match these filters.');
  await search.fill('');
  await expect(clientNames(page)).toHaveCount(5);
});

test('changing a status on the dashboard updates the counts and every reminder of that client', async ({ page }) => {
  await openHome(page);
  await page.locator('.client-row[data-client="Acme Ltd."] .client-status').selectOption('inactive');
  await expectCounts(page, { lead: 2, potential: 1, active: 0, inactive: 2 });

  const acme = (await stored(page)).filter(e => e.clientName.toLowerCase().includes('acme'));
  expect(acme.map(e => e.status)).toEqual(['inactive', 'inactive']);
  expect(acme.every(e => e.updatedAt)).toBe(true);

  await page.reload();
  await expectCounts(page, { lead: 2, potential: 1, active: 0, inactive: 2 });
});

test('clicking a client opens the details panel for its next reminder', async ({ page }) => {
  await openHome(page);
  await page.locator('.client-name', { hasText: 'Acme Ltd.' }).click();
  const panel = page.locator('#panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.event-title')).toHaveText('Renewal call');
  await expect(panel.locator('.status-badge')).toHaveText('Active');
  await expect(panel.locator('.status-badge .fa-circle-check')).toHaveCount(1);
  await expect(panel.locator('.event-phone')).toHaveText('+971 4 123 4567');
  await expect(panel.locator('.event-phone .fa-phone')).toHaveCount(1);
  await expect(panel.locator('.event-city')).toHaveText('Dubai');
  await expect(panel.locator('.event-city .fa-city')).toHaveCount(1);
  await expect(panel.locator('.event-country')).toHaveText('United Arab Emirates');
  await expect(panel.locator('.event-country .fa-earth-asia')).toHaveCount(1);

  // No upcoming reminder: the latest one opens instead.
  await page.locator('#panel-close').click();
  await page.locator('.client-name', { hasText: 'Oasis Group' }).click();
  await expect(panel.locator('.event-title')).toHaveText('Budget sign-off');
});

test('the counts follow adding and editing reminders in the form', async ({ page }) => {
  await openHome(page, { events: [] });
  await page.locator('#add-event').click();
  await fillForm(page, { title: 'Discovery call', clientName: 'New Co', time: '15:00' });
  await page.locator('#event-form [name="status"]').selectOption('potential');
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expectCounts(page, { lead: 0, potential: 1, active: 0, inactive: 0 });

  await page.locator('.client-name', { hasText: 'New Co' }).click();
  await page.locator('#day-events .link', { hasText: 'Edit' }).click();
  await expect(page.locator('#event-form [name="status"]')).toHaveValue('potential');
  await page.locator('#event-form [name="status"]').selectOption('active');
  await page.locator('#event-form button[type="submit"]').click();
  await expectCounts(page, { lead: 0, potential: 0, active: 1, inactive: 0 });
});

test('a new reminder for a known client keeps its status and location', async ({ page }) => {
  await openHome(page);
  await page.locator('#add-event').click();
  await fillForm(page, { title: 'Follow-up', time: '16:00' });
  const form = page.locator('#event-form');
  await form.locator('[name="clientName"]').fill('ACME LTD.');
  await form.locator('[name="title"]').focus(); // leaving the field looks the client up
  await expect(form.locator('[name="status"]')).toHaveValue('active');
  await expect(form.locator('[name="city"]')).toHaveValue('Dubai');
  await form.locator('button[type="submit"]').click();

  await expectCounts(page, { lead: 2, potential: 1, active: 1, inactive: 1 });
  await expect(page.locator('.client-row[data-client="Acme Ltd."] .client-reminders')).toHaveText('3');
});

test('typing a phone number fills city and country; a hand-typed city is kept', async ({ page }) => {
  await openHome(page, { events: [] });
  await page.locator('#add-event').click();
  const form = page.locator('#event-form');
  await form.locator('[name="phone"]').fill('+971 4 123 4567');
  await expect(form.locator('[name="city"]')).toHaveValue('Dubai');
  await expect(form.locator('[name="country"]')).toHaveValue('United Arab Emirates');

  // A different number replaces what was filled in automatically…
  await form.locator('[name="phone"]').fill('+966 11 234 5678');
  await expect(form.locator('[name="city"]')).toHaveValue('Riyadh');
  await expect(form.locator('[name="country"]')).toHaveValue('Saudi Arabia');

  // …but never what you typed yourself.
  await form.locator('[name="city"]').fill('Jubail');
  await form.locator('[name="phone"]').fill('0501234567');
  await expect(form.locator('[name="city"]')).toHaveValue('Jubail');
  await expect(form.locator('[name="country"]')).toHaveValue('United Arab Emirates');

  expect(await page.locator('#country-list option').count()).toBeGreaterThan(20);
});

test('importing sample.xlsx shows the cities detected from phone numbers', async ({ page }) => {
  await openHome(page, { events: [] });
  await page.locator('#import-file').setInputFiles(join(root, 'tests', 'fixtures', 'sample.xlsx'));
  await expect(page.locator('#banner-body')).toContainText('2 locations detected from phone numbers');

  // Falcon's +971 4 landline → Dubai; Desert Rose's 050 mobile → UAE only.
  await expect(page.locator('.loc-city[data-city="Dubai"] .loc-count')).toHaveText('1');
  await expect(page.locator('.client-row[data-client="Falcon Trading"] .client-place')).toHaveText('Dubai, United Arab Emirates');
  await expect(page.locator('.client-row[data-client="Desert Rose LLC"] .client-place')).toHaveText('United Arab Emirates');
  await expectCounts(page, { lead: 4, potential: 0, active: 0, inactive: 0 });
});

test('there is no heart icon anywhere', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('.fa-heart')).toHaveCount(0);
  await page.locator('#view-month').click();
  await expect(page.locator('.fa-heart')).toHaveCount(0);
  await expect(page.locator('.brand')).toHaveText('Pipeline');
});

test('the page renders at once with no script errors (blank-screen check)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // A CDN that never answers must not hold the app up: the Excel reader is
  // loaded on demand, and the Firebase scripts are deferred.
  await page.route('https://cdn.sheetjs.com/**', () => {});
  await openHome(page);
  await expect(page.locator('.status-card')).toHaveCount(4);
  expect(await page.evaluate(() => typeof XLSX)).toBe('undefined');
  await page.locator('#view-month').click();
  await expect(page.locator('#month-label')).not.toHaveText('—');
  expect(errors).toEqual([]);
});

test('the app is called Pipeline and the footer credits chrys with a portfolio link', async ({ page }) => {
  await openHome(page);
  await expect(page).toHaveTitle('Pipeline — Client Reminders & BD Calendar');
  await expect(page.locator('.brand')).toHaveText('Pipeline');
  const footer = page.locator('.site-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toHaveText('© 2026 Pipeline · Built by chrys');
  const link = footer.locator('a', { hasText: 'chrys' });
  await expect(link).toHaveAttribute('href', 'https://portfolio-v2-mu-roan.vercel.app/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
});

test('with the details panel open on desktop, the client list turns into cards and never slides under it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openHome(page);
  // Wide enough for the table while the panel is closed.
  await expect(page.locator('.client-head')).toBeVisible();

  await page.locator('.client-row[data-client="Acme Ltd."] .client-name').click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('.client-head')).toBeHidden();

  const layout = await page.evaluate(() => {
    const list = document.querySelector('.dash-clients');
    const panel = document.querySelector('#panel').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.client-row:not(.client-head)')].map(r => r.getBoundingClientRect().right);
    return { overflow: list.scrollWidth - list.clientWidth, rightmost: Math.max(...rows), panelLeft: panel.left };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.rightmost).toBeLessThanOrEqual(layout.panelLeft);
});
