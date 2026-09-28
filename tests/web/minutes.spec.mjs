// Minutes view against a mocked Groq (page.route): generate, edit, save, copy,
// delete, the 3-part flow and a 429 that succeeds on retry. Local mode.

import { test, expect } from './fixtures.mjs';
import { openApp, goToView } from './helpers.mjs';

const KEY = 'gsk_test_0123456789abcd';
const MINUTES = {
  title: 'Renewal kickoff',
  date: '2026-09-28',
  attendees: ['Anna', 'Omar'],
  summary: 'Acme agreed to renew for 12 months.',
  decisions: ['Renew for 12 months'],
  actionItems: [{ task: 'Send the contract', owner: 'Anna', due: '2026-10-01' }]
};

const groqReply = content => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });

/**
 * Mock Groq: JSON requests get MINUTES, notes requests get "notes N".
 * `first` optionally answers the very first request instead (e.g. a 429).
 */
async function mockGroq(page, { first = null, holdSecond = null } = {}) {
  const requests = [];
  await page.route('**/api.groq.com/**', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (first && requests.length === 1) return route.fulfill(first);
    if (holdSecond && requests.length === 2) await holdSecond;
    return route.fulfill(groqReply(body.response_format ? JSON.stringify(MINUTES) : `notes ${requests.length}`));
  });
  return requests;
}

async function open(page, { key = KEY } = {}) {
  await page.addInitScript(key => {
    if (key && !sessionStorage.getItem('__key_set')) {
      localStorage.setItem('cladflo.groq-key.v1', key);
      sessionStorage.setItem('__key_set', '1');
    }
  }, key);
  await openApp(page);
  await page.keyboard.press('n');
  await expect(page.locator('#minutes')).toBeVisible();
  page.on('dialog', dialog => dialog.accept());
}

async function generate(page, transcript, client = 'Acme Ltd.') {
  await page.locator('#minutes-client').fill(client);
  await page.locator('#minutes-date').fill('2026-09-28');
  await page.locator('#minutes-transcript').fill(transcript);
  await page.locator('#minutes-generate').click();
  await expect(page.locator('#minutes-editor')).toBeVisible();
}

const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), key);

test('the Minutes button and the N key open the view; the calendar is hidden', async ({ page }) => {
  await open(page);
  await expect(page.locator('#view-minutes')).toHaveClass(/is-active/);
  await expect(page.locator('.calendar')).toBeHidden();
  await expect(page.locator('.nav')).toBeHidden();
  await goToView(page, 'month');
  await expect(page.locator('#minutes')).toBeHidden();
  await page.locator('#view-minutes').click();
  await expect(page.locator('#minutes')).toBeVisible();
  await expect(page.locator('#saved-minutes')).toContainText('No saved minutes yet.');
});

test('with no key, Generate asks for one and opens AI settings; nothing is sent', async ({ page }) => {
  const requests = await mockGroq(page);
  await open(page, { key: '' });
  await page.locator('#minutes-transcript').fill('Anna: hello');
  await page.locator('#minutes-generate').click();
  await expect(page.locator('#minutes-progress')).toContainText('Groq API key in AI settings');
  await page.locator('#minutes-open-settings').click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#groq-key')).toBeFocused();
  expect(requests).toHaveLength(0);
});

test('generate, edit and save: minutes only (no transcript), listed under the client, logged', async ({ page }) => {
  const requests = await mockGroq(page);
  await open(page);
  await generate(page, 'Anna: Shall we renew?\nOmar: Yes, 12 months.');
  expect(requests).toHaveLength(1);
  expect(requests[0].model).toBe('llama-3.3-70b-versatile');
  expect(requests[0].messages[1].content).toContain('Client: Acme Ltd.');
  await expect(page.locator('#minutes-progress')).toContainText('Done');

  const form = page.locator('#minutes-edit');
  await expect(form.locator('[name="title"]')).toHaveValue('Renewal kickoff');
  await expect(form.locator('[name="attendees"]')).toHaveValue('Anna, Omar');
  await expect(form.locator('[name="actionItems"]')).toHaveValue('Send the contract | Anna | 2026-10-01');
  await form.locator('[name="title"]').fill('Renewal kickoff (edited)');
  await form.locator('[name="decisions"]').fill('Renew for 12 months\n5% discount');
  await page.locator('#minutes-save').click();

  await expect(page.locator('#minutes-editor')).toBeHidden();
  await expect(page.locator('#minutes-transcript')).toHaveValue('');
  const group = page.locator('.saved-group[data-client="Acme Ltd."]');
  await expect(group.locator('.saved-title')).toHaveText(['Renewal kickoff (edited)']);
  await expect(page.locator('#saved-count')).toHaveText('(1)');

  const [meeting] = await stored(page, 'client-calendar.meetings.v1');
  expect(meeting.clientName).toBe('Acme Ltd.');
  expect(meeting.decisions).toEqual(['Renew for 12 months', '5% discount']);
  expect(JSON.stringify(meeting)).not.toContain('Shall we renew');

  await page.keyboard.press('l');
  await expect(page.locator('#history-list .history-item').first()).toHaveAttribute('data-action', 'minutes');
  await expect(page.locator('#history-list .history-item').first()).toContainText('Renewal kickoff (edited)');
});

