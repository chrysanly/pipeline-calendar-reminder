// To-Do page (js/views/todos.js, todo-compose.js): notes without titles, written
// at the top or with a folder's "+ Add"; tick done, the Open / Done / All
// switch, edit in place, delete with a confirm, kept after a reload; an older
// item's title still shows; signed in, saved to users/{uid}/todos (the fake).

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = { apiKey: 'fake-api-key', authDomain: 'demo-calendar.firebaseapp.com', projectId: 'demo-calendar', appId: '1:123:web:abc' };
const STORE_KEY = 'client-calendar.todos.v1'; // recordKey('todos'), js/records.js

const page$ = page => page.locator('#page-todos');
const rows = page => page.locator('#page-todos .todo-item');
const tab = (page, name) => page.locator(`#page-todos .todo-tab[data-filter="${name}"]`);
const topForm = page => page.locator('#page-todos .todo-form');
const folder = (page, name) => page.locator(`#page-todos .todo-group[data-group="${name}"]`);

async function openTodos(page) {
  await openApp(page, undefined, { view: null });
  await page.locator('.views [data-view="todos"]').click();
  await expect(page$(page)).toBeVisible();
}

/** Write a note in the top form (optionally into a folder) and press Enter. */
async function addNote(page, note, group) {
  if (group !== undefined) await topForm(page).locator('.todo-group-input').fill(group);
  await topForm(page).locator('.todo-note-input').fill(note);
  await topForm(page).locator('.todo-note-input').press('Enter');
  await expect(topForm(page).locator('.todo-note-input')).toHaveValue('');
}

test('the To-Do page has a nav button, opens with O, and starts with an empty state', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  const button = page.locator('.views [data-view="todos"]');
  await expect(button.locator('.btn-label')).toHaveText('To-Do');
  await page.keyboard.press('o');
  await expect(page$(page)).toBeVisible();
  await expect(button).toHaveAttribute('aria-current', 'page');
  await expect(page$(page).locator('.page-title')).toHaveText('To-Do');
  // No title box any more: a note, a folder and the paperclip.
  await expect(topForm(page).locator('.todo-title-input')).toHaveCount(0);
  await expect(topForm(page).locator('.todo-note-input')).toHaveAttribute('maxlength', '1000');
  await expect(page$(page).locator('.todo-empty-title')).toHaveText('All clear');
  await expect(tab(page, 'open')).toHaveText('Open (0)');
});

test('a note from the top form, no title: Enter adds, Shift+Enter is a new line, it shows as the main text', async ({ page }) => {
  await openTodos(page);
  const note = topForm(page).locator('.todo-note-input');
  await note.fill('Buy printer ink');
  await note.press('Shift+Enter');
  await note.pressSequentially('and paper');
  await expect(note).toHaveValue('Buy printer ink\nand paper');
  await note.press('Enter');
  await expect(note).toHaveValue('');
  await expect(note).toBeFocused();
  const item = rows(page).first();
  await expect(item.locator('.todo-note.is-main')).toHaveText('Buy printer ink\nand paper');
  await expect(item.locator('.todo-title')).toHaveCount(0);
  await expect(item.locator('.todo-check')).toHaveAttribute('aria-label', 'Done: Buy printer ink');
  await expect(folder(page, 'General')).toBeVisible();
});

test('an empty note is refused with a message, and nothing is added', async ({ page }) => {
  await openTodos(page);
  await topForm(page).locator('.todo-note-input').fill('   ');
  await page.locator('#page-todos .todo-form .todo-add').click();
  await expect(page.locator('#page-todos .todo-status')).toHaveText('Write a note or attach a file.');
  await expect(rows(page)).toHaveCount(0);
});

test('the top form keeps the last folder used, also after a reload', async ({ page }) => {
  await openTodos(page);
  await addNote(page, 'Renew the domain', 'Sinag');
  await expect(topForm(page).locator('.todo-group-input')).toHaveValue('Sinag');
  await page.reload();
  await page.locator('.views [data-view="todos"]').click();
  await expect(topForm(page).locator('.todo-group-input')).toHaveValue('Sinag');
  await expect(folder(page, 'Sinag').locator('.todo-note')).toHaveText(['Renew the domain']);
});

