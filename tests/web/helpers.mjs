// Shared helpers for the browser specs.

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
  await button[action]();
}
