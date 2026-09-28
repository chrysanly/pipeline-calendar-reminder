// Client page: pick a client, then see everything about them in one place:
// the merged timeline with notes, the task | owner | due list, a session timer
// with hand-entered time, the expense log, and the mount point the AI panel
// fills. Logic lives in timeline.js and timetrack.js; this file is the DOM.
//
// Hooks: listens to 'open-client' {name} (any feature can deep-link here) and
// emits 'client-render' {client, mount} after every render, for the AI panel.

import { toDateKey, formatDayLabel } from '../calendar.js';
import { STATUS_LABELS, clientKey } from '../storage.js';
import { CURRENCIES } from '../store.js';
import { dealFor, formatMoney, formatTotals } from '../deals.js';
import {
  TIMELINE_KINDS, TIMELINE_LABELS, clientTimeline, filterTimeline, timelineCounts, addNote, removeNote,
  validateTask, taskRecord, taskState, clientTasks, newActionItems, pickableClients
} from '../timeline.js';
import {
  EXPENSE_CATEGORIES, runningSession, startSession, stopSession, formatClock, formatDuration, manualSession,
  clientSessions, totalMinutes, validateExpense, expenseRecord, clientExpenses, expenseTotals
} from '../timetrack.js';
import { el, icon, withBusy, STATUS_ICONS } from '../ui.js';

const CLIENT_KEY = 'cladflo.client.v1';
const KIND_ICONS = {
  reminder: 'fa-bell', note: 'fa-note-sticky', minutes: 'fa-file-lines',
  activity: 'fa-arrow-right-arrow-left', time: 'fa-stopwatch', expense: 'fa-receipt'
};

// The open client's name and the timeline filter, kept across renders.
const profileState = { name: readSavedClient(), filter: '' };
// The page's fixed parts, built once in bind so typing survives re-renders.
let parts = null;

function readSavedClient() {
  try {
    return localStorage.getItem(CLIENT_KEY) || '';
  } catch (err) {
    return '';
  }
}

function selectClient(app, name) {
  profileState.name = name;
  profileState.filter = '';
  try {
    localStorage.setItem(CLIENT_KEY, name);
  } catch (err) {
    // the pick just won't survive a reload
  }
  for (const node of parts.page.querySelectorAll('.form-status')) node.textContent = '';
  app.render();
}

const currentProfileClient = app => {
  const key = clientKey(profileState.name);
  return key ? app.clients().find(c => c.key === key) || null : null;
};

const profileRecord = (app, client) => dealFor(app.store.all('clients'), client.name);

