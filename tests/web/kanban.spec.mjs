// The pipeline board on Home (js/views/kanban.js): columns by status, drag
// and drop (mouse and touch), the Stage menu, deal values, and CSV / Excel
// export that imports back. Local mode.

import { test, expect } from './fixtures.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mouseDrag, touchDrag } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVENTS_KEY = 'client-calendar.events.v1';
const CLIENTS_KEY = 'client-calendar.clients.v1';

const evt = (id, clientName, status, date, extra = {}) => ({
  id, title: `Call ${clientName}`, clientName, status, date, time: '10:00', reminderMinutesBefore: 0,
  notified: true, updatedAt: '2026-09-20T08:00:00.000Z', notes: '', ...extra
});
const EVENTS = [
  evt('e1', 'Acme Ltd.', 'lead', '2026-10-05', { city: 'Dubai', country: 'United Arab Emirates', phone: '+971 4 123 4567' }),
  evt('e2', 'Acme Ltd.', 'lead', '2026-10-12'),
  evt('e3', 'Falcon Trading', 'potential', '2026-10-08', { city: 'Abu Dhabi' }),
  evt('e4', 'Palm Holdings', 'active', '2026-10-01'),
  evt('e5', '', 'lead', '2026-10-02', { title: 'Personal' })
];

async function openBoard(page, { events = EVENTS, deals = [], view = 'dashboard' } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://cdn.sheetjs.com/**', route =>
    route.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.addInitScript(({ events, deals, view, keys }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem('view', view);
      localStorage.setItem(keys.events, JSON.stringify(events));
      localStorage.setItem(keys.clients, JSON.stringify(deals));
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { events, deals, view, keys: { events: EVENTS_KEY, clients: CLIENTS_KEY } });
  await page.goto('/index.html?backend=local');
  return errors;
}

const column = (page, status) => page.locator(`.board-col[data-status="${status}"]`);
const card = (page, name) => page.locator('.board-card', { has: page.locator('.card-name', { hasText: name }) });
// Grab a card by its name, away from its buttons and Stage menu.
const namePoint = async cardLocator => {
  const box = await cardLocator.locator('.card-name').boundingBox();
  return { x: box.x + Math.min(20, box.width / 2), y: box.y + box.height / 2 };
};
const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);

test('the board is on Home, under the chart and cards, with no table, Locations or Board page', async ({ page }) => {
  const errors = await openBoard(page, { view: 'month' });
  await expect(page.locator('#view-board')).toHaveCount(0);
  await expect(page.locator('#page-board')).toHaveCount(0);
  await page.keyboard.press('b');
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('#view-dashboard')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#dashboard #home-board .board')).toBeVisible();
  await expect(page.locator('#progress-chart')).toBeVisible();
  await expect(page.locator('#status-cards .status-card')).toHaveCount(5);
  for (const gone of ['#client-list', '#location-list', '#client-pager', '#client-search', '.dash-body']) {
    await expect(page.locator(`#dashboard ${gone}`)).toHaveCount(0);
  }
  await expect(page.locator('#board-search')).toBeVisible();
  await expect(page.locator('#export-csv')).toBeVisible();
  await expect(page.locator('.board-col-title')).toHaveText(['Lead1', 'Potential1', 'Active1', 'Inactive0']);
  await expect(column(page, 'lead').locator('.card-name')).toHaveText(['Acme Ltd.']);
  await expect(card(page, 'Acme Ltd.').locator('.card-place')).toHaveText('Dubai, United Arab Emirates');
  await expect(column(page, 'inactive').locator('.board-empty')).toHaveText('Drop a client here');
  await expect(page.locator('.board-forecast')).toHaveText('Set deal values to see a forecast.');
  expect(errors).toEqual([]);
});

test('an old saved Board page opens Home', async ({ page }) => {
  await openBoard(page, { view: 'board' });
  await expect(page.locator('#dashboard .board')).toBeVisible();
});

