// To-Do page: notes in folders ("Sinag", "CladFlo"…), each with attached
// photos or files. Write a note at the top (into the folder named there, the
// last one used by default) or with a folder's "+ Add" right inside it; tick
// done, edit in place, delete with a confirm; Open / Done / All with counts.
// Older items may have a title, shown above the note. Kept in the 'todos'
// collection (this browser in local mode, your account when signed in).
// Logic: js/todos.js; the note box: todo-compose.js; files: todo-attachments.js.

import {
  TODO_TITLE_MAX, TODO_NOTE_MAX, TODO_FILTERS, normalizeTodo, newTodo, editTodo,
  toggleDone, todoCounts, filterTodos, groupTodos, todoGroups, todoGroupName, todoLabel
} from '../todos.js';
import { chatTime } from '../chat.js';
import { saveTodoFile, removeTodoFile } from '../todo-files.js';
import { el, icon, withBusy } from '../ui.js';
import { pickProblem, attachButton, fileChips, attachmentList } from './todo-attachments.js';
import { createComposer, textField, groupField, readLastFolder, rememberFolder, TODO_GROUP_LIST_ID } from './todo-compose.js';

const TODO_TAB_LABELS = { open: 'Open', done: 'Done', all: 'All' };
const TODO_EMPTY = {
  open: { icon: 'fa-mug-hot', title: 'All clear', text: 'Nothing open. Write a note above whenever something comes up.' },
  done: { icon: 'fa-circle-check', title: 'Nothing done yet', text: 'Tick a note’s circle when it’s done and it moves here.' },
  all: { icon: 'fa-note-sticky', title: 'No notes yet', text: 'Pick a folder, write a note and press Enter.' }
};

// The tab shown; folders folded shut and the one with its quick box open
// (lower-case names; the box's node is kept across renders, like the item being
// edited, with the files it keeps and the new ones).
const todoView = {
  filter: 'open', collapsed: new Set(), quickKey: null, quickNode: null,
  editingId: null, editNode: null, editKeep: [], editNew: []
};
let todoParts = null;

const todoList = app => app.store.all('todos').map(normalizeTodo);
const findTodo = (app, id) => todoList(app).find(todo => todo.id === id) || null;

function setTodoStatus(text) {
  todoParts.status.textContent = text;
}

/** A store call; a failure is said on the page as well as in the top bar. */
async function saveTodo(action) {
  try {
    await action();
    setTodoStatus('');
    return true;
  } catch (err) {
    setTodoStatus(`Not saved: ${err && err.message ? err.message : err}`);
    return false;
  }
}

// ---------- files ----------

/** Store picked files one by one; all or nothing (a failure removes the ones already stored). */
async function uploadTodoFiles(app, files) {
  const saved = [];
  try {
    for (const [index, file] of files.entries()) {
      setTodoStatus(files.length > 1 ? `Uploading ${index + 1} of ${files.length}: ${file.name}…` : `Uploading ${file.name}…`);
      saved.push(await saveTodoFile(app, file));
    }
    setTodoStatus('');
    return saved;
  } catch (err) {
    for (const meta of saved) removeTodoFile(app, meta);
    throw err;
  }
}

// ---------- adding ----------

/** Save a note (and its files) into `group`; true once saved. */
async function addTodoNote(app, { note, group, files }) {
  const { error } = newTodo({ note, group, attachments: files });
  if (error) {
    setTodoStatus(error);
    return false;
  }
  let attachments;
  try {
    attachments = await uploadTodoFiles(app, files);
  } catch (err) {
    setTodoStatus(`Not saved: ${err.message}`);
    return false;
  }
  const { todo } = newTodo({ note, group, attachments });
  const saved = await saveTodo(() => app.store.add('todos', todo));
  if (!saved) for (const meta of attachments) removeTodoFile(app, meta);
  return saved;
}

function buildTopForm(app) {
  const group = groupField(readLastFolder());
  const folder = el('label', 'todo-group-row');
  folder.append(icon('fa-folder'), el('span', 'todo-group-label', 'Folder'), group);
  const composer = createComposer({
    className: 'todo-form',
    placeholder: 'Write a note… (Enter adds, Shift+Enter for a new line)',
    label: 'Note',
    folder,
    onProblem: setTodoStatus,
    async onSubmit({ note, files }) {
      const name = todoGroupName(group.value);
      const saved = await addTodoNote(app, { note, group: name, files });
      if (saved) {
        rememberFolder(group.value.trim() ? name : '');
        todoView.collapsed.delete(name.toLowerCase());
      }
      return saved;
    }
  });
  return { ...composer, group };
}