function cpSay(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

/** Saves need a backend (local mode, or signed in). */
function cpCanWrite(app, status) {
  if (app.canSave()) return true;
  cpSay(status, 'Sign in first.', true);
  return false;
}

// ---------- small DOM builders ----------

function cpButton(text, className, iconName, label) {
  const node = el('button', className);
  node.type = 'button';
  if (iconName) node.append(icon(iconName), ' ');
  node.append(text);
  if (label) node.setAttribute('aria-label', label);
  return node;
}

function cpField(labelText, control) {
  const label = el('label', 'client-field');
  label.append(labelText, control);
  return label;
}

function cpInput(name, { type = 'text', placeholder = '', inputMode } = {}) {
  const node = el('input');
  node.type = type;
  node.name = name;
  node.placeholder = placeholder;
  node.autocomplete = 'off';
  if (inputMode) node.inputMode = inputMode;
  return node;
}

function cpSelect(name, values, labels = {}) {
  const node = el('select');
  node.name = name;
  for (const value of values) {
    const option = el('option', '', labels[value] || value);
    option.value = value;
    node.appendChild(option);
  }
  return node;
}

function cpCard(title, iconName, className) {
  const section = el('section', `dash-card client-card ${className}`);
  const heading = el('h3', 'dash-title');
  heading.append(icon(iconName), ' ', title);
  section.appendChild(heading);
  return section;
}

function cpForm(className, fields, submitText) {
  const node = el('form', `stack-form ${className}`);
  node.noValidate = true;
  const status = el('p', 'form-status');
  status.setAttribute('role', 'status');
  const submit = cpButton(submitText, 'primary', 'fa-plus');
  submit.type = 'submit';
  node.append(...fields, submit, status);
  return { node, status, submit };
}

// ---------- notes ----------

async function saveNote(app, text, status) {
  const client = currentProfileClient(app);
  if (!client || !cpCanWrite(app, status)) return false;
  let notes;
  try {
    notes = addNote((profileRecord(app, client) || {}).notes, text);
  } catch (err) {
    cpSay(status, err.message, true);
    return false;
  }
  await saveProfileNotes(app, client, notes);
  app.log('create', 'client', 'Note', client.name, notes[0].text.slice(0, 80));
  cpSay(status, 'Note added.');
  return true;
}

function saveProfileNotes(app, client, notes) {
  const record = profileRecord(app, client);
  if (record) return app.store.update('clients', record.id, { notes });
  return app.store.add('clients', { key: client.key, name: client.name, notes });
}

// ---------- tasks ----------

async function saveTask(app, fields, status, extra = {}) {
  const client = currentProfileClient(app);
  if (!client || !cpCanWrite(app, status)) return false;
  const { task, error } = validateTask(fields);
  if (error) {
    cpSay(status, error, true);
    return false;
  }
  await app.store.add('tasks', taskRecord(client.name, task, extra));
  app.log('create', 'client', task.task, client.name, 'Task added');
  cpSay(status, 'Task added.');
  return true;
}

async function addActionItems(app, meetingId, status) {
  const client = currentProfileClient(app);
  const meeting = app.state.meetings.find(m => m.id === meetingId);
  if (!client || !meeting || !cpCanWrite(app, status)) return;
  const items = newActionItems(meeting, app.store.all('tasks'));
  for (const item of items) await app.store.add('tasks', taskRecord(client.name, item, { meetingId }));
  cpSay(status, `Added ${items.length} task${items.length === 1 ? '' : 's'} from "${meeting.title}".`);
}

// ---------- time ----------

async function toggleTimer(app, status) {
  if (!cpCanWrite(app, status)) return;
  const sessions = app.store.all('time');
  const running = runningSession(sessions);
  if (running) {
    const patch = stopSession(running, new Date(), parts.timerNote.value);
    await app.store.update('time', running.id, patch);
    parts.timerNote.value = '';
    app.log('create', 'client', 'Time logged', running.clientName, formatDuration(patch.minutes));
    cpSay(status, `Logged ${formatDuration(patch.minutes)} for ${running.clientName}.`);
    return;
  }
  const client = currentProfileClient(app);
  if (!client) return;
  await app.store.add('time', startSession(client.name));
  cpSay(status, 'Timer started.');
}

async function saveManualTime(app, values, status) {
  const client = currentProfileClient(app);
  if (!client || !cpCanWrite(app, status)) return false;
  const { session, error } = manualSession(client.name, values);
  if (error) {
    cpSay(status, error, true);
    return false;
  }
  await app.store.add('time', session);
  app.log('create', 'client', 'Time logged', client.name, formatDuration(session.minutes));
  cpSay(status, `Added ${formatDuration(session.minutes)}.`);
  return true;
}

function tickTimer(app) {
  if (!parts || parts.page.hidden) return;
  const running = runningSession(app.store.all('time'));
  if (running) parts.clock.textContent = formatClock(Date.now() - new Date(running.start).getTime());
}

// ---------- expenses ----------

async function saveExpense(app, values, status) {
  const client = currentProfileClient(app);
  if (!client || !cpCanWrite(app, status)) return false;
  const { expense, errors } = validateExpense(values, app.settings().currency);
  const problems = Object.values(errors);
  if (problems.length) {
    cpSay(status, problems.join(' '), true);
    return false;
  }
  await app.store.add('expenses', expenseRecord(client.name, expense));
  app.log('create', 'client', `${expense.category} expense`, client.name, formatMoney(expense.amount, expense.currency));
  cpSay(status, 'Expense added.');
  return true;
}

// ---------- building the page (once) ----------

function cpOnSubmit(formParts, action) {
  formParts.node.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(formParts.submit, action);
  });
}

