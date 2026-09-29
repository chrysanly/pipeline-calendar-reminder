import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  CHAT_MAX, validateChatText, chatRecord, normalizeChatMessage, orderChat, isOwnMessage, unreadCount, latestAt, chatTime, chatPath,
  chatErrorText, withChatTimeout, CHAT_NOT_ALLOWED, CHAT_OFFLINE, CHAT_FILE_MAX, attachmentKind, validateAttachment, splitChunks,
  attachmentRecord, formatFileSize, shrinkSize, linkParts, sharedItems, presenceList, typingText, lastSeenText,
  chatInitials, avatarTone, replyRecord, replySnippet, normalizeReply, REPLY_SNIPPET_MAX
} from '../js/chat.js';

const ME = { uid: 'u1', displayName: 'Chrys', email: 'Chrys@Example.com' };
const msg = (id, uid, at, text = 'hi') => ({ id, uid, name: uid, email: '', text, at });

test('validateChatText trims, refuses blank and over 1000 characters', () => {
  assertDeepEqual(validateChatText('  hello  '), { text: 'hello', error: '' });
  assertEqual(validateChatText('   ').error, 'Write a message or attach a file first.');
  assertEqual(validateChatText('   ', true).error, '', 'a file alone is fine');
  assertEqual(validateChatText(null).error, 'Write a message or attach a file first.');
  assertEqual(validateChatText('x'.repeat(CHAT_MAX)).error, '');
  assert(/under 1,000 characters \(this one has 1,001\)/.test(validateChatText('x'.repeat(CHAT_MAX + 1)).error));
});

test('chatRecord stores exactly uid, name, email (lower case), text and at', () => {
  const record = chatRecord(ME, 'hello', new Date('2026-09-29T08:00:00Z'));
  assertDeepEqual(record, { uid: 'u1', name: 'Chrys', email: 'chrys@example.com', text: 'hello', at: '2026-09-29T08:00:00.000Z' });
  assertEqual(chatRecord({ uid: 'u2', email: 'anna@x.ae' }, 'x').name, 'anna', 'no display name: the email name');
  assertEqual(chatRecord({ uid: 'u3' }, 'x').name, 'Someone');
});

test('normalizeChatMessage drops unreadable messages and caps the text', () => {
  assertEqual(normalizeChatMessage('a', null), null);
  assertEqual(normalizeChatMessage('a', { text: '  ', at: 'x' }), null);
  assertEqual(normalizeChatMessage('a', { text: 'hi' }), null, 'no time');
  const m = normalizeChatMessage('a', { uid: 'u1', text: 'y'.repeat(2000), at: '2026-09-29T08:00:00.000Z' });
  assertEqual(m.text.length, CHAT_MAX);
  assertEqual(m.name, 'Someone');
});

test('orderChat puts the oldest first; unreadCount skips own messages and seen ones', () => {
  const list = [msg('c', 'u2', '2026-09-29T10:00:00Z'), null, msg('a', 'u1', '2026-09-29T08:00:00Z'), msg('b', 'u2', '2026-09-29T09:00:00Z')];
  assertDeepEqual(orderChat(list).map(m => m.id), ['a', 'b', 'c']);
  const ordered = orderChat(list);
  assertEqual(unreadCount(ordered, '', ME), 2);
  assertEqual(unreadCount(ordered, '2026-09-29T09:00:00Z', ME), 1);
  assertEqual(unreadCount(ordered, '2026-09-29T10:00:00Z', ME), 0);
  assertEqual(isOwnMessage(ordered[0], ME), true);
  assertEqual(isOwnMessage(ordered[0], null), false);
  assertEqual(latestAt(ordered), '2026-09-29T10:00:00Z');
  assertEqual(latestAt([], 'seen'), 'seen');
});

test('chatTime: just the time today, else the day and month too', () => {
  const now = new Date(2026, 8, 29, 18, 0);
  assertEqual(chatTime(new Date(2026, 8, 29, 9, 5).toISOString(), now), '09:05');
  assertEqual(chatTime(new Date(2026, 9, 3, 14, 30).toISOString(), now), '3 Oct, 14:30');
  assertEqual(chatTime('nonsense', now), '');
  assertDeepEqual(chatPath(), ['chat', 'main', 'messages']);
});

