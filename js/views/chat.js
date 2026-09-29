// Chat page: one team room for the signed-in users, live from Firestore
// (chat/main/messages, newest 100 first, "Load older" for more). Own messages
// sit on the right; photos, videos and files can be attached; links open; a
// line says who is typing; the side panel lists the team (online or not) and
// what was shared (chat-side.js). The navbar button gets a dot for unread
// messages. Not in local mode (?backend=local): there is no account to chat as.
// Logic: js/chat.js; files: js/chat-files.js; online/typing: js/chat-presence.js.

import {
  CHAT_MAX, CHAT_PAGE, chatPath, validateChatText, validateAttachment, chatRecord, normalizeChatMessage, orderChat,
  isOwnMessage, unreadCount, latestAt, chatErrorText, withChatTimeout, formatFileSize,
  presenceList, typingText, replyRecord, replySnippet
} from '../chat.js';
import { uploadChatFile } from '../chat-files.js';
import { startPresence } from '../chat-presence.js';
import { newRecordId } from '../store.js';
import { el, icon, withBusy } from '../ui.js';
import { showBanner } from '../banner.js';
import { buildChatSide, renderChatPeople, renderShared } from './chat-side.js';
import { buildChatMobileBar, renderChatMobile } from './chat-mobile.js';
import { chatMessageNode } from './chat-message.js';

const CHAT_SEEN_KEY = 'cladflo.chat-seen.v1';

// Live state: the messages shown, how many to ask for, the listeners, who is around.
const chatRoom = { messages: [], limit: CHAT_PAGE, more: false, stop: null, error: '', presence: null, people: [], presenceNote: '' };
let chatParts = null;
// The file picked for the next message.
let chatPending = null;
// The message the next one answers (Reply), or null.
let chatReply = null;
// A quoted message being looked for: {id, tries} while older pages load.
let chatJump = null;
/** Older pages loaded at most while looking for a quoted message. */
const JUMP_MAX_PAGES = 20;

function readChatSeen() {
  try {
    return localStorage.getItem(CHAT_SEEN_KEY) || '';
  } catch {
    return '';
  }
}

function markChatSeen() {
  const at = latestAt(chatRoom.messages, readChatSeen());
  try {
    localStorage.setItem(CHAT_SEEN_KEY, at);
  } catch {
    // the dot may come back after a reload
  }
}

const messagesRef = db => {
  const [top, doc, sub] = chatPath();
  return db.collection(top).doc(doc).collection(sub);
};

/** Why this browser can't chat right now, or '' when it can. */
function chatBlocked(app) {
  if (app.mode === 'local') {
    return 'CladFlo Talk needs an account, so it is off in local mode: the page was opened with ?backend=local, '
      + 'or Firebase could not load (an ad blocker or no connection). Open CladFlo normally and sign in to use CladFlo Talk.';
  }
  if (!app.user) return 'Sign in to use CladFlo Talk with your team.';
  return '';
}

// ---------- live messages and presence ----------

function stopChat() {
  if (chatRoom.stop) chatRoom.stop();
  chatRoom.stop = null;
}

function listenChat(app) {
  stopChat();
  const db = app.db();
  if (!db || !app.user) {
    chatRoom.messages = [];
    refreshChat(app);
    return;
  }
  chatRoom.stop = messagesRef(db).orderBy('at', 'desc').limit(chatRoom.limit).onSnapshot(snap => {
    chatRoom.error = '';
    chatRoom.more = snap.docs.length >= chatRoom.limit;
    chatRoom.messages = orderChat(snap.docs.map(doc => normalizeChatMessage(doc.id, doc.data())));
    refreshChat(app);
  }, err => {
    chatRoom.error = `Could not load CladFlo Talk. ${chatErrorText(err, navigator.onLine)} Signed in as ${app.user ? app.user.email : 'nobody'}.`;
    refreshChat(app);
  });
}

let presenceDocs = [];

function renderPresence(app) {
  if (!chatParts) return;
  chatRoom.people = presenceList(presenceDocs, app.user);
  renderChatPeople(chatRoom.people, chatRoom.presenceNote);
  renderChatMobile(chatRoom.people, chatRoom.messages);
  chatParts.typing.textContent = typingText(chatRoom.people);
}