test('a 3-part transcript: notes per part with "Part x of 3" progress, then one merge', async ({ page }) => {
  // Part 2's reply waits until the test has seen "Part 2 of 3…".
  let release;
  const requests = await mockGroq(page, { holdSecond: new Promise(resolve => { release = resolve; }) });
  await open(page);
  const line = i => `${i % 2 ? 'Omar' : 'Anna'}: ${'we talked about the renewal terms and the price '.repeat(4).trim()} (${i})`;
  const transcript = Array.from({ length: 150 }, (_, i) => line(i)).join('\n');
  expect(transcript.length).toBeGreaterThan(24000);
  expect(transcript.length).toBeLessThan(36000);

  await page.locator('#minutes-transcript').fill(transcript);
  await page.locator('#minutes-generate').click();
  await expect(page.locator('#minutes-progress')).toHaveText('Part 2 of 3…');
  await expect(page.locator('#minutes-generate')).toBeDisabled();
  release();
  await expect(page.locator('#minutes-editor')).toBeVisible();
  await expect(page.locator('#minutes-generate')).toBeEnabled();

  expect(requests).toHaveLength(4);
  expect(requests.map(r => Boolean(r.response_format))).toEqual([false, false, false, true]);
  expect(requests[2].messages[1].content).toContain('Transcript part 3 of 3');
  expect(requests[3].messages[1].content).toContain('Part 1:\nnotes 1');
});

test('a 429 from Groq is retried after retry-after, then the minutes come through', async ({ page }) => {
  const requests = await mockGroq(page, {
    first: { status: 429, headers: { 'retry-after': '1' }, contentType: 'application/json', body: '{"error":{"message":"Rate limit reached"}}' }
  });
  await open(page);
  await generate(page, 'Anna: Short call.');
  expect(requests).toHaveLength(2);
  await expect(page.locator('#minutes-edit [name="title"]')).toHaveValue('Renewal kickoff');
});

test('a bad key stops with "Key not valid" and offers AI settings', async ({ page }) => {
  await page.route('**/api.groq.com/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await open(page);
  await page.locator('#minutes-transcript').fill('Anna: hi');
  await page.locator('#minutes-generate').click();
  await expect(page.locator('#minutes-progress')).toContainText('Key not valid');
  await expect(page.locator('#minutes-open-settings')).toBeVisible();
  await expect(page.locator('#minutes-editor')).toBeHidden();
});

test('import a .vtt transcript; other files are refused', async ({ page }) => {
  await open(page);
  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Anna>Welcome to the call</v>\n\n2\n00:00:03.000 --> 00:00:05.000\n<v Omar>Thanks Anna</v>\n';
  await page.locator('#minutes-file').setInputFiles({ name: 'call.vtt', mimeType: 'text/vtt', buffer: Buffer.from(vtt) });
  await expect(page.locator('#minutes-transcript')).toHaveValue('Anna: Welcome to the call\nOmar: Thanks Anna');
  await expect(page.locator('#minutes-file-info')).toHaveText('call.vtt: 8 words, speakers: Anna, Omar.');

  await page.locator('#minutes-file').setInputFiles({ name: 'deck.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
  await expect(page.locator('#minutes-progress')).toContainText('not a transcript');
});

test('saved minutes: Copy puts the text on the clipboard; Delete removes them and is logged', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockGroq(page);
  await open(page);
  await generate(page, 'Anna: Shall we renew?');
  await page.locator('#minutes-save').click();

  const item = page.locator('.saved-item').first();
  await item.locator('.saved-copy').click();
  await expect(page.locator('#banner-title')).toHaveText('Minutes copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Renewal kickoff');
  expect(copied).toContain('- Send the contract (Anna), due 2026-10-01');

  await item.locator('.saved-delete').click();
  await expect(page.locator('.saved-item')).toHaveCount(0);
  expect(await stored(page, 'client-calendar.meetings.v1')).toEqual([]);
  await page.keyboard.press('l');
  await expect(page.locator('#history-list .history-item').first()).toContainText('Deleted minutes');
});
