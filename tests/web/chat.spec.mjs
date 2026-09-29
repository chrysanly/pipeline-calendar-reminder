// Team chat against the in-memory Firestore fake (fake-firebase.js): live
// messages, own ones on the right, sending with busy-then-result toasts, the
// 1000-character cap, Load older, the unread dot, and local mode switched off.

import { test, expect } from './fixtures.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOM = 'chat/main/messages';
const NOW = new Date(2026, 8, 29, 9, 0, 0);
const at = minutes => new Date(NOW.getTime() - minutes * 60000).toISOString();
const message = (uid, name, text, minutesAgo) => ({ uid, name, email: `${uid}@example.com`, text, at: at(minutesAgo) });

const CONFIG = { apiKey: 'fake-api-key', authDomain: 'demo-calendar.firebaseapp.com', projectId: 'demo-calendar', appId: '1:123:web:abc' };

async function openCloud(page, cloud = {}) {
  await page.clock.install({ time: NOW });
  await page.route('**/js/firebase-config.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const FIREBASE_CONFIG = ${JSON.stringify(CONFIG)};`
  }));
  await page.addInitScript({ path: join(here, 'fake-firebase.js') });
  await page.addInitScript(({ cloud }) => {
    if (!sessionStorage.getItem('__test_reset')) {
      localStorage.clear();
      localStorage.setItem('view', 'dashboard');
      sessionStorage.setItem('__test_reset', '1');
    }
    for (const [path, data] of Object.entries(cloud)) window.__fake.seed(path, data);
    window.Notification = class {
      static permission = 'denied';
      static requestPermission() { return Promise.resolve('denied'); }
    };
  }, { cloud });
  await page.goto('/index.html');
}

async function signIn(page) {
  await page.locator('#sign-in').click();
  await expect(page.locator('#user-name')).toHaveText('Test User');
}

const chatButton = page => page.locator('.views [data-view="chat"]');
const bubbles = page => page.locator('#page-chat .chat-msg');

async function recordToasts(page) {
  await page.evaluate(() => {
    window.__toasts = [];
    const title = document.querySelector('#banner-title');
    new MutationObserver(() => window.__toasts.push({
      text: title.textContent,
      busy: document.querySelector('#banner').classList.contains('is-busy')
    })).observe(title, { childList: true, characterData: true, subtree: true });
  });
}

test('signed in: the room shows live, oldest first, own messages on the right', async ({ page }) => {
  await openCloud(page, {
    [`${ROOM}/m1`]: message('anna', 'Anna', 'Morning team', 30),
    [`${ROOM}/m2`]: message('user-1', 'Test User', 'Hi Anna', 20)
  });
  await signIn(page);
  await chatButton(page).click();
  await expect(bubbles(page)).toHaveCount(2);
  await expect(bubbles(page).locator('.chat-text')).toHaveText(['Morning team', 'Hi Anna']);
  await expect(bubbles(page).nth(0)).not.toHaveClass(/is-own/);
  await expect(bubbles(page).nth(1)).toHaveClass(/is-own/);
  await expect(bubbles(page).nth(1).locator('.chat-name')).toHaveText('You');
  await expect(bubbles(page).nth(0).locator('.chat-time')).toHaveText('08:30');

  // Someone else posts: it arrives without a reload.
  await page.evaluate(({ path, data }) => window.__fake.remoteSet(path, data), { path: `${ROOM}/m3`, data: message('omar', 'Omar', 'Lunch?', 1) });
  await expect(bubbles(page)).toHaveCount(3);
  await expect(bubbles(page).last().locator('.chat-name')).toHaveText('Omar');
});

test('sending: no toast, the message just shows; stored with exactly the allowed fields; Enter sends', async ({ page }) => {
  await openCloud(page);
  await signIn(page);
  await chatButton(page).click();
  await expect(page.locator('#page-chat .chat-empty')).toHaveText('No messages yet: say hello to the team.');
  const input = page.locator('#page-chat .chat-input');
  await page.locator('.chat-send').click();
  await expect(page.locator('.chat-status')).toHaveText('Write a message or attach a file first.');

  await recordToasts(page);
  await input.fill('Proposal for Acme is out');
  await input.press('Enter');
  await expect(bubbles(page)).toHaveCount(1);
  const toasts = await page.evaluate(() => window.__toasts);
  expect(toasts, 'no toast for a sent message').toEqual([]);
  await expect(page.locator('#banner')).toBeHidden();
  await expect(input).toHaveValue('');
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubbles(page).first()).toHaveClass(/is-own/);

  const stored = await page.evaluate(room => Object.entries(window.__fake.dump()).filter(([p]) => p.startsWith(room)).map(([, d]) => d), ROOM);
  expect(stored).toHaveLength(1);
  expect(Object.keys(stored[0]).sort()).toEqual(['at', 'email', 'name', 'text', 'uid']);
  expect(stored[0]).toMatchObject({ uid: 'user-1', name: 'Test User', email: 'test@example.com', text: 'Proposal for Acme is out' });

  // Shift+Enter is a new line, not a send.
  await input.fill('line one');
  await input.press('Shift+Enter');
  await expect(bubbles(page)).toHaveCount(1);
});