// ---------- a folder's quick box ----------

function closeQuick() {
  todoView.quickKey = null;
  todoView.quickNode = null;
}

/** The note box inside a folder: stays open for the next note; Escape closes it. */
function quickBox(app, name) {
  const item = el('li', 'todo-quick-item');
  const composer = createComposer({
    className: 'todo-quick',
    placeholder: `New note in ${name}… (Enter adds, Esc closes)`,
    label: `New note in ${name}`,
    onProblem: setTodoStatus,
    onSubmit: ({ note, files }) => addTodoNote(app, { note, group: name, files }),
    onEscape() {
      closeQuick();
      setTodoStatus('');
      renderTodos(app);
    }
  });
  item.appendChild(composer.form);
  return { item, focus: composer.focus };
}

function openQuick(app, name) {
  const key = name.toLowerCase();
  if (todoView.quickKey === key) {
    todoView.quickNode.focus();
    return;
  }
  todoView.collapsed.delete(key);
  todoView.quickKey = key;
  todoView.quickNode = quickBox(app, name);
  renderTodos(app);
  todoView.quickNode.focus();
}

// ---------- the list ----------

function todoMeta(todo) {
  if (todo.done && todo.doneAt) return `Done ${chatTime(todo.doneAt)}`;
  return todo.createdAt ? `Added ${chatTime(todo.createdAt)}` : '';
}

function iconButton(className, name, label) {
  const button = el('button', `icon ghost ${className}`);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.appendChild(icon(name));
  return button;
}

/** A note: round tick, the note first (an older item's title above it), files, when. */
function todoRow(app, todo) {
  const label = todoLabel(todo);
  const item = el('li', `todo-item${todo.done ? ' is-done' : ''}`);
  item.dataset.id = todo.id;
  const check = el('input', 'todo-check');
  check.type = 'checkbox';
  check.checked = todo.done;
  check.setAttribute('aria-label', `Done: ${label}`);
  const body = el('div', 'todo-body');
  if (todo.title) body.appendChild(el('strong', 'todo-title', todo.title));
  if (todo.note) body.appendChild(el('p', `todo-note${todo.title ? '' : ' is-main'}`, todo.note));
  const files = attachmentList(app, todo.attachments);
  if (files) body.appendChild(files);
  const meta = todoMeta(todo);
  if (meta) body.appendChild(el('small', 'todo-meta', meta));
  const actions = el('div', 'todo-actions');
  actions.append(iconButton('todo-edit', 'fa-pen', `Edit ${label}`), iconButton('todo-delete', 'fa-trash', `Delete ${label}`));
  item.append(check, body, actions);
  return item;
}

function stopEditing() {
  todoView.editingId = null;
  todoView.editNode = null;
  todoView.editKeep = [];
  todoView.editNew = [];
}

/** The edit form's chips: files it keeps, then new ones picked; × takes one off. */
function renderEditFiles() {
  const box = todoView.editNode && todoView.editNode.querySelector('.todo-chips');
  if (!box) return;
  const kept = todoView.editKeep.length;
  box.replaceWith(fileChips([...todoView.editKeep, ...todoView.editNew], index => {
    if (index < kept) todoView.editKeep.splice(index, 1);
    else todoView.editNew.splice(index - kept, 1);
    renderEditFiles();
  }));
}

async function saveEdit(app, id) {
  const todo = findTodo(app, id);
  if (!todo) {
    stopEditing();
    renderTodos(app);
    return;
  }
  const form = todoView.editNode;
  const title = form.querySelector('.todo-title-input');
  const fields = {
    title: title ? title.value : todo.title,
    note: form.querySelector('.todo-note-input').value,
    group: form.querySelector('.todo-group-input').value
  };
  const { error } = editTodo(todo, { ...fields, attachments: [...todoView.editKeep, ...todoView.editNew] });
  if (error) {
    setTodoStatus(error);
    return;
  }
  let added;
  try {
    added = await uploadTodoFiles(app, todoView.editNew);
  } catch (err) {
    setTodoStatus(`Not saved: ${err.message}`);
    return;
  }
  const keptIds = new Set(todoView.editKeep.map(meta => meta.id));
  const dropped = todo.attachments.filter(meta => !keptIds.has(meta.id));
  const { todo: edited } = editTodo(todo, { ...fields, attachments: [...todoView.editKeep, ...added] });
  stopEditing();
  const saved = await saveTodo(() => app.store.update('todos', id, { title: edited.title, note: edited.note, group: edited.group, attachments: edited.attachments }));
  // Files leave storage only once the item no longer points at them.
  for (const meta of saved ? dropped : added) removeTodoFile(app, meta);
  renderTodos(app);
}

