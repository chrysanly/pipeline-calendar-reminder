// Chat side panel: the team with who is online (and who is typing), and a
// "Shared" view like Messenger's, with Media, Files and Links in their own tabs.
// Also the viewer that opens a photo or video full size. Page: js/views/chat.js.

import { sharedItems, lastSeenText, formatFileSize, chatTime } from '../chat.js';
import { loadChatFile } from '../chat-files.js';
import { el, icon } from '../ui.js';

const SHARED_TABS = [['media', 'Media'], ['files', 'Files'], ['links', 'Links']];
const sideState = { tab: 'media' };
let sideParts = null;
let viewerParts = null;

// ---------- full-size viewer ----------

function buildViewer() {
  const viewer = el('div', 'chat-viewer');
  viewer.hidden = true;
  viewer.setAttribute('role', 'dialog');
  viewer.setAttribute('aria-modal', 'true');
  viewer.setAttribute('aria-label', 'Attachment');
  const bar = el('div', 'chat-viewer-bar');
  const title = el('p', 'chat-viewer-title');
  const download = el('a', 'ghost chat-viewer-download');
  download.append(icon('fa-download'), ' ', el('span', 'btn-label', 'Download'));
  const close = el('button', 'icon ghost chat-viewer-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.appendChild(icon('fa-xmark'));
  bar.append(title, download, close);
  const stage = el('div', 'chat-viewer-stage');
  viewer.append(bar, stage);
  document.body.appendChild(viewer);
  const hide = () => {
    viewer.hidden = true;
    stage.innerHTML = '';
  };
  close.addEventListener('click', hide);
  viewer.addEventListener('click', e => { if (e.target === viewer || e.target === stage) hide(); });
  viewer.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') hide();
  });
  viewerParts = { viewer, title, download, close, stage };
}

/** Open a photo or video full size (loads it first when needed). */
export async function openChatViewer(app, attachment) {
  if (!viewerParts) buildViewer();
  const { viewer, title, download, close, stage } = viewerParts;
  title.textContent = `${attachment.name} · ${formatFileSize(attachment.size)}`;
  stage.innerHTML = '';
  stage.appendChild(el('p', 'chat-viewer-wait', 'Loading…'));
  viewer.hidden = false;
  close.focus();
  try {
    const url = await loadChatFile(app.db(), attachment);
    download.href = url;
    download.download = attachment.name;
    stage.innerHTML = '';
    const media = el(attachment.kind === 'video' ? 'video' : 'img', 'chat-viewer-media');
    media.src = url;
    if (attachment.kind === 'video') {
      media.controls = true;
      media.autoplay = true;
    } else {
      media.alt = attachment.name;
    }
    stage.appendChild(media);
  } catch (err) {
    stage.innerHTML = '';
    stage.appendChild(el('p', 'chat-viewer-wait', `Could not load it: ${err.message}`));
  }
}

/** Save a file to the device (loads it first). */
export async function downloadChatFile(app, attachment) {
  const url = await loadChatFile(app.db(), attachment);
  const link = el('a');
  link.href = url;
  link.download = attachment.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

// ---------- side panel ----------

export function buildChatSide(app) {
  const side = el('aside', 'chat-side');
  side.setAttribute('aria-label', 'People and shared items');

  const people = el('section', 'chat-people');
  people.appendChild(el('h3', 'chat-side-title', 'People'));
  const peopleList = el('ul', 'chat-people-list');
  people.appendChild(peopleList);

  const shared = el('section', 'chat-shared');
  shared.appendChild(el('h3', 'chat-side-title', 'Shared'));
  const tabs = el('div', 'chat-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const [id, label] of SHARED_TABS) {
    const tab = el('button', 'chat-tab', label);
    tab.type = 'button';
    tab.dataset.tab = id;
    tab.setAttribute('role', 'tab');
    tabs.appendChild(tab);
  }
  const panel = el('div', 'chat-tab-panel');
  panel.setAttribute('role', 'tabpanel');
  shared.append(tabs, panel);
  side.append(people, shared);

  tabs.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    sideState.tab = tab.dataset.tab;
    renderShared(app, sideParts.messages || []);
  });
  sideParts = { side, shared, peopleList, tabs, panel, messages: [] };
  return side;
}

