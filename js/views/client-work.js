// Client page: the Time card (session timer and hand-entered time) and the
// Invoices card (stored in the `expenses` collection). Logic lives in timetrack.js;
// `ctx.current()` is the open client.

import { toDateKey, formatDayLabel } from '../calendar.js';
import { clientKey } from '../storage.js';
import { CURRENCIES } from '../store.js';
import { formatMoney, formatTotals } from '../deals.js';
import {
  EXPENSE_CATEGORIES, runningSession, startSession, stopSession, formatClock, formatDuration, manualSession,
  clientSessions, totalMinutes, validateExpense, expenseRecord, clientExpenses, expenseTotals
} from '../timetrack.js';
import { el, icon, withBusy } from '../ui.js';
import { cpSay, cpCanWrite, cpButton, cpField, cpInput, cpSelect, cpCard, cpForm, cpOnSubmit } from './client-dom.js';

// ---------- time ----------

async function toggleTimer(app, ctx, work, status) {
  if (!cpCanWrite(app, status)) return;
  const running = runningSession(app.store.all('time'));
  if (running) {
    const patch = stopSession(running, new Date(), work.timerNote.value);
    await app.store.update('time', running.id, patch);
    work.timerNote.value = '';
    app.log('create', 'client', 'Time logged', running.clientName, formatDuration(patch.minutes));
    cpSay(status, `Logged ${formatDuration(patch.minutes)} for ${running.clientName}.`);
    return;
  }
  const client = ctx.current();
  if (!client) return;
  await app.store.add('time', startSession(client.name));
  cpSay(status, 'Timer started.');
}

