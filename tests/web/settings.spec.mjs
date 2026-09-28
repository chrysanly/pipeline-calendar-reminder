// Settings modal: AI settings (Groq key and model, this browser only) and
// Clear all data, in local mode and against the fake Firebase. Groq is mocked.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const KEY = 'gsk_test_0123456789abcd';
const NOW = new Date(2026, 8, 27, 8, 0, 0);

const EVENTS = [
  { id: 'e1', title: 'Renewal call', clientName: 'Acme Ltd.', date: '2026-09-28', time: '14:30', reminderMinutesBefore: 0, notified: false },
  { id: 'e2', title: 'Site visit', clientName: 'Falcon Trading', date: '2026-09-29', time: '10:00', reminderMinutesBefore: 0, notified: false }
];
const MEETING = { id: 'm1', clientName: 'Acme Ltd.', title: 'Kickoff', date: '2026-09-20', attendees: [], summary: 'Agreed.', decisions: [], actionItems: [] };
const OLD_ENTRY = { id: 'h0', at: '2026-09-26T09:00:00.000Z', action: 'create', kind: 'reminder', title: 'Renewal call', client: 'Acme Ltd.', detail: '' };

/** Local mode, with `seed` (localStorage key → value) written on the first load only. */
async function openLocal(page, seed = {}) {
  await page.clock.install({ time: NOW });
  await page.addInitScript(seed => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem('view', 'month');
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, seed);
  await page.goto('/index.html?backend=local');
  await page.waitForSelector('#grid .day');
}

const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || 'null'), key);

/** Answer every Groq request with `status` (200 replies "OK"); returns the requests seen. */
async function mockGroq(page, status) {
  const requests = [];
  await page.route('**/api.groq.com/**', route => {
    requests.push({ auth: route.request().headers().authorization, body: route.request().postDataJSON() });
    return route.fulfill(status === 200
      ? { status, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: 'OK' } }] }) }
      : { status, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Invalid API Key' } }) });
  });
  return requests;
}

test('the gear opens Settings; the close button and Escape close it', async ({ page }) => {
  await openLocal(page);
  await expect(page.locator('#settings')).toBeHidden();
  await page.locator('#settings-btn').click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#settings h3')).toHaveText(['AI settings', 'Data']);
  await expect(page.locator('#groq-key')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeHidden();
  await expect(page.locator('#settings-btn')).toBeFocused();
  await page.locator('#settings-btn').click();
  await page.locator('#settings-close').click();
  await expect(page.locator('#settings')).toBeHidden();
});

test('AI settings: the key is masked, saved in this browser only, and can be removed', async ({ page }) => {
  await openLocal(page);
  await page.locator('#settings-btn').click();
  await expect(page.locator('#groq-key')).toHaveAttribute('type', 'password');
  await expect(page.locator('#groq-key-state')).toHaveText('No key saved yet.');
  await expect(page.locator('#groq-remove')).toBeDisabled();
  await expect(page.locator('#settings a[href="https://console.groq.com/keys"]')).toHaveText('console.groq.com');

  await page.locator('#groq-key').fill(KEY);
  await page.locator('#groq-save').click();
  await expect(page.locator('#groq-status')).toHaveText('Key saved in this browser.');
  await expect(page.locator('#groq-key')).toHaveValue('');
  await expect(page.locator('#groq-key')).toHaveAttribute('placeholder', 'gsk_…abcd');
  await expect(page.locator('#groq-key-state')).toHaveText('Saved in this browser: gsk_…abcd');
  expect(await page.evaluate(() => localStorage.getItem('cladflo.groq-key.v1'))).toBe(KEY);
  expect(await page.locator('#settings').innerText()).not.toContain(KEY);

  await page.locator('#groq-remove').click();
  await expect(page.locator('#groq-key-state')).toHaveText('No key saved yet.');
  expect(await page.evaluate(() => localStorage.getItem('cladflo.groq-key.v1'))).toBeNull();
});

test('AI settings: the model defaults to Llama 3.3 70B and the choice is kept', async ({ page }) => {
  await openLocal(page);
  await page.locator('#settings-btn').click();
  await expect(page.locator('#groq-model')).toHaveValue('llama-3.3-70b-versatile');
  await expect(page.locator('#groq-model option')).toHaveCount(2);
  await page.locator('#groq-model').selectOption('llama-3.1-8b-instant');
  await page.reload();
  await page.locator('#settings-btn').click();
  await expect(page.locator('#groq-model')).toHaveValue('llama-3.1-8b-instant');
});

test('Test key: a working key says so; a bad one says "Key not valid"', async ({ page }) => {
  await openLocal(page);
  let requests = await mockGroq(page, 200);
  await page.locator('#settings-btn').click();
  await page.locator('#groq-key').fill(KEY);
  await page.locator('#groq-test').click();
  await expect(page.locator('#groq-status')).toHaveText('The key works.');
  expect(requests).toHaveLength(1);
  expect(requests[0].auth).toBe(`Bearer ${KEY}`);
  expect(requests[0].body.model).toBe('llama-3.3-70b-versatile');

  await page.unroute('**/api.groq.com/**');
  requests = await mockGroq(page, 401);
  await page.locator('#groq-test').click();
  await expect(page.locator('#groq-status')).toContainText('Key not valid');
  await expect(page.locator('#groq-status')).toHaveClass(/is-error/);
  expect(requests).toHaveLength(1);
});

test('Test key with nothing saved asks for a key and sends nothing', async ({ page }) => {
  await openLocal(page);
  const requests = await mockGroq(page, 200);
  await page.locator('#settings-btn').click();
  await page.locator('#groq-test').click();
  await expect(page.locator('#groq-status')).toHaveText('Paste your Groq API key first.');
  expect(requests).toHaveLength(0);
});

test('Clear all (local): needs CLEAR, deletes reminders and minutes, keeps and adds to History', async ({ page }) => {
  await openLocal(page, {
    'client-calendar.events.v1': EVENTS,
    'client-calendar.meetings.v1': [MEETING],
    'client-calendar.history.v1': [OLD_ENTRY]
  });
  await expect(page.locator('#grid .chip')).toHaveCount(2);
  await page.locator('#settings-btn').click();
  const button = page.locator('#clear-all');
  await expect(button).toBeDisabled();
  await page.locator('#clear-confirm').fill('clear');
  await expect(button).toBeDisabled();
  await page.locator('#clear-confirm').fill('CLEAR');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.locator('#clear-status')).toHaveText('Cleared 2 reminders, 1 minutes.');

  expect(await stored(page, 'client-calendar.events.v1')).toEqual([]);
  expect(await stored(page, 'client-calendar.meetings.v1')).toEqual([]);
  const history = await stored(page, 'client-calendar.history.v1');
  expect(history.map(e => e.title)).toEqual(['Cleared 2 reminders, 1 minutes', 'Renewal call']);
  expect(history[0].action).toBe('clear');

  await page.keyboard.press('Escape');
  await expect(page.locator('#grid .chip')).toHaveCount(0);
  await page.keyboard.press('l');
  await expect(page.locator('#history-list .history-item').first()).toContainText('Cleared 2 reminders, 1 minutes');
});

