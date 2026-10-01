// Client tools: the Home progress chart, duplicate imports (the Duplicates
// card), a client on the Client tab opens its page, Follow up / Add to calendar / Add
// minutes, many comments, the searchable select, the date and range pickers,
// and the busy-then-result toasts.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, openAccountMenu } from './helpers.mjs';
import XLSX from 'xlsx';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Fixed clock: today is Sun 27 Sep 2026, 10:00.
const NOW = new Date(2026, 8, 27, 10, 0, 0);

const ROWS = [
  { Company: 'Acme Ltd.', Status: 'Potential', 'BD Notes': 'Call on 05/10/2026 10:00' },
  { Company: 'Falcon Trading', Status: 'Active', 'BD Notes': 'Call on 06/10/2026 11:00' },
  { Company: 'Palm Holdings', Status: 'Active', 'BD Notes': 'Call on 07/10/2026 09:30' }
];

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(ROWS), 'Leads');
  return {
    name: 'leads.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('https://cdn.sheetjs.com/**', route =>
    route.fulfill({ path: join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await page.clock.install({ time: NOW });
  await openApp(page, undefined, { view: null });
});

async function dismissToast(page) {
  await page.locator('#banner-close').click();
  await expect(page.locator('#banner')).toBeHidden();
}

async function importLeads(page, summary = /^Imported 3 reminders: 3 new \(/) {
  await page.locator('#view-dashboard').click();
  await page.locator('#import-file').setInputFiles(workbook());
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(summary);
  await dismissToast(page);
}

/** Every title the toast shows, with whether it was the busy (spinner) one. */
async function recordToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const title = document.querySelector('#banner-title');
    new MutationObserver(() => window.__toasts.push({
      text: title.textContent,
      busy: document.querySelector('#banner').classList.contains('is-busy')
    })).observe(title, { childList: true, characterData: true, subtree: true });
  });
}

/** The busy toast came first, then the result (not busy). */
async function expectBusyThenDone(page, busy, done) {
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(done);
  const toasts = await page.evaluate(() => window.__toasts);
  const busyAt = toasts.findIndex(t => t.busy && t.text === busy);
  const doneAt = toasts.findIndex(t => !t.busy && t.text === done);
  expect(busyAt, JSON.stringify(toasts)).toBeGreaterThanOrEqual(0);
  expect(doneAt).toBeGreaterThan(busyAt);
}

/** The Client tab's list of every client (leaving an open profile first). */
async function openClientList(page) {
  await page.locator('#view-client').click();
  const back = page.locator('#page-client .page-back');
  if (await back.isVisible()) await back.click();
  await expect(page.locator('#clients-table .client-head')).toBeVisible();
}

async function openClient(page, name) {
  await openClientList(page);
  await page.locator('#clients-table .client-name', { hasText: name }).click();
  await expect(page.locator('#page-client .profile-name')).toHaveText(name);
}

async function openMonth(page) {
  await page.locator('#view-calendar').click();
  await page.locator('#view-month').click();
  await expect(page.locator('#month-label')).toBeVisible();
}

const cell = (page, key) => page.locator(`#grid .day[data-key="${key}"]`);

test('Home shows the Potential and Active progress chart first', async ({ page }) => {
  await importLeads(page);
  const first = await page.locator('#dashboard').evaluate(node => node.querySelector('.page-head').nextElementSibling.id);
  expect(first).toBe('progress-chart');
  const chart = page.locator('#progress-chart');
  await expect(chart.locator('.progress-legend')).toHaveText(/Potential 1\s*33%\s*Active 2\s*67%/);
  await expect(chart.locator('.progress-month')).toHaveCount(6);
  const september = chart.locator('.progress-month[data-month="2026-09"]');
  await expect(september.locator('.progress-bar.status-potential')).toHaveAttribute('data-count', '1');
  await expect(september.locator('.progress-bar.status-active')).toHaveAttribute('data-count', '2');
  await expect(page.locator('#progress-bars')).toHaveAttribute('aria-label', /Now 1 potential \(33% of clients\) and 2 active \(67%\)/);
});