test('a folder’s + Add opens a note box inside it: two notes in a row, Escape closes it', async ({ page }) => {
  await openTodos(page);
  await addNote(page, 'First', 'CladFlo');
  await addNote(page, 'Elsewhere', 'Sinag');
  const cladflo = folder(page, 'CladFlo');
  await cladflo.locator('.todo-group-add').click();
  const quick = cladflo.locator('.todo-quick .todo-note-input');
  await expect(quick).toBeFocused();
  await expect(quick).toHaveAttribute('placeholder', /New note in CladFlo/);

  await quick.fill('Second');
  await quick.press('Enter');
  await expect(quick).toHaveValue('');
  await expect(quick).toBeFocused(); // stays open for the next one
  await quick.fill('Third');
  await quick.press('Enter');
  await expect(cladflo.locator('.todo-item .todo-note')).toHaveText(['Third', 'Second', 'First']);
  await expect(cladflo.locator('.todo-group-count')).toHaveText('3');
  await expect(folder(page, 'Sinag').locator('.todo-item')).toHaveCount(1);

  await quick.press('Escape');
  await expect(cladflo.locator('.todo-quick')).toHaveCount(0);
  // The top form's folder was not changed by the quick box.
  await expect(topForm(page).locator('.todo-group-input')).toHaveValue('Sinag');
});

test('+ Add opens a folded folder', async ({ page }) => {
  await openTodos(page);
  await addNote(page, 'Inside', 'Sinag');
  const sinag = folder(page, 'Sinag');
  await sinag.locator('.todo-group-toggle').click();
  await expect(sinag.locator('.todo-list')).toBeHidden();
  await sinag.locator('.todo-group-add').click();
  await expect(sinag.locator('.todo-list')).toBeVisible();
  await expect(sinag.locator('.todo-quick .todo-note-input')).toBeFocused();
});

test('tick done, see it under Done, and it is kept after a reload; unticking brings it back', async ({ page }) => {
  await openTodos(page);
  await addNote(page, 'Send the quote', 'Sinag');
  await addNote(page, 'Call Anna');
  await expect(tab(page, 'open')).toHaveText('Open (2)');

  await rows(page).filter({ hasText: 'Send the quote' }).locator('.todo-check').click(); // the row leaves Open
  await expect(rows(page)).toHaveCount(1);
  await expect(tab(page, 'done')).toHaveText('Done (1)');
  await tab(page, 'done').click();
  await expect(tab(page, 'done')).toHaveAttribute('aria-pressed', 'true');
  const done = rows(page).first();
  await expect(done).toHaveClass(/is-done/);
  await expect(done.locator('.todo-check')).toBeChecked();
  await expect(done.locator('.todo-meta')).toContainText('Done');
  expect(await done.locator('.todo-note').evaluate(n => getComputedStyle(n).textDecorationLine)).toBe('line-through');

  await page.reload();
  await page.locator('.views [data-view="todos"]').click();
  await tab(page, 'all').click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: 'Send the quote' })).toHaveClass(/is-done/);
  await rows(page).filter({ hasText: 'Send the quote' }).locator('.todo-check').click();
  await tab(page, 'open').click();
  await expect(tab(page, 'open')).toHaveText('Open (2)');
});

test('edit the note and folder in place; Escape cancels; an emptied note is refused', async ({ page }) => {
  await openTodos(page);
  await addNote(page, 'Draft', 'Sinag');
  await rows(page).first().locator('.todo-edit').click();
  const form = page.locator('#page-todos .todo-edit-form');
  await expect(form.locator('.todo-title-input')).toHaveCount(0); // new items have no title
  await expect(form.locator('.todo-note-input')).toBeFocused();
  await form.locator('.todo-note-input').fill('Send the draft\nto Omar');
  await form.locator('.todo-group-input').fill('CladFlo');
  await form.locator('.todo-save').click();
  await expect(form).toHaveCount(0);
  await expect(folder(page, 'CladFlo').locator('.todo-note')).toHaveText('Send the draft\nto Omar');

  await rows(page).first().locator('.todo-edit').click();
  await form.locator('.todo-note-input').fill('');
  await form.locator('.todo-save').click();
  await expect(page.locator('#page-todos .todo-status')).toHaveText('Write a note or attach a file.');
  await form.locator('.todo-note-input').press('Escape');
  await expect(form).toHaveCount(0);
  await expect(rows(page).first().locator('.todo-note')).toHaveText('Send the draft\nto Omar');
});