function buildPicker(app) {
  const picker = el('form', 'client-picker');
  picker.noValidate = true;
  const pick = cpInput('client', { type: 'search', placeholder: 'Type a client name…' });
  pick.id = 'client-pick';
  pick.setAttribute('list', 'client-pick-list');
  pick.setAttribute('aria-label', 'Client');
  const list = el('datalist');
  list.id = 'client-pick-list';
  const open = cpButton('Open', 'primary', 'fa-address-card');
  open.type = 'submit';
  const status = el('p', 'form-status');
  status.setAttribute('role', 'status');
  picker.append(pick, list, open, status);
  picker.addEventListener('submit', e => {
    e.preventDefault();
    const client = app.clients().find(c => c.key && c.key === clientKey(pick.value));
    if (!client) {
      cpSay(status, pick.value.trim() ? `No client called "${pick.value.trim()}".` : 'Type a client name.', true);
      return;
    }
    cpSay(status, '');
    pick.value = '';
    selectClient(app, client.name);
  });
  return { picker, list, pick };
}

function buildTimelineCard(app) {
  const section = cpCard('Timeline', 'fa-timeline', 'client-timeline');
  const note = el('textarea');
  note.name = 'note';
  note.rows = 3;
  note.placeholder = 'Add a note about this client…';
  note.setAttribute('aria-label', 'New note');
  const noteForm = cpForm('note-form', [note], 'Add note');
  cpOnSubmit(noteForm, async () => {
    if (await saveNote(app, note.value, noteForm.status)) note.value = '';
  });
  const filters = el('div', 'timeline-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Show');
  const list = el('ol', 'timeline-list');
  section.append(noteForm.node, filters, list);
  return { section, filters, list, noteStatus: noteForm.status };
}

function buildTasksCard(app) {
  const section = cpCard('Tasks', 'fa-list-check', 'client-tasks');
  const task = cpInput('task', { placeholder: 'Send the proposal' });
  const owner = cpInput('owner', { placeholder: 'Anna' });
  const due = cpInput('due', { placeholder: 'DD/MM/YYYY', inputMode: 'numeric' });
  const row = el('div', 'row');
  row.append(cpField('Owner', owner), cpField('Due', due));
  const hint = el('p', 'form-hint', 'Or type "task | owner | due" in the task box.');
  const taskForm = cpForm('task-form', [cpField('Task', task), row, hint], 'Add task');
  cpOnSubmit(taskForm, async () => {
    const fields = task.value.includes('|') ? task.value : { task: task.value, owner: owner.value, due: due.value };
    if (await saveTask(app, fields, taskForm.status)) task.value = owner.value = due.value = '';
  });
  const list = el('ul', 'task-list');
  section.append(taskForm.node, list);
  return { section, taskList: list, taskStatus: taskForm.status };
}

function buildTimeCard(app) {
  const section = cpCard('Time', 'fa-stopwatch', 'client-time');
  const clock = el('p', 'timer-clock', '0:00:00');
  clock.setAttribute('aria-live', 'off');
  const timerFor = el('p', 'timer-for');
  const timerNote = cpInput('timerNote', { placeholder: 'What are you working on? (optional)' });
  timerNote.setAttribute('aria-label', 'Timer note');
  const timerBtn = cpButton('Start timer', 'primary timer-toggle', 'fa-play');
  const timerStatus = el('p', 'form-status');
  timerStatus.setAttribute('role', 'status');
  timerBtn.addEventListener('click', () => withBusy(timerBtn, () => toggleTimer(app, timerStatus)));
  const timer = el('div', 'timer');
  timer.append(clock, timerFor, timerNote, timerBtn, timerStatus);

  const duration = cpInput('duration', { placeholder: '1:30' });
  const date = cpInput('date', { type: 'date' });
  const note = cpInput('note', { placeholder: 'Workshop prep' });
  const row = el('div', 'row');
  row.append(cpField('Time spent', duration), cpField('Day', date));
  const manual = cpForm('time-form', [row, cpField('Note', note)], 'Add time');
  cpOnSubmit(manual, async () => {
    if (await saveManualTime(app, { duration: duration.value, date: date.value, note: note.value }, manual.status)) duration.value = note.value = '';
  });
  const total = el('p', 'time-total');
  const list = el('ul', 'session-list');
  section.append(timer, manual.node, total, list);
  return { section, clock, timerFor, timerNote, timerBtn, timeList: list, timeTotal: total, timeDate: date };
}

