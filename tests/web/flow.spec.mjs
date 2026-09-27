// Full smoke pass through the real app: create, open via the chip, edit,
// delete, persist.

import { test, expect } from './fixtures.mjs';
import { openApp, fillForm, todayKey } from './helpers.mjs';

const TODAY = todayKey();

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

async function createEvent(page, fields) {
  await page.locator('#add-event').click();
  await fillForm(page, fields);
  await page.locator('#event-form button[type="submit"]').click();
  await expect(page.locator('#modal')).toBeHidden();
}

const todayCell = page => page.locator(`#grid .day[data-key="${TODAY}"]`);

async function openChip(page, title) {
  await todayCell(page).locator('.chip-title', { hasText: title }).click();
  await expect(page.locator('#panel')).toBeVisible();
}

const FULL = {
  title: 'Follow-up call',
  clientName: 'Acme Ltd.',
  time: '14:30',
  notes: 'Discuss renewal terms',
  reminderMinutesBefore: 15
};

test('panel is hidden on load and the calendar takes the full width', async ({ page }) => {
  await expect(page.locator('#panel')).toBeHidden();
  const layout = await page.locator('.layout').boundingBox();
  const calendar = await page.locator('.calendar').boundingBox();
  expect(calendar.width).toBeGreaterThan(layout.width - 60);
});

test('create a reminder: today\'s cell shows a chip with title and client, panel stays hidden', async ({ page }) => {
  await createEvent(page, FULL);

  const chip = todayCell(page).locator('.chip');
  await expect(chip).toHaveCount(1);
  await expect(chip.locator('.chip-title')).toHaveText('Follow-up call');
  await expect(chip.locator('.chip-client')).toHaveText('Acme Ltd.');
  await expect(chip.locator('.chip-time')).toHaveText('14:30');
  await expect(chip.locator('.chip-client .fa-user')).toHaveCount(1);
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#grid .dot, #grid .badge')).toHaveCount(0);
});

test('clicking the chip title opens the panel with the details', async ({ page }) => {
  await createEvent(page, FULL);
  await openChip(page, 'Follow-up call');

  const event = page.locator('#day-events .event');
  await expect(event).toHaveCount(1);
  await expect(event.locator('.event-title')).toHaveText('Follow-up call');
  await expect(event.locator('.event-client')).toHaveText('Acme Ltd.');
  await expect(event.locator('.event-time')).toHaveText('14:30');
  await expect(event.locator('.event-notes')).toHaveText('Discuss renewal terms');
  await expect(event.locator('.event-reminder')).toHaveText('Reminder 15 min before');
});

test('clicking an empty spot on a day selects it but does not open the panel', async ({ page }) => {
  const cell = page.locator('#grid .day').nth(10);
  await cell.click({ position: { x: 8, y: 60 } });
  await expect(cell).toHaveClass(/is-selected/);
  await expect(page.locator('#panel')).toBeHidden();

  await page.locator('#add-event').click();
  await expect(page.locator('#event-form [name="date"]')).toHaveValue(await cell.getAttribute('data-key'));
});

test('the close button and Escape both close the panel', async ({ page }) => {
  await createEvent(page, FULL);

  await openChip(page, 'Follow-up call');
  await page.locator('#panel-close').click();
  await expect(page.locator('#panel')).toBeHidden();

  await openChip(page, 'Follow-up call');
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel')).toBeHidden();
});

test('month cells show at most 3 chips then "+N more", which opens day view', async ({ page }) => {
  for (const [i, time] of ['08:00', '09:00', '10:00', '11:00', '12:00'].entries()) {
    await createEvent(page, { title: `Call ${i + 1}`, time });
  }
  const cell = todayCell(page);
  await expect(cell.locator('.chip')).toHaveCount(3);
  await expect(cell.locator('.more')).toHaveText('+2 more');

  await cell.locator('.more').click();
  await expect(page.locator('#view-day')).toHaveClass(/is-active/);
  await expect(page.locator('#grid .day')).toHaveCount(1);
  await expect(page.locator('#grid .chip .chip-title')).toHaveText(['Call 1', 'Call 2', 'Call 3', 'Call 4', 'Call 5']);
});

test('Edit reopens the modal with the saved values and saves changes', async ({ page }) => {
  await createEvent(page, FULL);
  await openChip(page, 'Follow-up call');

  await page.locator('#day-events .event .link', { hasText: 'Edit' }).click();

  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('Edit reminder');
  const form = page.locator('#event-form');
  await expect(form.locator('[name="title"]')).toHaveValue('Follow-up call');
  await expect(form.locator('[name="clientName"]')).toHaveValue('Acme Ltd.');
  await expect(form.locator('[name="date"]')).toHaveValue(TODAY);
  await expect(form.locator('[name="time"]')).toHaveValue('14:30');
  await expect(form.locator('[name="notes"]')).toHaveValue('Discuss renewal terms');
  await expect(form.locator('[name="reminderMinutesBefore"]')).toHaveValue('15');

  await fillForm(page, { title: 'Renewal call', time: '16:00', reminderMinutesBefore: 30 });
  await page.locator('#event-form button[type="submit"]').click();

  await expect(page.locator('#modal')).toBeHidden();
  const event = page.locator('#day-events .event');
  await expect(event).toHaveCount(1);
  await expect(event.locator('.event-title')).toHaveText('Renewal call');
  await expect(event.locator('.event-time')).toHaveText('16:00');
  await expect(event.locator('.event-reminder')).toHaveText('Reminder 30 min before');
  await expect(todayCell(page).locator('.chip-title')).toHaveText('Renewal call');
});

test('Delete removes the reminder, its chip, and closes the panel', async ({ page }) => {
  await createEvent(page, { title: 'Follow-up call', time: '14:30' });
  await openChip(page, 'Follow-up call');

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#day-events .event .link', { hasText: 'Delete' }).click();

  await expect(page.locator('#panel')).toBeHidden();
  await expect(todayCell(page).locator('.chip')).toHaveCount(0);
});

test('surviving reminders persist across a reload', async ({ page }) => {
  await createEvent(page, { title: 'Keep me', time: '09:00' });
  await createEvent(page, { title: 'Delete me', time: '11:00' });
  await expect(todayCell(page).locator('.chip')).toHaveCount(2);

  await openChip(page, 'Delete me');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#day-events .event .link', { hasText: 'Delete' }).click();
  await expect(todayCell(page).locator('.chip')).toHaveCount(1);

  await page.reload();
  await page.waitForSelector('#grid .day');

  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(todayCell(page).locator('.chip .chip-title')).toHaveText(['Keep me']);

  await openChip(page, 'Keep me');
  await expect(page.locator('#day-events .event .event-title')).toHaveText('Keep me');
});
