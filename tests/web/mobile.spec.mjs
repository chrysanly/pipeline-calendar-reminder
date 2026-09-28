// Phone and tablet layout. Runs in the `mobile` (390×844), `small` (360×740)
// and `tablet` (768×1024) projects only; see playwright.config.mjs.
// Screenshots for review land in test-results/mobile/.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY, fillForm } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, '..', '..', 'test-results', 'mobile');

// Sun 27 Sep 2026, 10:00. Seeded reminders are later that day, so none pop up.
const NOW = new Date(2026, 8, 27, 10, 0, 0);
const SEED = [
  { id: 'a', title: 'Renewal call', clientName: 'Acme Ltd.', date: '2026-09-27', time: '14:30', status: 'active', phone: '+971 4 123 4567', city: 'Dubai', country: 'United Arab Emirates' },
  { id: 'b', title: 'Site visit', clientName: 'Falcon Trading', date: '2026-09-27', time: '16:00', status: 'potential', phone: '02 555 1234', city: 'Abu Dhabi', country: 'United Arab Emirates' },
  { id: 'c', title: 'Quarterly review with a very long title that must be cut off', clientName: 'Palm Holdings', date: '2026-09-27', time: '17:00' },
  { id: 'd', title: 'Budget sign-off', clientName: 'Oasis Group', date: '2026-09-29', time: '09:00', status: 'inactive', phone: '+966 11 234 5678', city: 'Riyadh', country: 'Saudi Arabia' }
].map(e => ({ notes: 'Discuss terms', reminderMinutesBefore: 0, notified: false, ...e }));

const isPhone = () => test.info().project.name !== 'tablet';
const shotName = name => join(shots, `${test.info().project.name}-${name}.png`);

async function open(page, { view = 'month', theme = 'light', events = SEED } = {}) {
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ key, events, view, theme }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(events));
      localStorage.setItem('view', view);
      localStorage.setItem('theme', theme);
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { key: STORAGE_KEY, events, view, theme });
  await page.goto('/index.html?backend=local');
  await page.waitForSelector(view === 'dashboard' ? '#dashboard' : '#grid .day');
}

/**
 * No sideways page scroll, and every visible control is ≥44×44.
 * Fixed chrome (top bar, + button) must be fully on screen. Page content (the
 * dashboard) may sit below the fold, and may only go past the sides inside
 * its own horizontally scrolling row (the locations).
 */
async function expectTouchFriendly(page) {
  const report = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const problems = [];
    const inScroller = node => {
      for (let p = node.parentElement; p; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const buttons = [...document.querySelectorAll('.topbar button, #add-event, #prompt-sign-in, .dashboard button, .dashboard select, #client-search')];
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') continue; // not shown
      const name = b.id || b.getAttribute('aria-label') || b.textContent.trim();
      const content = Boolean(b.closest('.dashboard'));
      const offSides = (r.left < -0.5 || r.right > vw + 0.5) && !(content && inScroller(b));
      const offTopBottom = !content && (r.top < -0.5 || r.bottom > vh + 0.5);
      if (offSides || offTopBottom) {
        problems.push(`${name} is off screen (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.right)},${Math.round(r.bottom)})`);
      }
      if (r.width < 43.5 || r.height < 43.5) problems.push(`${name} is only ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return {
      problems,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: vw,
      checked: buttons.length
    };
  });
  expect(report.scrollWidth, 'page scrolls sideways').toBeLessThanOrEqual(report.innerWidth);
  expect(report.problems).toEqual([]);
  expect(report.checked).toBeGreaterThan(3);
}

const rectOf = locator => locator.evaluate(n => {
  const r = n.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight };
});

/** Wait until a sliding sheet or modal has landed. */
const settle = locator => locator.evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));

/** Open a reminder's details the way a user would on this screen size. */
async function openDetails(page, title) {
  if (isPhone()) {
    await page.locator('#grid .day[data-key="2026-09-27"]').tap();
    await page.locator('#day-agenda .chip-title', { hasText: title }).tap();
  } else {
    await page.locator('#grid .day[data-key="2026-09-27"] .chip-title', { hasText: title }).tap();
  }
  await expect(page.locator('#panel')).toBeVisible();
  // Measure where the sheet ends up, not mid-slide.
  await page.locator('#panel').evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));
}

async function swipe(page, fromX, toX, dy = 0) {
  const calendar = page.locator('.calendar');
  const y = 420;
  const init = { pointerType: 'touch', isPrimary: true, pointerId: 1, bubbles: true };
  await calendar.dispatchEvent('pointerdown', { ...init, clientX: fromX, clientY: y });
  await calendar.dispatchEvent('pointerup', { ...init, clientX: toX, clientY: y + dy });
}

// ---------- every view, both themes ----------

for (const theme of ['light', 'dark']) {
  for (const view of ['dashboard', 'day', 'week', 'month']) {
    test(`${view} view, ${theme}: fits the screen with 44px buttons`, async ({ page }) => {
      await open(page, { view, theme });
      await expect(page.locator(`#view-${view}`)).toHaveClass(/is-active/);
      await expectTouchFriendly(page);
      await page.screenshot({ path: shotName(`${view}-${theme}`) });
    });
  }
}

