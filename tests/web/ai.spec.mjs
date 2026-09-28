// AI panel on the Client page (js/views/ai-panel.js) and status alerts
// (js/notify.js), with the Worker mocked. Local mode, so the Worker access
// token from the panel is used.

import { test, expect } from './fixtures.mjs';

const WORKER = 'https://w.example.workers.dev';
const KEYS = { events: 'client-calendar.events.v1', settings: 'client-calendar.settings.v1', tasks: 'client-calendar.tasks.v1' };
const EVENTS = [
  { id: 'e1', title: 'Renewal call', clientName: 'Acme Ltd.', status: 'lead', date: '2026-10-05', time: '14:30', notes: '', reminderMinutesBefore: 0, notified: false, updatedAt: '2026-09-20T08:00:00.000Z' },
  { id: 'e2', title: 'Visit', clientName: 'Falcon Trading', status: 'potential', date: '2026-10-06', time: '10:00', notes: '', reminderMinutesBefore: 0, notified: false, updatedAt: '2026-09-20T08:00:00.000Z' }
];

/** Answers for each Worker path; returns the requests the app made. */
async function mockWorker(page, answers) {
  const requests = [];
  await page.route(`${WORKER}/**`, async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    requests.push({ path, headers: req.headers(), body: req.postData(), contentType: req.headers()['content-type'] || '' });
    const [status, data] = answers[path] || [404, { error: 'Not found.' }];
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return requests;
}

async function openPanel(page, { workerUrl = WORKER, token = 'local-token', view = 'client', viewport, notifications = 'granted', mic = false } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  if (viewport) await page.setViewportSize(viewport);
  await page.addInitScript(({ keys, events, workerUrl, token, view, notifications, mic }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem('view', view);
      localStorage.setItem('cladflo.client.v1', 'Acme Ltd.');
      localStorage.setItem(keys.events, JSON.stringify(events));
      localStorage.setItem(keys.settings, JSON.stringify(workerUrl ? [{ id: 'app', workerUrl }] : []));
      if (token) localStorage.setItem('cladflo.worker-token.v1', token);
      sessionStorage.setItem('__test_reset', '1');
    }
    window.__notes = [];
    window.Notification = class {
      static permission = notifications;
      static requestPermission() { return Promise.resolve(notifications); }
      constructor(title, options) { window.__notes.push({ title, body: options.body }); }
    };
    if (mic) {
      // A fake microphone: MediaRecorder hands back a small webm blob on stop.
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() { window.__micStopped = true; } }] });
      window.MediaRecorder = class extends EventTarget {
        constructor() { super(); this.mimeType = 'audio/webm'; }
        start() { this.state = 'recording'; }
        stop() {
          const data = new Event('dataavailable');
          data.data = new Blob([new Uint8Array(2048)], { type: 'audio/webm' });
          this.dispatchEvent(data);
          this.dispatchEvent(new Event('stop'));
        }
      };
    }
  }, { keys: KEYS, events: EVENTS, workerUrl, token, view, notifications, mic });
  await page.goto('/index.html?backend=local');
  if (view === 'client') await expect(page.locator('.ai-panel')).toBeVisible();
  return errors;
}

const panel = page => page.locator('.ai-panel');
const stored = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]'), key);