/** The row as a small form: the note (and an older item's title), folder, files; Escape cancels. */
function editRow(app, todo) {
  const item = el('li', 'todo-item is-editing');
  item.dataset.id = todo.id;
  const form = el('form', 'todo-edit-form');
  form.noValidate = true;
  if (todo.title) {
    const title = textField('input', 'todo-title-input', { label: 'Title', max: TODO_TITLE_MAX, value: todo.title });
    title.type = 'text';
    form.appendChild(title);
  }
  const note = textField('textarea', 'todo-note-input', { label: 'Note', max: TODO_NOTE_MAX, value: todo.note });
  note.rows = 3;
  const folder = el('label', 'todo-group-row');
  folder.append(icon('fa-folder'), el('span', 'todo-group-label', 'Folder'), groupField(todo.group));
  const save = el('button', 'primary todo-save');
  save.type = 'submit';
  save.append(icon('fa-check'), ' ', el('span', 'btn-label', 'Save'));
  const cancel = el('button', 'ghost todo-cancel', 'Cancel');
  cancel.type = 'button';
  const attach = attachButton(files => {
    const problem = pickProblem(files, todoView.editKeep.length + todoView.editNew.length);
    setTodoStatus(problem);
    if (problem) return;
    todoView.editNew.push(...files);
    renderEditFiles();
  }, 'Add photos or files');
  const buttons = el('div', 'todo-edit-actions');
  buttons.append(attach.button, attach.input, cancel, save);
  form.append(note, folder, fileChips([], () => {}), buttons);
  item.appendChild(form);
  form.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(save, () => saveEdit(app, todo.id));
  });
  const close = () => {
    stopEditing();
    setTodoStatus('');
    renderTodos(app);
  };
  cancel.addEventListener('click', close);
  form.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  return item;
}

function startEditing(app, id) {
  const todo = findTodo(app, id);
  if (!todo) return;
  todoView.editingId = id;
  todoView.editKeep = [...todo.attachments];
  todoView.editNew = [];
  todoView.editNode = editRow(app, todo);
  renderEditFiles();
  renderTodos(app);
  todoView.editNode.querySelector('.todo-note-input').focus();
}

async function deleteTodo(app, id) {
  const todo = findTodo(app, id);
  if (!todo || !confirm(`Delete "${todoLabel(todo)}"?`)) return;
  if (todoView.editingId === id) stopEditing();
  const removed = await saveTodo(() => app.store.remove('todos', id));
  if (removed) for (const meta of todo.attachments) removeTodoFile(app, meta);
}

async function tickTodo(app, id) {
  const todo = findTodo(app, id);
  if (!todo) return;
  const next = toggleDone(todo);
  await saveTodo(() => app.store.update('todos', id, { done: next.done, doneAt: next.doneAt }));
}

// ---------- tabs, folders, the page ----------

function buildTabs() {
  const tabs = el('div', 'todo-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Show');
  const buttons = {};
  for (const filter of TODO_FILTERS) {
    const button = el('button', 'todo-tab');
    button.type = 'button';
    button.dataset.filter = filter;
    tabs.appendChild(button);
    buttons[filter] = button;
  }
  return { tabs, buttons };
}

