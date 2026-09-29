// Home dashboard: client statuses and the pipeline board (cards, filters).

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY, fillForm, goToView } from './helpers.mjs';

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
const boardCards = page => page.locator('#home-board .board-card');
const boardNames = page => page.locator('#home-board .board-card .card-name');
const columnNames = (page, status) => page.locator(`#home-board .board-col[data-status="${status}"] .card-name`);
const card = (page, name) => page.locator('#home-board .board-card', { has: page.locator('.card-name', { hasText: name }) });
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);

/** New reminder is on the calendar page: open Calendar, then the form. */
async function openNewReminder(page) {
  await page.locator('#view-calendar').click();
  await page.locator('#add-event').click();
}

/** Pick an option in one of the board's searchable filters. */
async function pick(page, id, text) {
  await page.locator(`#${id}-search`).fill(text);
  await page.keyboard.press('Enter');
}

/** The Client tab's list of every client (leaving an open profile first). */
async function openClientList(page) {
  await page.locator('#view-client').click();
  const back = page.locator('#page-client .page-back');
  if (await back.isVisible()) await back.click();
  await expect(page.locator('#clients-table .client-head')).toBeVisible();
}

/** The Home status cards (going back to Home first if needed). */
async function expectCounts(page, { lead, potential, active, inactive }) {
  if (!(await page.locator('#dashboard').isVisible())) await page.locator('#view-dashboard').click();
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
  await expect(page.locator('#board-title')).toHaveText('Pipeline board');
  await expect(page.locator('#home-board .board-col')).toHaveCount(4);
  await expect(page.locator('#home-board .board-empty')).toHaveText(Array(4).fill('Drop a client here'));
  await expect(boardCards(page)).toHaveCount(0);
  await expectCounts(page, { lead: 0, potential: 0, active: 0, inactive: 0 });
  await expect(page.locator('.status-card .status-label')).toHaveText(['Leads', 'Potential', 'Active', 'Inactive', 'Duplicates']);
  await expect(page.locator('.status-card.status-duplicate .status-count')).toHaveText('0');
  for (const icon of ['fa-seedling', 'fa-star', 'fa-circle-check', 'fa-circle-pause', 'fa-clone']) {
    await expect(page.locator(`.status-card .${icon}`)).toHaveCount(1);
  }
});

test('H and the Home button switch to the dashboard, and it is remembered', async ({ page }) => {
  await openHome(page, { view: 'month' });
  await expect(page.locator('#grid .day')).toHaveCount(42);
  await page.keyboard.press('h');
  await expect(page.locator('#dashboard')).toBeVisible();
  await goToView(page, 'week');
  await expect(page.locator('#dashboard')).toBeHidden();
  await page.locator('#view-dashboard').click();
  await page.reload();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#view-dashboard')).toHaveClass(/is-active/);
});

test('clients are grouped by name, counted by status and shown on the board', async ({ page }) => {
  await openHome(page);
  await expectCounts(page, { lead: 2, potential: 1, active: 1, inactive: 1 });
  // Every named client is a card in its status column; reminders without a client are not.
  await expect(boardNames(page)).toHaveText(['Palm Holdings', 'Falcon Trading', 'Acme Ltd.', 'Oasis Group']);
  await expect(columnNames(page, 'lead')).toHaveText(['Palm Holdings']);
  await expect(columnNames(page, 'active')).toHaveText(['Acme Ltd.']);
  await expect(page.locator('#home-board')).not.toContainText('(No client)');
  await expect(page.locator('#home-board .board-filter-count')).toHaveText('4 clients');

  const acmeCard = card(page, 'Acme Ltd.');
  await expect(acmeCard.locator('.card-place')).toHaveText('Dubai, United Arab Emirates');
  await expect(acmeCard.getByLabel('Stage for Acme Ltd.')).toHaveValue('active');

  // The details (phone, reminders, next reminder) are in the Client tab's table.
  await openClientList(page);
  const acme = page.locator('#clients-table .client-row[data-client="Acme Ltd."]');
  await expect(acme.locator('.client-status')).toHaveValue('active');
  await expect(acme.locator('.client-place')).toHaveText('Dubai, United Arab Emirates');
  await expect(acme.locator('.client-phone')).toHaveText('+971 4 123 4567');
  await expect(acme.locator('.client-reminders')).toHaveText('2');
  await expect(acme.locator('.client-next')).toHaveText('Mon, 28 September 2026, 10:00');
  await expect(page.locator('#clients-table .client-row[data-client="Oasis Group"] .client-next')).toHaveText('No upcoming reminder');
});