function buildExpensesCard(app) {
  const section = cpCard('Expenses', 'fa-receipt', 'client-expenses');
  const date = cpInput('date', { type: 'date' });
  const amount = cpInput('amount', { placeholder: '250', inputMode: 'decimal' });
  const currency = cpSelect('currency', CURRENCIES);
  const category = cpSelect('category', EXPENSE_CATEGORIES);
  const note = cpInput('note', { placeholder: 'Taxi to the site visit' });
  const row1 = el('div', 'row');
  row1.append(cpField('Amount', amount), cpField('Currency', currency));
  const row2 = el('div', 'row');
  row2.append(cpField('Date', date), cpField('Category', category));
  const expenseForm = cpForm('expense-form', [row1, row2, cpField('Note', note)], 'Add expense');
  cpOnSubmit(expenseForm, async () => {
    const values = { date: date.value, amount: amount.value, currency: currency.value, category: category.value, note: note.value };
    if (await saveExpense(app, values, expenseForm.status)) amount.value = note.value = '';
  });
  const totals = el('p', 'expense-total');
  const list = el('ul', 'expense-list');
  section.append(expenseForm.node, totals, list);
  return { section, expenseList: list, expenseTotal: totals, expenseDate: date, expenseCurrency: currency };
}

function buildPage(app, page) {
  const head = el('div', 'page-head');
  const text = el('div');
  text.append(el('h2', 'page-title', 'Client'), el('p', 'page-sub', 'Timeline, tasks, time and expenses for one client.'));
  const { picker, list: pickList, pick } = buildPicker(app);
  head.append(text, picker);

  const empty = el('section', 'dash-card client-empty');
  const chooser = el('div', 'client-chooser');
  empty.append(el('h3', 'dash-title', 'Pick a client'), el('p', 'form-hint', 'Or type a name above.'), chooser);

  const profile = el('div', 'client-profile');
  const header = el('section', 'dash-card client-header');
  const timeline = buildTimelineCard(app);
  const tasks = buildTasksCard(app);
  const time = buildTimeCard(app);
  const expenses = buildExpensesCard(app);
  // The AI panel (js/views/ai-panel.js) fills this on 'client-render'.
  const aiMount = el('section', 'client-ai');
  aiMount.id = 'client-ai';
  aiMount.setAttribute('aria-label', 'AI assistant');
  const main = el('div', 'client-main');
  main.append(timeline.section);
  const side = el('div', 'client-side');
  side.append(aiMount, tasks.section, time.section, expenses.section);
  const columns = el('div', 'client-columns');
  columns.append(main, side);
  profile.append(header, columns);
  page.append(head, empty, profile);

  parts = { page, pickList, pick, empty, chooser, profile, header, aiMount, ...timeline, ...tasks, ...time, ...expenses };
  bindLists(app);
}

/** Clicks inside the re-rendered lists, bound once on their containers. */
function bindLists(app) {
  parts.filters.addEventListener('click', e => {
    const chip = e.target.closest('button[data-kind]');
    if (!chip) return;
    profileState.filter = chip.dataset.kind;
    app.render();
  });
  parts.chooser.addEventListener('click', e => {
    const pick = e.target.closest('button[data-client]');
    if (pick) selectClient(app, pick.dataset.client);
  });
  parts.list.addEventListener('click', async e => {
    const target = e.target.closest('button[data-action]');
    if (!target) return;
    const { action, ref } = target.dataset;
    if (action === 'open-reminder') app.openReminder(ref);
    else if (action === 'tasks-from-minutes') await withBusy(target, () => addActionItems(app, ref, parts.taskStatus));
    else if (action === 'delete-note') {
      const client = currentProfileClient(app);
      if (!client || !cpCanWrite(app, parts.noteStatus) || !confirm('Delete this note?')) return;
      await saveProfileNotes(app, client, removeNote(profileRecord(app, client).notes, ref));
    }
  });
  parts.taskList.addEventListener('change', e => {
    const box = e.target.closest('input[data-task]');
    if (box && cpCanWrite(app, parts.taskStatus)) app.store.update('tasks', box.dataset.task, { done: box.checked });
  });
  parts.taskList.addEventListener('click', e => {
    const remove = e.target.closest('button[data-task]');
    if (remove && cpCanWrite(app, parts.taskStatus) && confirm('Delete this task?')) app.store.remove('tasks', remove.dataset.task);
  });
  for (const [selector, collection] of [['.session-list', 'time'], ['.expense-list', 'expenses']]) {
    parts.page.querySelector(selector).addEventListener('click', e => {
      const remove = e.target.closest('button[data-id]');
      if (remove && cpCanWrite(app, parts.taskStatus) && confirm('Delete this entry?')) app.store.remove(collection, remove.dataset.id);
    });
  }
}