test('the brand logo fits the top bar without sideways scrolling', async ({ page }) => {
  await open(page, { view: 'dashboard' });
  const logo = page.locator('.brand .brand-logo');
  await expect(logo).toBeVisible();
  const r = await rectOf(logo);
  expect(Math.round(r.width)).toBe(isPhone() ? 28 : 34);
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(r.vw);
  // Logo and name stay on one line, clear of the icon buttons.
  const brand = await rectOf(page.locator('.brand'));
  const firstButton = await rectOf(page.locator('#theme-toggle'));
  expect(brand.right).toBeLessThanOrEqual(firstButton.left);
  expect(brand.height).toBeLessThan(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(r.vw);
});

test('signed-out screen fits the screen with a full-width sign-in button', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await page.route('**/js/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'export const FIREBASE_CONFIG = {"apiKey":"fake","projectId":"demo-calendar","appId":"1:1:web:1"};'
  }));
  await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  await page.goto('/index.html');
  await expect(page.locator('#signed-out')).toBeVisible();
  await expect(page.locator('#sign-in')).toBeVisible();

  await expectTouchFriendly(page);
  if (isPhone()) {
    const card = await rectOf(page.locator('#signed-out'));
    const button = await rectOf(page.locator('#prompt-sign-in'));
    expect(button.width).toBeGreaterThan(card.width - 40);
  }
  await page.screenshot({ path: shotName('signed-out') });
});

test('tablet: the top bar fits in at most 2 rows', async ({ page }) => {
  test.skip(isPhone(), 'tablet layout only');
  await open(page);
  const rows = await page.locator('.topbar').evaluate(bar => {
    const tops = [...bar.querySelectorAll('button, h1, #month-label')]
      .map(n => n.getBoundingClientRect())
      .filter(r => r.width && r.height)
      .map(r => Math.round(r.top + r.height / 2));
    // Group centres that sit within 12px of each other into one row.
    return tops.sort((a, b) => a - b).reduce((acc, y) => (acc.length && y - acc[acc.length - 1] < 12 ? acc : [...acc, y]), []).length;
  });
  expect(rows).toBeLessThanOrEqual(2);
});

// ---------- new reminder ----------

test('New reminder: the button opens a form that fits, and Save works', async ({ page }) => {
  await open(page, { events: [] });
  const add = page.locator('#add-event');

  if (isPhone()) {
    // A round floating button in the bottom-right corner.
    expect(await add.evaluate(n => getComputedStyle(n).position)).toBe('fixed');
    const r = await rectOf(add);
    expect(Math.round(r.width)).toBe(56);
    expect(Math.round(r.height)).toBe(56);
    expect(r.vw - r.right).toBeLessThan(32);
    expect(r.vh - r.bottom).toBeLessThan(40);
    // The page leaves room below the last reminder for it.
    const pad = await page.locator('.layout').evaluate(n => parseFloat(getComputedStyle(n).paddingBottom));
    expect(pad).toBeGreaterThanOrEqual(r.height + 16);
  }

  await add.tap();
  await expect(page.locator('#modal')).toBeVisible();
  await settle(page.locator('#modal .modal-card'));
  const card = await rectOf(page.locator('#modal .modal-card'));
  expect(card.left).toBeGreaterThanOrEqual(0);
  expect(card.top).toBeGreaterThanOrEqual(0);
  expect(card.right).toBeLessThanOrEqual(card.vw + 0.5);
  expect(card.bottom).toBeLessThanOrEqual(card.vh + 0.5);
  if (isPhone()) expect(Math.round(card.height)).toBe(card.vh); // full screen

  const save = page.locator('#event-form button[type="submit"]');
  await expect(save).toBeInViewport();
  await expect(page.locator('#modal-cancel')).toBeInViewport();

  // 16px or more, so iOS does not zoom in on focus.
  const sizes = await page.locator('#event-form input:not([type="hidden"]), #event-form select, #event-form textarea')
    .evaluateAll(nodes => nodes.map(n => parseFloat(getComputedStyle(n).fontSize)));
  expect(sizes.length).toBe(11); // title, client, status, phone, location, city, country, date, time, remind, notes
  for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);

  await page.screenshot({ path: shotName('form') });

  await fillForm(page, { title: 'Call from phone', clientName: 'Mobile Co.', time: '15:00' });
  await save.tap();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#grid .day[data-key="2026-09-27"] .chip-title')).toHaveText(['Call from phone']);
});

