// Cloud mode against an in-memory fake of the Firebase compat SDK
// (fake-firebase.js). A test config is served in place of js/firebase-config.js,
// so the real one stays empty and nothing ever reaches Firebase.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY, fillForm, todayKey, goToView } from './helpers.mjs';

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

/** Sign out lives in the account dropdown on the right of the top bar. */
async function signOut(page) {
  await page.locator('#account-btn').click();
  await page.locator('#sign-out').click();
}

const todayCell = page => page.locator(`#grid .day[data-key="${TODAY}"]`);
// Reminder docs only; the History log (users/{uid}/history) is checked on its own below.
const dump = page => page.evaluate(() =>
  Object.fromEntries(Object.entries(window.__fake.dump()).filter(([path]) => path.includes('/events/'))));

async function createEvent(page, fields) {
  await page.locator('#add-event').click();
  await fillForm(page, fields);
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
}

test('the account dropdown shows the name and Sign out; Escape and a click outside close it', async ({ page }) => {
  await openCloud(page);
  await signIn(page);
  const button = page.locator('#account-btn');
  const menu = page.locator('#account-menu');
  await expect(button.locator('.avatar')).toHaveText('T');
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  // Top right of the bar.
  const box = await button.boundingBox();
  expect(box.x + box.width).toBeGreaterThan(page.viewportSize().width - 40);

  await button.click();
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#account-name')).toHaveText('Test User');
  await expect(page.locator('#account-email')).toHaveText('test@example.com');
  await expect(page.locator('#sign-out')).toBeFocused();
  await expect(page.locator('#sign-out .fa-right-from-bracket')).toHaveCount(1);
  await page.screenshot({ path: join(here, '..', '..', 'test-results', 'design', 'account-menu.png') });

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await button.click();
  await page.locator('.brand').click();
  await expect(menu).toBeHidden();

  await signOut(page);
  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#account')).toBeHidden();
});

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
  await expect(page.locator('#sign-in')).toBeHidden();
  await expect(page.locator('#sign-out')).toBeHidden(); // inside the closed account menu
  await expect(page.locator('#account-btn')).toBeVisible();
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

  const writes = await page.evaluate(() => window.__fake.appWrites().filter(w => w.path.includes('/events/')).map(w => [w.op, w.path]));
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
  await signOut(page);
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

  await signOut(page);
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
  await expect(page.locator('.brand')).toHaveText('CladFlo');
  await expect(page.locator('#month-label')).not.toHaveText(/^\s*—?\s*$/);
  expect(errors).toEqual([]);
});

test('signed in but the first snapshot never arrives: the calendar still renders its days', async ({ page }) => {
  await page.addInitScript(() => { window.__fakeHold = { snapshot: true }; });
  await openCloud(page);
  await signIn(page);
  await goToView(page, 'month');
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

test('History and minutes are saved in the account at users/{uid}/history and users/{uid}/meetings', async ({ page }) => {
  await openCloud(page, {
    cloud: { [`users/${UID}/meetings/m0`]: { clientName: 'Acme Ltd.', title: 'Earlier meeting', date: '2026-09-01' } }
  });
  await signIn(page);
  await createEvent(page, { title: 'Follow-up call', clientName: 'Acme Ltd.', date: TODAY, time: '14:30' });

  const all = await page.evaluate(() => window.__fake.dump());
  const history = Object.entries(all).filter(([path]) => path.startsWith(`users/${UID}/history/`));
  expect(history).toHaveLength(1);
  expect(history[0][1]).toMatchObject({ action: 'create', kind: 'reminder', title: 'Follow-up call', client: 'Acme Ltd.' });
  expect('id' in history[0][1]).toBe(false);

  // The saved meeting comes from this account's meetings collection.
  await page.keyboard.press('n');
  await expect(page.locator('.saved-title')).toHaveText(['Earlier meeting']);
  page.once('dialog', d => d.accept());
  await page.locator('.saved-delete').click();
  await expect(page.locator('.saved-item')).toHaveCount(0);
  expect(Object.keys(await page.evaluate(() => window.__fake.dump())).filter(p => p.includes('/meetings/'))).toEqual([]);

  // Signing out empties both lists on screen.
  await signOut(page);
  await expect(page.locator('#signed-out')).toBeVisible();
  expect(await page.locator('#saved-minutes .saved-item').count()).toBe(0);
  expect(await page.locator('#history-list .history-item').count()).toBe(0);
});
