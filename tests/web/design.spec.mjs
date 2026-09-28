// Design checks at phone, tablet and desktop widths: no sideways scrolling,
// 44px touch targets, AA contrast on primary buttons and a visible focus ring.
// Full-page screenshots for review land in test-results/design/.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY, goToView } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, '..', '..', 'test-results', 'design');

const WIDTHS = [375, 768, 1280];
const VIEWS = ['dashboard', 'day', 'week', 'month', 'minutes', 'history'];
const THEMES = ['light', 'dark'];

// Sun 27 Sep 2026, 10:00. Seeded reminders are later that day, so none pop up.
const NOW = new Date(2026, 8, 27, 10, 0, 0);
const SEED = [
  { id: 'a', title: 'Renewal call', clientName: 'Acme Ltd.', date: '2026-09-27', time: '14:30', status: 'active', city: 'Dubai', country: 'United Arab Emirates' },
  { id: 'b', title: 'Site visit', clientName: 'Falcon Trading', date: '2026-09-27', time: '16:00', status: 'potential', city: 'Abu Dhabi', country: 'United Arab Emirates' },
  { id: 'c', title: 'Intro meeting', clientName: 'Palm Holdings', date: '2026-09-28', time: '11:00', status: 'lead', city: 'Sharjah', country: 'United Arab Emirates' },
  { id: 'd', title: 'Budget sign-off', clientName: 'Oasis Group', date: '2026-09-29', time: '09:00', status: 'inactive', city: 'Riyadh', country: 'Saudi Arabia' }
].map(e => ({ notes: 'Discuss terms', phone: '+971 4 123 4567', reminderMinutesBefore: 0, notified: false, ...e }));

async function open(page, { width, theme = 'light', view = 'dashboard' }) {
  await page.setViewportSize({ width, height: width < 640 ? 812 : 900 });
  await page.clock.install({ time: NOW });
  await page.addInitScript(({ key, events, theme }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(events));
      localStorage.setItem('view', 'dashboard');
      localStorage.setItem('theme', theme);
      sessionStorage.setItem('__test_reset', '1');
    }
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { key: STORAGE_KEY, events: SEED, theme });
  await page.goto('/index.html?backend=local');
  await page.waitForSelector('#dashboard');
  if (view !== 'dashboard') await goToView(page, view);
  await expect(page.locator(`#view-${view}`)).toHaveClass(/is-active/);
}

/** Every visible control outside the calendar cells is at least 44×44. */
function smallControls(page) {
  return page.evaluate(() => {
    const sel = 'button, select, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea';
    return [...document.querySelectorAll(sel)]
      .filter(n => !n.closest('#grid, #day-agenda, .modal, #panel'))
      .filter(n => {
        const r = n.getBoundingClientRect();
        return r.width && r.height && getComputedStyle(n).visibility !== 'hidden';
      })
      .map(n => ({ n, r: n.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 43.5 || r.height < 43.5)
      .map(({ n, r }) => `${n.id || n.getAttribute('aria-label') || n.name || n.textContent.trim()} is ${Math.round(r.width)}×${Math.round(r.height)}`);
  });
}

/** WCAG contrast ratio between the text colour and background of a node. */
function contrastOf(locator) {
  return locator.evaluate(n => {
    const rgb = c => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const s = getComputedStyle(n);
    const [a, b] = [lum(rgb(s.color)), lum(rgb(s.backgroundColor))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
}

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    for (const view of VIEWS) {
      test(`${view} at ${width}px, ${theme}: no sideways scroll, 44px controls`, async ({ page }) => {
        await open(page, { width, theme, view });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
        expect(await smallControls(page)).toEqual([]);
        await page.screenshot({ path: join(shots, `${width}-${theme}-${view}.png`), fullPage: true });
      });
    }

    test(`primary and secondary buttons at ${width}px, ${theme} meet AA contrast`, async ({ page }) => {
      await open(page, { width, theme });
      // Home's Import Excel is the pink secondary button.
      expect(await contrastOf(page.locator('#import-btn'))).toBeGreaterThanOrEqual(4.5);
      await goToView(page, 'month');
      const primaries = page.locator('button.primary:visible');
      expect(await primaries.count()).toBeGreaterThan(0);
      for (const button of await primaries.all()) {
        expect(await contrastOf(button)).toBeGreaterThanOrEqual(4.5);
      }
      await page.locator('#add-event').click();
      const save = page.locator('#event-form button[type="submit"]');
      await expect(save).toBeVisible();
      expect(await contrastOf(save)).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: join(shots, `${width}-${theme}-form.png`) });
    });
  }

  test(`keyboard focus is clearly visible at ${width}px`, async ({ page }) => {
    await open(page, { width });
    const rings = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      rings.push(await page.evaluate(() => {
        const n = document.activeElement;
        const s = getComputedStyle(n);
        const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
        return { name: n.id || n.tagName, visible: outline || s.boxShadow !== 'none' };
      }));
    }
    expect(rings.filter(r => !r.visible)).toEqual([]);
  });
}