test('uploading the file again adds the rows as duplicates, counted on Home', async ({ page }) => {
  await importLeads(page);
  const dupes = page.locator('.status-card.status-duplicate .status-count');
  await expect(dupes).toHaveText('0');
  await importLeads(page, /^Imported 3 reminders: 0 new, 3 duplicates \(added\)/);
  // The Duplicates card counts every row imported again; the board keeps one card per client.
  await expect(dupes).toHaveText('3');
  await expect(page.locator('.status-card.status-duplicate')).toHaveAttribute('aria-label', '3 duplicates');
  await expect(page.locator('#home-board .board-card')).toHaveCount(3);
  // The Client tab lists every client once, with no duplicate lines.
  await page.locator('#view-client').click();
  await expect(page.locator('#clients-table .client-row:not(.client-head)')).toHaveCount(3);
  await expect(page.locator('#clients-table .dup-badge')).toHaveCount(0);
  // Raw data: nothing on the calendar yet.
  await openMonth(page);
  await page.locator('#next').click();
  await expect(page.locator('#grid .chip')).toHaveCount(0);
});

test('one file with repeated rows: every row is imported, repeats counted as duplicates', async ({ page }) => {
  const rows = [
    { Company: 'Acme Ltd.', Status: 'Potential', 'BD Notes': 'Call on 05/10/2026' },
    { Company: 'Acme Ltd.', Status: 'Potential', 'BD Notes': 'Call on 05/10/2026' },
    { Company: 'Acme Ltd.', Status: 'Potential', 'BD Notes': 'Call on 12/10/2026' },
    { Company: 'Falcon Trading', Status: 'Active', 'BD Notes': 'no date yet' },
    { Company: 'Falcon Trading', Status: 'Active', 'BD Notes': 'no date yet' }
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Leads');
  await page.locator('#import-file').setInputFiles({ name: 'repeats.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(/^Imported 5 reminders: 2 new, 3 duplicates \(added\)/);
  await dismissToast(page);
  const dupes = page.locator('.status-card.status-duplicate .status-count');
  await expect(dupes).toHaveText('3');
  await expect(page.locator('#home-board .board-card .card-name')).toHaveText(['Acme Ltd.', 'Falcon Trading']);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('client-calendar.events.v1')));
  expect(stored).toHaveLength(5);

  // Re-import from History updates the same 5 rows: nothing lost, nothing added.
  await openAccountMenu(page);
  await page.locator('#view-history').click();
  await page.locator('#history-list .history-item', { hasText: 'repeats.xlsx' }).locator('.history-reimport').click();
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(/^Imported 5 reminders: 0 new, 5 updated/);
  await dismissToast(page);
  await page.locator('#view-dashboard').click();
  await expect(dupes).toHaveText('3');
  await expect(page.locator('#home-board .board-card')).toHaveCount(2);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('client-calendar.events.v1')));
  expect(after).toHaveLength(5);
});

