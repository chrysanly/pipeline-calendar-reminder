// To-do attachments on the page: the Attach button (photos and files, several
// at once), the chips of files waiting to be saved, and the files shown on a
// to-do (photos as thumbnails, other files as links). Storage: js/todo-files.js.

import { attachmentKind, validateAttachment, formatFileSize } from '../chat.js';
import { TODO_FILES_MAX } from '../todos.js';
import { todoFileUrl } from '../todo-files.js';
import { el, icon } from '../ui.js';

/** Why these picked files can't be added (count, size), or ''. Photos over 10 MB are shrunk, so they pass. */
export function pickProblem(files, alreadyAttached) {
  if (alreadyAttached + files.length > TODO_FILES_MAX) return `An item can hold up to ${TODO_FILES_MAX} files.`;
  for (const file of files) {
    const problem = validateAttachment(file);
    if (problem && !(attachmentKind(file.type) === 'image' && file.size)) return problem;
  }
  return '';
}

/** The paperclip button and its hidden multi-file input; onPick(files[]). */
export function attachButton(onPick, label = 'Attach photos or files') {
  const input = el('input', 'todo-file-input');
  input.type = 'file';
  input.multiple = true;
  input.hidden = true;
  input.accept = 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.zip,*/*';
  const button = el('button', 'icon ghost todo-attach');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = `${label} (up to 10 MB each)`;
  button.appendChild(icon('fa-paperclip'));
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = ''; // picking the same file again still fires change
    if (files.length) onPick(files);
  });
  return { button, input };
}

const fileIcon = type => (attachmentKind(type) === 'image' ? 'fa-image' : attachmentKind(type) === 'video' ? 'fa-film' : 'fa-file');

/** Chips for files (picked File objects or saved metas), each with a remove ×; onRemove(index). */
export function fileChips(files, onRemove) {
  const list = el('ul', 'todo-chips');
  list.hidden = !files.length;
  files.forEach((file, index) => {
    const chip = el('li', 'todo-chip');
    const remove = el('button', 'icon ghost todo-chip-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.appendChild(icon('fa-xmark'));
    remove.addEventListener('click', () => onRemove(index));
    chip.append(icon(fileIcon(file.type)), el('span', 'todo-chip-name', file.name), el('span', 'todo-chip-size', formatFileSize(file.size)), remove);
    list.appendChild(chip);
  });
  return list;
}

/** A photo thumbnail or a file link, filled in once the file is read. */
function todoFileNode(app, meta) {
  const item = el('li', 'todo-file');
  const link = el('a', `todo-file-link is-${attachmentKind(meta.type)}`);
  link.download = meta.name;
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-label', `Open ${meta.name} (${formatFileSize(meta.size)})`);
  link.title = meta.name;
  const image = attachmentKind(meta.type) === 'image';
  if (image) {
    const img = el('img', 'todo-thumb');
    img.alt = meta.name;
    img.loading = 'lazy';
    link.appendChild(img);
  } else {
    link.append(icon(fileIcon(meta.type)), el('span', 'todo-file-name', meta.name), el('span', 'todo-chip-size', formatFileSize(meta.size)));
  }
  item.appendChild(link);
  todoFileUrl(app, meta).then(url => {
    link.href = url;
    if (image) link.querySelector('img').src = url;
  }, err => {
    item.classList.add('is-missing');
    link.removeAttribute('download');
    link.title = err.message;
    if (image) link.replaceChildren(icon('fa-image'), el('span', 'todo-file-name', meta.name));
  });
  return item;
}

/** The files saved on a to-do, or null when it has none. */
export function attachmentList(app, attachments) {
  if (!attachments.length) return null;
  const list = el('ul', 'todo-files');
  list.setAttribute('aria-label', 'Attachments');
  for (const meta of attachments) list.appendChild(todoFileNode(app, meta));
  return list;
}
