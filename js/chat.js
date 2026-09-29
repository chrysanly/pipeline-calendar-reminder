// Team chat, pure: one shared room for the signed-in team, stored in
// Firestore at chat/main/messages (firestore.rules lets only the allowed
// emails read and post). js/views/chat.js is the page.

export const CHAT_ROOM = 'main';
export const CHAT_MAX = 1000;
export const CHAT_PAGE = 100;

const chatText = value => (value === null || value === undefined ? '' : String(value));

/**
 * The text as it will be sent (trimmed), or why it can't be. With an
 * attachment (`hasFile`) the text may be empty.
 * @returns {{text: string, error: string}}
 */
export function validateChatText(value, hasFile = false) {
  const text = chatText(value).trim();
  if (!text && !hasFile) return { text: '', error: 'Write a message or attach a file first.' };
  if (text.length > CHAT_MAX) return { text, error: `Keep a message under ${CHAT_MAX.toLocaleString('en-US')} characters (this one has ${text.length.toLocaleString('en-US')}).` };
  return { text, error: '' };
}

export const chatUserName = user => chatText(user.displayName).trim() || chatText(user.email).split('@')[0] || 'Someone';

/**
 * What is stored for one message: exactly the fields the rules allow
 * (attachment: attachmentRecord; replyTo: replyRecord of the message answered).
 */
export function chatRecord(user, text, now = new Date(), attachment = null, replyTo = null) {
  const record = {
    uid: user.uid,
    name: chatUserName(user),
    email: chatText(user.email).toLowerCase(),
    text,
    at: now.toISOString()
  };
  if (attachment) record.attachment = attachment;
  if (replyTo) record.replyTo = replyTo;
  return record;
}

// ---------- replies ----------

/** A reply keeps this much of the message it answers. */
export const REPLY_SNIPPET_MAX = 120;

/** The words shown for a message in a reply: its text, else what it carries. */
export function replySnippet(message) {
  const text = chatText(message && message.text).replace(/\s+/g, ' ').trim();
  if (text) return text.length > REPLY_SNIPPET_MAX ? `${text.slice(0, REPLY_SNIPPET_MAX - 1)}…` : text;
  const attachment = message && message.attachment;
  if (!attachment) return '';
  const label = { image: 'Photo', video: 'Video' }[attachment.kind] || 'File';
  return `${label}: ${attachment.name}`.slice(0, REPLY_SNIPPET_MAX);
}

/** What a reply stores about the message it answers: {id, name, snippet} (the rules check these). */
export function replyRecord(message) {
  return {
    id: chatText(message.id).slice(0, 64),
    name: chatText(message.name).trim().slice(0, 120) || 'Someone',
    snippet: replySnippet(message)
  };
}

export function normalizeReply(data) {
  if (!data || typeof data !== 'object' || !data.id) return null;
  return {
    id: chatText(data.id),
    name: chatText(data.name).trim() || 'Someone',
    snippet: chatText(data.snippet).slice(0, REPLY_SNIPPET_MAX)
  };
}

/** A stored message, cleaned up; null when it can't be shown. */
export function normalizeChatMessage(id, data) {
  if (!data || typeof data.text !== 'string' || typeof data.at !== 'string') return null;
  const attachment = normalizeAttachment(data.attachment);
  if (!data.text.trim() && !attachment) return null;
  return {
    id: chatText(id),
    uid: chatText(data.uid),
    name: chatText(data.name).trim() || 'Someone',
    email: chatText(data.email),
    text: data.text.slice(0, CHAT_MAX),
    at: data.at,
    attachment,
    replyTo: normalizeReply(data.replyTo)
  };
}

// ---------- attachments: images, videos and files ----------
// Kept in Firestore itself (the free Spark plan has no file storage): the
// file's bytes as base64 in pieces, chat/{room}/files/{fileId}/chunks/{n}.

/** The biggest file (after an image is shrunk): 10 MB. */
export const CHAT_FILE_MAX = 10 * 1024 * 1024;
/** base64 characters per piece: well under Firestore's 1 MiB per document. */
export const CHAT_CHUNK_CHARS = 700000;

