// Client page: pick a client, then see everything about them in one place:
// Follow up / Add to calendar / Add minutes (client-actions.js), the merged
// timeline with any number of comments, the task | owner | due list, time and
// expenses (client-work.js), and the mount point the AI panel fills. Logic
// lives in timeline.js and timetrack.js; these files are the DOM.
//
// With no client open it lists every client (client-list.js); Back returns to
// where the client was opened from: Home, or this list.
//
// Hooks: listens to 'open-client' {name, from} (any feature can deep-link here) and
// emits 'client-render' {client, mount} after every render, for the AI panel.

import { toDateKey, formatDayLabel } from '../calendar.js';
import { STATUS_LABELS, clientKey } from '../storage.js';
import { dealFor, formatMoney, formatTotals } from '../deals.js';
import {
  TIMELINE_KINDS, TIMELINE_LABELS, clientTimeline, filterTimeline, timelineCounts, addNote, removeNote,
  validateTask, taskRecord, taskState, clientTasks, newActionItems
} from '../timeline.js';
import { clientSessions, totalMinutes, formatDuration, clientExpenses, expenseTotals } from '../timetrack.js';
import { el, icon, withBusy, STATUS_ICONS } from '../ui.js';
import { runWithToast } from '../banner.js';
import { cpSay, cpCanWrite, cpButton, cpField, cpInput, cpForm, cpOnSubmit, cpCard } from './client-dom.js';
import {
  buildTimeCard, buildExpensesCard, renderClientTime, renderClientExpenses, tickTimer, bindWorkLists
} from './client-work.js';
import { renderClientActions } from './client-actions.js';
import { buildClientList, renderClientList } from './client-list.js';

const CLIENT_KEY = 'cladflo.client.v1';
const KIND_ICONS = {
  reminder: 'fa-bell', note: 'fa-note-sticky', minutes: 'fa-file-lines',
  activity: 'fa-arrow-right-arrow-left', time: 'fa-stopwatch', expense: 'fa-receipt'
};

// The open client's name and the timeline filter, kept across renders.
// from: 'home' | 'list', where Back goes.
const profileState = { name: readSavedClient(), filter: '', from: 'list' };
// The page's fixed parts, built once in bind so typing survives re-renders.
let parts = null;

function readSavedClient() {
  try {
    return localStorage.getItem(CLIENT_KEY) || '';
  } catch (err) {
    return '';
  }
}

