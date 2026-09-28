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
  await expect(page.locator('#settings h3')).toHaveText(['AI settings', 'Business', 'Data']);
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

// ---------- Business (js/views/settings.js, settings/app in the generic store) ----------

const SETTINGS_KEY = 'client-calendar.settings.v1';
const FAKE_CONFIG = 'export const FIREBASE_CONFIG = {"apiKey":"fake","projectId":"demo-calendar","appId":"1:1:web:1"};';

async function openCloud(page, seed = {}) {
  await page.route('**/js/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: FAKE_CONFIG }));
  await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  await page.addInitScript(seed => {
    localStorage.setItem('view', 'month');
    for (const [path, data] of Object.entries(seed)) window.__fake.seed(path, data);
  }, seed);
  await page.goto('/index.html');
}

async function fillBusiness(page, values) {
  const form = page.locator('#business-form');
  for (const [name, value] of Object.entries(values)) {
    if (name === 'currency') await form.locator('[name="currency"]').selectOption(value);
    else await form.locator(`[name="${name}"]`).fill(value);
  }
}

test('Business: defaults to AED, flags bad fields and saves nothing until they are fixed', async ({ page }) => {
  await openLocal(page);
  await page.locator('#settings-btn').click();
  const form = page.locator('#business-form');
  await expect(form.locator('[name="currency"]')).toHaveValue('AED');
  await expect(form.locator('[name="currency"] option')).toHaveText(['AED', 'USD', 'EUR', 'GBP', 'SAR', 'PHP', 'INR']);

  await fillBusiness(page, { stripeLink: 'http://buy.stripe.com/x', gcashNumber: '12345', workerUrl: 'not a url' });
  await page.locator('#biz-save').click();
  await expect(page.locator('#biz-status')).toHaveText('Fix the highlighted fields.');
  await expect(page.locator('#biz-stripeLink-error')).toHaveText('Enter the https:// Stripe Payment Link.');
  await expect(page.locator('#biz-gcashNumber-error')).toContainText('PH mobile number');
  await expect(page.locator('#biz-workerUrl-error')).toHaveText('Enter the https:// address of your Worker.');
  await expect(form.locator('[name="stripeLink"]')).toHaveAttribute('aria-invalid', 'true');
  await expect(form.locator('[name="stripeLink"]')).toBeFocused();
  await expect(page.locator('#biz-paypalLink-error')).toBeHidden();
  expect(await stored(page, SETTINGS_KEY)).toBeNull();
});

test('Business (local): saves tidied values in this browser and keeps them after a reload', async ({ page }) => {
  await openLocal(page);
  await page.locator('#settings-btn').click();
  await fillBusiness(page, {
    currency: 'USD',
    stripeLink: 'buy.stripe.com/abc',
    paypalLink: 'https://paypal.me/chrys/',
    gcashNumber: '0917 123 4567',
    workerUrl: 'https://pipeline.demo.workers.dev/'
  });
  await page.locator('#business-form [name="workerUrl"]').press('Enter');
  await expect(page.locator('#biz-status')).toHaveText('Business settings saved.');
  await expect(page.locator('#business-form [name="stripeLink"]')).toHaveValue('https://buy.stripe.com/abc');

  const [saved] = await stored(page, SETTINGS_KEY);
  expect(saved).toMatchObject({
    id: 'app', currency: 'USD', stripeLink: 'https://buy.stripe.com/abc', paypalLink: 'https://paypal.me/chrys',
    gcashNumber: '09171234567', gcashQr: '', workerUrl: 'https://pipeline.demo.workers.dev'
  });
  expect(saved.createdAt).toBeTruthy();

  await page.reload();
  await page.waitForSelector('#grid .day');
  await page.locator('#settings-btn').click();
  await expect(page.locator('#business-form [name="currency"]')).toHaveValue('USD');
  await expect(page.locator('#business-form [name="gcashNumber"]')).toHaveValue('09171234567');
  await expect(page.locator('#biz-status')).toHaveText('');
});

test('Business (cloud): saves to users/{uid}/settings/app and picks up a change from another device', async ({ page }) => {
  await openCloud(page, { 'users/user-1/settings/app': { currency: 'EUR', paypalLink: 'https://paypal.me/old' } });
  await page.locator('#sign-in').click();
  await expect(page.locator('#account')).toBeVisible();

  await page.locator('#settings-btn').click();
  await expect(page.locator('#business-form [name="currency"]')).toHaveValue('EUR');
  await expect(page.locator('#business-form [name="paypalLink"]')).toHaveValue('https://paypal.me/old');
  await fillBusiness(page, { currency: 'GBP', gcashQr: 'https://example.com/qr.png' });
  await page.locator('#biz-save').click();
  await expect(page.locator('#biz-status')).toHaveText('Business settings saved.');
  const docs = await page.evaluate(() => window.__fake.dump());
  expect(docs['users/user-1/settings/app']).toMatchObject({ currency: 'GBP', paypalLink: 'https://paypal.me/old', gcashQr: 'https://example.com/qr.png' });
  expect(Object.keys(docs).filter(p => p.includes('/settings/'))).toEqual(['users/user-1/settings/app']);

  // Closed dialog: a save from another device shows next time it opens.
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__fake.remoteSet('users/user-1/settings/app', { currency: 'SAR' }));
  await page.locator('#settings-btn').click();
  await expect(page.locator('#business-form [name="currency"]')).toHaveValue('SAR');
  await expect(page.locator('#business-form [name="paypalLink"]')).toHaveValue('');
});

test('Business while signed out says to sign in and writes nothing', async ({ page }) => {
  await openCloud(page);
  await expect(page.locator('#signed-out')).toBeVisible();
  await page.locator('#settings-btn').click();
  await fillBusiness(page, { currency: 'USD' });
  await page.locator('#biz-save').click();
  await expect(page.locator('#biz-status')).toHaveText('Sign in first.');
  expect(await page.evaluate(() => window.__fake.appWrites())).toEqual([]);
});

test('phone: the Business section fits 390px and its fields and Save are at least 44px tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openLocal(page);
  await page.locator('#settings-btn').click();
  const form = page.locator('#business-form');
  await form.scrollIntoViewIfNeeded();
  const card = await page.locator('#settings .modal-card').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(390);
  for (const control of await form.locator('input, select, button').all()) {
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    expect(box.height, await control.getAttribute('name') || await control.getAttribute('id')).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
