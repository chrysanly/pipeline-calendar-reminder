// Cloud mode against an in-memory fake of the Firebase compat SDK
// (fake-firebase.js). A test config is served in place of js/firebase-config.js,
// so the real one stays empty and nothing ever reaches Firebase.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY, fillForm, todayKey } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TODAY = todayKey();
const EIGHT_AM = (() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; })();
const UID = 'user-1';
const docPath = id => `users/${UID}/events/${id}`;

const TEST_CONFIG = {
  apiKey: 'fake-api-key',
  authDomain: 'demo-calendar.firebaseapp.com',
  projectId: 'demo-calendar',
  appId: '1:123:web:abc'
};

const reminder = (title, extra = {}) => ({
  clientName: 'Acme Ltd.', title, date: TODAY, time: '14:30', notes: '',
  reminderMinutesBefore: 15, notified: false, ...extra
});

/**
 * Open the app in cloud mode. `local` seeds this browser's localStorage,
 * `cloud` seeds the fake Firestore (path → data) before the app subscribes.
 */
async function openCloud(page, { config = TEST_CONFIG, local = null, cloud = {}, url = '/index.html', sdk = true } = {}) {
  // 08:00 today, so the 14:30 test reminders are not due and don't pop up.
  await page.clock.install({ time: EIGHT_AM });
  await page.route('**/js/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const FIREBASE_CONFIG = ${JSON.stringify(config)};`
  }));
  if (sdk) await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  else await page.addInitScript(() => { window.__fake = { seed() {} }; });
  await page.addInitScript(({ key, local, cloud }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem('view', 'month');
      if (local) localStorage.setItem(key, JSON.stringify(local));
      sessionStorage.setItem('__test_reset', '1');
    }
    for (const [path, data] of Object.entries(cloud)) window.__fake.seed(path, data);
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { key: STORAGE_KEY, local, cloud });
  await page.goto(url);
}

async function signIn(page) {
  await page.locator('#sign-in').click();
  await expect(page.locator('#user-name')).toHaveText('Test User');
}

const todayCell = page => page.locator(`#grid .day[data-key="${TODAY}"]`);
const dump = page => page.evaluate(() => window.__fake.dump());

async function createEvent(page, fields) {
  await page.locator('#add-event').click();
  await fillForm(page, fields);
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
}

test('signed out: the sign-in prompt shows and the calendar is hidden', async ({ page }) => {
  await openCloud(page);

  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#signed-out h2')).toHaveText('Sign in to see your reminders');
  await expect(page.locator('#sign-in')).toBeVisible();
  await expect(page.locator('#sign-in .fa-google')).toHaveCount(1);
  await expect(page.locator('#sign-out')).toBeHidden();
  await expect(page.locator('.calendar')).toBeHidden();
  await expect(page.locator('#add-event')).toBeHidden();
  await expect(page.locator('#import-btn')).toBeHidden();
  expect(await page.evaluate(() => window.__fake.config.projectId)).toBe('demo-calendar');
});

test('the prompt\'s own button signs in too', async ({ page }) => {
  await openCloud(page);
  await page.locator('#prompt-sign-in').click();
  await expect(page.locator('#signed-out')).toBeHidden();
  await expect(page.locator('.calendar')).toBeVisible();
});

test('after sign-in, reminders come from the snapshot (own uid only)', async ({ page }) => {
  await openCloud(page, {
    cloud: {
      [docPath('c1')]: reminder('From the cloud'),
      'users/someone-else/events/x': reminder('Not mine')
    }
  });
  await signIn(page);

  await expect(page.locator('#signed-out')).toBeHidden();
  await expect(page.locator('#sign-out')).toBeVisible();
  await expect(page.locator('#sign-out .fa-right-from-bracket')).toHaveCount(1);
  await expect(todayCell(page).locator('.chip-title')).toHaveText(['From the cloud']);
  await expect(page.locator('#grid .chip-title', { hasText: 'Not mine' })).toHaveCount(0);
});

