import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  TODO_TITLE_MAX, TODO_NOTE_MAX, TODO_FILES_MAX, TODO_FILTERS, TODO_GROUP_MAX, TODO_EMPTY_ERROR, todoLabel, todoGroupName, todoGroups, groupTodos, normalizeTodoFile, normalizeTodo, validateTodo,
  newTodo, editTodo, toggleDone, sortTodos, todoCounts, filterTodos
} from '../js/todos.js';
import { COLLECTIONS } from '../js/store.js';

const NOW = new Date('2026-10-01T09:00:00Z');
const todo = (id, extra = {}) => ({ id, title: id, note: '', done: false, doneAt: '', attachments: [], ...extra });

test('todos sync through the store as their own collection, apart from client tasks', () => {
  assert(COLLECTIONS.includes('todos'));
  assert(COLLECTIONS.includes('tasks'));
  assertDeepEqual(TODO_FILTERS, ['open', 'done', 'all']);
});

test('validateTodo: a note, a file or an old title is enough; empty is refused; limits stay', () => {
  assertEqual(TODO_EMPTY_ERROR, 'Write a note or attach a file.');
  assertEqual(validateTodo({}), TODO_EMPTY_ERROR);
  assertEqual(validateTodo({ title: '  ', note: ' \n ', attachments: [] }), TODO_EMPTY_ERROR);
  assertEqual(validateTodo({ note: 'Buy printer ink' }), '', 'a note alone, no title');
  assertEqual(validateTodo({ attachments: [{ id: 'f', name: 'a.png' }] }), '', 'a file alone');
  assertEqual(validateTodo({ attachments: [{ name: 'picked.pdf', size: 3 }] }), '', 'files waiting to upload count too');
  assertEqual(validateTodo({ title: 'Old item' }), '', 'an older item with only a title');
  assertEqual(validateTodo({ note: 'n', attachments: Array.from({ length: TODO_FILES_MAX + 1 }, () => ({})) }), 'An item can hold up to 10 files.');
  assertEqual(validateTodo({ title: 'x'.repeat(TODO_TITLE_MAX) }), '');
  assertEqual(validateTodo({ title: 'x'.repeat(TODO_TITLE_MAX + 1) }), 'Keep the title to 200 characters.');
  assertEqual(validateTodo({ title: 'Call Anna', note: 'n'.repeat(TODO_NOTE_MAX) }), '');
  assertEqual(validateTodo({ title: 'Call Anna', note: 'n'.repeat(TODO_NOTE_MAX + 1) }), 'Keep the note to 1000 characters.');
  assertEqual(validateTodo({ title: `  ${'x'.repeat(TODO_TITLE_MAX)}  ` }), '', 'counted after trimming');
});

test('newTodo: a note-only item has no title; an empty one is refused', () => {
  assertDeepEqual(newTodo({ note: ' Renew the domain ', group: 'Sinag' }).todo,
    { title: '', note: 'Renew the domain', group: 'Sinag', done: false, doneAt: '', attachments: [] });
  assertEqual(newTodo({ attachments: [{ id: 'f1', name: 'photo.jpg', size: 10 }] }).todo.attachments.length, 1);
  assertEqual(newTodo({ note: '   ' }).error, TODO_EMPTY_ERROR);
  assertEqual(newTodo({}).todo, undefined);
});

test('newTodo trims, starts open, and refuses an empty item', () => {
  assertDeepEqual(newTodo({ title: '  Send the quote ', note: ' by Friday ' }).todo,
    { title: 'Send the quote', note: 'by Friday', group: 'General', done: false, doneAt: '', attachments: [] });
  assertEqual(newTodo({ title: '' }).error, TODO_EMPTY_ERROR);
  assertEqual(newTodo({ title: '' }).todo, undefined);
});