function renderTabs(counts) {
  for (const filter of TODO_FILTERS) {
    const button = todoParts.tabButtons[filter];
    const active = filter === todoView.filter;
    button.replaceChildren(TODO_TAB_LABELS[filter], ' ', el('span', 'todo-tab-count', `(${counts[filter]})`));
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

/** One folder card: a header (fold, name, count, + Add), its quick box when open, its notes. */
function groupSection(app, { name, todos }) {
  const key = name.toLowerCase();
  const open = !todoView.collapsed.has(key);
  const section = el('section', `todo-group${open ? '' : ' is-folded'}`);
  section.dataset.group = name;
  const head = el('div', 'todo-group-head');
  const title = el('h3', 'todo-group-title');
  const toggle = el('button', 'todo-group-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(open));
  toggle.append(icon('fa-chevron-down'), icon(open ? 'fa-folder-open' : 'fa-folder'), el('span', 'todo-group-name', name), el('span', 'todo-group-count', String(todos.length)));
  toggle.addEventListener('click', () => {
    if (open) todoView.collapsed.add(key);
    else todoView.collapsed.delete(key);
    if (open && todoView.quickKey === key) closeQuick();
    renderTodos(app);
  });
  title.appendChild(toggle);
  const add = el('button', 'ghost todo-group-add');
  add.type = 'button';
  add.setAttribute('aria-label', `Add a note to ${name}`);
  add.append(icon('fa-plus'), ' ', el('span', 'btn-label', 'Add'));
  add.addEventListener('click', () => openQuick(app, name));
  head.append(title, add);
  const list = el('ul', 'todo-list');
  list.hidden = !open;
  if (todoView.quickKey === key) list.appendChild(todoView.quickNode.item);
  list.append(...todos.map(todo => (todo.id === todoView.editingId ? todoView.editNode : todoRow(app, todo))));
  section.append(head, list);
  return section;
}

function renderEmpty(shown) {
  const { icon: name, title, text } = TODO_EMPTY[todoView.filter];
  todoParts.empty.replaceChildren(icon(name), el('strong', 'todo-empty-title', title), el('span', 'todo-empty-text', text));
  todoParts.empty.hidden = shown > 0;
}

function renderTodos(app) {
  if (!todoParts) return;
  const all = todoList(app);
  const blocked = app.canSave() ? '' : 'Sign in to see and keep your to-do list.';
  todoParts.notice.textContent = blocked;
  todoParts.notice.hidden = !blocked;
  todoParts.body.hidden = Boolean(blocked);
  if (blocked) return;
  if (todoView.editingId && !all.some(todo => todo.id === todoView.editingId)) stopEditing();
  renderTabs(todoCounts(all));
  todoParts.groupNames.replaceChildren(...todoGroups(all).map(name => Object.assign(el('option'), { value: name })));
  const shown = filterTodos(all, todoView.filter);
  const folders = groupTodos(shown);
  // A folder with its quick box open stays, even when the tab shows none of its notes.
  if (todoView.quickKey && !folders.some(folder => folder.name.toLowerCase() === todoView.quickKey)) {
    const name = todoGroups(all).find(n => n.toLowerCase() === todoView.quickKey);
    if (name) folders.push({ name, todos: [] });
    else closeQuick();
  }
  todoParts.list.replaceChildren(...folders.map(folder => groupSection(app, folder)));
  renderEmpty(folders.length);
}

function bindList(app, list) {
  list.addEventListener('change', e => {
    const check = e.target.closest('.todo-check');
    if (check) tickTodo(app, check.closest('.todo-item').dataset.id);
  });
  list.addEventListener('click', e => {
    const edit = e.target.closest('.todo-edit');
    if (edit) startEditing(app, edit.closest('.todo-item').dataset.id);
    const remove = e.target.closest('.todo-delete');
    if (remove) deleteTodo(app, remove.closest('.todo-item').dataset.id);
  });
}

function buildTodosPage(app, section) {
  const head = el('div', 'page-head');
  const text = el('div');
  text.append(el('h2', 'page-title', 'To-Do'), el('p', 'page-sub', 'Notes in folders, with photos and files. Add one any time, tick it done, edit or delete it.'));
  head.appendChild(text);
  const notice = el('p', 'todo-notice');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  const body = el('section', 'todo-card');
  body.setAttribute('aria-label', 'To-do list');
  const top = buildTopForm(app);
  const status = el('p', 'form-error todo-status');
  status.setAttribute('role', 'alert');
  const { tabs, buttons } = buildTabs();
  const toolbar = el('div', 'todo-toolbar');
  toolbar.append(el('h3', 'todo-toolbar-title', 'Your notes'), tabs);
  // The folders, each a card with its own list (see groupSection).
  const list = el('div', 'todo-groups');
  const groupNames = el('datalist');
  groupNames.id = TODO_GROUP_LIST_ID;
  const empty = el('p', 'todo-empty');
  body.append(top.form, groupNames, status, toolbar, list, empty);
  section.append(head, notice, body);
  todoParts = { ...top, notice, body, status, tabButtons: buttons, list, groupNames, empty };

  tabs.addEventListener('click', e => {
    const tab = e.target.closest('.todo-tab');
    if (!tab) return;
    todoView.filter = tab.dataset.filter;
    renderTodos(app);
  });
  bindList(app, list);
}

/** Feature entry point (js/features.js). */
export function registerTodos(app) {
  app.views.register({
    id: 'todos',
    label: 'To-Do',
    icon: 'fa-list-check',
    key: 'o',
    bind: buildTodosPage,
    render: renderTodos
  });
  app.hooks.on('auth', () => {
    stopEditing();
    closeQuick();
    todoView.filter = 'open';
  });
}