test('over 1000 characters is refused before sending; a refused write says why', async ({ page }) => {
  await openCloud(page);
  await signIn(page);
  await chatButton(page).click();
  const input = page.locator('#page-chat .chat-input');
  await input.fill('x'.repeat(1001));
  await expect(page.locator('.chat-counter')).toHaveText('1001/1000');
  await expect(page.locator('.chat-counter')).toHaveClass(/is-over/);
  await page.locator('.chat-send').click();
  await expect(page.locator('.chat-status')).toContainText('under 1,000 characters');
  expect(await page.evaluate(() => window.__fake.appWrites().filter(w => w.path.startsWith('chat/main/messages')).length)).toBe(0);

  await page.evaluate(() => { window.__fakeHold = { denyWrites: true }; });
  await input.fill('Hello?');
  await page.locator('.chat-send').click();
  await expect(page.locator('.chat-status')).toHaveText('Not sent: Your email isn’t on the CladFlo Talk list, or the CladFlo Talk rules aren’t deployed yet.');
  await expect(input).toHaveValue('Hello?');
});

test('the newest 100 show first; Load older brings the rest', async ({ page }) => {
  const cloud = {};
  for (let i = 0; i < 130; i++) cloud[`${ROOM}/m${String(i).padStart(3, '0')}`] = message('anna', 'Anna', `Message ${i}`, 200 - i);
  await openCloud(page, cloud);
  await signIn(page);
  await chatButton(page).click();
  await expect(bubbles(page)).toHaveCount(100);
  await expect(bubbles(page).first().locator('.chat-text')).toHaveText('Message 30');
  await expect(bubbles(page).last().locator('.chat-text')).toHaveText('Message 129');
  await page.locator('.chat-older').click();
  await expect(bubbles(page)).toHaveCount(130);
  await expect(bubbles(page).first().locator('.chat-text')).toHaveText('Message 0');
  await expect(page.locator('.chat-older')).toBeHidden();
});

test('the unread dot counts messages from others while the chat is closed', async ({ page }) => {
  await openCloud(page, { [`${ROOM}/m1`]: message('anna', 'Anna', 'Morning', 10) });
  await signIn(page);
  const dot = chatButton(page).locator('.chat-dot');
  await expect(dot).toHaveText('1');
  await chatButton(page).click();
  await expect(dot).toBeHidden();
  await page.locator('#view-dashboard').click();
  await page.evaluate(({ path, data }) => window.__fake.remoteSet(path, data), { path: `${ROOM}/m2`, data: message('omar', 'Omar', 'Call at 3?', 1) });
  await expect(dot).toHaveText('1');
  await expect(chatButton(page)).toHaveAttribute('aria-label', 'CladFlo Talk, 1 unread');
  await chatButton(page).click();
  await expect(dot).toBeHidden();

  // After a reload (the fake starts over with only the seeded message) what was seen stays seen.
  await page.reload();
  await signIn(page);
  await expect(page.locator('.views [data-view="chat"] .chat-dot')).toBeHidden();
});

test('signed out it asks you to sign in; in local mode chat is off and says so', async ({ page }) => {
  await openCloud(page);
  await chatButton(page).click();
  await expect(page.locator('#page-chat .chat-notice')).toHaveText('Sign in to use CladFlo Talk with your team.');
  await expect(page.locator('#page-chat .chat-card')).toBeHidden();
});

test('local mode: Chat is off with a message', async ({ page }) => {
  await openApp(page, undefined, { view: null });
  await chatButton(page).click();
  await expect(page.locator('#page-chat .chat-notice')).toContainText('off in local mode: the page was opened with ?backend=local, or Firebase could not load');
  await expect(page.locator('#page-chat .chat-card')).toBeHidden();
});

test('two people: one sends, the other sees it (not as own) and replies; both see both', async ({ page }) => {
  await openCloud(page);
  await signIn(page);
  await chatButton(page).click();
  const input = page.locator('#page-chat .chat-input');
  await input.fill('Hi love, testing the chat');
  await input.press('Enter');
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubbles(page).first()).toHaveClass(/is-own/);

  // The other person signs in (same room, other account).
  await page.evaluate(() => window.__fake.setUser({ uid: 'user-2', displayName: 'Joyce', email: 'palmajoyceann@gmail.com' }));
  await expect(page.locator('#user-name')).toHaveText('Joyce');
  await expect(bubbles(page)).toHaveCount(1);
  await expect(bubbles(page).first()).not.toHaveClass(/is-own/);
  await expect(bubbles(page).first().locator('.chat-name')).toHaveText('Test User');
  await input.fill('Got it!');
  await input.press('Enter');
  await expect(bubbles(page)).toHaveCount(2);
  await expect(bubbles(page).last()).toHaveClass(/is-own/);

  // Back as the first person: the reply is there, from Joyce.
  await page.evaluate(() => window.__fake.setUser({ uid: 'user-1', displayName: 'Test User', email: 'test@example.com' }));
  await expect(page.locator('#user-name')).toHaveText('Test User');
  await expect(bubbles(page).locator('.chat-name')).toHaveText(['You', 'Joyce']);
  const stored = await page.evaluate(room => Object.entries(window.__fake.dump()).filter(([p]) => p.startsWith(room)).map(([, d]) => [d.uid, d.email]), ROOM);
  expect(stored.sort()).toEqual([['user-1', 'test@example.com'], ['user-2', 'palmajoyceann@gmail.com']]);
});