function listenPresence(app) {
  if (chatRoom.presence) chatRoom.presence.stop();
  chatRoom.presence = null;
  presenceDocs = [];
  const db = app.db();
  if (!db || !app.user) return;
  chatRoom.presence = startPresence(db, app.user, {
    onChange(docs) {
      if (docs) presenceDocs = docs;
      chatRoom.presenceNote = '';
      renderPresence(app);
    },
    onError() {
      chatRoom.presenceNote = 'Who is online shows once the latest CladFlo Talk rules are deployed.';
      renderPresence(app);
    }
  });
}

function loadOlderChat(app) {
  chatRoom.limit += CHAT_PAGE;
  listenChat(app);
}

// ---------- sending ----------

function setChatStatus(text) {
  chatParts.status.textContent = text;
}

/** Reply to `message` (null: stop replying): the bar above the box says to whom. */
function setReply(message) {
  chatReply = message;
  chatParts.replyBar.hidden = !message;
  if (!message) return;
  chatParts.replyName.textContent = `Replying to ${isOwnMessage(message, chatParts.app.user) ? 'yourself' : message.name}`;
  chatParts.replySnippet.textContent = replySnippet(message);
  chatParts.input.focus();
}

/** Scroll to a message and light it up briefly; true when it is in the list. */
function flashMessage(id) {
  const item = chatParts.log.querySelector(`.chat-msg[data-id="${CSS.escape(id)}"]`);
  if (!item) return false;
  item.scrollIntoView({ block: 'center', behavior: 'smooth' });
  item.classList.remove('is-highlight');
  void item.offsetWidth; // restart the animation when tapped twice
  item.classList.add('is-highlight');
  setTimeout(() => item.classList.remove('is-highlight'), 1800);
  return true;
}

/** A quoted reply was tapped: go to the original, loading older messages until it shows. */
function jumpToMessage(app, id) {
  if (flashMessage(id)) return;
  if (chatRoom.more) {
    chatJump = { id, tries: 1 };
    loadOlderChat(app);
    return;
  }
  showBanner('That message is no longer available', 'It may be older than CladFlo Talk keeps, or it was never sent.');
}

/** After each render: keep looking for the quoted message, or give up. */
function continueJump(app) {
  if (!chatJump) return;
  if (flashMessage(chatJump.id)) {
    chatJump = null;
  } else if (chatRoom.more && chatJump.tries < JUMP_MAX_PAGES) {
    chatJump.tries++;
    loadOlderChat(app);
  } else {
    chatJump = null;
    showBanner('That message is no longer available', 'It may be older than CladFlo Talk keeps, or it was never sent.');
  }
}

function setPending(file) {
  chatPending = file;
  chatParts.fileChip.hidden = !file;
  chatParts.fileName.textContent = file ? `${file.name} · ${formatFileSize(file.size)}` : '';
  chatParts.fileInput.value = '';
}

/** Firestore writes that fail, in plain words; a write offline gives up after a while. */
async function chatWrite(action) {
  if (!navigator.onLine) throw new Error(chatErrorText(null, false));
  try {
    return await withChatTimeout(action());
  } catch (err) {
    throw new Error(chatErrorText(err, navigator.onLine));
  }
}

async function sendChat(app) {
  const file = chatPending;
  const { text, error } = validateChatText(chatParts.input.value, Boolean(file));
  if (error) {
    setChatStatus(error);
    return;
  }
  const db = app.db();
  const blocked = chatBlocked(app);
  if (blocked || !db) {
    setChatStatus(blocked || 'CladFlo Talk is not connected yet.');
    return;
  }
  setChatStatus('');
  try {
    let attachment = null;
    if (file) {
      attachment = await uploadChatFile(db, app.user, file, {
        onProgress: (done, total) => setChatStatus(total > 1 ? `Sending ${file.name}… ${Math.round((done / total) * 100)}%` : `Sending ${file.name}…`)
      }).catch(err => { throw new Error(chatErrorText(err, navigator.onLine)); });
    }
    const replyTo = chatReply ? replyRecord(chatReply) : null;
    await chatWrite(() => messagesRef(db).doc(newRecordId()).set(chatRecord(app.user, text, new Date(), attachment, replyTo)));
    // Sent: the message shows in the list, no toast.
    setChatStatus('');
    chatParts.input.value = '';
    setPending(null);
    setReply(null);
    updateChatCounter();
    if (chatRoom.presence) chatRoom.presence.typing(false);
  } catch (err) {
    setChatStatus(`Not sent: ${err.message}`);
  }
}