test('the board status filter narrows the cards; Clear filters shows them all', async ({ page }) => {
  await openHome(page);
  await pick(page, 'board-status-filter', 'Active');
  await expect(boardNames(page)).toHaveText(['Acme Ltd.']);
  await expect(page.locator('#home-board .board-filter-count')).toHaveText('1 of 4 clients');
  await expect(page.locator('#home-board .board-col[data-status="lead"] .board-empty')).toHaveText('No clients match the filters');

  await pick(page, 'board-status-filter', 'Lead');
  await expect(boardNames(page)).toHaveText(['Palm Holdings']);

  await page.locator('#home-board .board-clear').click();
  await expect(boardCards(page)).toHaveCount(4);
  await expect(page.locator('#board-status-filter')).toHaveValue('');
});

test('board location filters: country then city; Clear filters shows every card', async ({ page }) => {
  await openHome(page);
  const optionTexts = id => page.locator(`#${id} option`).evaluateAll(os => os.map(o => o.textContent));
  expect(await optionTexts('board-country-filter')).toEqual(['All countries', 'United Arab Emirates', 'Saudi Arabia', 'Unknown']);

  await pick(page, 'board-country-filter', 'United Arab Emirates');
  await expect(boardNames(page)).toHaveText(['Falcon Trading', 'Acme Ltd.']);
  expect(await optionTexts('board-city-filter')).toEqual(['All cities', 'Abu Dhabi', 'Dubai']);

  await pick(page, 'board-city-filter', 'Dubai');
  await expect(boardNames(page)).toHaveText(['Acme Ltd.']);

  await page.locator('#home-board .board-clear').click();
  await expect(boardCards(page)).toHaveCount(4);

  await pick(page, 'board-country-filter', 'Unknown');
  await expect(boardNames(page)).toHaveText(['Palm Holdings']);
});

test('search narrows the board by name, phone or city', async ({ page }) => {
  await openHome(page);
  const search = page.locator('#board-search');
  await search.fill('riyadh');
  await expect(boardNames(page)).toHaveText(['Oasis Group']);
  await search.fill('+971 4');
  await expect(boardNames(page)).toHaveText(['Acme Ltd.']);
  await search.fill('nobody');
  await expect(boardCards(page)).toHaveCount(0);
  await expect(page.locator('#home-board .board-empty')).toHaveText(Array(4).fill('No clients match the filters'));
  await search.fill('');
  await expect(boardCards(page)).toHaveCount(4);
});

test('changing a stage on the board updates the counts and every reminder of that client', async ({ page }) => {
  await openHome(page);
  await card(page, 'Acme Ltd.').getByLabel('Stage for Acme Ltd.').selectOption('inactive');
  await expectCounts(page, { lead: 2, potential: 1, active: 0, inactive: 2 });
  await expect(columnNames(page, 'inactive')).toHaveText(['Acme Ltd.', 'Oasis Group']);

  const acme = (await stored(page)).filter(e => e.clientName.toLowerCase().includes('acme'));
  expect(acme.map(e => e.status)).toEqual(['inactive', 'inactive']);
  expect(acme.every(e => e.updatedAt)).toBe(true);

  await page.reload();
  await expectCounts(page, { lead: 2, potential: 1, active: 0, inactive: 2 });
});

/** Client tab → a client's page → one of its reminders in the details panel. */
async function openClientReminder(page, name, title) {
  await openClientList(page);
  await page.locator('#clients-table .client-name', { hasText: name }).click();
  await expect(page.locator('#page-client .profile-name')).toHaveText(name);
  await page.locator('#page-client .timeline-item', { hasText: title }).locator('[data-action="open-reminder"]').click();
}