test('form on phones: date and time stack, Cancel/Save stay pinned at the bottom', async ({ page }) => {
  test.skip(!isPhone(), 'phone layout only');
  await open(page, { events: [] });
  await page.locator('#add-event').tap();
  await settle(page.locator('#modal .modal-card'));

  const date = await rectOf(page.locator('#event-form [name="date"]'));
  const time = await rectOf(page.locator('#event-form [name="time"]'));
  expect(time.top).toBeGreaterThan(date.bottom - 1);

  // Scroll the form to the top: the actions are still on screen at the bottom.
  await page.locator('#modal .modal-card').evaluate(n => { n.scrollTop = 0; });
  const actions = await rectOf(page.locator('.modal-actions'));
  expect(actions.bottom).toBeGreaterThan(actions.vh - 2);
  expect(actions.width).toBeGreaterThan(actions.vw - 2);
});

// ---------- month grid ----------

test('month: 7 columns with outside days, tapping a day shows its reminders', async ({ page }) => {
  await open(page);

  const columns = await page.locator('#grid').evaluate(n => getComputedStyle(n).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(7);
  await expect(page.locator('#grid .day')).toHaveCount(42);
  await expect(page.locator('#grid .day.is-outside').first()).toBeVisible();

  const busy = page.locator('#grid .day[data-key="2026-09-27"]');
  if (isPhone()) {
    // Two one-line titles, then a one-line "+1".
    await expect(busy.locator('.chip')).toHaveCount(2);
    await expect(busy.locator('.more')).toHaveText('+1');
    const more = await rectOf(busy.locator('.more'));
    expect(more.height).toBeLessThan(20);
    const title = busy.locator('.chip-title').first();
    expect(await title.evaluate(n => getComputedStyle(n).textOverflow)).toBe('ellipsis');
  } else {
    await expect(page.locator('#day-agenda')).toBeHidden();
  }

  await page.locator('#grid .day[data-key="2026-09-29"]').tap({ position: { x: 6, y: 6 } });
  await expect(page.locator('#grid .day[data-key="2026-09-29"]')).toHaveClass(/is-selected/);

  if (isPhone()) {
    const agenda = page.locator('#day-agenda');
    await expect(agenda).toBeVisible();
    await expect(agenda.locator('.agenda-label')).toHaveText('Tue, 29 September 2026');
    await expect(agenda.locator('.chip-title')).toHaveText(['Budget sign-off']);
    await expect(agenda.locator('.chip-client')).toHaveText(['Oasis Group']);
    await expect(agenda.locator('.chip-time')).toHaveText(['09:00']);
    await expect(page.locator('#panel')).toBeHidden();
    await page.screenshot({ path: shotName('agenda'), fullPage: true });

    // The busy day: a long title is clamped to 2 lines with an ellipsis, and
    // scrolled to the bottom the last reminder clears the floating + button.
    await page.locator('#grid .day[data-key="2026-09-27"]').tap();
    const long = agenda.locator('.chip-title', { hasText: 'Quarterly review' });
    const clamp = await long.evaluate(n => {
      const s = getComputedStyle(n);
      return { lines: s.webkitLineClamp, height: n.getBoundingClientRect().height, line: parseFloat(s.lineHeight) || 20 };
    });
    expect(clamp.lines).toBe('2');
    expect(clamp.height).toBeLessThanOrEqual(clamp.line * 2 + 1);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await rectOf(agenda.locator('.chip').last());
    const add = await rectOf(page.locator('#add-event'));
    expect(last.bottom).toBeLessThanOrEqual(add.top);
    await page.screenshot({ path: shotName('agenda-bottom') });
  } else {
    await expect(page.locator('#day-agenda')).toBeHidden();
    const cell = page.locator('#grid .day[data-key="2026-09-29"]');
    await expect(cell.locator('.chip-title')).toHaveText(['Budget sign-off']);
    await expect(cell.locator('.chip-client')).toHaveText(['Oasis Group']);
  }
});

test('week view: every day shows its reminders with title and client', async ({ page }) => {
  await open(page, { view: 'week' });
  await expect(page.locator('#grid .day')).toHaveCount(7);
  const sunday = page.locator('#grid .day[data-key="2026-09-27"]');
  await expect(sunday.locator('.chip-title')).toHaveText([
    'Renewal call', 'Site visit', 'Quarterly review with a very long title that must be cut off'
  ]);
  await expect(sunday.locator('.chip-client')).toHaveText(['Acme Ltd.', 'Falcon Trading', 'Palm Holdings']);
  if (isPhone()) {
    // A vertical list: each day under the previous one, labelled with its name.
    const first = await rectOf(sunday);
    const second = await rectOf(page.locator('#grid .day[data-key="2026-09-28"]'));
    expect(second.top).toBeGreaterThan(first.bottom - 1);
    await expect(sunday.locator('.day-name')).toHaveText('Sun');
    await expect(sunday.locator('.day-name')).toBeVisible();
    // The date sits right under the day name, not in the middle of a tall day.
    const name = await rectOf(sunday.locator('.day-name'));
    const number = await rectOf(sunday.locator('.day-number'));
    expect(number.top - name.bottom).toBeLessThan(12);
  }
});

// ---------- details panel ----------

test('tapping a title opens the details sheet on screen; backdrop and ✕ close it', async ({ page }) => {
  await open(page);
  await openDetails(page, 'Renewal call');

  const panel = await rectOf(page.locator('#panel'));
  expect(panel.left).toBeGreaterThanOrEqual(-0.5);
  expect(panel.right).toBeLessThanOrEqual(panel.vw + 0.5);
  expect(panel.top).toBeGreaterThanOrEqual(-0.5);
  expect(panel.bottom).toBeLessThanOrEqual(panel.vh + 0.5);
  if (isPhone()) {
    // A bottom sheet: full width, flush with the bottom, at most 85% tall.
    expect(Math.round(panel.width)).toBe(panel.vw);
    expect(Math.round(panel.bottom)).toBe(panel.vh);
    expect(panel.height).toBeLessThanOrEqual(panel.vh * 0.85 + 1);
  } else {
    // A 380px side sheet on the right.
    expect(Math.round(panel.width)).toBe(380);
    expect(Math.round(panel.right)).toBe(panel.vw);
  }
  await expect(page.locator('#panel-backdrop')).toBeVisible();
  await expect(page.locator('#day-events .event-title')).toHaveText('Renewal call');
  await expect(page.locator('#day-events .event-client')).toHaveText('Acme Ltd.');

  // Edit and Delete are real 44px buttons, and the page behind does not scroll.
  for (const label of ['Edit', 'Delete']) {
    const r = await rectOf(page.locator('#day-events .link', { hasText: label }));
    expect(r.height).toBeGreaterThanOrEqual(43.5);
  }
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  await page.screenshot({ path: shotName('sheet') });

  await page.locator('#panel-backdrop').tap({ position: { x: 10, y: 10 } });
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#panel-backdrop')).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');

  await openDetails(page, 'Renewal call');
  await page.locator('#panel-close').tap();
  await expect(page.locator('#panel')).toBeHidden();
});

test('Edit from the sheet opens the form on top of it', async ({ page }) => {
  await open(page);
  await openDetails(page, 'Renewal call');
  await page.locator('#day-events .link', { hasText: 'Edit' }).tap();
  await expect(page.locator('#modal-title')).toHaveText('Edit reminder');
  await expect(page.locator('#event-form button[type="submit"]')).toBeInViewport();
  // The form, not the sheet, receives the tap.
  await page.locator('#modal-cancel').tap();
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#panel')).toBeVisible();
});

test('the sheet does not slide in when reduced motion is preferred', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await openDetails(page, 'Renewal call');
  expect(await page.locator('#panel').evaluate(n => getComputedStyle(n).animationName)).toBe('none');
});