/** The Media / Files / Links section: the phone view shows it in a dialog (chat-mobile.js). */
export const chatSharedSection = () => (sideParts ? sideParts.shared : null);

/** Where the Shared section lives on desktop, to put it back after the phone dialog. */
export const chatSideNode = () => (sideParts ? sideParts.side : null);

/** The team, online first: a green dot, "Online" or "Last seen …", and "typing…". */
export function renderChatPeople(people, note = '') {
  if (!sideParts) return;
  const list = sideParts.peopleList;
  list.innerHTML = '';
  for (const person of people) {
    const item = el('li', `chat-person${person.online ? ' is-online' : ''}`);
    item.appendChild(el('span', 'chat-presence-dot'));
    const text = el('span', 'chat-person-text');
    text.append(el('strong', 'chat-person-name', person.self ? `${person.name} (you)` : person.name),
      el('span', 'chat-person-status', person.typing ? 'typing…' : lastSeenText(person)));
    item.appendChild(text);
    item.title = person.email;
    list.appendChild(item);
  }
  if (!people.length) list.appendChild(el('li', 'chat-side-empty', note || 'Nobody has opened the chat yet.'));
}

function thumb(app, item) {
  const button = el('button', `chat-shared-media kind-${item.attachment.kind}`);
  button.type = 'button';
  button.setAttribute('aria-label', `Open ${item.attachment.name}`);
  if (item.attachment.kind === 'image') {
    const img = el('img');
    img.alt = item.attachment.name;
    img.loading = 'lazy';
    loadChatFile(app.db(), item.attachment).then(url => { img.src = url; }, () => {});
    button.appendChild(img);
  } else {
    button.append(icon('fa-circle-play'), el('span', 'chat-shared-name', item.attachment.name));
  }
  button.addEventListener('click', () => openChatViewer(app, item.attachment));
  return button;
}

/** The Shared tabs for the messages loaded now (Load older adds more). */
export function renderShared(app, messages) {
  if (!sideParts) return;
  sideParts.messages = messages;
  const items = sharedItems(messages);
  for (const tab of sideParts.tabs.children) {
    const active = tab.dataset.tab === sideState.tab;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.textContent = `${SHARED_TABS.find(([id]) => id === tab.dataset.tab)[1]} (${items[tab.dataset.tab].length})`;
  }
  const panel = sideParts.panel;
  panel.innerHTML = '';
  const list = items[sideState.tab];
  if (!list.length) {
    panel.appendChild(el('p', 'chat-side-empty', { media: 'No photos or videos yet.', files: 'No files yet.', links: 'No links yet.' }[sideState.tab]));
    return;
  }
  if (sideState.tab === 'media') {
    const grid = el('div', 'chat-shared-grid');
    for (const item of list) grid.appendChild(thumb(app, item));
    panel.appendChild(grid);
    return;
  }
  const rows = el('ul', 'chat-shared-list');
  for (const item of list) {
    const row = el('li', 'chat-shared-row');
    if (sideState.tab === 'files') {
      const button = el('button', 'chat-shared-file');
      button.type = 'button';
      button.append(icon('fa-file-arrow-down'), el('span', 'chat-shared-name', item.attachment.name), el('span', 'chat-shared-size', formatFileSize(item.attachment.size)));
      button.addEventListener('click', () => downloadChatFile(app, item.attachment).catch(() => {}));
      row.appendChild(button);
    } else {
      const link = el('a', 'chat-shared-link', item.label);
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.appendChild(link);
    }
    row.appendChild(el('span', 'chat-shared-from', `${item.message.name} · ${chatTime(item.message.at)}`));
    rows.appendChild(row);
  }
  panel.appendChild(rows);
}