// ---------- rendering (every app render) ----------

function timelineWhen(entry) {
  const day = formatDayLabel(entry.date);
  return entry.allDay || !entry.time ? day : `${day}, ${entry.time}`;
}

function renderClientHeader(app, client) {
  const header = parts.header;
  header.innerHTML = '';
  const title = el('div', 'client-title');
  const badge = el('span', `status-badge status-${client.status}`);
  badge.append(icon(STATUS_ICONS[client.status]), ' ', STATUS_LABELS[client.status]);
  title.append(el('h2', 'profile-name', client.name), badge);
  const details = [client.phone, client.location, [client.city, client.country].filter(Boolean).join(', ')].filter(Boolean);
  header.append(title);
  if (details.length) header.append(el('p', 'client-details', details.join(' · ')));

  const record = profileRecord(app, client);
  const sessions = clientSessions(app.store.all('time'), client.name);
  const open = clientTasks(app.store.all('tasks'), client.name).filter(t => !t.done).length;
  const stats = el('dl', 'client-stats');
  const stat = (label, value) => stats.append(el('dt', '', label), el('dd', '', value));
  stat('Deal value', record && record.value ? formatMoney(record.value, record.currency) : '—');
  stat('Reminders', String(client.reminderCount));
  stat('Open tasks', String(open));
  stat('Time', formatDuration(totalMinutes(sessions)));
  stat('Expenses', formatTotals(expenseTotals(clientExpenses(app.store.all('expenses'), client.name))) || '—');
  header.append(stats);
}

function renderTimelineFilters(counts, total) {
  parts.filters.innerHTML = '';
  const chip = (kind, label, count) => {
    const node = cpButton(`${label} (${count})`, `chip-filter${profileState.filter === kind ? ' is-active' : ''}`);
    node.dataset.kind = kind;
    node.setAttribute('aria-pressed', String(profileState.filter === kind));
    parts.filters.appendChild(node);
  };
  chip('', 'All', total);
  for (const kind of TIMELINE_KINDS) if (counts[kind]) chip(kind, TIMELINE_LABELS[kind], counts[kind]);
}

function timelineEntry(app, entry) {
  const li = el('li', `timeline-item kind-${entry.kind}${entry.upcoming ? ' is-upcoming' : ''}`);
  const mark = el('span', 'timeline-icon');
  mark.appendChild(icon(KIND_ICONS[entry.kind]));
  const body = el('div', 'timeline-body');
  const head = el('p', 'timeline-head');
  head.append(el('strong', 'timeline-title', entry.title), el('span', 'timeline-when', timelineWhen(entry)));
  body.appendChild(head);
  if (entry.upcoming) body.appendChild(el('span', 'timeline-tag', 'Upcoming'));
  if (entry.kind === 'time') body.appendChild(el('p', 'timeline-extra', formatDuration(entry.minutes)));
  if (entry.kind === 'expense') body.appendChild(el('p', 'timeline-extra', formatMoney(entry.amount, entry.currency)));
  if (entry.detail) body.appendChild(el('p', 'timeline-detail', entry.detail));

  const actions = el('div', 'timeline-actions');
  const ref = entry.id.slice(entry.kind.length + 1);
  const action = (text, name, iconName, label) => {
    const node = cpButton(text, 'ghost', iconName, label);
    node.dataset.action = name;
    node.dataset.ref = ref;
    actions.appendChild(node);
  };
  if (entry.kind === 'reminder') action('Open', 'open-reminder', 'fa-up-right-from-square', `Open reminder ${entry.title}`);
  if (entry.kind === 'note') action('Delete', 'delete-note', 'fa-trash', 'Delete note');
  if (entry.kind === 'minutes') {
    const meeting = app.state.meetings.find(m => m.id === ref);
    const count = meeting ? newActionItems(meeting, app.store.all('tasks')).length : 0;
    if (count) action(`Add ${count} action item${count === 1 ? '' : 's'} as tasks`, 'tasks-from-minutes', 'fa-list-check');
  }
  if (actions.childElementCount) body.appendChild(actions);
  li.append(mark, body);
  return li;
}