// ---------- gestures and import ----------

test('swiping left and right moves to the next and previous month', async ({ page }) => {
  await open(page);
  const label = page.locator('#month-label');
  await expect(label).toHaveText('September 2026');

  await swipe(page, 300, 120);
  await expect(label).toHaveText('October 2026');
  await swipe(page, 60, 260);
  await swipe(page, 60, 260);
  await expect(label).toHaveText('August 2026');

  // A mostly vertical drag is a scroll, and a short one is a tap: no change.
  await swipe(page, 200, 120, 120);
  await swipe(page, 200, 170);
  await expect(label).toHaveText('August 2026');
});

test('swiping in day view moves by one day', async ({ page }) => {
  await open(page, { view: 'day' });
  await swipe(page, 300, 100);
  await expect(page.locator('#month-label')).toHaveText('Mon, 28 Sep 2026');
});

test('Import sits on Home; tapping it opens the file chooser', async ({ page }) => {
  await open(page, { view: 'dashboard' });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#import-btn').tap();
  expect((await chooser).isMultiple()).toBe(false);
});

test('the banner fits the screen and its close button is 44px', async ({ page }) => {
  await open(page);
  // A due reminder: create one for now so the real popup path shows the banner.
  await page.locator('#add-event').tap();
  await fillForm(page, { title: 'Due now', time: '10:00', reminderMinutesBefore: 0 });
  await page.locator('#event-form button[type="submit"]').tap();

  const banner = page.locator('#banner');
  await expect(banner).toContainText('Hey you have a Due now');
  const r = await rectOf(banner);
  expect(r.left).toBeGreaterThanOrEqual(0);
  expect(r.right).toBeLessThanOrEqual(r.vw);
  const close = await rectOf(page.locator('#banner-close'));
  expect(close.width).toBeGreaterThanOrEqual(43.5);
  expect(close.height).toBeGreaterThanOrEqual(43.5);
  await page.screenshot({ path: shotName('banner') });
});

