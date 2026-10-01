// Shared helpers for the browser specs.

import { expect } from '@playwright/test';

export const STORAGE_KEY = 'client-calendar.events.v1';

/** Today's date as the app writes it: local YYYY-MM-DD. */
export function todayKey(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Load the app in local mode with an empty store and notifications stubbed out.
 * Opens in Month view (these specs are about the calendar); pass {view: null}
 * for a true first visit, which lands on the Home dashboard.
 */
export async function openApp(page, url = '/index.html?backend=local', { view = 'month' } = {}) {
  await page.addInitScript(({ key, view }) => {
    // Init scripts re-run on every navigation; clear only on the first load so
    // reload specs can still observe what was persisted.
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.removeItem(key);
      if (view) localStorage.setItem('view', view);
      else localStorage.removeItem('view');
      sessionStorage.setItem('__test_reset', '1');
    }
    // Notification prompts would block the run; answer them silently.
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { key: STORAGE_KEY, view });
  await page.goto(url);
  await page.waitForSelector(view ? '#grid .day' : '#dashboard');
}

/** Fill the reminder form. Only the given fields are touched. */
export async function fillForm(page, fields) {
  const form = page.locator('#event-form');
  if (fields.title !== undefined) await form.locator('[name="title"]').fill(fields.title);
  if (fields.clientName !== undefined) await form.locator('[name="clientName"]').fill(fields.clientName);
  if (fields.date !== undefined) await form.locator('[name="date"]').fill(fields.date);
  if (fields.time !== undefined) await form.locator('[name="time"]').fill(fields.time);
  if (fields.notes !== undefined) await form.locator('[name="notes"]').fill(fields.notes);
  if (fields.reminderMinutesBefore !== undefined) {
    await form.locator('[name="reminderMinutesBefore"]').selectOption(String(fields.reminderMinutesBefore));
  }
}

/**
 * Switch view the way a user would: Day/Week/Month live in the calendar's own
 * toolbar, so from another page open Calendar in the top nav first.
 */
export async function goToView(page, view, action = 'click') {
  const button = page.locator(`#view-${view}`);
  if (['day', 'week', 'month'].includes(view) && !(await button.isVisible())) {
    await page.locator('#view-calendar')[action]();
  }
  if (view === 'history') await openAccountMenu(page);
  await button[action]();
}

/** Open the profile dropdown (History, theme, Settings, Sign out) if it is closed. */
export async function openAccountMenu(page) {
  const menu = page.locator('#account-menu');
  if (await menu.isVisible()) return;
  await page.locator('#account-btn').click();
  await expect(menu).toBeVisible();
}

/**
 * Wait until an Excel import has finished. The toast shows "Importing…" (busy)
 * as soon as the file is picked, so its visibility alone does not mean done:
 * wait for the summary or the error in a toast that is no longer busy.
 */
export async function waitForImport(page) {
  await expect(page.locator('#banner:not(.is-busy):visible #banner-title')).toHaveText(/^(Imported|Import failed)/);
}

const centre = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Mouse drag from the middle of `from` to `to` ({x, y} or a locator), in small steps. */
export async function mouseDrag(page, from, to, { fromPoint } = {}) {
  const start = fromPoint || centre(await from.boundingBox());
  const end = typeof to.boundingBox === 'function' ? centre(await to.boundingBox()) : to;
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 6, start.y + 6, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/**
 * Touch drag as a finger does it: press, hold past the long-press delay
 * (js/drag.js), then move and lift. Pointer events with pointerType 'touch'.
 */
export async function touchDrag(page, from, to, { fromPoint, hold = 260 } = {}) {
  const start = fromPoint || centre(await from.boundingBox());
  const end = typeof to.boundingBox === 'function' ? centre(await to.boundingBox()) : to;
  const fire = (type, point) => page.evaluate(({ type, point }) => {
    const target = document.elementFromPoint(point.x, point.y) || document.body;
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true,
      clientX: point.x, clientY: point.y, button: 0, buttons: type === 'pointerup' ? 0 : 1
    }));
  }, { type, point });
  await fire('pointerdown', start);
  await page.waitForTimeout(hold);
  for (let i = 1; i <= 8; i++) {
    await fire('pointermove', { x: start.x + ((end.x - start.x) * i) / 8, y: start.y + ((end.y - start.y) * i) / 8 });
    await page.waitForTimeout(20);
  }
  await fire('pointerup', end);
}
