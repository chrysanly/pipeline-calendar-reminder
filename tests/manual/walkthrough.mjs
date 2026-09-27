// QA walkthrough against the running dev server (npm start → :8000), real CDN,
// real clock, local mode. Prints PASS/FAIL per check and saves screenshots to
// test-results/walkthrough/. Run with: node tests/manual/walkthrough.mjs
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:8000/index.html?backend=local';
const out = 'test-results/walkthrough';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`); };
const counts = page => page.$$eval('.status-card', cards => Object.fromEntries(cards.map(c => [c.dataset.status, Number(c.querySelector('.status-count').textContent)])));
const names = page => page.$$eval('.client-row:not(.client-head) .client-name', ns => ns.map(n => n.textContent.trim()));
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', d => d.accept());

await page.goto(BASE);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#dashboard', { state: 'visible' });

// 1. No heart, Home is default
check('no heart on Home', (await page.locator('.fa-heart').count()) === 0);
check('Home is the default view', await page.locator('#view-dashboard').evaluate(n => n.classList.contains('is-active')));
check('counts start at 0', JSON.stringify(await counts(page)) === JSON.stringify({ lead: 0, potential: 0, active: 0, inactive: 0 }), JSON.stringify(await counts(page)));

// 2. Phone lookup in an empty form
await page.locator('#add-event').click();
const form = page.locator('#event-form');
await form.locator('[name="phone"]').fill('+971 4 555 1234');
await page.waitForTimeout(200);
check('+971 4… gives Dubai', (await form.locator('[name="city"]').inputValue()) === 'Dubai', await form.locator('[name="city"]').inputValue());
check('+971 4… gives UAE', (await form.locator('[name="country"]').inputValue()) === 'United Arab Emirates', await form.locator('[name="country"]').inputValue());
await form.locator('[name="phone"]').fill('0501234567');
await page.waitForTimeout(200);
const city = await form.locator('[name="city"]').inputValue();
const country = await form.locator('[name="country"]').inputValue();
check('0501234567 gives UAE', country === 'United Arab Emirates', country);
check('0501234567 gives no city', city === '', `city is "${city}"`);

// 3. Add a reminder, then edit its status
await form.locator('[name="title"]').fill('QA intro call');
await form.locator('[name="clientName"]').fill('QA Client');
await form.locator('[name="date"]').fill(today);
await form.locator('[name="time"]').fill('23:30');
await form.locator('button[type="submit"]').click();
await page.locator('#modal').waitFor({ state: 'hidden' });
let c = await counts(page);
check('new reminder counts as a Lead', c.lead === 1 && c.potential + c.active + c.inactive === 0, JSON.stringify(c));
await page.locator('.client-name', { hasText: 'QA Client' }).click();
await page.locator('#day-events .link', { hasText: 'Edit' }).click();
await form.locator('[name="status"]').selectOption('active');
await form.locator('button[type="submit"]').click();
await page.locator('#modal').waitFor({ state: 'hidden' });
if (await page.locator('#panel').isVisible()) await page.locator('#panel-close').click();
c = await counts(page);
check('editing status to Active moves the count', c.active === 1 && c.lead === 0, JSON.stringify(c));

// 4. Second reminder for the same client, then change status in place
await page.locator('#add-event').click();
await form.locator('[name="title"]').fill('QA follow-up');
await form.locator('[name="clientName"]').fill('qa client');
await form.locator('[name="title"]').focus();
await form.locator('[name="date"]').fill(today);
await form.locator('[name="time"]').fill('23:45');
check('known client brings in its status', (await form.locator('[name="status"]').inputValue()) === 'active', await form.locator('[name="status"]').inputValue());
await form.locator('button[type="submit"]').click();
await page.locator('#modal').waitFor({ state: 'hidden' });
await page.locator('.client-row[data-client="QA Client"] .client-status').selectOption('inactive');
const stored = await page.evaluate(() => Object.values(localStorage).map(v => { try { return JSON.parse(v); } catch { return null; } }).find(Array.isArray) || []);
const qa = stored.filter(e => (e.clientName || '').toLowerCase() === 'qa client');
check('dashboard status change updates every reminder of the client', qa.length === 2 && qa.every(e => e.status === 'inactive'), JSON.stringify(qa.map(e => e.status)));
c = await counts(page);
check('counts follow the in-place change', c.inactive === 1 && c.active === 0, JSON.stringify(c));

// 5. Import the sample file
const chooser = page.waitForEvent('filechooser');
await page.locator('#import-btn').click();
await (await chooser).setFiles('tests/fixtures/sample.xlsx');
await page.locator('#banner').waitFor({ state: 'visible', timeout: 15000 });
const banner = (await page.locator('#banner').innerText()).replace(/\s+/g, ' ');
check('import banner reports detected locations', /locations? detected/.test(banner), banner);
check('Dubai appears in Locations', (await page.locator('.loc-city[data-city="Dubai"]').count()) > 0);
await page.screenshot({ path: `${out}/home-after-import.png`, fullPage: true });

// 6. Filters
const all = (await names(page)).length;
await page.locator('.status-card[data-status="lead"]').click();
const leads = await names(page);
check('status card filters the list', leads.length > 0 && leads.length < all && !leads.includes('QA Client'), JSON.stringify(leads));
await page.locator('.status-card[data-status="lead"]').click();
check('clicking the card again clears it', (await names(page)).length === all);
await page.locator('.loc-city[data-city="Dubai"]').first().click();
const dubai = await names(page);
check('location filters the list', dubai.length > 0 && dubai.length < all, JSON.stringify(dubai));
await page.locator('.filter-tag').first().click();
check('filter tag removes the filter', (await names(page)).length === all);

// 7. Calendar views and popups still work
for (const view of ['day', 'week', 'month']) {
  await page.locator(`#view-${view}`).click();
  const label = (await page.locator('#month-label').innerText()).trim();
  check(`${view} view renders with a label`, (await page.locator('.calendar').isVisible()) && label && label !== '—', label);
}
check('no heart on the calendar', (await page.locator('.fa-heart').count()) === 0);
await page.locator('#next').click();
await page.locator('#prev').click();
await page.locator('#today').click();
const chip = page.locator(`#grid .day[data-key="${today}"] .chip-title`).first();
await chip.click();
check('chip opens the details panel', await page.locator('#panel').isVisible());
check('panel shows a status badge', (await page.locator('#panel .status-badge').count()) > 0);
await page.screenshot({ path: `${out}/month-panel.png` });
await page.keyboard.press('Escape');
await page.locator('#add-event').click();
check('New reminder opens the modal', await page.locator('#modal').isVisible());
await page.locator('#modal-cancel').click();
check('Cancel closes the modal', await page.locator('#modal').isHidden());
await page.locator('#theme-toggle, [aria-label*="theme" i]').first().click();
await page.locator('#view-dashboard').click();
await page.screenshot({ path: `${out}/home-dark.png`, fullPage: true });

check('no console or script errors', errors.length === 0, JSON.stringify(errors));
await page.evaluate(() => localStorage.clear());
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
