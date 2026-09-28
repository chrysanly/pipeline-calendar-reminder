// Regression spec for the bug where the modal was permanently on screen:
// `.modal { display: grid }` outranked the browser's `[hidden] { display: none }`,
// so `closeModal()` set the attribute but nothing moved.
// These assertions use toBeHidden/toBeVisible, i.e. *computed* visibility.

import { test, expect } from './fixtures.mjs';
import { openApp, fillForm, todayKey } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('modal is not visible on load', async ({ page }) => {
  await expect(page.locator('#modal')).toBeHidden();
});

test('banner is not visible on load', async ({ page }) => {
  await expect(page.locator('#banner')).toBeHidden();
});

test('+ New reminder opens the modal prefilled for the selected day', async ({ page }) => {
  await page.locator('#add-event').click();

  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('New reminder');
  await expect(page.locator('#event-form [name="date"]')).toHaveValue(todayKey());
});

for (const [label, close] of [
  ['Cancel', page => page.locator('#modal-cancel').click()],
  ['the close button', page => page.locator('#modal-close').click()],
  ['the Escape key', page => page.keyboard.press('Escape')],
  ['a backdrop click', page => page.locator('#modal .modal-backdrop').click({ position: { x: 5, y: 5 } })]
]) {
  test(`${label} hides the modal`, async ({ page }) => {
    await page.locator('#add-event').click();
    await expect(page.locator('#modal')).toBeVisible();

    await close(page);
    await expect(page.locator('#modal')).toBeHidden();
  });
}

test('the modal can be reopened after being closed', async ({ page }) => {
  await page.locator('#add-event').click();
  await page.locator('#modal-cancel').click();
  await expect(page.locator('#modal')).toBeHidden();

  await page.locator('#add-event').click();
  await expect(page.locator('#modal')).toBeVisible();
});

test('a closed modal does not swallow clicks on the page behind it', async ({ page }) => {
  await page.locator('#add-event').click();
  await page.locator('#modal-cancel').click();

  // Would time out if the invisible modal overlay were still covering the grid.
  await page.locator('#grid .day').nth(8).click();
  await expect(page.locator('#grid .day').nth(8)).toHaveClass(/is-selected/);
});

test('submitting an empty title keeps the modal open and reports the error', async ({ page }) => {
  await page.locator('#add-event').click();
  await fillForm(page, { title: '' });
  await page.locator('#event-form button[type="submit"]').click();

  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#form-error')).toHaveText('Title is required.');
});

test('closing the modal returns focus to the trigger', async ({ page }) => {
  await page.locator('#add-event').click();
  await page.locator('#modal-cancel').click();

  await expect(page.locator('#add-event')).toBeFocused();
});
