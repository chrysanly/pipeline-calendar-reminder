// CladFlo Talk on a phone: instead of the side panel under the messages, a bar at
// the top with a round avatar per person (a dot when online; tap for who they
// are) and a Shared button that opens Media, Files and Links in a dialog.
// css/chat.css shows this bar and hides the side panel at phone width only.

import { chatInitials, avatarTone, lastSeenText, sharedItems } from '../chat.js';
import { el, icon } from '../ui.js';
import { chatSharedSection, chatSideNode } from './chat-side.js';

let mobileParts = null;
// The people shown now, by uid, for the "who is this" card.
let mobilePeople = new Map();

function chatModal(className, title) {
  const modal = el('div', `modal chat-modal ${className}`);
  modal.hidden = true;
  const backdrop = el('div', 'modal-backdrop');
  const card = el('div', 'modal-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const head = el('div', 'modal-head');
  const heading = el('h2', '', title);
  const close = el('button', 'icon');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.appendChild(icon('fa-xmark'));
  head.append(heading, close);
  const body = el('div', 'chat-modal-body');
  card.append(head, body);
  modal.append(backdrop, card);
  document.body.appendChild(modal);
  const hide = () => {
    modal.hidden = true;
    if (modal.onHide) modal.onHide();
  };
  for (const node of [backdrop, close]) node.addEventListener('click', hide);
  modal.addEventListener('keydown', e => {
    // The page's shortcuts and Escape handling stay out of the dialog.
    e.stopPropagation();
    if (e.key === 'Escape') hide();
  });
  return { modal, heading, body, close, hide };
}

function avatar(person, big = false) {
  const node = el('span', `chat-avatar status-${avatarTone(person.uid || person.email)}${big ? ' is-big' : ''}`, chatInitials(person.name));
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function openPerson(uid) {
  const person = mobilePeople.get(uid);
  if (!person) return;
  const { modal, heading, body, close } = mobileParts.personModal;
  heading.textContent = person.self ? `${person.name} (you)` : person.name;
  body.innerHTML = '';
  const status = el('p', `chat-profile-status${person.online ? ' is-online' : ''}`);
  status.append(el('span', 'chat-presence-dot'), person.typing ? 'typing…' : lastSeenText(person));
  const email = el('a', 'chat-profile-email', person.email);
  email.href = `mailto:${person.email}`;
  body.append(avatar(person, true), status, email);
  modal.hidden = false;
  close.focus();
}

function openShared() {
  const section = chatSharedSection();
  if (!section) return;
  const { modal, body, close } = mobileParts.sharedModal;
  // Move the Media / Files / Links section into the dialog, and back when it closes.
  body.appendChild(section);
  modal.onHide = () => {
    const side = chatSideNode();
    if (side) side.appendChild(section);
    mobileParts.sharedButton.focus();
  };
  modal.hidden = false;
  close.focus();
}

/** The phone bar: avatars and the Shared button. Goes at the top of the chat. */
export function buildChatMobileBar() {
  const bar = el('div', 'chat-mobile-bar');
  const avatars = el('ul', 'chat-avatars');
  avatars.setAttribute('aria-label', 'People');
  const sharedButton = el('button', 'ghost chat-shared-open');
  sharedButton.type = 'button';
  const sharedLabel = el('span', 'btn-label', 'Shared');
  sharedButton.append(icon('fa-photo-film'), ' ', sharedLabel);
  bar.append(avatars, sharedButton);
  avatars.addEventListener('click', e => {
    const button = e.target.closest('[data-uid]');
    if (button) openPerson(button.dataset.uid);
  });
  sharedButton.addEventListener('click', openShared);
  mobileParts = {
    bar, avatars, sharedButton, sharedLabel,
    personModal: chatModal('chat-person-modal', 'Person'),
    sharedModal: chatModal('chat-shared-modal', 'Media, files and links')
  };
  return bar;
}

/** Re-draw the avatars (online first) and the Shared count. */
export function renderChatMobile(people, messages) {
  if (!mobileParts) return;
  mobilePeople = new Map(people.map(p => [p.uid, p]));
  const list = mobileParts.avatars;
  list.innerHTML = '';
  for (const person of people) {
    const item = el('li');
    const button = el('button', `chat-avatar-button${person.online ? ' is-online' : ''}${person.typing ? ' is-typing' : ''}`);
    button.type = 'button';
    button.dataset.uid = person.uid;
    const state = person.typing ? 'typing' : person.online ? 'online' : 'offline';
    button.setAttribute('aria-label', `${person.self ? `${person.name} (you)` : person.name}, ${state}`);
    button.append(avatar(person), el('span', 'chat-avatar-dot'));
    item.appendChild(button);
    list.appendChild(item);
  }
  const items = sharedItems(messages);
  const count = items.media.length + items.files.length + items.links.length;
  mobileParts.sharedLabel.textContent = count ? `Shared (${count})` : 'Shared';
  mobileParts.sharedButton.setAttribute('aria-label', `Media, files and links: ${count}`);
}
