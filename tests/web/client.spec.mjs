// Client page (js/views/client.js): picker, merged timeline, notes, tasks
// (incl. from meeting minutes), session timer, manual time, expenses, the AI
// mount point and the phone layout. Local mode.

import { test, expect } from './fixtures.mjs';

const NOW = new Date(2026, 8, 28, 12, 0, 0);
const KEYS = {
  events: 'client-calendar.events.v1',
  meetings: 'client-calendar.meetings.v1',
  history: 'client-calendar.history.v1',
  clients: 'client-calendar.clients.v1',
  tasks: 'client-calendar.tasks.v1',
  time: 'client-calendar.time.v1',
  expenses: 'client-calendar.expenses.v1'
};
const iso = (d, h, m = 0) => new Date(2026, 8, d, h, m).toISOString();

const EVENTS = [
  { id: 'e1', title: 'Renewal call', clientName: 'Acme Ltd.', status: 'potential', date: '2026-10-05', time: '14:30', city: 'Dubai', country: 'United Arab Emirates',
    phone: '+971 4 123 4567', notes: 'Bring the deck', reminderMinutesBefore: 0, notified: false, updatedAt: iso(20, 8) },
  { id: 'e2', title: 'Intro call', clientName: 'Acme Ltd.', status: 'potential', date: '2026-09-01', time: '10:00', notes: '', reminderMinutesBefore: 0, notified: true, updatedAt: iso(1, 8) },
  { id: 'e3', title: 'Site visit', clientName: 'Falcon Trading', status: 'lead', date: '2026-09-29', time: '09:00', notes: '', reminderMinutesBefore: 0, notified: false, updatedAt: iso(2, 8) }
];
const MEETINGS = [{
  id: 'm1', clientName: 'Acme Ltd.', title: 'Kickoff', date: '2026-09-20', attendees: ['Anna'], summary: 'Agreed the scope.', decisions: [],
  actionItems: [{ task: 'Send proposal', owner: 'Anna', due: '2026-09-30' }, { task: 'Book workshop', owner: '', due: '' }], createdAt: iso(20, 16), updatedAt: iso(20, 16)
}];
const HISTORY = [{ id: 'h1', at: iso(22, 9), action: 'status', kind: 'client', title: 'Acme Ltd.', client: 'Acme Ltd.', detail: 'Lead → Potential' }];

async function openClientPage(page, { client = 'Acme Ltd.', viewport } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', dialog => dialog.accept());
  if (viewport) await page.setViewportSize(viewport);
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ keys, seed, client }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem('view', 'client');
      if (client) localStorage.setItem('cladflo.client.v1', client);
      for (const [name, list] of Object.entries(seed)) localStorage.setItem(keys[name], JSON.stringify(list));
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { keys: KEYS, seed: { events: EVENTS, meetings: MEETINGS, history: HISTORY }, client });
  await page.goto('/index.html?backend=local');
  await expect(page.locator('#page-client')).toBeVisible();
  return errors;
}

const stored = (page, name) => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), KEYS[name]);
const timeline = page => page.locator('.timeline-item');
const tasksCard = page => page.locator('.client-tasks');
const timeCard = page => page.locator('.client-time');
const expensesCard = page => page.locator('.client-expenses');