test('a deal value is checked, saved per client, and totals the column and forecast', async ({ page }) => {
  await openBoard(page);
  const acme = card(page, 'Acme Ltd.');
  await acme.getByRole('button', { name: 'Set value for Acme Ltd.' }).click();
  const input = acme.getByLabel('Deal value for Acme Ltd.');
  await expect(input).toBeFocused();
  await expect(acme.getByLabel('Currency for Acme Ltd.')).toHaveValue('AED');
  await input.fill('lots');
  await acme.getByRole('button', { name: 'Save' }).click();
  await expect(acme.locator('.deal-error')).toHaveText('Enter an amount like 12,500 or 800.50.');
  expect(await stored(page, CLIENTS_KEY)).toEqual([]);

  await acme.getByLabel('Deal value for Acme Ltd.').fill('12,500');
  await acme.getByLabel('Deal value for Acme Ltd.').press('Enter');
  await expect(acme.locator('.card-value')).toHaveText('AED 12,500');
  await expect(column(page, 'lead').locator('.board-col-total')).toHaveText('AED 12,500');
  await expect(page.locator('.board-forecast')).toHaveText('Forecast: AED 1,250');
  const [deal] = await stored(page, CLIENTS_KEY);
  expect(deal).toMatchObject({ key: 'acme ltd.', name: 'Acme Ltd.', value: 12500, currency: 'AED' });

  // Editing keeps one record per client.
  const falcon = card(page, 'Falcon Trading');
  await falcon.scrollIntoViewIfNeeded();
  await falcon.getByRole('button', { name: 'Set value for Falcon Trading' }).click();
  await falcon.getByLabel('Deal value for Falcon Trading').fill('800.50');
  await falcon.getByLabel('Currency for Falcon Trading').selectOption('USD');
  await falcon.getByRole('button', { name: 'Save' }).click();
  await acme.getByRole('button', { name: 'Edit value for Acme Ltd.' }).click();
  await acme.getByLabel('Deal value for Acme Ltd.').fill('20000');
  await acme.getByRole('button', { name: 'Save' }).click();
  await expect(acme.locator('.card-value')).toHaveText('AED 20,000');
  expect((await stored(page, CLIENTS_KEY)).length).toBe(2);
  await expect(page.locator('.board-forecast')).toHaveText('Forecast: AED 2,000 · USD 400.25');
});

test('Cancel and Escape close the value form without saving', async ({ page }) => {
  await openBoard(page);
  const acme = card(page, 'Acme Ltd.');
  await acme.getByRole('button', { name: 'Set value for Acme Ltd.' }).click();
  await acme.getByLabel('Deal value for Acme Ltd.').fill('5');
  await acme.getByRole('button', { name: 'Cancel' }).click();
  await expect(acme.locator('.card-value')).toHaveText('No value yet');
  await acme.getByRole('button', { name: 'Set value for Acme Ltd.' }).click();
  await page.keyboard.press('Escape');
  await expect(acme.locator('.deal-form')).toHaveCount(0);
  expect(await stored(page, CLIENTS_KEY)).toEqual([]);
});

test('the Stage menu moves a client: every reminder, History and the columns', async ({ page }) => {
  await openBoard(page);
  await card(page, 'Acme Ltd.').getByLabel('Stage for Acme Ltd.').selectOption('active');
  await expect(column(page, 'active').locator('.card-name')).toHaveText(['Acme Ltd.', 'Palm Holdings']);
  await expect(column(page, 'lead').locator('.board-card')).toHaveCount(0);
  const events = await stored(page, EVENTS_KEY);
  expect(events.filter(e => e.clientName === 'Acme Ltd.').map(e => e.status)).toEqual(['active', 'active']);
  const history = await stored(page, 'client-calendar.history.v1');
  expect(history[0]).toMatchObject({ action: 'status', title: 'Acme Ltd.', detail: 'Lead → Active' });
});

test('dragging a card with the mouse to another column moves the client', async ({ page }) => {
  await openBoard(page);
  const falcon = card(page, 'Falcon Trading');
  await falcon.scrollIntoViewIfNeeded();
  await mouseDrag(page, falcon, column(page, 'inactive').locator('.board-cards'), { fromPoint: await namePoint(falcon) });
  await expect(column(page, 'inactive').locator('.card-name')).toHaveText(['Falcon Trading']);
  await expect(page.locator('.board-col-title')).toHaveText(['Lead1', 'Potential0', 'Active1', 'Inactive1']);
  const events = await stored(page, EVENTS_KEY);
  expect(events.find(e => e.id === 'e3').status).toBe('inactive');
  const history = await stored(page, 'client-calendar.history.v1');
  expect(history[0]).toMatchObject({ action: 'status', detail: 'Potential → Inactive' });
});

test('touch: a long-press picks a card up and dropping it moves the client', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openBoard(page);
  const acme = card(page, 'Acme Ltd.');
  await acme.scrollIntoViewIfNeeded();
  await touchDrag(page, acme, column(page, 'active').locator('.board-cards'), { fromPoint: await namePoint(acme) });
  await expect(column(page, 'active').locator('.card-name')).toHaveText(['Acme Ltd.', 'Palm Holdings']);
  const events = await stored(page, EVENTS_KEY);
  expect(events.filter(e => e.clientName === 'Acme Ltd.').map(e => e.status)).toEqual(['active', 'active']);
});