test('clicking a client opens its Client page; a reminder there opens the details panel', async ({ page }) => {
  await openHome(page);
  await openClientReminder(page, 'Acme Ltd.', 'Renewal call');
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

  // A client with no upcoming reminder opens on its page too.
  await page.locator('#panel-close').click();
  await openClientList(page);
  await page.locator('#clients-table .client-name', { hasText: 'Oasis Group' }).click();
  await expect(page.locator('#page-client .timeline-list')).toContainText('Budget sign-off');
  await expect(panel).toBeHidden();
});

test('the counts follow adding and editing reminders in the form', async ({ page }) => {
  await openHome(page, { events: [] });
  await openNewReminder(page);
  await fillForm(page, { title: 'Discovery call', clientName: 'New Co', time: '15:00' });
  await page.locator('#event-form [name="status"]').selectOption('potential');
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
  await expectCounts(page, { lead: 0, potential: 1, active: 0, inactive: 0 });

  await openClientReminder(page, 'New Co', 'Discovery call');
  await page.locator('#day-events .link', { hasText: 'Edit' }).click();
  await expect(page.locator('#event-form [name="status"]')).toHaveValue('potential');
  await page.locator('#event-form [name="status"]').selectOption('active');
  await page.locator('#event-form button[type="submit"]').click();
  await expectCounts(page, { lead: 0, potential: 0, active: 1, inactive: 0 });
});

test('a new reminder for a known client keeps its status and location', async ({ page }) => {
  await openHome(page);
  await openNewReminder(page);
  await fillForm(page, { title: 'Follow-up', time: '16:00' });
  const form = page.locator('#event-form');
  await form.locator('[name="clientName"]').fill('ACME LTD.');
  await form.locator('[name="title"]').focus(); // leaving the field looks the client up
  await expect(form.locator('[name="status"]')).toHaveValue('active');
  await expect(form.locator('[name="city"]')).toHaveValue('Dubai');
  await form.locator('button[type="submit"]').click();

  await expectCounts(page, { lead: 2, potential: 1, active: 1, inactive: 1 });
  await expect(columnNames(page, 'active')).toHaveText(['Acme Ltd.']);
  await openClientList(page);
  await expect(page.locator('#clients-table .client-row[data-client="Acme Ltd."] .client-reminders')).toHaveText('3');
});

test('typing a phone number fills city and country; a hand-typed city is kept', async ({ page }) => {
  await openHome(page, { events: [] });
  await openNewReminder(page);
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
  await expect(card(page, 'Falcon Trading').locator('.card-place')).toHaveText('Dubai, United Arab Emirates');
  await expect(card(page, 'Desert Rose LLC').locator('.card-place')).toHaveText('United Arab Emirates');
  expect(await page.locator('#board-city-filter option').evaluateAll(os => os.map(o => o.textContent))).toContain('Dubai');
  await expectCounts(page, { lead: 4, potential: 0, active: 0, inactive: 0 });
});

test('there is no heart icon anywhere', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('.fa-heart')).toHaveCount(0);
  await goToView(page, 'month');
  await expect(page.locator('.fa-heart')).toHaveCount(0);
  await expect(page.locator('.brand')).toHaveText('CladFlo');
});

test('the page renders at once with no script errors (blank-screen check)', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // A CDN that never answers must not hold the app up: the Excel reader is
  // loaded on demand, and the Firebase scripts are deferred.
  await page.route('https://cdn.sheetjs.com/**', () => {});
  await openHome(page);
  await expect(page.locator('.status-card')).toHaveCount(5);
  await expect(boardCards(page)).toHaveCount(4);
  expect(await page.evaluate(() => typeof XLSX)).toBe('undefined');
  await goToView(page, 'month');
  await expect(page.locator('#month-label')).not.toHaveText('—');
  expect(errors).toEqual([]);
});

test('the app is called CladFlo and the footer credits chrys with a portfolio link', async ({ page }) => {
  await openHome(page);
  await expect(page).toHaveTitle('CladFlo — Client Reminders & BD Calendar');
  await expect(page.locator('.brand')).toHaveText('CladFlo');
  const footer = page.locator('.site-footer');
  await expect(footer).toBeVisible();
  await expect(footer).toHaveText('© 2026 CladFlo · Built by chrys');
  const link = footer.locator('a', { hasText: 'chrys' });
  await expect(link).toHaveAttribute('href', 'https://portfolio-v2-mu-roan.vercel.app/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
});