/** Open a client's profile ('' = the list). `from` is where Back returns: 'home' or 'list'. */
function selectClient(app, name, from = 'list') {
  profileState.name = name;
  profileState.filter = '';
  profileState.from = from;
  if (name && typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
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

// ---------- comments (kept as `notes` on the client's record) ----------

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
  const saved = await runWithToast({
    busy: `Adding a comment for ${client.name}…`,
    done: `Comment added for ${client.name}`,
    body: notes[0].text.slice(0, 120),
    failed: `Could not add the comment for ${client.name}`
  }, () => saveProfileNotes(app, client, notes));
  if (!saved.ok) {
    cpSay(status, 'The comment was not saved. Try again.', true);
    return false;
  }
  app.log('create', 'client', 'Comment', client.name, notes[0].text.slice(0, 80));
  cpSay(status, 'Comment added.');
  return true;
}

async function deleteNote(app, id) {
  const client = currentProfileClient(app);
  if (!client || !cpCanWrite(app, parts.noteStatus) || !confirm('Delete this comment?')) return;
  const saved = await runWithToast({
    busy: `Removing the comment from ${client.name}…`,
    done: `Comment removed from ${client.name}`,
    failed: 'Could not remove the comment'
  }, () => saveProfileNotes(app, client, removeNote(profileRecord(app, client).notes, id)));
  if (saved.ok) app.log('delete', 'client', 'Comment', client.name, 'Removed a comment');
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

// ---------- building the page (once) ----------

function buildTimelineCard(app) {
  const section = cpCard('Timeline', 'fa-timeline', 'client-timeline');
  const note = el('textarea');
  note.name = 'note';
  note.rows = 3;
  note.placeholder = 'Add a comment about this client…';
  note.setAttribute('aria-label', 'New comment');
  const noteForm = cpForm('note-form', [note], 'Add comment');
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

function buildPage(app, page) {
  const head = el('div', 'page-head');
  const text = el('div');
  const back = cpButton('Back to Home', 'ghost page-back', 'fa-arrow-left');
  back.addEventListener('click', () => backFromClient(app));
  const sub = el('p', 'page-sub');
  text.append(back, el('h2', 'page-title', 'Client'), sub);
  head.append(text);

  const listCard = buildClientList(() => app.render());

  const profile = el('div', 'client-profile');
  const header = el('section', 'dash-card client-header');
  const headerInfo = el('div', 'client-header-info');
  const actionBar = el('div', 'client-actions');
  actionBar.setAttribute('role', 'group');
  actionBar.setAttribute('aria-label', 'Client actions');
  header.append(headerInfo, actionBar);
  const ctx = { current: () => currentProfileClient(app) };
  const timeline = buildTimelineCard(app);
  const tasks = buildTasksCard(app);
  const time = buildTimeCard(app, ctx);
  const expenses = buildExpensesCard(app, ctx);
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
  page.append(head, listCard, profile);

  parts = { page, back, sub, listCard, profile, header: headerInfo, actionBar, aiMount, ...timeline, ...tasks, ...time, ...expenses };
  // client-work.js renders the Time and Expenses cards (and ticks the clock) from these.
  parts.work = { ...time, ...expenses, page };
  bindLists(app);
  bindWorkLists(app, page, parts.taskStatus);
}

/** Clicks inside the re-rendered lists, bound once on their containers. */
function bindLists(app) {
  parts.filters.addEventListener('click', e => {
    const chip = e.target.closest('button[data-kind]');
    if (!chip) return;
    profileState.filter = chip.dataset.kind;
    app.render();
  });
  parts.list.addEventListener('click', async e => {
    const target = e.target.closest('button[data-action]');
    if (!target) return;
    const { action, ref } = target.dataset;
    if (action === 'open-reminder') app.openReminder(ref);
    else if (action === 'tasks-from-minutes') await withBusy(target, () => addActionItems(app, ref, parts.taskStatus));
    else if (action === 'delete-note') await deleteNote(app, ref);
  });
  parts.taskList.addEventListener('change', e => {
    const box = e.target.closest('input[data-task]');
    if (box && cpCanWrite(app, parts.taskStatus)) app.store.update('tasks', box.dataset.task, { done: box.checked });
  });
  parts.taskList.addEventListener('click', e => {
    const remove = e.target.closest('button[data-task]');
    if (remove && cpCanWrite(app, parts.taskStatus) && confirm('Delete this task?')) app.store.remove('tasks', remove.dataset.task);
  });
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
  stat('Invoices', formatTotals(expenseTotals(clientExpenses(app.store.all('expenses'), client.name))) || '—');
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
  if (entry.duplicate) body.appendChild(el('span', 'timeline-tag dup-badge', 'Duplicate'));
  if (entry.kind === 'reminder' && !entry.onCalendar) body.appendChild(el('span', 'timeline-tag is-off', 'Home only'));
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
  if (entry.kind === 'note') action('Delete', 'delete-note', 'fa-trash', 'Delete comment');
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
  if (!shown.length) parts.list.appendChild(el('li', 'timeline-empty', 'Nothing yet: add a comment, a task or a follow-up.'));
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

/** Back: to Home when the client was opened there, else to the list of every client. */
function backFromClient(app) {
  const from = profileState.from;
  selectClient(app, '');
  if (from === 'home') app.setView('dashboard');
}

function renderClientPage(app) {
  const client = app.state.loading ? null : currentProfileClient(app);
  parts.listCard.hidden = Boolean(client);
  parts.profile.hidden = !client;
  parts.back.hidden = !client;
  parts.back.lastChild.textContent = profileState.from === 'home' ? 'Back to Home' : 'Back to all clients';
  parts.sub.textContent = client
    ? 'Timeline, tasks, time and invoices for one client.'
    : 'Every client, once. Pick one to see its details.';
  if (!client) {
    renderClientList(app.clients(), {
      loading: app.state.loading,
      onOpen: picked => selectClient(app, picked.name, 'list'),
      onStatus: (name, status) => app.setClientStatus(name, status)
    });
    return;
  }
  renderClientHeader(app, client);
  renderClientActions(app, client, parts.actionBar);
  renderClientTimeline(app, client);
  renderClientTasks(app, client);
  renderClientTime(app, client, parts.work);
  renderClientExpenses(app, client, parts.work);
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
  app.hooks.on('open-client', ({ name, from }) => {
    // Home says from: 'home'; others (Minutes' Back) keep where Back went before.
    selectClient(app, name, from || profileState.from);
    app.setView('client');
  });
  // The Client tab in the navbar always opens on the list.
  const tab = document.querySelector('.views [data-view="client"]');
  if (tab) tab.addEventListener('click', () => selectClient(app, ''));
  setInterval(() => tickTimer(app, parts.work), 1000);
}