test('the panel sits on the Client page; without a Worker URL it points to Settings', async ({ page }) => {
  const errors = await openPanel(page, { workerUrl: '' });
  await expect(panel(page).locator('.dash-title')).toHaveText('AI assistant');
  await expect(panel(page).locator('.ai-setup')).toContainText('Set your Worker URL in Settings → Business');
  await panel(page).getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.locator('#settings')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Find action items: sends the notes with the access token, then adds the chosen ones as tasks', async ({ page }) => {
  const requests = await mockWorker(page, {
    '/ai/actions': [200, { summary: 'Agreed the scope.', actionItems: [
      { task: 'Send proposal', owner: 'Anna', due: '2026-10-01' }, { task: 'Book workshop', owner: '', due: 'next week' }, { task: 'Skip me', owner: '', due: '' }
    ] }]
  });
  await openPanel(page);
  await expect(panel(page).locator('.ai-setup')).toBeHidden();
  await panel(page).getByRole('button', { name: 'Find action items' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Paste notes or a transcript first.');
  expect(requests).toEqual([]);

  await panel(page).getByLabel('Notes or transcript').fill('Anna sends the proposal by 1 Oct. Workshop next week.');
  await panel(page).getByRole('button', { name: 'Find action items' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Found 3 action items.');
  await expect(panel(page).locator('.ai-summary')).toHaveText('Agreed the scope.');
  await expect(panel(page).locator('.ai-item .ai-check')).toHaveText(['Send proposal', 'Book workshop', 'Skip me']);
  expect(requests[0].headers['x-app-token']).toBe('local-token');
  expect(JSON.parse(requests[0].body)).toEqual({ text: 'Anna sends the proposal by 1 Oct. Workshop next week.', client: 'Acme Ltd.' });

  await panel(page).getByLabel('Skip me').uncheck();
  await panel(page).getByRole('button', { name: 'Add selected as tasks' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Added 2 tasks.');
  await expect(page.locator('.client-tasks .task-text')).toHaveText(['Send proposal', 'Book workshop']);
  const tasks = await stored(page, KEYS.tasks);
  expect(tasks.map(t => [t.task, t.owner, t.due, t.source])).toEqual([['Send proposal', 'Anna', '2026-10-01', 'ai'], ['Book workshop', '', '', 'ai']]);

  await panel(page).getByRole('button', { name: 'Add selected as tasks' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Added 0 tasks (2 already on the list).');
});

test('Draft follow-up email: editable subject and body, Copy, and an Open in email link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const requests = await mockWorker(page, { '/ai/followup': [200, { subject: 'Thanks for today', body: 'Hi Anna,\n\nThanks for the kickoff.' }] });
  await openPanel(page);
  await panel(page).getByLabel('Notes or transcript').fill('Kickoff went well.');
  await panel(page).getByLabel('Email tone').selectOption('formal');
  await panel(page).getByRole('button', { name: 'Draft follow-up email' }).click();
  await expect(panel(page).getByLabel('Subject')).toHaveValue('Thanks for today');
  await expect(panel(page).getByLabel('Email', { exact: true })).toHaveValue('Hi Anna,\n\nThanks for the kickoff.');
  expect(JSON.parse(requests[0].body)).toMatchObject({ client: 'Acme Ltd.', tone: 'formal', text: 'Kickoff went well.' });

  await panel(page).getByLabel('Subject').fill('Thank you');
  await expect(panel(page).getByRole('link', { name: 'Open in email' })).toHaveAttribute('href', 'mailto:?subject=Thank%20you&body=Hi%20Anna%2C%0A%0AThanks%20for%20the%20kickoff.');
  await panel(page).getByRole('button', { name: 'Copy' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Email copied.');
  // The Windows clipboard hands text back with CRLF line ends.
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe('Subject: Thank you\n\nHi Anna,\n\nThanks for the kickoff.');
});

test('Upload audio: an audio file is transcribed into the notes; other files are refused without a request', async ({ page }) => {
  const requests = await mockWorker(page, { '/ai/transcribe': [200, { text: 'We agreed on the budget.' }] });
  await openPanel(page);
  const file = panel(page).locator('input[type="file"]');
  await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(panel(page).locator('.ai-status')).toContainText('not an audio file');
  expect(requests).toEqual([]);
  await panel(page).getByLabel('Notes or transcript').fill('My notes.');
  await file.setInputFiles({ name: 'meeting.m4a', mimeType: 'audio/mp4', buffer: Buffer.alloc(4096) });
  await expect(panel(page).locator('.ai-status')).toHaveText('Transcript added below your notes.');
  await expect(panel(page).getByLabel('Notes or transcript')).toHaveValue('My notes.\n\nWe agreed on the budget.');
  expect(requests[0].contentType).toContain('multipart/form-data');
});

test('Record: the mic recording is transcribed on Stop and the microphone is released', async ({ page }) => {
  const requests = await mockWorker(page, { '/ai/transcribe': [200, { text: 'Recorded words.' }] });
  await openPanel(page, { mic: true });
  const record = panel(page).locator('.ai-record');
  await record.click();
  await expect(record).toHaveText('Stop recording');
  await expect(record).toHaveAttribute('aria-pressed', 'true');
  await expect(panel(page).locator('.ai-clock')).not.toHaveText('');
  await record.click();
  await expect(panel(page).getByLabel('Notes or transcript')).toHaveValue('Recorded words.');
  await expect(record).toHaveText('Record');
  expect(await page.evaluate(() => window.__micStopped)).toBe(true);
  expect(requests.map(r => r.path)).toEqual(['/ai/transcribe']);
});

test('Worker errors are shown in the panel: rate limit, rejected token, unreachable', async ({ page }) => {
  await mockWorker(page, { '/ai/actions': [429, { error: 'Too many requests. Try again in 40 s.' }] });
  await openPanel(page);
  await panel(page).getByLabel('Notes or transcript').fill('notes');
  await panel(page).getByRole('button', { name: 'Find action items' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Too many requests. Try again in 40 s.');
  await expect(panel(page).locator('.ai-status')).toHaveClass(/is-error/);
  await page.unroute(`${WORKER}/**`);
  await page.route(`${WORKER}/**`, route => route.abort());
  await panel(page).getByRole('button', { name: 'Find action items' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Could not reach the Worker. Check the Worker URL and your connection.');
});

test('without sign-in or a saved token, the panel asks for the access token; saving it works', async ({ page }) => {
  const requests = await mockWorker(page, { '/ai/actions': [200, { summary: '', actionItems: [] }] });
  await openPanel(page, { token: '' });
  await panel(page).getByLabel('Notes or transcript').fill('notes');
  await panel(page).getByRole('button', { name: 'Find action items' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Sign in, or save the Worker access token in the AI panel.');
  await panel(page).locator('.ai-settings summary').click();
  await panel(page).getByLabel('Worker access token (only without sign-in)').fill('fresh-token');
  await panel(page).getByRole('button', { name: 'Save token' }).click();
  await expect(panel(page).locator('.ai-status')).toHaveText('Access token saved in this browser.');
  await panel(page).getByRole('button', { name: 'Find action items' }).click();
  await expect(panel(page).locator('.ai-item-list')).toHaveText('No clear action items in these notes.');
  expect(requests[0].headers['x-app-token']).toBe('fresh-token');
});

test('status alerts: moving a client on the Board shows a notification and emails through /notify', async ({ page }) => {
  const requests = await mockWorker(page, { '/notify': [202, { sent: true }] });
  await openPanel(page);
  await panel(page).locator('.ai-settings summary').click();
  await panel(page).getByLabel('Email me (through the Worker)').check();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('cladflo.alerts.v1')))).toEqual({ browser: true, email: true, statuses: ['active', 'inactive'] });

  await page.locator('#view-board').click();
  await page.getByLabel('Stage for Acme Ltd.').selectOption('potential'); // not a chosen status: no alert
  await page.getByLabel('Stage for Acme Ltd.').selectOption('active');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].path).toBe('/notify');
  expect(JSON.parse(requests[0].body)).toEqual({ subject: 'Acme Ltd. is now Active', text: 'Acme Ltd. moved from Potential to Active.' });
  expect(await page.evaluate(() => window.__notes)).toEqual([{ title: 'Acme Ltd. is now Active', body: 'Acme Ltd. moved from Potential to Active.' }]);
});

test('a failed email alert says so in the banner', async ({ page }) => {
  await mockWorker(page, { '/notify': [503, { error: 'Email alerts are not set up on the Worker.' }] });
  await openPanel(page);
  await panel(page).locator('.ai-settings summary').click();
  await panel(page).getByLabel('Email me (through the Worker)').check();
  await page.locator('#view-board').click();
  await page.getByLabel('Stage for Falcon Trading').selectOption('inactive');
  await expect(page.locator('#banner-title')).toHaveText('Email alert not sent');
  await expect(page.locator('#banner-body')).toHaveText('Email alerts are not set up on the Worker.');
});

test('phone: the panel fits 390px and its controls are at least 44px tall', async ({ page }) => {
  await openPanel(page, { viewport: { width: 390, height: 844 } });
  await panel(page).locator('.ai-settings summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const control of await panel(page).locator('button:visible, textarea:visible, select:visible, summary, input[type="password"]').all()) {
    const box = await control.boundingBox();
    expect(box.height, await control.evaluate(n => n.outerHTML.slice(0, 70))).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
});