test('chatErrorText: permission denied, offline and expired sign-in in plain words', () => {
  assertEqual(chatErrorText({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }), CHAT_NOT_ALLOWED);
  assertEqual(chatErrorText(new Error('Missing or insufficient permissions.')), CHAT_NOT_ALLOWED);
  assertEqual(chatErrorText({ code: 'unavailable', message: 'x' }), CHAT_OFFLINE);
  assertEqual(chatErrorText({ code: 'deadline-exceeded' }), CHAT_OFFLINE);
  assertEqual(chatErrorText(new Error('Failed to get document because the client is offline.')), CHAT_OFFLINE);
  assertEqual(chatErrorText({ code: 'permission-denied' }, false), CHAT_OFFLINE, 'no connection wins');
  assertEqual(chatErrorText({ code: 'unauthenticated' }), 'Your sign-in has expired: sign out, sign in again, then retry.');
  assertEqual(chatErrorText(new Error('Quota exceeded.')), 'Quota exceeded.');
  assertEqual(chatErrorText(null), 'Something went wrong. Try again.');
  assert(CHAT_NOT_ALLOWED.includes('CladFlo Talk list') && CHAT_NOT_ALLOWED.includes('rules'));
});

const pendingChat = [];
const laterChat = (name, fn) => pendingChat.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

laterChat('withChatTimeout passes a result through, and gives up with deadline-exceeded', async () => {
  assertEqual(await withChatTimeout(Promise.resolve('ok'), 1000), 'ok');
  let error = null;
  try {
    await withChatTimeout(new Promise(() => {}), 5);
  } catch (err) {
    error = err;
  }
  assertEqual(error && error.code, 'deadline-exceeded');
  assertEqual(chatErrorText(error), CHAT_OFFLINE);
  let refused = null;
  try {
    await withChatTimeout(Promise.reject(Object.assign(new Error('no'), { code: 'permission-denied' })), 1000);
  } catch (err) {
    refused = err;
  }
  assertEqual(refused.code, 'permission-denied');
});


test('attachments: kind from the type, 10 MB cap, pieces, and messages with only a file', () => {
  assertEqual(attachmentKind('image/png'), 'image');
  assertEqual(attachmentKind('video/quicktime'), 'video');
  assertEqual(attachmentKind('application/pdf'), 'file');
  assertEqual(attachmentKind(''), 'file');
  assertEqual(validateAttachment({ name: 'a.pdf', size: 100 }), '');
  assert(validateAttachment({ name: 'big.mov', size: CHAT_FILE_MAX + 1 }).includes('up to 10 MB'));
  assertEqual(validateAttachment({ name: 'empty.txt', size: 0 }), '"empty.txt" is empty.');
  assertDeepEqual(splitChunks('abcdefg', 3), ['abc', 'def', 'g']);
  assertDeepEqual(splitChunks('', 3), ['']);
  const meta = attachmentRecord('f1', { name: 'photo.jpg', type: 'image/jpeg', size: 2048 }, 1);
  assertDeepEqual(meta, { id: 'f1', name: 'photo.jpg', type: 'image/jpeg', size: 2048, kind: 'image', chunks: 1 });
  const record = chatRecord(ME, '', new Date('2026-09-29T08:00:00Z'), meta);
  assertDeepEqual(Object.keys(record).sort(), ['at', 'attachment', 'email', 'name', 'text', 'uid']);
  const shown = normalizeChatMessage('m1', record);
  assertDeepEqual([shown.text, shown.attachment.kind], ['', 'image']);
  assertEqual(normalizeChatMessage('m2', { text: '', at: 'x' }), null, 'no text and no file: nothing to show');
  assertEqual(formatFileSize(512), '512 B');
  assertEqual(formatFileSize(2048), '2 KB');
  assertEqual(formatFileSize(3.5 * 1024 * 1024), '3.5 MB');
  assertDeepEqual(shrinkSize(4000, 3000), { width: 1600, height: 1200 });
  assertEqual(shrinkSize(800, 600), null);
});