test('a client on the Client tab opens its page, not the side panel', async ({ page }) => {
  await importLeads(page);
  await openClient(page, 'Falcon Trading');
  await expect(page.locator('#page-client')).toBeVisible();
  await expect(page.locator('#view-client')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#panel')).toBeHidden();
  for (const button of ['.follow-up-btn', '.calendar-add', '.minutes-add']) {
    const box = await page.locator(`#page-client ${button}`).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test('Follow up needs a date and a time (notes optional) and goes on the calendar', async ({ page }) => {
  await importLeads(page);
  await openClient(page, 'Acme Ltd.');
  await page.locator('.follow-up-btn').click();
  const dialog = page.locator('#follow-up');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#follow-up-title')).toHaveText('Follow up with Acme Ltd.');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.locator('.form-error')).toHaveText('Pick the follow-up date.');

  // The date picker: open on today, arrow down a week, Enter picks.
  await dialog.locator('.dp-toggle').click();
  await expect(dialog.locator('.dp-popup')).toBeVisible();
  await expect(dialog.locator('.dp-day[data-date="2026-09-27"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(dialog.locator('.dp-popup')).toBeHidden();
  await expect(dialog.locator('[name="date"]')).toHaveValue('2026-10-03');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.locator('.form-error')).toHaveText('Pick the follow-up time.');

  await dialog.locator('[name="time"]').fill('14:00');
  await recordToasts(page);
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  await expectBusyThenDone(page, 'Saving follow-up for Acme Ltd.…', 'Follow-up for Acme Ltd. saved for Sat, 3 October 2026, 14:00');
  await dismissToast(page);

  await expect(page.locator('#page-client .timeline-list')).toContainText('Follow up: Acme Ltd.');
  await openMonth(page);
  await page.locator('#next').click();
  await expect(cell(page, '2026-10-03').locator('.chip-title')).toHaveText('Follow up: Acme Ltd.');
  await expect(cell(page, '2026-10-05').locator('.chip')).toHaveCount(0);
});

test('Follow up: Cancel and Escape close without saving; a picked date can be typed too', async ({ page }) => {
  await importLeads(page);
  await openClient(page, 'Acme Ltd.');
  await page.locator('.follow-up-btn').click();
  const dialog = page.locator('#follow-up');
  await dialog.locator('[name="date"]').fill('03/10/2026');
  await dialog.locator('[name="time"]').fill('09:15');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.locator('.follow-up-btn').click();
  await expect(dialog.locator('[name="date"]')).toHaveValue('');
  await dialog.locator('[name="date"]').fill('03/10/2026');
  await dialog.locator('[name="time"]').fill('09:15');
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText('Follow-up for Acme Ltd. saved for Sat, 3 October 2026, 09:15');
});

test('Add to calendar and Remove from calendar move the client\'s reminders, with toasts', async ({ page }) => {
  await importLeads(page);
  await openClient(page, 'Falcon Trading');
  await expect(page.locator('.calendar-add')).toHaveText(/Add to calendar \(1\)/);
  await expect(page.locator('.calendar-remove')).toHaveCount(0);
  await recordToasts(page);
  await page.locator('.calendar-add').click();
  await expectBusyThenDone(page, 'Adding 1 reminder for Falcon Trading to the calendar…', 'Added 1 reminder for Falcon Trading to the calendar');
  await dismissToast(page);
  await expect(page.locator('.calendar-add')).toHaveCount(0);

  await openMonth(page);
  await page.locator('#next').click();
  await expect(cell(page, '2026-10-06').locator('.chip-title')).toHaveText('Follow up: Falcon Trading');

  await openClient(page, 'Falcon Trading');
  await recordToasts(page);
  await page.locator('.calendar-remove').click();
  await expectBusyThenDone(page, 'Removing 1 reminder for Falcon Trading from the calendar…', 'Removed 1 reminder for Falcon Trading from the calendar');
  await dismissToast(page);
  await openMonth(page);
  await expect(page.locator('#grid .chip')).toHaveCount(0);
});

test('comments: add as many as you like, newest first with the time; delete one', async ({ page }) => {
  await importLeads(page);
  await openClient(page, 'Acme Ltd.');
  const form = page.locator('#page-client .note-form');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.form-status')).toHaveText('Write the comment first.');

  await recordToasts(page);
  await form.locator('textarea').fill('First call went well');
  await form.locator('button[type="submit"]').click();
  await expectBusyThenDone(page, 'Adding a comment for Acme Ltd.…', 'Comment added for Acme Ltd.');
  await page.clock.fastForward('05:00');
  await form.locator('textarea').fill('Sent the deck');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('.form-status')).toHaveText('Comment added.');
  await expect(form.locator('textarea')).toHaveValue('');

  const comments = page.locator('#page-client .timeline-item.kind-note');
  await expect(comments).toHaveCount(2);
  await expect(comments.locator('.timeline-detail')).toHaveText(['Sent the deck', 'First call went well']);
  await expect(comments.first().locator('.timeline-when')).toHaveText('Sun, 27 September 2026, 10:05');
  await expect(page.locator('#page-client .timeline-filters')).toContainText('Comments (2)');

  page.once('dialog', dialog => dialog.accept());
  await recordToasts(page);
  await comments.first().locator('[data-action="delete-note"]').click();
  await expectBusyThenDone(page, 'Removing the comment from Acme Ltd.…', 'Comment removed from Acme Ltd.');
  await expect(comments.locator('.timeline-detail')).toHaveText(['First call went well']);
});

test('Add minutes opens Minutes with the client filled in', async ({ page }) => {
  await importLeads(page);
  await openClient(page, 'Palm Holdings');
  await page.locator('.minutes-add').click();
  await expect(page.locator('#minutes')).toBeVisible();
  await expect(page.locator('#minutes-client')).toHaveValue('Palm Holdings');
  await expect(page.locator('#minutes-date')).toHaveValue('2026-09-27');
  await expect(page.locator('#minutes-progress')).toHaveText(/New minutes for Palm Holdings/);
});

test('Client tab: every client in a table with search and searchable filters; Back returns to the list', async ({ page }) => {
  await importLeads(page);
  await page.locator('#view-client').click();
  const names = page.locator('#clients-table .client-row:not(.client-head) .client-name');
  await expect(names).toHaveText(['Acme Ltd.', 'Falcon Trading', 'Palm Holdings']);
  await page.locator('#clients-search').fill('HOLD');
  await expect(names).toHaveText(['Palm Holdings']);
  await page.locator('#clients-search').fill('');
  await page.locator('#clients-status-filter-search').fill('potent');
  await page.keyboard.press('Enter');
  await expect(names).toHaveText(['Acme Ltd.']);
  await names.first().click();
  await expect(page.locator('#page-client .profile-name')).toHaveText('Acme Ltd.');
  await expect(page.locator('#page-client .page-back')).toHaveText('Back to all clients');
  await page.locator('#page-client .page-back').click();
  await expect(page.locator('#clients-table')).toBeVisible();
  await expect(names).toHaveText(['Acme Ltd.'], { timeout: 2000 });
});

test('searchable select: the board status filter and the Minutes client field', async ({ page }) => {
  await importLeads(page);
  const status = page.locator('#board-status-filter-search');
  await status.click();
  await status.fill('act');
  // Typing highlights the best match (Active before Inactive): Enter picks it.
  await page.keyboard.press('Enter');
  await expect(page.locator('#board-status-filter')).toHaveValue('active');
  await expect(status).toHaveValue('Active');
  await expect(page.locator('#home-board .board-card .card-name')).toHaveText(['Falcon Trading', 'Palm Holdings']);
  await status.click();
  await page.locator('#dashboard .combo-option', { hasText: 'All statuses' }).click();
  await expect(page.locator('#home-board .board-card')).toHaveCount(3);

  await openClient(page, 'Acme Ltd.');
  await page.locator('.minutes-add').click();
  const client = page.locator('#minutes-client');
  await client.fill('acm');
  await page.locator('#minutes .combo-option', { hasText: 'Acme Ltd.' }).click();
  await expect(client).toHaveValue('Acme Ltd.');
  await client.fill('Brand New Co');
  await expect(page.locator('#minutes .combo-empty')).toHaveText('A new client');
});

test('the navbar has no Minutes button or N shortcut; Minutes opens from the client and Back returns there', async ({ page }) => {
  await importLeads(page);
  await expect(page.locator('#view-minutes')).toHaveCount(0);
  await expect(page.locator('.topbar .views')).not.toContainText('Minutes');
  await page.locator('body').press('n');
  await expect(page.locator('#minutes')).toBeHidden();

  await openClient(page, 'Palm Holdings');
  await page.locator('.minutes-add').click();
  await expect(page.locator('#minutes')).toBeVisible();
  await expect(page.locator('#minutes-back')).toHaveText('Back to Palm Holdings');
  await page.locator('#minutes-back').click();
  await expect(page.locator('#page-client .profile-name')).toHaveText('Palm Holdings');
});

test('Board filters: search, status, country and city narrow the cards, show n of total, clear, and are remembered', async ({ page }) => {
  const rows = [
    { Company: 'Acme Ltd.', Status: 'Potential', City: 'Dubai', Country: 'UAE', 'BD Notes': 'Call on 05/10/2026' },
    { Company: 'Falcon Trading', Status: 'Active', City: 'Riyadh', Country: 'Saudi Arabia', 'BD Notes': 'Call on 06/10/2026' },
    { Company: 'Palm Holdings', Status: 'Active', City: 'Abu Dhabi', Country: 'UAE', 'BD Notes': 'Call on 07/10/2026' }
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Leads');
  await page.locator('#import-file').setInputFiles({ name: 'places.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(/^Imported 3 reminders/);
  await dismissToast(page);

  await page.locator('#view-dashboard').click();
  const cards = page.locator('#home-board .board-card .card-name');
  const count = page.locator('.board-filter-count');
  await expect(cards).toHaveCount(3);
  await expect(count).toHaveText('3 clients');
  await expect(page.locator('.board-clear')).toBeDisabled();

  await page.locator('#board-search').fill('falcon');
  await expect(cards).toHaveText(['Falcon Trading']);
  await expect(count).toHaveText('1 of 3 clients');
  await page.locator('.board-clear').click();
  await expect(cards).toHaveCount(3);
  await expect(page.locator('#board-search')).toHaveValue('');

  // Searchable selects: typing highlights the best match, Enter picks it.
  await page.locator('#board-country-filter-search').fill('uae');
  await page.keyboard.press('Enter');
  await expect(cards).toHaveText(['Acme Ltd.', 'Palm Holdings']);
  await page.locator('#board-status-filter-search').fill('active');
  await page.keyboard.press('Enter');
  await expect(cards).toHaveText(['Palm Holdings']);
  await expect(count).toHaveText('1 of 3 clients');
  await expect(page.locator('.board-col[data-status="potential"] .board-empty')).toHaveText('No clients match the filters');

  await page.reload();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(cards).toHaveText(['Palm Holdings']);
  await expect(page.locator('#board-country-filter-search')).toHaveValue('UAE');
  await page.locator('.board-clear').click();
  await page.locator('#board-city-filter-search').fill('riy');
  await page.keyboard.press('Enter');
  await expect(cards).toHaveText(['Falcon Trading']);
});

test('the Client page has a Back button at the top left that returns to the list', async ({ page }) => {
  await importLeads(page);
  await openClient(page, 'Acme Ltd.');
  const back = page.locator('#page-client .page-back');
  await expect(back).toHaveText('Back to all clients');
  const box = await back.boundingBox();
  const title = await page.locator('#page-client .page-title').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height).toBeLessThanOrEqual(title.y + 1);
  expect(box.x).toBeLessThanOrEqual(title.x + 1);
  await back.click();
  await expect(page.locator('#clients-table .client-head')).toBeVisible();
  await expect(page.locator('#page-client .profile-name')).toBeHidden();
  await expect(page.locator('#view-client')).toHaveAttribute('aria-current', 'page');
});

test('status selects open the app menu: 4 options, no search, picking saves the status', async ({ page }) => {
  await importLeads(page);
  await openClientList(page);
  const select = page.locator('.client-row[data-client="Acme Ltd."]:not([data-duplicate]) .client-status');
  await select.click();
  const menu = page.locator('.menu-pop');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.menu-search')).toBeHidden();
  await expect(menu.locator('.menu-option')).toHaveText(['Lead', 'Potential', 'Active', 'Inactive']);
  await expect(menu.locator('.menu-option[aria-selected="true"]')).toHaveText('Potential');
  await expect(menu.locator('.menu-option.status-active .menu-dot')).toHaveCount(1);
  await menu.locator('.menu-option', { hasText: 'Active' }).first().click();
  await expect(menu).toBeHidden();
  await expect(page.locator('.client-row[data-client="Acme Ltd."]:not([data-duplicate]) .client-status')).toHaveValue('active');

  // Keyboard: Enter opens, arrows move, Escape closes without changing anything.
  const falcon = page.locator('.client-row[data-client="Falcon Trading"] .client-status');
  await falcon.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(falcon).toHaveValue('active');
  await expect(falcon).toBeFocused();
});

test('History: the client filter menu has a search box (many clients); picking filters the log', async ({ page }) => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ Company: `Firm ${i}`, 'BD Notes': 'Call on 05/10/2026' }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Leads');
  await page.locator('#import-file').setInputFiles({ name: 'firms.xlsx', mimeType: 'application/octet-stream', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await expect(page.locator('#banner:not(.is-busy) #banner-title')).toHaveText(/^Imported 9 reminders/);
  await dismissToast(page);
  for (const name of ['Firm 1', 'Firm 2', 'Firm 3', 'Firm 4', 'Firm 5', 'Firm 6', 'Firm 7']) {
    await page.locator('#view-client').click();
    await page.locator('#clients-table .client-name', { hasText: name }).click();
    await page.locator('#page-client .calendar-add').click();
    await dismissToast(page);
  }
  await openAccountMenu(page);
  await page.locator('#view-history').click();
  await page.locator('#history-client').click();
  const menu = page.locator('.menu-pop');
  await expect(menu.locator('.menu-search')).toBeVisible();
  await expect(menu.locator('.menu-search')).toBeFocused();
  await page.keyboard.type('firm 7');
  await expect(menu.locator('.menu-option')).toHaveText(['Firm 7']);
  await page.keyboard.press('Enter');
  await expect(page.locator('#history-client')).toHaveValue('Firm 7');
  await expect(page.locator('#history-list .history-item')).toHaveCount(1);

  await page.locator('#history-action').click();
  await expect(menu.locator('.menu-option')).toHaveCount(8); // All actions + 7: over 6, so it can be searched too
  await page.keyboard.press('Escape');
});

test('the reminder dialog is a medium two-column modal with the date picker and app menus', async ({ page }) => {
  await page.locator('#view-calendar').click();
  await page.locator('#add-event').click();
  const card = page.locator('#modal .modal-card');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box.width).toBeGreaterThan(560);
  expect(box.width).toBeLessThanOrEqual(640);
  const title = await page.locator('#event-form [name="title"]').boundingBox();
  const client = await page.locator('#event-form [name="clientName"]').boundingBox();
  expect(Math.abs(title.y - client.y)).toBeLessThan(4);
  expect(client.x).toBeGreaterThan(title.x + title.width);

  await page.locator('#event-form .dp-toggle').click();
  await page.locator('#event-form .dp-day[data-date="2026-10-02"]').click();
  await expect(page.locator('#event-form [name="date"]')).toHaveValue('2026-10-02');
  const date = await page.locator('#event-form [name="date"]').boundingBox();
  const time = await page.locator('#event-form [name="time"]').boundingBox();
  expect(Math.abs(date.y - time.y)).toBeLessThan(4);

  await page.locator('#event-form [name="reminderMinutesBefore"]').click();
  await page.locator('.menu-pop .menu-option', { hasText: '1 hour before' }).click();
  await expect(page.locator('#event-form [name="reminderMinutesBefore"]')).toHaveValue('60');
  await page.locator('#event-form [name="status"]').click();
  await page.locator('.menu-pop .menu-option', { hasText: 'Potential' }).click();
  await page.locator('#event-form [name="title"]').fill('Menu check');
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('client-calendar.events.v1')).find(e => e.title === 'Menu check'));
  expect(saved).toMatchObject({ date: '2026-10-02', reminderMinutesBefore: 60, status: 'potential' });
});
