// A client's profile, pure: the merged timeline (reminders, notes, meeting
// minutes, status and value changes, time and expenses), the notes kept on the
// client's record in the `clients` collection (the one deals.js reads), and
// the task | owner | due list in the `tasks` collection.

import { toDateKey } from './calendar.js';
import { clientKey } from './storage.js';

export const TIMELINE_KINDS = ['reminder', 'note', 'minutes', 'activity', 'time', 'expense'];
export const TIMELINE_LABELS = {
  reminder: 'Reminders',
  note: 'Notes',
  minutes: 'Minutes',
  activity: 'Activity',
  time: 'Time',
  expense: 'Expenses'
};

export const NOTE_LIMIT = 5000;

const tlText = value => (value === null || value === undefined ? '' : String(value).trim());
const tlPad = n => String(n).padStart(2, '0');
const tlSameClient = (name, key) => clientKey(name) === key;

/** An ISO timestamp as a local 'YYYY-MM-DDTHH:MM' sort key ('' if unreadable). */
export function localStamp(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return `${toDateKey(date)}T${tlPad(date.getHours())}:${tlPad(date.getMinutes())}`;
}

function tlItem(kind, id, sort, title, detail = '', extra = {}) {
  return { kind, id: `${kind}:${id}`, sort, date: sort.slice(0, 10), time: sort.slice(11, 16), title, detail, ...extra };
}

/**
 * Everything about one client, newest first. Reminders still ahead of `now`
 * are marked upcoming. History adds only status and value changes (reminders
 * and minutes already have their own items).
 */
export function clientTimeline({ name, events = [], meetings = [], history = [], profile = null, time = [], expenses = [] }, now = new Date()) {
  const key = clientKey(name);
  if (!key) return [];
  const nowStamp = localStamp(now.toISOString());
  const items = [];

  for (const evt of events) {
    if (!tlSameClient(evt.clientName, key) || !evt.date) continue;
    const sort = `${evt.date}T${evt.time || '00:00'}`;
    items.push(tlItem('reminder', evt.id, sort, tlText(evt.title) || 'Reminder', tlText(evt.notes), {
      ref: evt.id, upcoming: sort >= nowStamp, allDay: !evt.time
    }));
  }
  for (const note of (profile && Array.isArray(profile.notes)) ? profile.notes : []) {
    const sort = localStamp(note.at);
    if (sort) items.push(tlItem('note', note.id, sort, 'Note', tlText(note.text), { ref: note.id }));
  }
  for (const meeting of meetings) {
    if (!tlSameClient(meeting.clientName, key) || !meeting.date) continue;
    const at = localStamp(meeting.createdAt);
    const sort = `${meeting.date}T${at && at.startsWith(meeting.date) ? at.slice(11) : '00:00'}`;
    items.push(tlItem('minutes', meeting.id, sort, tlText(meeting.title) || 'Meeting minutes', tlText(meeting.summary), {
      ref: meeting.id, actionItems: meeting.actionItems || [], allDay: sort.endsWith('T00:00')
    }));
  }
  for (const entry of history) {
    if (!tlSameClient(entry.client, key)) continue;
    const valueChange = entry.kind === 'client' && entry.action === 'edit';
    if (entry.action !== 'status' && !valueChange) continue;
    const sort = localStamp(entry.at);
    if (sort) items.push(tlItem('activity', entry.id, sort, entry.action === 'status' ? 'Status changed' : 'Updated', tlText(entry.detail)));
  }
  for (const session of time) {
    if (!tlSameClient(session.clientName, key) || !session.end) continue;
    const sort = localStamp(session.start);
    if (sort) items.push(tlItem('time', session.id, sort, 'Time logged', tlText(session.note), { minutes: session.minutes || 0 }));
  }
  for (const expense of expenses) {
    if (!tlSameClient(expense.clientName, key) || !expense.date) continue;
    const at = localStamp(expense.createdAt);
    const sort = `${expense.date}T${at && at.startsWith(expense.date) ? at.slice(11) : '00:00'}`;
    items.push(tlItem('expense', expense.id, sort, tlText(expense.category) || 'Expense', tlText(expense.note), {
      amount: expense.amount, currency: expense.currency, allDay: sort.endsWith('T00:00')
    }));
  }
  return items.sort((a, b) => b.sort.localeCompare(a.sort) || a.id.localeCompare(b.id));
}