test('create, edit and delete write the right Firestore docs', async ({ page }) => {
  await openCloud(page);
  await signIn(page);

  await createEvent(page, { title: 'Cloud call', clientName: 'Acme Ltd.', time: '14:30' });
  const chip = todayCell(page).locator('.chip');
  await expect(chip).toHaveCount(1);
  const id = await chip.getAttribute('data-id');

  let docs = await dump(page);
  expect(Object.keys(docs)).toEqual([docPath(id)]);
  expect(docs[docPath(id)]).toMatchObject({ title: 'Cloud call', clientName: 'Acme Ltd.', date: TODAY, time: '14:30' });
  expect(docs[docPath(id)]).not.toHaveProperty('id');
  expect(await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY)).toBeNull();

  await chip.locator('.chip-title').click();
  await page.locator('#day-events .link', { hasText: 'Edit' }).click();
  await fillForm(page, { title: 'Renamed call' });
  await page.locator('#event-form button[type="submit"]').click();
  await expect(chip.locator('.chip-title')).toHaveText('Renamed call');
  docs = await dump(page);
  expect(docs[docPath(id)].title).toBe('Renamed call');

  page.once('dialog', d => d.accept());
  await page.locator('#day-events .link', { hasText: 'Delete' }).click();
  await expect(todayCell(page).locator('.chip')).toHaveCount(0);
  expect(await dump(page)).toEqual({});

  const writes = await page.evaluate(() => window.__fake.appWrites().map(w => [w.op, w.path]));
  expect(writes).toEqual([['set', docPath(id)], ['set', docPath(id)], ['delete', docPath(id)]]);
});

test('a change from another device shows up live', async ({ page }) => {
  await openCloud(page);
  await signIn(page);
  await expect(todayCell(page).locator('.chip')).toHaveCount(0);

  await page.evaluate(({ path, data }) => window.__fake.remoteSet(path, data), { path: docPath('phone-1'), data: reminder('Added on phone') });
  await expect(todayCell(page).locator('.chip-title')).toHaveText(['Added on phone']);

  // Open it, then the other device deletes it: the panel closes.
  await todayCell(page).locator('.chip-title').click();
  await expect(page.locator('#panel')).toBeVisible();
  await page.evaluate(path => window.__fake.remoteDelete(path), docPath('phone-1'));
  await expect(todayCell(page).locator('.chip')).toHaveCount(0);
  await expect(page.locator('#panel')).toBeHidden();

  // Nothing was written back by the app.
  expect(await page.evaluate(() => window.__fake.appWrites().length)).toBe(0);
});

test('a due reminder pops up and is marked notified in Firestore', async ({ page }) => {
  await openCloud(page);
  await signIn(page);

  await createEvent(page, { title: 'Right now', time: '08:00', reminderMinutesBefore: 0 });
  await expect(page.locator('#banner-title')).toHaveText('Hey you have a Right now');
  const id = await todayCell(page).locator('.chip').getAttribute('data-id');
  await expect.poll(async () => (await dump(page))[docPath(id)].notified).toBe(true);
});

test('local reminders move to an empty cloud once, on first sign-in', async ({ page }) => {
  const local = [
    { id: 'l1', ...reminder('Old local 1', { time: '09:00' }) },
    { id: 'l2', ...reminder('Old local 2', { time: '11:00' }) }
  ];
  await openCloud(page, { local });
  // Signed out: the local reminders are not shown.
  await expect(page.locator('.calendar')).toBeHidden();

  await signIn(page);
  await expect(page.locator('#banner-title')).toHaveText('Moved 2 reminders to the cloud');
  expect(Object.keys(await dump(page)).sort()).toEqual([docPath('l1'), docPath('l2')]);
  await expect(todayCell(page).locator('.chip-title')).toHaveText(['Old local 1', 'Old local 2']);
  expect(await page.evaluate(() => localStorage.getItem('client-calendar.migrated.v1'))).toBe(UID);

  // Empty the cloud, sign out and back in: it must not upload again.
  await page.locator('#banner-close').click();
  await page.evaluate(paths => paths.forEach(p => window.__fake.remoteDelete(p)), [docPath('l1'), docPath('l2')]);
  await page.locator('#sign-out').click();
  await expect(page.locator('#signed-out')).toBeVisible();
  await signIn(page);
  await expect(todayCell(page).locator('.chip')).toHaveCount(0);
  await expect(page.locator('#banner')).toBeHidden();
  expect(await dump(page)).toEqual({});
});