/** 'image' | 'video' | 'file' from a MIME type. */
export function attachmentKind(type) {
  const t = chatText(type).toLowerCase();
  if (/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml|heic|heif|avif)$/.test(t)) return 'image';
  if (t.startsWith('video/')) return 'video';
  return 'file';
}

/** Why a file can't be sent, or ''. */
export function validateAttachment({ name, size }) {
  if (!chatText(name).trim()) return 'That file has no name.';
  if (!size) return `"${name}" is empty.`;
  if (size > CHAT_FILE_MAX) return `"${name}" is ${formatFileSize(size)}: files can be up to ${formatFileSize(CHAT_FILE_MAX)}.`;
  return '';
}

/** A base64 string cut into pieces of at most `size` characters. */
export function splitChunks(base64, size = CHAT_CHUNK_CHARS) {
  const pieces = [];
  for (let i = 0; i < base64.length; i += size) pieces.push(base64.slice(i, i + size));
  return pieces.length ? pieces : [''];
}

/** What a message stores about its file (the rules check these fields). */
export function attachmentRecord(fileId, { name, type, size }, chunks) {
  return { id: fileId, name: chatText(name).slice(0, 200), type: chatText(type).slice(0, 100) || 'application/octet-stream', size: Number(size) || 0, kind: attachmentKind(type), chunks };
}

export function normalizeAttachment(data) {
  if (!data || typeof data !== 'object' || !data.id || !(Number(data.chunks) > 0)) return null;
  return {
    id: chatText(data.id),
    name: chatText(data.name) || 'file',
    type: chatText(data.type),
    size: Number(data.size) || 0,
    kind: ['image', 'video', 'file'].includes(data.kind) ? data.kind : attachmentKind(data.type),
    chunks: Number(data.chunks)
  };
}

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** An image this many pixels on its longest side or bigger is shrunk before sending. */
export const CHAT_IMAGE_MAX_SIDE = 1600;

/** The size to shrink an image to (same shape), or null when it is small enough. */
export function shrinkSize(width, height, max = CHAT_IMAGE_MAX_SIDE) {
  const side = Math.max(width, height);
  if (!side || side <= max) return null;
  const scale = max / side;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// ---------- links ----------

const LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const trimLink = url => url.replace(/[).,!?;:]+$/, '');

/** A message's text as plain parts and links, to show links as links. */
export function linkParts(text) {
  const parts = [];
  let last = 0;
  for (const match of chatText(text).matchAll(LINK_RE)) {
    const url = trimLink(match[0]);
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) });
    parts.push({ type: 'link', value: url, href: /^https?:/i.test(url) ? url : `https://${url}` });
    last = match.index + url.length;
  }
  if (last < chatText(text).length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

/**
 * Everything shared in the room, newest first, like Messenger's
 * "Media, files and links": {media: [...], files: [...], links: [...]}.
 */
export function sharedItems(messages) {
  const media = [];
  const files = [];
  const links = [];
  for (const m of messages.slice().reverse()) {
    if (m.attachment) (m.attachment.kind === 'file' ? files : media).push({ message: m, attachment: m.attachment });
    for (const part of linkParts(m.text)) if (part.type === 'link') links.push({ message: m, url: part.href, label: part.value });
  }
  return { media, files, links };
}

// ---------- who is online, who is typing ----------
// chat/{room}/presence/{uid}: {name, email, lastSeen, typingAt} (ISO times).

/** Seen this recently = online (the page writes lastSeen every 45 s). */
export const CHAT_ONLINE_MS = 100 * 1000;
/** Typed this recently = "is typing…". */
export const CHAT_TYPING_MS = 6 * 1000;

const msAgo = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : now.getTime() - t;
};