async function saveManualTime(app, ctx, values, status) {
  const client = ctx.current();
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

/** Every second while the Client page shows: the running clock. */
export function tickTimer(app, work) {
  if (!work || work.page.hidden) return;
  const running = runningSession(app.store.all('time'));
  if (running) work.clock.textContent = formatClock(Date.now() - new Date(running.start).getTime());
}

export function buildTimeCard(app, ctx) {
  const section = cpCard('Time', 'fa-stopwatch', 'client-time');
  const clock = el('p', 'timer-clock', '0:00:00');
  clock.setAttribute('aria-live', 'off');
  const timerFor = el('p', 'timer-for');
  const timerNote = cpInput('timerNote', { placeholder: 'What are you working on? (optional)' });
  timerNote.setAttribute('aria-label', 'Timer note');
  const timerBtn = cpButton('Start timer', 'primary timer-toggle', 'fa-play');
  const timerStatus = el('p', 'form-status');
  timerStatus.setAttribute('role', 'status');
  const work = { section, clock, timerFor, timerNote, timerBtn };
  timerBtn.addEventListener('click', () => withBusy(timerBtn, () => toggleTimer(app, ctx, work, timerStatus)));
  const timer = el('div', 'timer');
  timer.append(clock, timerFor, timerNote, timerBtn, timerStatus);

  const duration = cpInput('duration', { placeholder: '1:30' });
  const date = cpInput('date', { type: 'date' });
  const note = cpInput('note', { placeholder: 'Workshop prep' });
  const row = el('div', 'row');
  row.append(cpField('Time spent', duration), cpField('Day', date));
  const manual = cpForm('time-form', [row, cpField('Note', note)], 'Add time');
  cpOnSubmit(manual, async () => {
    if (await saveManualTime(app, ctx, { duration: duration.value, date: date.value, note: note.value }, manual.status)) duration.value = note.value = '';
  });
  const total = el('p', 'time-total');
  const list = el('ul', 'session-list');
  section.append(timer, manual.node, total, list);
  return Object.assign(work, { timeList: list, timeTotal: total, timeDate: date });
}

export function renderClientTime(app, client, work) {
  const running = runningSession(app.store.all('time'));
  const here = running && clientKey(running.clientName) === client.key;
  work.timerBtn.innerHTML = '';
  work.timerBtn.append(icon(running ? 'fa-stop' : 'fa-play'), ' ', running ? 'Stop timer' : 'Start timer');
  work.timerBtn.classList.toggle('is-running', Boolean(running));
  work.timerFor.textContent = running && !here ? `Running for ${running.clientName}: stop it before timing ${client.name}.` : '';
  work.clock.textContent = running ? formatClock(Date.now() - new Date(running.start).getTime()) : '0:00:00';
  work.clock.classList.toggle('is-running', Boolean(here));
  if (!work.timeDate.value) work.timeDate.value = toDateKey(new Date());

  const sessions = clientSessions(app.store.all('time'), client.name);
  work.timeTotal.textContent = `Total: ${formatDuration(totalMinutes(sessions))}`;
  work.timeList.innerHTML = '';
  for (const session of sessions.slice(0, 10)) {
    const li = el('li', 'entry-item');
    const start = new Date(session.start);
    li.append(el('span', 'entry-main', formatDuration(session.minutes)),
      el('span', 'entry-meta', [formatDayLabel(toDateKey(start)), session.note].filter(Boolean).join(' · ')));
    const remove = cpButton('', 'icon ghost', 'fa-trash', `Delete ${formatDuration(session.minutes)} session`);
    remove.dataset.id = session.id;
    li.appendChild(remove);
    work.timeList.appendChild(li);
  }
  if (!sessions.length) work.timeList.appendChild(el('li', 'list-empty', 'No time logged yet.'));
}

// ---------- expenses ----------

async function saveExpense(app, ctx, values, status) {
  const client = ctx.current();
  if (!client || !cpCanWrite(app, status)) return false;
  const { expense, errors } = validateExpense(values, app.settings().currency);
  const problems = Object.values(errors);
  if (problems.length) {
    cpSay(status, problems.join(' '), true);
    return false;
  }
  await app.store.add('expenses', expenseRecord(client.name, expense));
  app.log('create', 'client', `${expense.category} invoice`, client.name, formatMoney(expense.amount, expense.currency));
  cpSay(status, 'Invoice added.');
  return true;
}

export function buildExpensesCard(app, ctx) {
  const section = cpCard('Invoices', 'fa-file-invoice-dollar', 'client-expenses');
  const date = cpInput('date', { type: 'date' });
  const amount = cpInput('amount', { placeholder: '250', inputMode: 'decimal' });
  const currency = cpSelect('currency', CURRENCIES);
  const category = cpSelect('category', EXPENSE_CATEGORIES);
  const note = cpInput('note', { placeholder: 'Website redesign, phase 1' });
  const row1 = el('div', 'row');
  row1.append(cpField('Amount', amount), cpField('Currency', currency));
  const row2 = el('div', 'row');
  row2.append(cpField('Date', date), cpField('Type', category));
  const expenseForm = cpForm('expense-form', [row1, row2, cpField('Note', note)], 'Add invoice');
  cpOnSubmit(expenseForm, async () => {
    const values = { date: date.value, amount: amount.value, currency: currency.value, category: category.value, note: note.value };
    if (await saveExpense(app, ctx, values, expenseForm.status)) amount.value = note.value = '';
  });
  currency.addEventListener('change', () => { currency.dataset.touched = '1'; });
  const totals = el('p', 'expense-total');
  const list = el('ul', 'expense-list');
  section.append(expenseForm.node, totals, list);
  return { section: section, expenseList: list, expenseTotal: totals, expenseDate: date, expenseCurrency: currency };
}

export function renderClientExpenses(app, client, work) {
  const expenses = clientExpenses(app.store.all('expenses'), client.name);
  if (!work.expenseDate.value) work.expenseDate.value = toDateKey(new Date());
  if (!work.expenseCurrency.dataset.touched) work.expenseCurrency.value = app.settings().currency;
  work.expenseTotal.textContent = expenses.length ? `Total: ${formatTotals(expenseTotals(expenses))}` : '';
  work.expenseList.innerHTML = '';
  for (const expense of expenses) {
    const li = el('li', 'entry-item');
    li.append(el('span', 'entry-main', formatMoney(expense.amount, expense.currency)),
      el('span', 'entry-meta', [formatDayLabel(expense.date), expense.category, expense.note].filter(Boolean).join(' · ')));
    const remove = cpButton('', 'icon ghost', 'fa-trash', `Delete ${expense.category} invoice`);
    remove.dataset.id = expense.id;
    li.appendChild(remove);
    work.expenseList.appendChild(li);
  }
  if (!expenses.length) work.expenseList.appendChild(el('li', 'list-empty', 'No invoices yet.'));
}

/** Delete buttons in the session and expense lists, bound once. */
export function bindWorkLists(app, page, status) {
  for (const [selector, collection] of [['.session-list', 'time'], ['.expense-list', 'expenses']]) {
    page.querySelector(selector).addEventListener('click', e => {
      const remove = e.target.closest('button[data-id]');
      if (remove && cpCanWrite(app, status) && confirm('Delete this entry?')) app.store.remove(collection, remove.dataset.id);
    });
  }
}