function pickFile(file) {
  if (!file) return;
  const problem = validateAttachment(file);
  // Big photos are shrunk before sending, so only refuse what can't be shrunk.
  if (problem && !(file.type || '').startsWith('image/')) {
    setChatStatus(problem);
    return;
  }
  setChatStatus('');
  setPending(file);
  chatParts.input.focus();
}

// ---------- the page ----------

function updateChatCounter() {
  const length = chatParts.input.value.trim().length;
  chatParts.counter.textContent = `${length}/${CHAT_MAX}`;
  chatParts.counter.classList.toggle('is-over', length > CHAT_MAX);
}

function buildCompose(app) {
  const form = el('form', 'chat-form');
  form.noValidate = true;
  const input = el('textarea', 'chat-input');
  input.rows = 2;
  input.placeholder = 'Write to your team… (Enter sends, Shift+Enter for a new line)';
  input.setAttribute('aria-label', 'Message');
  const fileInput = el('input', 'chat-file-input');
  fileInput.type = 'file';
  fileInput.hidden = true;
  fileInput.accept = 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip,*/*';
  const attach = el('button', 'icon ghost chat-attach');
  attach.type = 'button';
  attach.setAttribute('aria-label', 'Attach a photo, video or file');
  attach.title = 'Attach a photo, video or file (up to 10 MB)';
  attach.appendChild(icon('fa-paperclip'));
  const submit = el('button', 'primary chat-send');
  submit.type = 'submit';
  submit.append(icon('fa-paper-plane'), ' ', el('span', 'btn-label', 'Send'));
  const row = el('div', 'chat-compose');
  row.append(attach, input, submit, fileInput);

  const fileChip = el('div', 'chat-file-chip');
  fileChip.hidden = true;
  const fileName = el('span', 'chat-file-name');
  const unpick = el('button', 'icon ghost chat-file-remove');
  unpick.type = 'button';
  unpick.setAttribute('aria-label', 'Remove the attachment');
  unpick.appendChild(icon('fa-xmark'));
  fileChip.append(icon('fa-paperclip'), fileName, unpick);

  const counter = el('span', 'chat-counter', `0/${CHAT_MAX}`);
  const status = el('p', 'form-error chat-status');
  status.setAttribute('role', 'alert');
  const meta = el('div', 'chat-meta');
  meta.append(status, counter);
  // Replying to: who and what, with an X to stop.
  const replyBar = el('div', 'chat-reply-bar');
  replyBar.hidden = true;
  const replyText = el('div', 'chat-reply-text');
  const replyName = el('strong', 'chat-reply-name');
  const replySnippetNode = el('span', 'chat-reply-snippet');
  replyText.append(replyName, replySnippetNode);
  const cancelReply = el('button', 'icon ghost chat-reply-cancel');
  cancelReply.type = 'button';
  cancelReply.setAttribute('aria-label', 'Cancel the reply');
  cancelReply.appendChild(icon('fa-xmark'));
  replyBar.append(icon('fa-reply'), replyText, cancelReply);
  cancelReply.addEventListener('click', () => {
    setReply(null);
    input.focus();
  });
  form.append(replyBar, fileChip, row, meta);

  attach.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => pickFile(fileInput.files[0]));
  unpick.addEventListener('click', () => setPending(null));
  form.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(submit, () => sendChat(app));
  });
  input.addEventListener('input', () => {
    updateChatCounter();
    if (chatRoom.presence) chatRoom.presence.typing(Boolean(input.value.trim()));
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  // A photo pasted from the clipboard, or a file dropped on the box, is attached.
  input.addEventListener('paste', e => {
    const file = [...(e.clipboardData ? e.clipboardData.files : [])][0];
    if (file) {
      e.preventDefault();
      pickFile(file);
    }
  });
  form.addEventListener('dragover', e => e.preventDefault());
  form.addEventListener('drop', e => {
    e.preventDefault();
    pickFile(e.dataTransfer && e.dataTransfer.files[0]);
  });
  return { form, input, fileInput, fileChip, fileName, counter, status, submit, replyBar, replyName, replySnippet: replySnippetNode };
}

function buildChatPage(app, section) {
  const head = el('div', 'page-head');
  const text = el('div');
  text.append(el('h2', 'page-title', 'CladFlo Talk'), el('p', 'page-sub', 'One room for the team: messages, photos, videos and files.'));
  head.appendChild(text);

  const notice = el('p', 'chat-notice');
  notice.setAttribute('role', 'status');
  const card = el('section', 'dash-card chat-card');
  card.setAttribute('aria-label', 'Messages');
  const main = el('div', 'chat-main');
  const older = el('button', 'ghost chat-older');
  older.type = 'button';
  older.append(icon('fa-clock-rotate-left'), ' ', 'Load older');
  older.addEventListener('click', () => withBusy(older, () => loadOlderChat(app)));
  const log = el('ol', 'chat-log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-label', 'CladFlo Talk messages');
  const typing = el('p', 'chat-typing');
  typing.setAttribute('aria-live', 'polite');
  const compose = buildCompose(app);
  // Phones: avatars and a Shared button on top instead of the side panel (css/chat.css).
  main.append(buildChatMobileBar(), older, log, typing, compose.form);
  card.append(main, buildChatSide(app));
  section.append(head, notice, card);
  chatParts = { app, section, notice, card, older, log, typing, ...compose };
  // Reply buttons and quoted replies, in every message (bound once).
  log.addEventListener('click', e => {
    const reply = e.target.closest('.chat-reply-btn');
    if (reply) {
      const message = chatRoom.messages.find(m => m.id === reply.closest('.chat-msg').dataset.id);
      if (message) setReply(message);
      return;
    }
    const quote = e.target.closest('.chat-quote');
    if (quote) jumpToMessage(app, quote.dataset.replyId);
  });
}

function renderChat(app) {
  if (!chatParts) return;
  const blocked = chatBlocked(app);
  chatParts.notice.textContent = blocked || chatRoom.error;
  chatParts.notice.hidden = !blocked && !chatRoom.error;
  chatParts.card.hidden = Boolean(blocked);
  if (blocked) return;
  const stick = chatParts.log.scrollHeight - chatParts.log.scrollTop - chatParts.log.clientHeight < 40;
  chatParts.log.innerHTML = '';
  for (const message of chatRoom.messages) chatParts.log.appendChild(chatMessageNode(app, message, { onError: setChatStatus }));
  if (!chatRoom.messages.length) chatParts.log.appendChild(el('li', 'chat-empty', 'No messages yet: say hello to the team.'));
  chatParts.older.hidden = !chatRoom.more;
  if (stick && !chatJump) chatParts.log.scrollTop = chatParts.log.scrollHeight;
  continueJump(app);
  renderShared(app, chatRoom.messages);
  renderPresence(app);
  markChatSeen();
}

/** The unread dot on the navbar button, off while the chat is open. */
function renderDot(app) {
  const button = document.querySelector('.views [data-view="chat"]');
  if (!button) return;
  let dot = button.querySelector('.chat-dot');
  if (!dot) {
    dot = el('span', 'chat-dot');
    button.appendChild(dot);
  }
  const unread = chatParts && !chatParts.section.hidden ? 0 : unreadCount(chatRoom.messages, readChatSeen(), app.user);
  dot.hidden = !unread;
  dot.textContent = unread ? String(Math.min(unread, 99)) : '';
  button.setAttribute('aria-label', unread ? `CladFlo Talk, ${unread} unread` : 'CladFlo Talk');
}

function refreshChat(app) {
  if (chatParts && !chatParts.section.hidden) renderChat(app);
  renderDot(app);
}

/** Feature entry point (js/features.js). */
export function registerChat(app) {
  app.views.register({
    id: 'chat',
    label: 'CladFlo Talk',
    icon: 'fa-comments',
    css: 'css/chat.css',
    bind: buildChatPage,
    render: current => {
      renderChat(current);
      renderDot(current);
    }
  });
  app.hooks.on('auth', () => {
    chatRoom.limit = CHAT_PAGE;
    chatRoom.error = '';
    listenChat(app);
    listenPresence(app);
  });
  refreshChat(app);
}