test('normalizeTodo cleans stored data: capped text, a real done flag, doneAt only when done', () => {
  const clean = normalizeTodo({ id: 't1', title: ` ${'x'.repeat(300)}`, note: 42, done: 'yes', doneAt: '2026-09-30T10:00:00Z', createdAt: 'c' });
  assertEqual(clean.id, 't1');
  assertEqual(clean.createdAt, 'c', 'other fields kept');
  assertEqual(clean.title.length, TODO_TITLE_MAX);
  assertEqual(clean.note, '42');
  assertEqual(clean.done, false);
  assertEqual(clean.doneAt, '');
  assertEqual(normalizeTodo({ title: 'a', done: true, doneAt: 'not a date' }).doneAt, '');
  assertEqual(normalizeTodo({ title: 'a', done: true, doneAt: '2026-09-30T10:00:00Z' }).doneAt, '2026-09-30T10:00:00Z');
  assertDeepEqual(normalizeTodo().attachments, []);
  assertEqual(normalizeTodo({ title: null }).title, '');
});

test('attachments keep only metadata; bad ones are dropped; at most 10', () => {
  assertDeepEqual(normalizeTodoFile({ id: 'f1', name: ' quote.pdf ', type: 'application/pdf', size: '2048.9', data: 'xxx' }),
    { id: 'f1', name: 'quote.pdf', type: 'application/pdf', size: 2048 });
  assertEqual(normalizeTodoFile({ id: 'f1' }), null);
  assertEqual(normalizeTodoFile(null), null);
  assertEqual(normalizeTodoFile({ id: 'f', name: 'n', size: -5 }).size, 0);
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `f${i}`, name: `photo${i}.jpg` }));
  const kept = normalizeTodo({ title: 'a', attachments: [...many, { name: 'no id' }] }).attachments;
  assertEqual(kept.length, TODO_FILES_MAX);
  assertEqual(normalizeTodo({ title: 'a', attachments: 'nope' }).attachments.length, 0);
});

test('editTodo changes the title, note or files and keeps the done state; a blank title is refused', () => {
  const done = todo('t1', { title: 'Old', note: 'keep', done: true, doneAt: '2026-09-30T10:00:00Z', createdAt: 'c' });
  const { todo: edited } = editTodo(done, { title: ' New ' });
  assertEqual(edited.title, 'New');
  assertEqual(edited.note, 'keep', 'unchanged fields stay');
  assertEqual(edited.done, true);
  assertEqual(edited.doneAt, '2026-09-30T10:00:00Z');
  assertEqual(edited.createdAt, 'c');
  assertEqual(editTodo(done, { note: '' }).todo.note, '', 'the note can be cleared');
  assertEqual(editTodo(done, { attachments: [{ id: 'f', name: 'a.png' }] }).todo.attachments.length, 1);
  assertEqual(editTodo(done, { title: '  ' }).todo.note, 'keep', 'the title can go when there is a note');
  assertEqual(editTodo(done, { title: '', note: '' }).error, TODO_EMPTY_ERROR);
  assertEqual(editTodo({ ...done, attachments: [{ id: 'f', name: 'a.png' }] }, { title: '', note: '' }).error, undefined, 'a file keeps it valid');
  assertEqual(editTodo(done, { title: '', note: '', attachments: [] }).error, TODO_EMPTY_ERROR, 'not when the last file goes too');
  assertEqual(done.title, 'Old', 'not mutated');
});

test('toggleDone stamps the time it was done, and clears it when opened again', () => {
  const open = todo('t1');
  const done = toggleDone(open, NOW);
  assertEqual(done.done, true);
  assertEqual(done.doneAt, NOW.toISOString());
  assertEqual(open.done, false, 'not mutated');
  const reopened = toggleDone(done, NOW);
  assertEqual(reopened.done, false);
  assertEqual(reopened.doneAt, '');
});

const LIST = [
  todo('old-open', { createdAt: '2026-09-01T00:00:00Z' }),
  todo('done-early', { done: true, doneAt: '2026-09-20T00:00:00Z', createdAt: '2026-09-02T00:00:00Z' }),
  todo('new-open', { createdAt: '2026-09-30T00:00:00Z' }),
  todo('done-late', { done: true, doneAt: '2026-09-29T00:00:00Z', createdAt: '2026-08-01T00:00:00Z' })
];

test('sortTodos: open first (newest first), then done (most recently done first), without mutating', () => {
  assertDeepEqual(sortTodos(LIST).map(t => t.id), ['new-open', 'old-open', 'done-late', 'done-early']);
  assertEqual(LIST[0].id, 'old-open');
  assertDeepEqual(sortTodos([]), []);
});