test('an older item with a title shows it above its note, and the edit form keeps it', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify([
    { id: 'old1', title: 'Call Anna', note: 'about the renewal', group: 'Sinag', done: false, createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-01T09:00:00.000Z' }
  ])), STORE_KEY);
  await page.reload();
  await page.locator('.views [data-view="todos"]').click();
  const item = rows(page).first();
  await expect(item.locator('.todo-title')).toHaveText('Call Anna');
  await expect(item.locator('.todo-note')).toHaveText('about the renewal');
  await expect(item.locator('.todo-note')).not.toHaveClass(/is-main/);
  await item.locator('.todo-edit').click();
  await expect(page.locator('#page-todos .todo-edit-form .todo-title-input')).toHaveValue('Call Anna');
});

test('delete asks first, naming the note; Cancel keeps it, OK removes it', async ({ page }) => {
  await openTodos(page);
  await addNote(page, 'Old task\nsecond line');
  page.once('dialog', dialog => {
    expect(dialog.message()).toBe('Delete "Old task"?');
    dialog.dismiss();
  });
  await rows(page).first().locator('.todo-delete').click();
  await expect(rows(page)).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await rows(page).first().locator('.todo-delete').click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#page-todos .todo-empty')).toBeVisible();
});

test('text is shown as text, never as HTML', async ({ page }) => {
  await openTodos(page);
  await addNote(page, '<img src=x onerror="window.__xss=1"><b>bold?</b>', '<i>folder</i>');
  await expect(rows(page).first().locator('.todo-note')).toHaveText('<img src=x onerror="window.__xss=1"><b>bold?</b>');
  await expect(page.locator('#page-todos .todo-group-name')).toHaveText('<i>folder</i>');
  await expect(page.locator('#page-todos .todo-groups').locator('img, b, i:not(.fa-solid)')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('a link opens the To-Do page directly: index.html?view=todos; an unknown page falls back to Home', async ({ page }) => {
  await openApp(page, undefined, { view: null }); // lands on Home
  await page.goto('/index.html?backend=local&view=todos');
  await expect(page$(page)).toBeVisible();
  await expect(page.locator('.views [data-view="todos"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#dashboard')).toBeHidden();

  await page.goto('/index.html?backend=local&view=nonsense');
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page$(page)).toBeHidden();
});

// For design review: the To-Do page with folders, notes, a done one and a
// folder's + Add box open, in light and dark, saved to test-results/design/.
for (const scheme of ['light', 'dark']) {
  test(`design review screenshot: To-Do with folders and notes (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openTodos(page);
    await addNote(page, 'Renew the domain before the 15th', 'Sinag');
    await addNote(page, 'Check the login page on phones', 'Sinag');
    await addNote(page, 'Send the October invoice to Acme', 'CladFlo');
    await addNote(page, 'Call Omar about the renewal\nhe asked for the new prices', 'CladFlo');
    await folder(page, 'Sinag').locator('.todo-check').first().click();
    await tab(page, 'all').click();
    await folder(page, 'CladFlo').locator('.todo-group-add').click();
    await expect(page.locator('#page-todos .todo-group')).toHaveCount(2);
    await expect(folder(page, 'CladFlo').locator('.todo-quick .todo-note-input')).toBeFocused();
    // The loading splash has gone and the To-Do page is the one on screen.
    await expect(page.locator('#app-loading')).toBeHidden();
    await expect(page.locator('.views [data-view="todos"]')).toHaveAttribute('aria-current', 'page');
    // From the top, so the sticky top bar sits at the top of the full-page shot.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(here, '..', '..', 'test-results', 'design', `todos-${scheme}.png`), fullPage: true });
  });
}

test('signed in: notes are saved to your account at users/{uid}/todos', async ({ page }) => {
  await page.route('**/js/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const FIREBASE_CONFIG = ${JSON.stringify(CONFIG)};`
  }));
  await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  await page.addInitScript(() => {
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  });
  await page.goto('/index.html');
  await page.locator('.views [data-view="todos"]').click();
  await expect(page.locator('#page-todos .todo-notice')).toHaveText('Sign in to see and keep your to-do list.');
  await expect(page.locator('#page-todos .todo-card')).toBeHidden();

  await page.locator('#sign-in').click();
  await expect(page.locator('#user-name')).toHaveText('Test User');
  await page.locator('.views [data-view="todos"]').click();
  await addNote(page, 'Renew the licence before the 15th', 'Admin');
  await expect(rows(page)).toHaveCount(1);
  const saved = await page.evaluate(() => Object.entries(window.__fake.dump()).filter(([path]) => path.startsWith('users/user-1/todos/')));
  expect(saved).toHaveLength(1);
  expect(saved[0][1]).toMatchObject({ title: '', note: 'Renew the licence before the 15th', group: 'Admin', done: false });
});
