// The note composer of the To-Do page, used twice: the form at the top (with a
// Folder box) and the quick box a folder's "+ Add" opens inside it. A note box
// (Enter adds, Shift+Enter is a new line), a paperclip for photos and files
// (also pasted or dropped), chips of the files waiting, and the Add button.

import { TODO_NOTE_MAX, TODO_GROUP_MAX, TODO_DEFAULT_GROUP } from '../todos.js';
import { el, icon, withBusy } from '../ui.js';
import { pickProblem, attachButton, fileChips } from './todo-attachments.js';

const TODO_FOLDER_KEY = 'cladflo.todo-folder';
export const TODO_GROUP_LIST_ID = 'todo-group-names';

export function textField(tag, className, { label, max, value = '' }) {
  const field = el(tag, className);
  field.setAttribute('aria-label', label);
  field.maxLength = max;
  field.value = value;
  return field;
}

/** Folder box, suggesting the folders already in use (datalist); blank is General. */
export function groupField(value = '') {
  const field = textField('input', 'todo-group-input', { label: 'Folder', max: TODO_GROUP_MAX, value });
  field.type = 'text';
  field.placeholder = `e.g. Sinag (blank: ${TODO_DEFAULT_GROUP})`;
  field.setAttribute('list', TODO_GROUP_LIST_ID);
  field.autocomplete = 'off';
  return field;
}

export function readLastFolder() {
  try {
    return localStorage.getItem(TODO_FOLDER_KEY) || '';
  } catch {
    return '';
  }
}

export function rememberFolder(name) {
  try {
    localStorage.setItem(TODO_FOLDER_KEY, name);
  } catch {
    // not kept: the box still shows it for now
  }
}

/**
 * options: {
 *   className, placeholder, label (the note box's name), submitLabel,
 *   folder?: HTMLElement (a Folder row shown above the note),
 *   onSubmit({note, files}) → Promise<boolean> (true: saved, so clear),
 *   onProblem(text) (a refused file, '' to clear), onEscape?()
 * }
 */
export function createComposer({ className, placeholder, label, submitLabel = 'Add', folder, onSubmit, onProblem, onEscape }) {
  const form = el('form', `todo-compose ${className}`);
  form.noValidate = true;
  const files = [];

  const note = el('textarea', 'todo-note-input');
  note.rows = 2;
  note.maxLength = TODO_NOTE_MAX;
  note.placeholder = placeholder;
  note.setAttribute('aria-label', label);

  let chips = fileChips([], () => {});
  const redraw = () => {
    const next = fileChips(files, index => {
      files.splice(index, 1);
      redraw();
    });
    chips.replaceWith(next);
    chips = next;
  };
  const pick = picked => {
    const problem = pickProblem(picked, files.length);
    onProblem(problem);
    if (problem) return;
    files.push(...picked);
    redraw();
    note.focus();
  };

  const attach = attachButton(pick);
  const submit = el('button', 'primary todo-add');
  submit.type = 'submit';
  submit.append(icon('fa-plus'), ' ', el('span', 'btn-label', submitLabel));
  const bar = el('div', 'todo-compose-bar');
  bar.append(attach.button, el('span', 'todo-hint', 'Photos and files, up to 10 MB each'), submit, attach.input);
  const box = el('div', 'todo-compose-box');
  box.append(note, chips, bar);
  if (folder) form.appendChild(folder);
  form.appendChild(box);

  const reset = () => {
    note.value = '';
    files.length = 0;
    redraw();
  };
  form.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(submit, async () => {
      if (await onSubmit({ note: note.value, files: [...files] })) reset();
      note.focus();
    });
  });
  note.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    } else if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      onEscape();
    }
  });
  // A photo pasted into the note, or files dropped on the box, are attached too.
  form.addEventListener('paste', e => {
    const pasted = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (!pasted.length) return;
    e.preventDefault();
    pick(pasted);
  });
  form.addEventListener('dragover', e => {
    e.preventDefault();
    box.classList.add('is-drop');
  });
  form.addEventListener('dragleave', () => box.classList.remove('is-drop'));
  form.addEventListener('drop', e => {
    e.preventDefault();
    box.classList.remove('is-drop');
    const dropped = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (dropped.length) pick(dropped);
  });
  return { form, note, submit, focus: () => note.focus() };
}