test('local reminders are not uploaded when the cloud already has data', async ({ page }) => {
  await openCloud(page, {
    local: [{ id: 'l1', ...reminder('Old local') }],
    cloud: { [docPath('c1')]: reminder('Already in cloud') }
  });
  await signIn(page);

  await expect(todayCell(page).locator('.chip-title')).toHaveText(['Already in cloud']);
  await expect(page.locator('#banner')).toBeHidden();
  expect(Object.keys(await dump(page))).toEqual([docPath('c1')]);
});

test('Excel import writes through to Firestore', async ({ page }) => {
  await page.route('https://cdn.sheetjs.com/**', route =>
    route.fulfill({ path: join(here, '..', '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), contentType: 'text/javascript' }));
  await openCloud(page);
  await signIn(page);

  await page.locator('#import-file').setInputFiles(join(here, '..', 'fixtures', 'sample.xlsx'));
  await expect(page.locator('#banner-title')).toContainText('Imported 4 reminders');
  const docs = Object.values(await dump(page));
  expect(docs.map(d => d.title).sort()).toEqual([
    'Follow up: Desert Rose LLC', 'Follow up: Falcon Trading', 'Follow up: Oasis Group', 'Follow up: Palm Holdings'
  ]);
  expect(docs.every(d => d.source === 'import' && d.importKey)).toBe(true);
});

test('signing out clears the calendar and shows the prompt again', async ({ page }) => {
  await openCloud(page, { cloud: { [docPath('c1')]: reminder('Private') } });
  await signIn(page);
  await expect(todayCell(page).locator('.chip')).toHaveCount(1);

  await page.locator('#sign-out').click();
  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#grid .chip')).toHaveCount(0);
  await expect(page.locator('#user-name')).toBeHidden();
});

test('empty config: local mode even with the SDK loaded, no sign-in, no banner', async ({ page }) => {
  await openCloud(page, { config: {} });
  await page.waitForSelector('#grid .day');

  await expect(page.locator('#auth-area')).toBeHidden();
  await expect(page.locator('#signed-out')).toBeHidden();
  await expect(page.locator('.calendar')).toBeVisible();
  await expect(page.locator('#banner')).toBeHidden();
  expect(await page.evaluate(() => window.__fake.config)).toBeNull();

  await createEvent(page, { title: 'Stays local' });
  expect(await page.evaluate(k => JSON.parse(localStorage.getItem(k)).length, STORAGE_KEY)).toBe(1);
  expect(await dump(page)).toEqual({});
});

test('?backend=local forces local mode even with a config', async ({ page }) => {
  await openCloud(page, { url: '/index.html?backend=local' });
  await page.waitForSelector('#grid .day');

  await expect(page.locator('#auth-area')).toBeHidden();
  await expect(page.locator('.calendar')).toBeVisible();
  await expect(page.locator('#banner')).toBeHidden();
  expect(await page.evaluate(() => window.__fake.config)).toBeNull();
});

// ---------- blank-screen check: slow Firebase ----------

test('auth that never answers: the page is not blank and the label is not stuck on "—"', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.__fakeHold = { auth: true }; });
  await openCloud(page);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.brand')).toHaveText('Pipeline');
  await expect(page.locator('#month-label')).not.toHaveText(/^\s*—?\s*$/);
  expect(errors).toEqual([]);
});

test('signed in but the first snapshot never arrives: the calendar still renders its days', async ({ page }) => {
  await page.addInitScript(() => { window.__fakeHold = { snapshot: true }; });
  await openCloud(page);
  await signIn(page);
  await page.locator('#view-month').click();
  await expect(page.locator('.calendar')).toBeVisible();
  await expect(page.locator('#grid .day')).toHaveCount(42);
  await expect(page.locator('#month-label')).not.toHaveText(/^\s*—?\s*$/);
});

test('config set but the SDK failed to load: local mode with a "Working offline" notice', async ({ page }) => {
  await openCloud(page, { sdk: false });
  await page.waitForSelector('#grid .day');

  await expect(page.locator('#auth-area')).toBeHidden();
  await expect(page.locator('.calendar')).toBeVisible();
  await expect(page.locator('#banner-title')).toHaveText('Working offline');
});