/** The team from the presence docs: online first, then by name; your own entry marked. */
export function presenceList(docs, user, now = new Date()) {
  return docs
    .map(p => ({
      uid: chatText(p.uid),
      name: chatText(p.name).trim() || chatText(p.email).split('@')[0] || 'Someone',
      email: chatText(p.email),
      lastSeen: chatText(p.lastSeen),
      online: msAgo(p.lastSeen, now) < CHAT_ONLINE_MS,
      typing: msAgo(p.typingAt, now) < CHAT_TYPING_MS && msAgo(p.lastSeen, now) < CHAT_ONLINE_MS,
      self: Boolean(user && p.uid === user.uid)
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

/** "Joyce is typing…", "Joyce and Omar are typing…", or '' (you are never listed). */
export function typingText(people) {
  const names = people.filter(p => p.typing && !p.self).map(p => p.name);
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

/** "Online", "Last seen 5 min ago", "Last seen yesterday", or "Offline". */
export function lastSeenText(person, now = new Date()) {
  if (person.online) return 'Online';
  const ago = msAgo(person.lastSeen, now);
  if (!Number.isFinite(ago)) return 'Offline';
  const minutes = Math.round(ago / 60000);
  if (minutes < 60) return `Last seen ${Math.max(1, minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Last seen yesterday' : `Last seen ${days} days ago`;
}

/** Oldest first for the page (Firestore sends the newest first). */
export function orderChat(list) {
  return list.filter(Boolean).slice().sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export const isOwnMessage = (message, user) => Boolean(user && message.uid === user.uid);

/** Messages from others newer than `seenAt` (ISO): the unread dot. */
export function unreadCount(messages, seenAt, user) {
  return messages.filter(m => !isOwnMessage(m, user) && (!seenAt || m.at > seenAt)).length;
}

/** The newest message time, or `fallback` when there are none. */
export function latestAt(messages, fallback = '') {
  return messages.reduce((latest, m) => (m.at > latest ? m.at : latest), fallback);
}

const CHAT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const chatPad = n => String(n).padStart(2, '0');

/** "14:05" today, else "3 Oct, 14:05" (local time). */
export function chatTime(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = `${chatPad(date.getHours())}:${chatPad(date.getMinutes())}`;
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay ? time : `${date.getDate()} ${CHAT_MONTHS[date.getMonth()]}, ${time}`;
}

/** Firestore paths: chat/{room}/messages. */
export const chatPath = (room = CHAT_ROOM) => ['chat', room, 'messages'];

export const CHAT_NOT_ALLOWED = 'Your email isn’t on the CladFlo Talk list, or the CladFlo Talk rules aren’t deployed yet.';
export const CHAT_OFFLINE = 'Can’t reach Firestore. Check your connection, then try again.';

/** A send that gets no answer from Firestore in this time counts as offline. */
export const CHAT_SEND_TIMEOUT = 15000;

/** Why a chat read or send failed, in plain words (Firestore error codes). */
export function chatErrorText(err, online = true) {
  const code = err && err.code ? String(err.code).replace(/^firestore\//, '') : '';
  const message = err && err.message ? String(err.message) : String(err || '');
  if (!online || code === 'unavailable' || code === 'deadline-exceeded' || /offline|network/i.test(message)) return CHAT_OFFLINE;
  if (code === 'permission-denied' || /insufficient permissions/i.test(message)) return CHAT_NOT_ALLOWED;
  if (code === 'unauthenticated') return 'Your sign-in has expired: sign out, sign in again, then retry.';
  return message || 'Something went wrong. Try again.';
}

/** `promise`, or a deadline-exceeded error after `ms` (a write offline never settles). */
export function withChatTimeout(promise, ms = CHAT_SEND_TIMEOUT, timer = setTimeout) {
  return new Promise((resolve, reject) => {
    const id = timer(() => reject(Object.assign(new Error('No answer from Firestore.'), { code: 'deadline-exceeded' })), ms);
    promise.then(value => { clearTimeout(id); resolve(value); }, err => { clearTimeout(id); reject(err); });
  });
}

// ---------- avatars (phone view) ----------

/** "Joyce Ann Palma" → "JP", "chrys" → "CH", "" → "?". */
export function chatInitials(name) {
  const words = chatText(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export const AVATAR_TONES = ['potential', 'active', 'lead', 'inactive'];

/** The same colour for the same person every time (one of the status tones). */
export function avatarTone(key) {
  let hash = 0;
  for (const char of chatText(key)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}
