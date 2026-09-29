// One CladFlo Talk message in the list: who and when, a Reply button, the
// quoted message it answers (tap: js/views/chat.js jumps there), its photo,
// video or file, and its text with links. Page: js/views/chat.js.

import { isOwnMessage, chatTime, linkParts, formatFileSize } from '../chat.js';
import { loadChatFile } from '../chat-files.js';
import { el, icon } from '../ui.js';
import { openChatViewer, downloadChatFile } from './chat-side.js';

function textWithLinks(text) {
  const node = el('p', 'chat-text');
  for (const part of linkParts(text)) {
    if (part.type === 'text') {
      node.append(part.value);
      continue;
    }
    const link = el('a', 'chat-link', part.value);
    link.href = part.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    node.appendChild(link);
  }
  return node;
}

function attachmentNode(app, attachment, onError) {
  if (attachment.kind === 'image') {
    const button = el('button', 'chat-attachment chat-photo');
    button.type = 'button';
    button.setAttribute('aria-label', `Open ${attachment.name}`);
    const img = el('img');
    img.alt = attachment.name;
    img.loading = 'lazy';
    button.appendChild(img);
    loadChatFile(app.db(), attachment).then(url => { img.src = url; }, () => button.replaceChildren(icon('fa-image'), ' Photo not available'));
    button.addEventListener('click', () => openChatViewer(app, attachment));
    return button;
  }
  const button = el('button', `chat-attachment chat-file kind-${attachment.kind}`);
  button.type = 'button';
  const label = attachment.kind === 'video' ? 'Play video' : 'Download';
  button.append(icon(attachment.kind === 'video' ? 'fa-circle-play' : 'fa-file-arrow-down'),
    el('span', 'chat-file-title', attachment.name), el('span', 'chat-file-size', `${label} · ${formatFileSize(attachment.size)}`));
  button.addEventListener('click', () => (attachment.kind === 'video'
    ? openChatViewer(app, attachment)
    : downloadChatFile(app, attachment).catch(() => onError('Could not download that file. Try again.'))));
  return button;
}

/** One message: who and when, a Reply button, the quoted message it answers, its file and text. */
export function chatMessageNode(app, message, { onError = () => {} } = {}) {
  const own = isOwnMessage(message, app.user);
  const item = el('li', `chat-msg${own ? ' is-own' : ''}${message.attachment ? ' has-attachment' : ''}`);
  item.dataset.id = message.id;
  const head = el('p', 'chat-msg-head');
  head.append(el('strong', 'chat-name', own ? 'You' : message.name), el('time', 'chat-time', chatTime(message.at)));
  head.lastChild.dateTime = message.at;
  if (!own && message.email) head.firstChild.title = message.email;
  const reply = el('button', 'chat-reply-btn');
  reply.type = 'button';
  reply.setAttribute('aria-label', `Reply to ${own ? 'your message' : message.name}`);
  reply.title = 'Reply';
  reply.appendChild(icon('fa-reply'));
  head.appendChild(reply);
  item.appendChild(head);
  if (message.replyTo) {
    // The message this answers: tap to go to it.
    const quote = el('button', 'chat-quote');
    quote.type = 'button';
    quote.dataset.replyId = message.replyTo.id;
    quote.setAttribute('aria-label', `Go to ${message.replyTo.name}'s message: ${message.replyTo.snippet}`);
    quote.append(el('strong', 'chat-quote-name', message.replyTo.name), el('span', 'chat-quote-text', message.replyTo.snippet));
    item.appendChild(quote);
  }
  if (message.attachment) item.appendChild(attachmentNode(app, message.attachment, onError));
  if (message.text.trim()) item.appendChild(textWithLinks(message.text));
  return item;
}