test('todoCounts and filterTodos for the Open, Done and All tabs', () => {
  assertDeepEqual(todoCounts(LIST), { open: 2, done: 2, all: 4 });
  assertDeepEqual(todoCounts([]), { open: 0, done: 0, all: 0 });
  assertDeepEqual(filterTodos(LIST, 'open').map(t => t.id), ['new-open', 'old-open']);
  assertDeepEqual(filterTodos(LIST, 'done').map(t => t.id), ['done-late', 'done-early']);
  assertEqual(filterTodos(LIST, 'all').length, 4);
  assertEqual(filterTodos(LIST, 'weird').length, 4, 'unknown filter shows all');
  assertDeepEqual(filterTodos(LIST).map(t => t.id), ['new-open', 'old-open'], 'Open by default');
});

test('todoGroupName: trimmed, single spaces, capped; blank is General', () => {
  assertEqual(todoGroupName('  Sinag  '), 'Sinag');
  assertEqual(todoGroupName('Clad   Flo'), 'Clad Flo');
  assertEqual(todoGroupName(''), 'General');
  assertEqual(todoGroupName(null), 'General');
  assertEqual(todoGroupName('x'.repeat(100)).length, TODO_GROUP_MAX);
  assertEqual(normalizeTodo({ title: 'a' }).group, 'General', 'old to-dos land in General');
  assertEqual(newTodo({ title: 'a', group: ' CladFlo ' }).todo.group, 'CladFlo');
  assertEqual(editTodo(todo('t', { group: 'Sinag' }), { title: 'b' }).todo.group, 'Sinag', 'folder kept on edit');
  assertEqual(editTodo(todo('t', { group: 'Sinag' }), { group: 'CladFlo' }).todo.group, 'CladFlo', 'moved');
});

test('groupTodos: folders A-Z with General last, case-insensitive, each sorted', () => {
  const list = [
    todo('c1', { group: 'CladFlo', createdAt: '2026-09-01T00:00:00Z' }),
    todo('g1', { group: '' }),
    todo('s1', { group: 'Sinag', createdAt: '2026-09-01T00:00:00Z' }),
    todo('c2', { group: 'cladflo', createdAt: '2026-09-30T00:00:00Z' }),
    todo('s2', { group: 'Sinag', done: true, doneAt: '2026-09-29T00:00:00Z' }),
    todo('a1', { group: 'Admin' })
  ];
  assertDeepEqual(todoGroups(list), ['Admin', 'CladFlo', 'Sinag', 'General']);
  assertDeepEqual(groupTodos(list).map(g => [g.name, g.todos.map(t => t.id)]), [
    ['Admin', ['a1']],
    ['CladFlo', ['c2', 'c1']],
    ['Sinag', ['s1', 's2']],
    ['General', ['g1']]
  ]);
  assertDeepEqual(groupTodos([]), []);
});

test('an older item with a title still loads and keeps it', () => {
  const old = normalizeTodo({ id: 'o1', title: 'Call Anna', note: '', group: 'Sinag', done: false, createdAt: '2026-09-01T00:00:00Z' });
  assertEqual(old.title, 'Call Anna');
  assertEqual(old.note, '');
  assertEqual(editTodo(old, { note: 'about the renewal' }).todo.title, 'Call Anna', 'kept on edit');
  assertEqual(normalizeTodo({ note: 'only a note' }).title, '');
});

test('todoLabel: the title, else the first line of the note, else the first file', () => {
  assertEqual(todoLabel({ title: 'Call Anna', note: 'x' }), 'Call Anna');
  assertEqual(todoLabel({ title: '', note: ' Buy ink\nand paper' }), 'Buy ink');
  assertEqual(todoLabel({ note: 'n'.repeat(100) }).length, 80);
  assert(todoLabel({ note: 'n'.repeat(100) }).endsWith('…'));
  assertEqual(todoLabel({ attachments: [{ name: 'scan.pdf' }] }), 'scan.pdf');
  assertEqual(todoLabel({}), 'this item');
});