const docPath = (name, id) => `users/user-1/${name}/${id}`;

test('Clear all (cloud): deletes the account\'s reminders and minutes in Firestore, keeps History', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.route('**/js/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const FIREBASE_CONFIG = {"apiKey":"fake","projectId":"demo-calendar","appId":"1:1:web:1"};'
  }));
  await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  const cloud = {
    [docPath('events', 'e1')]: EVENTS[0],
    [docPath('events', 'e2')]: EVENTS[1],
    [docPath('meetings', 'm1')]: MEETING,
    [docPath('history', 'h0')]: OLD_ENTRY,
    'users/someone-else/events/x': EVENTS[0]
  };
  await page.addInitScript(cloud => {
    localStorage.setItem('view', 'month');
    for (const [path, data] of Object.entries(cloud)) {
      const { id, ...rest } = data;
      window.__fake.seed(path, rest);
    }
  }, cloud);
  await page.goto('/index.html');
  await page.locator('#sign-in').click();
  await expect(page.locator('#grid .chip')).toHaveCount(2);

  await page.locator('#settings-btn').click();
  await page.locator('#clear-confirm').fill('CLEAR');
  await page.locator('#clear-all').click();
  await expect(page.locator('#clear-status')).toHaveText('Cleared 2 reminders, 1 minutes.');

  const docs = await page.evaluate(() => window.__fake.dump());
  const paths = Object.keys(docs);
  expect(paths.filter(p => p.startsWith('users/user-1/events/'))).toEqual([]);
  expect(paths.filter(p => p.startsWith('users/user-1/meetings/'))).toEqual([]);
  expect(paths).toContain('users/someone-else/events/x');
  const history = paths.filter(p => p.startsWith('users/user-1/history/')).map(p => docs[p]);
  expect(history.map(e => e.title).sort()).toEqual(['Cleared 2 reminders, 1 minutes', 'Renewal call']);
  // The Groq key is never written to Firestore.
  expect(JSON.stringify(docs)).not.toContain('gsk_');
});

test('Clear all while signed out does nothing and says why', async ({ page }) => {
  await page.route('**/js/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const FIREBASE_CONFIG = {"apiKey":"fake","projectId":"demo-calendar","appId":"1:1:web:1"};'
  }));
  await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  await page.goto('/index.html');
  await expect(page.locator('#signed-out')).toBeVisible();
  await page.locator('#settings-btn').click();
  await page.locator('#clear-confirm').fill('CLEAR');
  await page.locator('#clear-all').click();
  await expect(page.locator('#clear-status')).toHaveText('Sign in first.');
});