/** Only one kind ('' = all). */
export function filterTimeline(items, kind = '') {
  return kind ? items.filter(entry => entry.kind === kind) : items;
}

/** How many items of each kind, for the filter chips. */
export function timelineCounts(items) {
  const counts = Object.fromEntries(TIMELINE_KINDS.map(kind => [kind, 0]));
  for (const entry of items) counts[entry.kind] += 1;
  return counts;
}

// ---------- notes (on the client's record) ----------

const tlNoteId = () => `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * The notes with a new one first.
 * @throws when the text is blank or too long.
 */
export function addNote(notes, text, now = new Date()) {
  const body = tlText(text);
  if (!body) throw new Error('Write the note first.');
  if (body.length > NOTE_LIMIT) throw new Error(`Keep a note under ${NOTE_LIMIT.toLocaleString('en-US')} characters.`);
  return [{ id: tlNoteId(), text: body, at: now.toISOString() }, ...(Array.isArray(notes) ? notes : [])];
}

export function removeNote(notes, id) {
  return (Array.isArray(notes) ? notes : []).filter(note => note.id !== id);
}

// ---------- tasks: task | owner | due ----------

/** 'YYYY-MM-DD' or day-first '28/09/2026' (also 28-09-2026, 28.09.2026) → a date key; '' blank; null invalid. */
export function parseDue(value) {
  const raw = tlText(value);
  if (!raw) return '';
  let y;
  let m;
  let d;
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, y, m, d] = match.map(Number);
  else if ((match = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = match.map(Number);
  else return null;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? toDateKey(date) : null;
}

/**
 * A task from the form, or from one "task | owner | due" line.
 * @returns {{task: object|null, error: string}}
 */
export function validateTask(input) {
  const source = typeof input === 'string'
    ? (([task = '', owner = '', due = '']) => ({ task, owner, due }))(input.split('|'))
    : input || {};
  const task = tlText(source.task);
  if (!task) return { task: null, error: 'Say what needs doing.' };
  if (task.length > 300) return { task: null, error: 'Keep the task under 300 characters.' };
  const due = parseDue(source.due);
  if (due === null) return { task: null, error: 'Use a due date like 28/09/2026.' };
  return { task: { task, owner: tlText(source.owner).slice(0, 80), due }, error: '' };
}

/** What to store for a new task of this client. */
export function taskRecord(name, fields, extra = {}) {
  return { clientKey: clientKey(name), clientName: tlText(name).replace(/\s+/g, ' '), ...fields, done: false, ...extra };
}

/** 'done' | 'overdue' | 'today' | 'open'. */
export function taskState(task, today) {
  if (task.done) return 'done';
  if (!task.due) return 'open';
  if (task.due < today) return 'overdue';
  return task.due === today ? 'today' : 'open';
}

/** One client's tasks: open ones by due date (undated last), then done ones, newest done first. */
export function clientTasks(tasks, name) {
  const key = clientKey(name);
  const mine = tasks.filter(task => task.clientKey === key || tlSameClient(task.clientName, key));
  const open = mine.filter(task => !task.done)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || tlText(a.task).localeCompare(tlText(b.task)));
  const done = mine.filter(task => task.done)
    .sort((a, b) => tlText(b.updatedAt).localeCompare(tlText(a.updatedAt)));
  return [...open, ...done];
}

/** A meeting's action items that are not tasks of this client yet. */
export function newActionItems(meeting, tasks) {
  const key = clientKey(meeting.clientName);
  const known = new Set(tasks.filter(t => t.clientKey === key).map(t => tlText(t.task).toLowerCase()));
  return (meeting.actionItems || [])
    .map(action => validateTask({ ...action, due: parseDue(action.due) === null ? '' : action.due }).task)
    .filter(task => task && !known.has(task.task.toLowerCase()));
}

/** Clients to pick from: named clients A–Z (from buildClients). */
export function pickableClients(clients) {
  return clients.filter(c => c.key).map(c => c.name).sort((a, b) => a.localeCompare(b));
}
