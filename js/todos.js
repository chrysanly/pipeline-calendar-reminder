// To-do list, pure: notes in folders with attached files, ticked done or open.
// A note or a file is enough; older items may also have a title, which is kept. Kept per user in the 'todos' collection (js/store.js:
// this browser in local mode, Firestore users/{uid}/todos when signed in).
// Attachments are metadata only ({id, name, type, size}); the file bytes live
// in the file store. js/views/todos.js is the page.

export const TODO_TITLE_MAX = 200;
export const TODO_NOTE_MAX = 1000;
export const TODO_FILES_MAX = 10;
export const TODO_FILTERS = ['open', 'done', 'all'];
// Folders group to-dos ("Sinag", "CladFlo", …); a to-do with none is in General.
export const TODO_GROUP_MAX = 60;
export const TODO_DEFAULT_GROUP = 'General';

const todoText = value => (value === null || value === undefined ? '' : String(value));

/** A folder name: trimmed, single spaces, capped; blank is General. */
export function todoGroupName(value) {
  const name = todoText(value).trim().replace(/\s+/g, ' ').slice(0, TODO_GROUP_MAX).trim();
  return name || TODO_DEFAULT_GROUP;
}

const groupKey = name => todoGroupName(name).toLowerCase();
const validIso = value => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : '');

/** One attachment's metadata, or null when it has no id or name. */
export function normalizeTodoFile(file) {
  if (!file || typeof file !== 'object') return null;
  const id = todoText(file.id).trim();
  const name = todoText(file.name).trim();
  if (!id || !name) return null;
  const size = Math.max(0, Math.floor(Number(file.size) || 0));
  return { id, name, type: todoText(file.type).trim(), size };
}

const normalizeFiles = files => (Array.isArray(files) ? files.map(normalizeTodoFile).filter(Boolean).slice(0, TODO_FILES_MAX) : []);

/** A stored to-do made safe to show: trimmed and capped text, a real done flag. */
export function normalizeTodo(raw = {}) {
  const done = raw.done === true;
  return {
    ...raw,
    title: todoText(raw.title).trim().slice(0, TODO_TITLE_MAX),
    note: todoText(raw.note).trim().slice(0, TODO_NOTE_MAX),
    group: todoGroupName(raw.group),
    done,
    doneAt: done ? validIso(raw.doneAt) : '',
    attachments: normalizeFiles(raw.attachments)
  };
}

export const TODO_EMPTY_ERROR = 'Write a note or attach a file.';

/**
 * Why an item can't be saved, or ''. A note or at least one attachment is
 * enough; the title is optional (new items have none, older ones keep theirs).
 * `attachments`: saved metas or files waiting to be uploaded, only counted.
 */
export function validateTodo({ title, note, attachments } = {}) {
  const cleanTitle = todoText(title).trim();
  const cleanNote = todoText(note).trim();
  const fileCount = Array.isArray(attachments) ? attachments.length : 0;
  if (!cleanTitle && !cleanNote && !fileCount) return TODO_EMPTY_ERROR;
  if (cleanTitle.length > TODO_TITLE_MAX) return `Keep the title to ${TODO_TITLE_MAX} characters.`;
  if (cleanNote.length > TODO_NOTE_MAX) return `Keep the note to ${TODO_NOTE_MAX} characters.`;
  if (fileCount > TODO_FILES_MAX) return `An item can hold up to ${TODO_FILES_MAX} files.`;
  return '';
}

/** The text a list or a confirm shows for an item: its title, else its note, else its first file. */
export function todoLabel(todo) {
  const text = todoText(todo.title).trim() || todoText(todo.note).trim().split('\n')[0];
  if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  const [file] = Array.isArray(todo.attachments) ? todo.attachments : [];
  return file && file.name ? file.name : 'this item';
}

/** A new open to-do from the form: {todo} to save, or {error}. */
export function newTodo(fields = {}) {
  const error = validateTodo(fields);
  if (error) return { error };
  return { todo: normalizeTodo({ title: fields.title, note: fields.note, group: fields.group, done: false, doneAt: '', attachments: fields.attachments }) };
}

/** Edit the title, note, folder or files: {todo} with the changes, or {error}. Done state is kept. */
export function editTodo(todo, fields = {}) {
  const next = {
    title: fields.title !== undefined ? fields.title : todo.title,
    note: fields.note !== undefined ? fields.note : todo.note
  };
  const attachments = fields.attachments !== undefined ? fields.attachments : todo.attachments;
  const error = validateTodo({ ...next, attachments });
  if (error) return { error };
  const group = fields.group !== undefined ? fields.group : todo.group;
  return { todo: normalizeTodo({ ...todo, ...next, group, attachments }) };
}

/**
 * Folder names in use, A–Z (General last), each spelled as first used.
 * Names differing only in case are one folder.
 */
export function todoGroups(list) {
  const names = new Map();
  for (const todo of list) {
    const key = groupKey(todo.group);
    if (!names.has(key)) names.set(key, todoGroupName(todo.group));
  }
  const general = TODO_DEFAULT_GROUP.toLowerCase();
  return [...names.entries()]
    .sort(([a], [b]) => (a === general) - (b === general) || a.localeCompare(b))
    .map(([, name]) => name);
}

/** The to-dos as folders [{name, todos}] in todoGroups order, each sorted (sortTodos). */
export function groupTodos(list) {
  return todoGroups(list).map(name => ({
    name,
    todos: sortTodos(list.filter(todo => groupKey(todo.group) === name.toLowerCase()))
  }));
}

/** Tick done (stamped now) or open again. */
export function toggleDone(todo, now = new Date()) {
  const done = !todo.done;
  return { ...todo, done, doneAt: done ? now.toISOString() : '' };
}

const stamp = value => Date.parse(value) || 0;

/** Open first (newest added first), then done (most recently done first). Does not mutate. */
export function sortTodos(list) {
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) return stamp(b.doneAt) - stamp(a.doneAt);
    return stamp(b.createdAt) - stamp(a.createdAt);
  });
}

/** {open, done, all} totals for the filter tabs. */
export function todoCounts(list) {
  const done = list.filter(todo => todo.done).length;
  return { open: list.length - done, done, all: list.length };
}

/** The to-dos one filter tab shows, sorted; an unknown filter shows all. */
export function filterTodos(list, filter = 'open') {
  const sorted = sortTodos(list);
  if (filter === 'open') return sorted.filter(todo => !todo.done);
  if (filter === 'done') return sorted.filter(todo => todo.done);
  return sorted;
}
