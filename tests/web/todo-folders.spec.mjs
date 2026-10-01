// To-Do folders ("Sinag", "CladFlo", …) and attached photos and files
// (js/views/todos.js, js/views/todo-attachments.js, js/todo-files.js): local
// mode keeps files in IndexedDB; signed in, in Firestore pieces (the fake).

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = { apiKey: 'fake-api-key', authDomain: 'demo-calendar.firebaseapp.com', projectId: 'demo-calendar', appId: '1:123:web:abc' };
// A 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const rows = page => page.locator('#page-todos .todo-item');
const folders = page => page.locator('#page-todos .todo-group');
const addForm = page => page.locator('#page-todos .todo-form');

async function openTodos(page) {
  await openApp(page, undefined, { view: null });
  await page.locator('.views [data-view="todos"]').click();
  await expect(page.locator('#page-todos')).toBeVisible();
}

async function addInFolder(page, note, folder) {
  await addForm(page).locator('.todo-group-input').fill(folder);
  await addForm(page).locator('.todo-note-input').fill(note);
  await addForm(page).locator('.todo-note-input').press('Enter');
  await expect(addForm(page).locator('.todo-note-input')).toHaveValue('');
}

// ---------- folders ----------

test('folders: to-dos are grouped under their folder, A-Z with General last; a folder folds shut', async ({ page }) => {
  await openTodos(page);
  await addInFolder(page, 'Todo 1', 'Sinag');
  await addInFolder(page, 'Todo 2', 'Sinag');
  await addInFolder(page, 'Todo 1', 'CladFlo');
  await addInFolder(page, 'Todo 2', 'cladflo'); // the same folder, any case
  await addInFolder(page, 'Todo 3', 'CladFlo');
  await addInFolder(page, 'Loose end', '');

  await expect(folders(page).locator('.todo-group-name')).toHaveText(['CladFlo', 'Sinag', 'General']);
  await expect(folders(page).locator('.todo-group-count')).toHaveText(['3', '2', '1']);
  await expect(folders(page).nth(0).locator('.todo-note')).toHaveText(['Todo 3', 'Todo 2', 'Todo 1']);
  await expect(folders(page).nth(1).locator('.todo-note')).toHaveText(['Todo 2', 'Todo 1']);
  // The folder box suggests the folders in use.
  await expect(page.locator('#todo-group-names option')).toHaveCount(3);

  const sinag = folders(page).filter({ hasText: 'Sinag' });
  await sinag.locator('.todo-group-toggle').click();
  await expect(sinag.locator('.todo-group-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(sinag.locator('.todo-list')).toBeHidden();
  await sinag.locator('.todo-group-toggle').click();
  await expect(sinag.locator('.todo-item')).toHaveCount(2);
  await expect(sinag.locator('.todo-item').first()).toBeVisible();
});

test('folders: the folder box keeps the last folder; editing moves a to-do to another folder', async ({ page }) => {
  await openTodos(page);
  await addInFolder(page, 'Call the bank', 'Sinag');
  await expect(addForm(page).locator('.todo-group-input')).toHaveValue('Sinag');

  await rows(page).first().locator('.todo-edit').click();
  const form = page.locator('#page-todos .todo-edit-form');
  await expect(form.locator('.todo-group-input')).toHaveValue('Sinag');
  await form.locator('.todo-group-input').fill('CladFlo');
  await form.locator('.todo-save').click();
  await expect(folders(page).locator('.todo-group-name')).toHaveText(['CladFlo']);
  await expect(rows(page).locator('.todo-note')).toHaveText(['Call the bank']);
});

// ---------- attachments ----------

test('attachments (local mode): photos and files are added, shown, kept after a reload, and can be removed', async ({ page }) => {
  await openTodos(page);
  await addForm(page).locator('.todo-note-input').fill('Send the contract');
  await addForm(page).locator('.todo-file-input').setInputFiles([
    { name: 'site.png', mimeType: 'image/png', buffer: PNG },
    { name: 'contract.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }
  ]);
  await expect(addForm(page).locator('.todo-chip-name')).toHaveText(['site.png', 'contract.pdf']);
  // One can be taken off before saving, and picked again.
  await addForm(page).locator('.todo-chip-remove').first().click();
  await expect(addForm(page).locator('.todo-chip-name')).toHaveText(['contract.pdf']);
  await addForm(page).locator('.todo-file-input').setInputFiles([{ name: 'site.png', mimeType: 'image/png', buffer: PNG }]);
  await page.locator('#page-todos .todo-add').click();

  const item = rows(page).first();
  await expect(item.locator('.todo-note')).toHaveText('Send the contract');
  await expect(addForm(page).locator('.todo-chips')).toBeHidden();
  await expect(item.locator('.todo-file')).toHaveCount(2);
  await expect(item.locator('.todo-file-link.is-file .todo-file-name')).toHaveText('contract.pdf');
  await expect(item.locator('.todo-file-link.is-file')).toHaveAttribute('href', /^blob:/);
  await expect(item.locator('.todo-file-link.is-file')).toHaveAttribute('download', 'contract.pdf');
  await expect(item.locator('.todo-thumb')).toHaveAttribute('src', /^blob:/);
  await expect(item.locator('.todo-thumb')).toHaveAttribute('alt', 'site.png');

  // Kept after a reload: read back from this browser.
  await page.reload();
  await page.locator('.views [data-view="todos"]').click();
  const thumb = rows(page).first().locator('.todo-thumb');
  await expect(thumb).toHaveAttribute('src', /^blob:/);
  expect(await thumb.evaluate(img => img.decode().then(() => img.naturalWidth))).toBe(1);

  // Edit: take the PDF off and save.
  await rows(page).first().locator('.todo-edit').click();
  const form = page.locator('#page-todos .todo-edit-form');
  await expect(form.locator('.todo-chip-name')).toHaveText(['contract.pdf', 'site.png']); // the order they were added
  await form.locator('.todo-chip-remove').first().click();
  await form.locator('.todo-save').click();
  await expect(rows(page).first().locator('.todo-file')).toHaveCount(1);
  await expect(rows(page).first().locator('.todo-thumb')).toBeVisible();
});

test('attachments: an empty file, or more than 10, are refused with a message', async ({ page }) => {
  await openTodos(page);
  const input = addForm(page).locator('.todo-file-input');
  await input.setInputFiles([{ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) }]);
  await expect(page.locator('#page-todos .todo-status')).toHaveText('"empty.txt" is empty.');
  await expect(addForm(page).locator('.todo-chip')).toHaveCount(0);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') }));
  await input.setInputFiles(eleven);
  await expect(page.locator('#page-todos .todo-status')).toHaveText('An item can hold up to 10 files.');
  await expect(addForm(page).locator('.todo-chip')).toHaveCount(0);
});

test('attachments (signed in): the file goes to users/{uid}/todoFiles in pieces; the to-do keeps its name and size; delete removes it', async ({ page }) => {
  await page.route('**/js/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const FIREBASE_CONFIG = ${JSON.stringify(CONFIG)};`
  }));
  await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  await page.goto('/index.html');
  await page.locator('#sign-in').click();
  await expect(page.locator('#user-name')).toHaveText('Test User');
  await page.locator('.views [data-view="todos"]').click();
  await addForm(page).locator('.todo-group-input').fill('Sinag');
  await addForm(page).locator('.todo-note-input').fill('Pay the invoice');
  await addForm(page).locator('.todo-file-input').setInputFiles([{ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 invoice') }]);
  await page.locator('#page-todos .todo-add').click();
  await expect(rows(page).first().locator('.todo-file-name')).toHaveText('invoice.pdf');

  const docs = await page.evaluate(() => window.__fake.dump());
  const todo = Object.entries(docs).find(([path]) => path.startsWith('users/user-1/todos/'))[1];
  expect(todo).toMatchObject({ title: '', note: 'Pay the invoice', group: 'Sinag' });
  expect(todo.attachments).toHaveLength(1);
  expect(Object.keys(todo.attachments[0]).sort()).toEqual(['id', 'name', 'size', 'type']);
  const id = todo.attachments[0].id;
  expect(docs[`users/user-1/todoFiles/${id}`]).toMatchObject({ name: 'invoice.pdf', chunks: 1 });
  expect(docs[`users/user-1/todoFiles/${id}/chunks/0000`].data.length).toBeGreaterThan(0);

  page.once('dialog', dialog => dialog.accept());
  await rows(page).first().locator('.todo-delete').click();
  await expect(rows(page)).toHaveCount(0);
  await expect.poll(async () => Object.keys(await page.evaluate(() => window.__fake.dump())).filter(path => path.includes('/todoFiles/'))).toEqual([]);
});
