// Minutes, History and Settings on phones and tablets (the mobile, small and
// tablet projects). Groq is mocked. Screenshots land in test-results/mobile/.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shotName = name => join(here, '..', '..', 'test-results', 'mobile', `${test.info().project.name}-${name}.png`);

const MINUTES = {
  title: 'Renewal kickoff with a fairly long title for a small screen',
  date: '2026-09-28',
  attendees: ['Anna', 'Omar'],
  summary: 'Acme agreed to renew for 12 months.',
  decisions: ['Renew for 12 months'],
  actionItems: [{ task: 'Send the contract', owner: 'Anna', due: '2026-10-01' }]
};

/** No sideways scroll; every visible control in `scope` is ≥44×44 and within the screen's width. */
async function expectFits(page, scope) {
  const report = await page.evaluate(scope => {
    const problems = [];
    // The phone nav with 5+ pages scrolls sideways, so its later buttons may sit past the edge.
    const inScroller = node => {
      for (let p = node.parentElement; p; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const controls = [...document.querySelectorAll(`${scope} button, ${scope} input:not([type="file"]), ${scope} select, ${scope} textarea, .topbar button`)];
    for (const node of controls) {
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = node.id || node.getAttribute('aria-label') || node.name || node.textContent.trim();
      if ((r.left < -0.5 || r.right > innerWidth + 0.5) && !inScroller(node)) problems.push(`${name} is off screen sideways`);
      if (r.width < 43.5 || r.height < 43.5) problems.push(`${name} is only ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return { problems, scrollWidth: document.documentElement.scrollWidth, innerWidth, checked: controls.length };
  }, scope);
  expect(report.scrollWidth, 'page scrolls sideways').toBeLessThanOrEqual(report.innerWidth);
  expect(report.problems).toEqual([]);
  expect(report.checked).toBeGreaterThan(5);
}

async function open(page) {
  await page.addInitScript(() => localStorage.setItem('cladflo.groq-key.v1', 'gsk_test_0123456789abcd'));
  await page.route('**/api.groq.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(MINUTES) } }] })
  }));
  await openApp(page);
}

test('every view and the gear fit the top bar (Minutes has no button)', async ({ page }) => {
  await open(page);
  await expect(page.locator('#view-minutes')).toHaveCount(0);
  for (const view of ['dashboard', 'day', 'week', 'month', 'history']) {
    await expect(page.locator(`#view-${view}`)).toBeVisible();
  }
  await expect(page.locator('#settings-btn')).toBeVisible();
  await expectFits(page, '.views');
});

test('Minutes: the form, the generated minutes and the saved list fit the screen', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await open(page);
  // The client profile's Add minutes opens it; here, the saved page after a reload.
  await page.evaluate(() => localStorage.setItem('view', 'minutes'));
  await page.reload();
  await expect(page.locator('#minutes')).toBeVisible();
  await expectFits(page, '#minutes');
  if (test.info().project.name !== 'tablet') await expect(page.locator('#add-event'), 'the floating + would cover the form').toBeHidden();

  await page.locator('#minutes-client').fill('Acme Ltd.');
  await page.locator('#minutes-transcript').fill('Anna: Shall we renew?\nOmar: Yes.');
  await page.locator('#minutes-generate').click();
  await expect(page.locator('#minutes-editor')).toBeVisible();
  await expectFits(page, '#minutes');
  await page.screenshot({ path: shotName('minutes-editor'), fullPage: true });

  await page.locator('#minutes-save').click();
  await expect(page.locator('.saved-item')).toHaveCount(1);
  await expectFits(page, '#minutes');
  await page.screenshot({ path: shotName('minutes-saved'), fullPage: true });
});

test('History fits the screen with its filters', async ({ page }) => {
  await open(page);
  await page.locator('#view-history').click();
  await expect(page.locator('#history')).toBeVisible();
  await expectFits(page, '#history');
});

test('Settings fits the screen with 44px buttons', async ({ page }) => {
  await open(page);
  await page.locator('#settings-btn').click();
  await expect(page.locator('#settings')).toBeVisible();
  // Measure the dialog once its pop-in (which starts at 98% scale) has finished.
  await page.locator('#settings .modal-card').evaluate(n => Promise.all(n.getAnimations().map(a => a.finished)));
  await expectFits(page, '#settings');
  await page.screenshot({ path: shotName('settings') });
});