test('touch: a quick swipe over a card is a scroll, it does not move the client', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openBoard(page);
  const acme = card(page, 'Acme Ltd.');
  await acme.scrollIntoViewIfNeeded();
  await touchDrag(page, acme, column(page, 'active').locator('.board-cards'), { fromPoint: await namePoint(acme), hold: 0 });
  await expect(column(page, 'lead').locator('.card-name')).toHaveText(['Acme Ltd.']);
});

test('Escape during a drag puts the card back', async ({ page }) => {
  await openBoard(page);
  const falcon = card(page, 'Falcon Trading');
  await falcon.scrollIntoViewIfNeeded();
  const start = await namePoint(falcon);
  const target = await column(page, 'inactive').boundingBox();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 8 });
  await expect(column(page, 'inactive')).toHaveClass(/is-over/);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(column(page, 'potential').locator('.card-name')).toHaveText(['Falcon Trading']);
  await expect(column(page, 'inactive')).not.toHaveClass(/is-over/);
});

async function exportAndReimport(page, buttonId, extension) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator(buttonId).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^cladflo-clients-\\d{4}-\\d{2}-\\d{2}\\.${extension}$`));
  const file = await download.path();

  // A fresh browser: nothing saved, then Import Excel on Home with the file.
  await page.evaluate(key => localStorage.setItem(key, '[]'), EVENTS_KEY);
  await page.reload();
  await page.locator('#view-dashboard').click();
  await page.locator('#import-file').setInputFiles({ name: `export.${extension}`, mimeType: 'application/octet-stream', buffer: readFileSync(file) });
  await expect(page.locator('#banner-title')).toContainText('Imported 4 reminders');
  const events = await stored(page, EVENTS_KEY);
  const summary = events.map(e => [e.clientName, e.date, e.time, e.status, e.city || '']).sort((a, b) => a[1].localeCompare(b[1]));
  expect(summary).toEqual([
    ['Palm Holdings', '2026-10-01', '10:00', 'active', ''],
    ['Acme Ltd.', '2026-10-05', '10:00', 'lead', 'Dubai'],
    ['Falcon Trading', '2026-10-08', '10:00', 'potential', 'Abu Dhabi'],
    ['Acme Ltd.', '2026-10-12', '10:00', 'lead', 'Dubai']
  ]);
  return file;
}

test('Export CSV downloads every client reminder and imports back as the same reminders', async ({ page }) => {
  await openBoard(page, { deals: [{ id: 'd1', key: 'acme ltd.', name: 'Acme Ltd.', value: 12500, currency: 'AED' }] });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-csv').click()]);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toBe('﻿Company,Status,Phone,Location,City,Country,Date,Time,Deal value,Currency,BD Notes');
  expect(csv).toContain('Acme Ltd.,lead,+971 4 123 4567,,Dubai,United Arab Emirates,2026-10-05,10:00,12500,AED,');
  expect(csv).not.toContain('Personal');
  await exportAndReimport(page, '#export-csv', 'csv');
});

test('Export Excel downloads an .xlsx that imports back as the same reminders', async ({ page }) => {
  await openBoard(page);
  await exportAndReimport(page, '#export-xlsx', 'xlsx');
});

test('with no clients, export says there is nothing to export', async ({ page }) => {
  await openBoard(page, { events: [] });
  await page.locator('#export-csv').click();
  await expect(page.locator('#banner-title')).toHaveText('Nothing to export yet');
});

test('phone: the columns swipe sideways and the card controls are at least 44px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoard(page);
  const board = page.locator('.board');
  const { scrollWidth, clientWidth } = await board.evaluate(node => ({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const control of [card(page, 'Acme Ltd.').getByLabel('Stage for Acme Ltd.'), card(page, 'Acme Ltd.').getByRole('button', { name: 'Set value for Acme Ltd.' }), page.locator('#export-csv')]) {
    const box = await control.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('a card name opens the client page, and Back returns to Home', async ({ page }) => {
  await openBoard(page);
  await card(page, 'Falcon Trading').getByRole('button', { name: 'Falcon Trading', exact: true }).click();
  await expect(page.locator('#dashboard')).toBeHidden();
  const back = page.locator('.page-back');
  await expect(back).toHaveText('Back to Home');
  await back.click();
  await expect(page.locator('#dashboard .board')).toBeVisible();
});