test('no client yet: a chooser of every client; picking one opens the profile', async ({ page }) => {
  const errors = await openClientPage(page, { client: '' });
  await expect(page.locator('#view-client')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.client-profile')).toBeHidden();
  await expect(page.locator('.client-chooser button')).toHaveText(['Acme Ltd.', 'Falcon Trading']);
  await page.locator('.client-chooser button', { hasText: 'Falcon Trading' }).click();
  await expect(page.locator('.profile-name')).toHaveText('Falcon Trading');
  await expect(page.locator('.client-empty')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the picker opens a client by name and says when there is no such client', async ({ page }) => {
  await openClientPage(page);
  await page.locator('#client-pick').fill('Nobody');
  await page.locator('#client-pick').press('Enter');
  await expect(page.locator('.client-picker .form-status')).toHaveText('No client called "Nobody".');
  await page.locator('#client-pick').fill('falcon trading');
  await page.locator('.client-picker button[type="submit"]').click();
  await expect(page.locator('.profile-name')).toHaveText('Falcon Trading');
  await expect(page.locator('.client-picker .form-status')).toBeHidden();
});

test('P opens the page; the header and the merged timeline show one client, newest first', async ({ page }) => {
  await openClientPage(page);
  await page.locator('#view-dashboard').click();
  await page.keyboard.press('p');
  await expect(page.locator('.profile-name')).toHaveText('Acme Ltd.');
  await expect(page.locator('.client-header .status-badge')).toHaveText('Potential');
  await expect(page.locator('.client-details')).toHaveText('+971 4 123 4567 · Dubai, United Arab Emirates');
  await expect(page.locator('.client-stats dd')).toHaveText(['—', '2', '0', '0m', '—']);
  await expect(page.locator('.timeline-title')).toHaveText(['Renewal call', 'Status changed', 'Kickoff', 'Intro call']);
  await expect(timeline(page).first().locator('.timeline-tag')).toHaveText('Upcoming');
  await expect(timeline(page).first().locator('.timeline-when')).toHaveText('Mon, 5 October 2026, 14:30');
  await expect(page.locator('.timeline-filters button')).toHaveText(['All (4)', 'Reminders (2)', 'Minutes (1)', 'Activity (1)']);
  await expect(page.locator('#client-ai')).toHaveAttribute('data-client', 'Acme Ltd.');
});

test('the filter chips narrow the timeline; Open shows the reminder', async ({ page }) => {
  await openClientPage(page);
  await page.locator('.timeline-filters button', { hasText: 'Reminders' }).click();
  await expect(page.locator('.timeline-filters button', { hasText: 'Reminders' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.timeline-title')).toHaveText(['Renewal call', 'Intro call']);
  await page.getByRole('button', { name: 'Open reminder Renewal call' }).click();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#panel')).toContainText('Renewal call');
});

test('notes are added to the top of the timeline, saved on the client, and can be deleted', async ({ page }) => {
  await openClientPage(page);
  const note = page.getByLabel('New note');
  await page.locator('.note-form button[type="submit"]').click();
  await expect(page.locator('.note-form .form-status')).toHaveText('Write the note first.');
  await note.fill('Prefers WhatsApp over email');
  await page.locator('.note-form button[type="submit"]').click();
  await expect(page.locator('.note-form .form-status')).toHaveText('Note added.');
  await expect(note).toHaveValue('');
  await expect(timeline(page).nth(1).locator('.timeline-detail')).toHaveText('Prefers WhatsApp over email');
  const [profile] = await stored(page, 'clients');
  expect(profile).toMatchObject({ key: 'acme ltd.', name: 'Acme Ltd.' });
  expect(profile.notes.map(n => n.text)).toEqual(['Prefers WhatsApp over email']);

  await page.getByRole('button', { name: 'Delete note' }).click();
  await expect(page.locator('.kind-note')).toHaveCount(0);
  expect((await stored(page, 'clients'))[0].notes).toEqual([]);
});

test('tasks: fields or one "task | owner | due" line, checked off, and made from meeting action items', async ({ page }) => {
  await openClientPage(page);
  const card = tasksCard(page);
  await card.getByLabel('Task', { exact: true }).fill('Draft the SOW');
  await card.getByLabel('Owner').fill('Omar');
  await card.getByLabel('Due').fill('31/02/2026');
  await card.locator('button[type="submit"]').click();
  await expect(card.locator('.form-status')).toHaveText('Use a due date like 28/09/2026.');
  await card.getByLabel('Due').fill('27/09/2026');
  await card.locator('button[type="submit"]').click();
  await expect(card.locator('.form-status')).toHaveText('Task added.');
  await card.getByLabel('Task', { exact: true }).fill('Call back | Anna | 2026-10-02');
  await card.getByLabel('Task', { exact: true }).press('Enter');
  await expect(card.locator('.task-text')).toHaveText(['Draft the SOW', 'Call back']);
  await expect(card.locator('.task-item').first()).toHaveClass(/is-overdue/);
  await expect(card.locator('.task-meta').first()).toHaveText('Omar · due Sun, 27 September 2026 · overdue');

  await card.locator('.task-check', { hasText: 'Draft the SOW' }).locator('input').check();
  await expect(card.locator('.task-text')).toHaveText(['Call back', 'Draft the SOW']);
  await expect(card.locator('.task-item').last()).toHaveClass(/is-done/);
  await expect(page.locator('.client-stats dd').nth(2)).toHaveText('1');

  const fromMinutes = page.getByRole('button', { name: 'Add 2 action items as tasks' });
  await fromMinutes.click();
  await expect(card.locator('.form-status')).toHaveText('Added 2 tasks from "Kickoff".');
  await expect(fromMinutes).toHaveCount(0);
  const tasks = await stored(page, 'tasks');
  expect(tasks.map(t => [t.task, t.owner, t.due, t.done])).toEqual([
    ['Draft the SOW', 'Omar', '2026-09-27', true], ['Call back', 'Anna', '2026-10-02', false],
    ['Send proposal', 'Anna', '2026-09-30', false], ['Book workshop', '', '', false]
  ]);
  expect(tasks[2].meetingId).toBe('m1');

  await card.getByRole('button', { name: 'Delete task Book workshop' }).click();
  await expect(card.locator('.task-text')).toHaveText(['Send proposal', 'Call back', 'Draft the SOW']);
});

test('the timer runs across a reload, stops into a logged session, and time can be typed in', async ({ page }) => {
  await openClientPage(page);
  const card = timeCard(page);
  await card.getByRole('button', { name: 'Start timer' }).click();
  await expect(card.getByRole('button', { name: 'Stop timer' })).toBeVisible();
  const [running] = await stored(page, 'time');
  expect(running).toMatchObject({ clientName: 'Acme Ltd.', end: null });
  await page.clock.runFor(65000);
  await expect(card.locator('.timer-clock')).toHaveText('0:01:05');

  await page.reload();
  await expect(timeCard(page).getByRole('button', { name: 'Stop timer' })).toBeVisible();
  await page.clock.runFor(60000);
  await expect(timeCard(page).locator('.timer-clock')).toHaveText(/^0:02:\d\d$/);
  await timeCard(page).getByLabel('Timer note').fill('Wireframes');
  await timeCard(page).getByRole('button', { name: 'Stop timer' }).click();
  await expect(timeCard(page).locator('.form-status').first()).toHaveText('Logged 2m for Acme Ltd..');
  await expect(timeCard(page).locator('.timer-clock')).toHaveText('0:00:00');

  await timeCard(page).getByLabel('Time spent').fill('soon');
  await timeCard(page).locator('.time-form button[type="submit"]').click();
  await expect(timeCard(page).locator('.time-form .form-status')).toHaveText('Enter a time like 1:30, 90m or 1.5h (up to 24h).');
  await timeCard(page).getByLabel('Time spent').fill('1:30');
  await timeCard(page).locator('.time-form button[type="submit"]').click();
  await expect(timeCard(page).locator('.time-total')).toHaveText('Total: 1h 32m');
  await expect(timeCard(page).locator('.session-list .entry-main')).toHaveText(['2m', '1h 30m']); // typed-in time starts at 09:00, before the 12:00 timer
  await expect(page.locator('.client-stats dd').nth(3)).toHaveText('1h 32m');
  await expect(page.locator('.kind-time')).toHaveCount(2);
});

test('a timer running for another client is shown there and must be stopped first', async ({ page }) => {
  await openClientPage(page);
  await timeCard(page).getByRole('button', { name: 'Start timer' }).click();
  await page.locator('#client-pick').fill('Falcon Trading');
  await page.locator('#client-pick').press('Enter');
  await expect(timeCard(page).locator('.timer-for')).toHaveText('Running for Acme Ltd.: stop it before timing Falcon Trading.');
  await timeCard(page).getByRole('button', { name: 'Stop timer' }).click();
  await expect(timeCard(page).getByRole('button', { name: 'Start timer' })).toBeVisible();
  const sessions = await stored(page, 'time');
  expect(sessions.map(s => [s.clientName, Boolean(s.end)])).toEqual([['Acme Ltd.', true]]);
});

test('expenses are checked, logged with totals per currency, and show in the timeline', async ({ page }) => {
  await openClientPage(page);
  const card = expensesCard(page);
  await expect(card.getByLabel('Currency')).toHaveValue('AED');
  await expect(card.getByLabel('Date')).toHaveValue('2026-09-28');
  await card.getByLabel('Amount').fill('free');
  await card.locator('button[type="submit"]').click();
  await expect(card.locator('.form-status')).toHaveText('Enter an amount like 250 or 1,200.50.');
  await card.getByLabel('Amount').fill('250');
  await card.getByLabel('Category').selectOption('Travel');
  await card.getByLabel('Note').fill('Taxi to the site');
  await card.locator('button[type="submit"]').click();
  await card.getByLabel('Amount').fill('40');
  await card.getByLabel('Currency').selectOption('USD');
  await card.getByLabel('Category').selectOption('Software');
  await card.locator('button[type="submit"]').click();
  await expect(card.locator('.expense-total')).toHaveText('Total: AED 250 · USD 40');
  await expect(card.locator('.entry-main')).toHaveText(['USD 40', 'AED 250']);
  await expect(page.locator('.client-stats dd').nth(4)).toHaveText('AED 250 · USD 40');
  await expect(page.locator('.kind-expense .timeline-extra')).toHaveCount(2);
  const expenses = await stored(page, 'expenses');
  expect(expenses.find(e => e.currency === 'AED')).toMatchObject({ clientKey: 'acme ltd.', amount: 250, currency: 'AED', category: 'Travel', note: 'Taxi to the site', date: '2026-09-28' });

  await card.getByRole('button', { name: 'Delete Software expense' }).click();
  await expect(card.locator('.entry-main')).toHaveText(['AED 250']);
});

test('phone: the page fits 390px, cards stack, and every control is at least 44px tall', async ({ page }) => {
  await openClientPage(page, { viewport: { width: 390, height: 844 } });
  await tasksCard(page).getByLabel('Task', { exact: true }).fill('Call back');
  await tasksCard(page).getByLabel('Task', { exact: true }).press('Enter');
  await expect(tasksCard(page).locator('.task-text')).toHaveText(['Call back']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const controls = page.locator('#page-client').locator('button:visible, input:visible, select:visible, textarea:visible');
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    if (!box) continue;
    if ((await control.getAttribute('type')) === 'checkbox') continue; // its label is the 44px target
    expect(box.height, await control.evaluate(n => n.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  const check = await tasksCard(page).locator('.task-check').boundingBox();
  expect(check.height).toBeGreaterThanOrEqual(44);
});

// Screenshots for review: test-results/screens/client-*.png
for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone-360', { width: 360, height: 740 }]]) {
  test(`screenshot: the Client page with a client selected (${name})`, async ({ page }) => {
    await openClientPage(page, { viewport });
    await tasksCard(page).getByLabel('Task', { exact: true }).fill('Send proposal | Anna | 30/09/2026');
    await tasksCard(page).getByLabel('Task', { exact: true }).press('Enter');
    await expect(page.locator('.profile-name')).toHaveText('Acme Ltd.');
    await expect(page.locator('.timeline-item')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: `test-results/screens/client-${name}.png`, fullPage: true });
  });
}

test('phone 360px: the nav scrolls the current page into view and snaps', async ({ page }) => {
  await openClientPage(page, { viewport: { width: 360, height: 740 } });
  const nav = page.locator('.topbar .views');
  const current = page.locator('#view-client');
  await expect(current).toHaveAttribute('aria-current', 'page');
  const inView = async () => {
    const [n, c] = [await nav.boundingBox(), await current.boundingBox()];
    return c.x >= n.x - 1 && c.x + c.width <= n.x + n.width + 1;
  };
  await expect.poll(inView).toBe(true);
  expect(await nav.evaluate(n => getComputedStyle(n).scrollSnapType)).toContain('x');
  await page.locator('#view-dashboard').click();
  await nav.evaluate(n => { n.scrollLeft = 0; });
  await page.keyboard.press('p');
  await expect.poll(inView).toBe(true);
  await page.screenshot({ path: 'test-results/screens/client-nav-360.png' });
});