function renderClientTimeline(app, client) {
  const items = clientTimeline({
    name: client.name,
    events: app.state.events,
    meetings: app.state.meetings,
    history: app.state.history,
    profile: profileRecord(app, client),
    time: app.store.all('time'),
    expenses: app.store.all('expenses')
  });
  const counts = timelineCounts(items);
  if (profileState.filter && !counts[profileState.filter]) profileState.filter = '';
  renderTimelineFilters(counts, items.length);
  parts.list.innerHTML = '';
  const shown = filterTimeline(items, profileState.filter);
  for (const entry of shown) parts.list.appendChild(timelineEntry(app, entry));
  if (!shown.length) parts.list.appendChild(el('li', 'timeline-empty', 'Nothing yet: add a note, a task or a reminder.'));
}

function renderClientTasks(app, client) {
  const today = toDateKey(new Date());
  const list = parts.taskList;
  list.innerHTML = '';
  const tasks = clientTasks(app.store.all('tasks'), client.name);
  for (const task of tasks) {
    const state = taskState(task, today);
    const li = el('li', `task-item is-${state}`);
    const label = el('label', 'task-check');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = Boolean(task.done);
    box.dataset.task = task.id;
    label.append(box, el('span', 'task-text', task.task));
    const meta = [task.owner, task.due ? `due ${formatDayLabel(task.due)}` : '', state === 'overdue' ? 'overdue' : state === 'today' ? 'due today' : '']
      .filter(Boolean).join(' · ');
    const remove = cpButton('', 'icon ghost task-delete', 'fa-trash', `Delete task ${task.task}`);
    remove.dataset.task = task.id;
    li.append(label, remove);
    if (meta) li.insertBefore(el('p', 'task-meta', meta), remove);
    list.appendChild(li);
  }
  if (!tasks.length) list.appendChild(el('li', 'list-empty', 'No tasks yet.'));
}

function renderClientTime(app, client) {
  const running = runningSession(app.store.all('time'));
  const here = running && clientKey(running.clientName) === client.key;
  parts.timerBtn.innerHTML = '';
  parts.timerBtn.append(icon(running ? 'fa-stop' : 'fa-play'), ' ', running ? 'Stop timer' : 'Start timer');
  parts.timerBtn.classList.toggle('is-running', Boolean(running));
  parts.timerFor.textContent = running && !here ? `Running for ${running.clientName}: stop it before timing ${client.name}.` : '';
  parts.clock.textContent = running ? formatClock(Date.now() - new Date(running.start).getTime()) : '0:00:00';
  parts.clock.classList.toggle('is-running', Boolean(here));
  if (!parts.timeDate.value) parts.timeDate.value = toDateKey(new Date());

  const sessions = clientSessions(app.store.all('time'), client.name);
  parts.timeTotal.textContent = `Total: ${formatDuration(totalMinutes(sessions))}`;
  parts.timeList.innerHTML = '';
  for (const session of sessions.slice(0, 10)) {
    const li = el('li', 'entry-item');
    const start = new Date(session.start);
    li.append(el('span', 'entry-main', formatDuration(session.minutes)),
      el('span', 'entry-meta', [formatDayLabel(toDateKey(start)), session.note].filter(Boolean).join(' · ')));
    const remove = cpButton('', 'icon ghost', 'fa-trash', `Delete ${formatDuration(session.minutes)} session`);
    remove.dataset.id = session.id;
    li.appendChild(remove);
    parts.timeList.appendChild(li);
  }
  if (!sessions.length) parts.timeList.appendChild(el('li', 'list-empty', 'No time logged yet.'));
}