test('when the rules refuse to read the chat, the page says why and who is signed in', async ({ page }) => {
  await openCloud(page);
  await page.evaluate(() => { window.__fakeHold = { denyChatReads: true }; });
  await signIn(page);
  await chatButton(page).click();
  await expect(page.locator('#page-chat .chat-notice')).toHaveText(
    'Could not load CladFlo Talk. Your email isn’t on the CladFlo Talk list, or the CladFlo Talk rules aren’t deployed yet. Signed in as test@example.com.');
});

test('offline, a send gives up and says Firestore can’t be reached', async ({ page, context }) => {
  await openCloud(page);
  await signIn(page);
  await chatButton(page).click();
  await context.setOffline(true);
  const input = page.locator('#page-chat .chat-input');
  await input.fill('Anyone there?');
  await page.locator('.chat-send').click();
  await expect(page.locator('.chat-status')).toHaveText('Not sent: Can’t reach Firestore. Check your connection, then try again.');
  await context.setOffline(false);
});

test('reply to a message: the bar says to whom, the reply shows a quote, tapping the quote goes to the original', async ({ page }) => {
  await openCloud(page, {
    [`${ROOM}/m1`]: message('anna', 'Joyce Ann Palma', 'Can you send the Acme proposal?', 30),
    [`${ROOM}/m2`]: message('anna', 'Joyce Ann Palma', 'Also lunch at 1?', 20)
  });
  await signIn(page);
  await chatButton(page).click();
  const first = bubbles(page).filter({ hasText: 'Acme proposal' });
  await first.locator('.chat-reply-btn').click();
  const bar = page.locator('#page-chat .chat-reply-bar');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.chat-reply-name')).toHaveText('Replying to Joyce Ann Palma');
  await expect(bar.locator('.chat-reply-snippet')).toHaveText('Can you send the Acme proposal?');
  await expect(page.locator('#page-chat .chat-input')).toBeFocused();

  // Cancel, then reply again and send.
  await bar.locator('.chat-reply-cancel').click();
  await expect(bar).toBeHidden();
  await first.locator('.chat-reply-btn').click();
  await page.locator('#page-chat .chat-input').fill('Sent it just now');
  await page.locator('#page-chat .chat-input').press('Enter');
  await expect(bubbles(page)).toHaveCount(3);
  await expect(bar).toBeHidden();
  const reply = bubbles(page).last();
  await expect(reply.locator('.chat-quote-name')).toHaveText('Joyce Ann Palma');
  await expect(reply.locator('.chat-quote-text')).toHaveText('Can you send the Acme proposal?');
  const stored = await page.evaluate(room => Object.entries(window.__fake.dump()).filter(([p]) => p.startsWith(room)).map(([, d]) => d).find(d => d.text === 'Sent it just now'), ROOM);
  expect(stored.replyTo).toEqual({ id: 'm1', name: 'Joyce Ann Palma', snippet: 'Can you send the Acme proposal?' });

  await reply.locator('.chat-quote').click();
  await expect(page.locator('#page-chat .chat-msg[data-id="m1"]')).toHaveClass(/is-highlight/);
});

test('a quote of an older message loads older pages until it shows; a missing one says so', async ({ page }) => {
  const cloud = {};
  for (let i = 0; i < 130; i++) cloud[`${ROOM}/m${String(i).padStart(3, '0')}`] = message('anna', 'Anna', `Message ${i}`, 300 - i);
  // The newest message answers Message 2, which is not in the first 100.
  cloud[`${ROOM}/m999`] = { ...message('anna', 'Anna', 'About that one', 1), replyTo: { id: 'm002', name: 'Anna', snippet: 'Message 2' } };
  cloud[`${ROOM}/m998`] = { ...message('anna', 'Anna', 'About a lost one', 2), replyTo: { id: 'gone', name: 'Anna', snippet: 'Deleted' } };
  await openCloud(page, cloud);
  await signIn(page);
  await chatButton(page).click();
  await expect(bubbles(page)).toHaveCount(100);
  await bubbles(page).filter({ hasText: 'About that one' }).locator('.chat-quote').click();
  await expect(page.locator('#page-chat .chat-msg[data-id="m002"]')).toHaveClass(/is-highlight/);
  await expect(bubbles(page)).toHaveCount(132);

  await bubbles(page).filter({ hasText: 'About a lost one' }).locator('.chat-quote').click();
  await expect(page.locator('#banner-title')).toHaveText('That message is no longer available');
});