// ---------- Home dashboard ----------

test('dashboard: status cards, a location row and client cards that fit the screen', async ({ page }) => {
  await open(page, { view: 'dashboard' });
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page.locator('.nav')).toBeHidden();

  const cards = page.locator('.status-card');
  await expect(cards).toHaveCount(4);
  await expect(cards.locator('.status-count')).toHaveText(['1', '1', '1', '1']);
  const rects = await cards.evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().toJSON()));
  if (isPhone()) {
    // 2×2: two cards per row.
    expect(Math.round(rects[0].top)).toBe(Math.round(rects[1].top));
    expect(rects[2].top).toBeGreaterThan(rects[0].bottom - 1);
    // Locations scroll sideways inside their own row; the page does not.
    const row = await page.locator('#location-list').evaluate(n => ({
      overflowX: getComputedStyle(n).overflowX, wraps: getComputedStyle(n).flexWrap
    }));
    expect(row).toEqual({ overflowX: 'auto', wraps: 'nowrap' });
  } else {
    expect(Math.round(rects[0].top)).toBe(Math.round(rects[3].top));
  }

  // Clients are stacked cards (no table header on phones/tablets).
  await expect(page.locator('.client-head')).toBeHidden();
  const rows = page.locator('.client-row:not(.client-head)');
  await expect(rows).toHaveCount(4);
  const first = await rectOf(rows.nth(0));
  const second = await rectOf(rows.nth(1));
  expect(second.top).toBeGreaterThan(first.bottom - 1);
  expect(first.right).toBeLessThanOrEqual(first.vw);

  await expectTouchFriendly(page);
  await page.screenshot({ path: shotName('dashboard-full'), fullPage: true });
});

test('dashboard: tapping a location filters, tapping a client opens the sheet', async ({ page }) => {
  await open(page, { view: 'dashboard' });
  await page.locator('.loc-city[data-city="Riyadh"]').tap();
  await expect(page.locator('.client-row:not(.client-head) .client-name')).toHaveText(['Oasis Group']);
  await expect(page.locator('.filter-tag')).toHaveText(['Saudi Arabia', 'Riyadh']);

  await page.locator('.client-name', { hasText: 'Oasis Group' }).tap();
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#day-events .event-title')).toHaveText('Budget sign-off');
  await expect(page.locator('#day-events .event-city')).toHaveText('Riyadh');
  await page.locator('#panel').evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));
  const sheet = await rectOf(page.locator('#panel'));
  expect(sheet.bottom).toBeLessThanOrEqual(sheet.vh + 0.5);
  await page.screenshot({ path: shotName('dashboard-sheet') });
});