function renderClientExpenses(app, client) {
  const expenses = clientExpenses(app.store.all('expenses'), client.name);
  if (!parts.expenseDate.value) parts.expenseDate.value = toDateKey(new Date());
  if (!parts.expenseCurrency.dataset.touched) parts.expenseCurrency.value = app.settings().currency;
  parts.expenseTotal.textContent = expenses.length ? `Total: ${formatTotals(expenseTotals(expenses))}` : '';
  parts.expenseList.innerHTML = '';
  for (const expense of expenses) {
    const li = el('li', 'entry-item');
    li.append(el('span', 'entry-main', formatMoney(expense.amount, expense.currency)),
      el('span', 'entry-meta', [formatDayLabel(expense.date), expense.category, expense.note].filter(Boolean).join(' · ')));
    const remove = cpButton('', 'icon ghost', 'fa-trash', `Delete ${expense.category} expense`);
    remove.dataset.id = expense.id;
    li.appendChild(remove);
    parts.expenseList.appendChild(li);
  }
  if (!expenses.length) parts.expenseList.appendChild(el('li', 'list-empty', 'No expenses yet.'));
}

function renderClientChooser(app) {
  const names = pickableClients(app.clients());
  parts.pickList.innerHTML = '';
  for (const name of names) {
    const option = el('option');
    option.value = name;
    parts.pickList.appendChild(option);
  }
  parts.chooser.innerHTML = '';
  for (const name of names) {
    const pick = cpButton(name, 'secondary', 'fa-user');
    pick.dataset.client = name;
    parts.chooser.appendChild(pick);
  }
  if (!names.length) parts.chooser.appendChild(el('p', 'list-empty', 'No clients yet: add a reminder with a client name first.'));
}

function renderClientPage(app) {
  renderClientChooser(app);
  const client = app.state.loading ? null : currentProfileClient(app);
  parts.empty.hidden = Boolean(client);
  parts.profile.hidden = !client;
  if (app.state.loading) {
    parts.chooser.innerHTML = '';
    parts.chooser.appendChild(el('p', 'list-empty', 'Loading…'));
  }
  if (!client) return;
  renderClientHeader(app, client);
  renderClientTimeline(app, client);
  renderClientTasks(app, client);
  renderClientTime(app, client);
  renderClientExpenses(app, client);
  parts.aiMount.dataset.client = client.name;
  app.hooks.emit('client-render', { client, mount: parts.aiMount });
}

/** Feature entry point (js/features.js). */
/**
 * On a phone the nav scrolls (six pages): whenever the current page changes
 * (click, shortcut, reload), bring its button into view.
 */
function keepActiveNavInView() {
  const nav = document.querySelector('.topbar .views');
  if (!nav || typeof MutationObserver === 'undefined') return;
  const reveal = () => {
    const active = nav.querySelector('[aria-current="page"]');
    if (!active || nav.scrollWidth <= nav.clientWidth) return;
    const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
    const right = left + active.offsetWidth;
    if (left < nav.scrollLeft || right > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - (nav.clientWidth - active.offsetWidth) / 2);
    }
  };
  new MutationObserver(reveal).observe(nav, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  reveal();
}

export function registerClientProfile(app) {
  keepActiveNavInView();
  app.views.register({
    id: 'client',
    label: 'Client',
    icon: 'fa-address-card',
    key: 'p',
    css: 'css/client.css',
    bind: buildPage,
    render: renderClientPage
  });
  app.hooks.on('open-client', ({ name }) => {
    selectClient(app, name);
    app.setView('client');
  });
  parts.expenseCurrency.addEventListener('change', () => { parts.expenseCurrency.dataset.touched = '1'; });
  setInterval(() => tickTimer(app), 1000);
}