test('links are found in the text; Shared lists media, files and links, newest first', () => {
  assertDeepEqual(linkParts('see https://a.com/x, and www.b.org!').map(p => [p.type, p.value]), [
    ['text', 'see '], ['link', 'https://a.com/x'], ['text', ', and '], ['link', 'www.b.org'], ['text', '!']
  ]);
  assertEqual(linkParts('www.b.org')[0].href, 'https://www.b.org');
  assertDeepEqual(linkParts('no links here'), [{ type: 'text', value: 'no links here' }]);
  const photo = { id: 'p', kind: 'image', name: 'p.jpg', chunks: 1 };
  const doc = { id: 'd', kind: 'file', name: 'd.pdf', chunks: 1 };
  const messages = [
    { id: '1', text: 'https://one.com', at: '1', attachment: null },
    { id: '2', text: '', at: '2', attachment: photo },
    { id: '3', text: 'contract https://two.com', at: '3', attachment: doc }
  ];
  const shared = sharedItems(messages);
  assertDeepEqual(shared.media.map(i => i.attachment.id), ['p']);
  assertDeepEqual(shared.files.map(i => i.attachment.id), ['d']);
  assertDeepEqual(shared.links.map(i => i.url), ['https://two.com', 'https://one.com']);
});

test('presence: online in the last 100 s, typing in the last 6 s; you are never "typing"', () => {
  const now = new Date('2026-09-29T10:00:00Z');
  const ago = s => new Date(now.getTime() - s * 1000).toISOString();
  const people = presenceList([
    { uid: 'u2', name: 'Joyce', email: 'j@x', lastSeen: ago(20), typingAt: ago(2) },
    { uid: 'u3', name: 'Omar', email: 'o@x', lastSeen: ago(60 * 60 * 3), typingAt: '' },
    { uid: 'u1', name: 'Chrys', email: 'c@x', lastSeen: ago(5), typingAt: ago(1) }
  ], ME, now);
  assertDeepEqual(people.map(p => [p.name, p.online, p.typing, p.self]), [
    ['Chrys', true, true, true], ['Joyce', true, true, false], ['Omar', false, false, false]
  ]);
  assertEqual(typingText(people), 'Joyce is typing…');
  assertEqual(typingText([{ name: 'A', typing: true }, { name: 'B', typing: true }]), 'A and B are typing…');
  assertEqual(typingText([]), '');
  assertEqual(lastSeenText(people[1], now), 'Online');
  assertEqual(lastSeenText(people[2], now), 'Last seen 3 h ago');
  assertEqual(lastSeenText({ online: false, lastSeen: ago(90 * 24 * 3600) }, now), 'Last seen 90 days ago');
  assertEqual(lastSeenText({ online: false, lastSeen: '' }, now), 'Offline');
});


test('avatars: initials from the name, and the same colour for the same person', () => {
  assertEqual(chatInitials('Joyce Ann Palma'), 'JP');
  assertEqual(chatInitials('chrys roma'), 'CR');
  assertEqual(chatInitials('chrys'), 'CH');
  assertEqual(chatInitials('   '), '?');
  assertEqual(avatarTone('user-1'), avatarTone('user-1'));
  assert(['potential', 'active', 'lead', 'inactive'].includes(avatarTone('anyone')));
});


test('replies: replyRecord keeps the id, the name and up to 120 characters; normalizeReply reads it back', () => {
  const original = { id: 'm1', uid: 'u2', name: 'Joyce Ann Palma', text: 'x'.repeat(200), at: '2026-09-29T08:00:00Z' };
  const reply = replyRecord(original);
  assertEqual(reply.id, 'm1');
  assertEqual(reply.name, 'Joyce Ann Palma');
  assertEqual(reply.snippet.length, REPLY_SNIPPET_MAX);
  assert(reply.snippet.endsWith('…'));
  assertEqual(replySnippet({ text: '  hello\n  there ' }), 'hello there');
  assertEqual(replySnippet({ text: '', attachment: { kind: 'image', name: 'a.jpg' } }), 'Photo: a.jpg');
  assertEqual(replySnippet({ text: '', attachment: { kind: 'file', name: 'q.pdf' } }), 'File: q.pdf');
  const record = chatRecord(ME, 'Sure!', new Date('2026-09-29T08:05:00Z'), null, reply);
  assertDeepEqual(Object.keys(record).sort(), ['at', 'email', 'name', 'replyTo', 'text', 'uid']);
  assertDeepEqual(normalizeChatMessage('m2', record).replyTo, reply);
  assertEqual(normalizeChatMessage('m3', chatRecord(ME, 'no reply')).replyTo, null);
  assertEqual(normalizeReply({ name: 'x' }), null, 'a reply needs the id it answers');
  assertEqual(normalizeReply({ id: 'm1', snippet: 'y'.repeat(300) }).snippet.length, REPLY_SNIPPET_MAX);
  assertEqual(normalizeReply({ id: 'm1' }).name, 'Someone');
});

export const chatTestsDone = Promise.all(pendingChat);
