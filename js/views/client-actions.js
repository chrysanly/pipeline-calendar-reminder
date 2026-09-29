// Client page action bar: Follow up (a dialog: date and time required, notes
// optional → a calendar reminder), Add to / Remove from calendar (imports
// start off it), and Add minutes (the Minutes page, client filled in).
// Every save shows a busy toast, then what happened (banner.js runWithToast).

import { formatDayLabel } from '../calendar.js';
import { addEvent, setClientOnCalendar, calendarCounts } from '../storage.js';
import { followUpReminder } from '../timeline.js';
import { createDatePicker } from '../datepicker.js';
import { runWithToast, showBanner } from '../banner.js';
import { el } from '../ui.js';
import { cpButton } from './client-dom.js';

const caPlural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The Follow up dialog, built once; `followUpFor` is the client it is open for.
let followUp = null;
let followUpFor = null;

function followUpField(labelText, control, hint) {
  const label = el('label', 'client-field');
  label.append(labelText, control);
  if (hint) label.append(el('span', 'form-hint', hint));
  return label;
}

function buildFollowUpDialog(app) {
  const modal = el('div', 'modal follow-up-modal');
  modal.id = 'follow-up';
  modal.hidden = true;
  const card = el('div', 'modal-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'follow-up-title');
  const head = el('div', 'modal-head');
  const title = el('h2', '', 'Follow up');
  title.id = 'follow-up-title';
  const close = cpButton('', 'icon', 'fa-xmark', 'Close');
  head.append(title, close);

  const form = el('form', 'stack-form follow-up-form');
  form.noValidate = true;
  const date = el('input');
  date.name = 'date';
  date.required = true;
  const time = el('input');
  time.type = 'time';
  time.name = 'time';
  time.required = true;
  const notes = el('textarea');
  notes.name = 'notes';
  notes.rows = 3;
  notes.placeholder = 'What to talk about (optional)';
  const row = el('div', 'row');
  row.append(followUpField('Date', date), followUpField('Time', time));
  const error = el('p', 'form-error');
  error.setAttribute('role', 'alert');
  const actions = el('div', 'modal-actions');
  const cancel = cpButton('Cancel', 'ghost');
  const save = cpButton('Save follow-up', 'primary', 'fa-calendar-plus');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(row, followUpField('Notes', notes, 'Optional'), error, actions);
  card.append(head, form);
  const backdrop = el('div', 'modal-backdrop');
  modal.append(backdrop, card);
  document.body.appendChild(modal);
  const picker = createDatePicker(date, { label: 'Choose the follow-up date' });

  const hide = () => {
    if (picker.isOpen()) picker.close(false);
    modal.hidden = true;
    followUpFor = null;
  };
  for (const node of [close, cancel, backdrop]) node.addEventListener('click', hide);
  modal.addEventListener('keydown', e => {
    // The page's shortcuts and Escape handling stay out of the dialog.
    e.stopPropagation();
    if (e.key === 'Escape') hide();
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const client = followUpFor;
    if (!client) return;
    const { reminder, error: problem } = followUpReminder(client, { date: date.value, time: time.value, notes: notes.value });
    error.textContent = problem;
    if (!reminder) return;
    if (!app.canSave()) {
      error.textContent = 'Sign in first.';
      return;
    }
    hide();
    saveFollowUp(app, client, reminder);
  });
  return { modal, form, title, date, time, notes, error };
}

function saveFollowUp(app, client, reminder) {
  const when = `${formatDayLabel(reminder.date)}, ${reminder.time}`;
  app.log('create', 'reminder', reminder.title, client.name, when);
  return runWithToast({
    busy: `Saving follow-up for ${client.name}…`,
    done: `Follow-up for ${client.name} saved for ${when}`,
    body: 'It is on the calendar and pops up then.',
    failed: `Could not save the follow-up for ${client.name}`
  }, () => app.commitEvents(addEvent(app.state.events, reminder)));
}

export function openFollowUp(app, client) {
  if (!followUp) followUp = buildFollowUpDialog(app);
  followUpFor = client;
  followUp.form.reset();
  followUp.error.textContent = '';
  followUp.title.textContent = `Follow up with ${client.name}`;
  followUp.modal.hidden = false;
  followUp.date.focus();
}

export const isFollowUpOpen = () => Boolean(followUp && !followUp.modal.hidden);

/** Put the client's reminders on the calendar, or take them off it. */
function moveOnCalendar(app, client, onCalendar) {
  if (!app.canSave()) {
    showBanner('Sign in first', 'Your changes need an account to be saved.');
    return null;
  }
  const { events, count } = setClientOnCalendar(app.state.events, client.name, onCalendar);
  if (!count) return null;
  const what = `${caPlural(count, 'reminder')} for ${client.name}`;
  app.log('edit', 'calendar', client.name, client.name, onCalendar ? `Added ${what} to the calendar` : `Removed ${what} from the calendar`);
  return runWithToast(onCalendar ? {
    busy: `Adding ${what} to the calendar…`,
    done: `Added ${what} to the calendar`,
    body: 'The ones still ahead will pop up on time.',
    failed: 'Could not add them to the calendar'
  } : {
    busy: `Removing ${what} from the calendar…`,
    done: `Removed ${what} from the calendar`,
    body: 'They stay on Home and on this page.',
    failed: 'Could not remove them from the calendar'
  }, () => app.commitEvents(events));
}

/** The action bar under the client's name, rebuilt on every render. */
export function renderClientActions(app, client, bar) {
  bar.innerHTML = '';
  const { shown, hidden } = calendarCounts(app.state.events, client.name);
  const action = (text, className, iconName, onClick) => {
    const node = cpButton(text, `client-action ${className}`, iconName);
    node.addEventListener('click', onClick);
    bar.appendChild(node);
    return node;
  };
  action('Follow up', 'primary follow-up-btn', 'fa-calendar-plus', () => openFollowUp(app, client));
  if (hidden) {
    const add = action(`Add to calendar (${hidden})`, 'secondary calendar-add', 'fa-calendar-check', () => moveOnCalendar(app, client, true));
    add.setAttribute('aria-label', `Add ${caPlural(hidden, 'reminder')} to the calendar`);
  }
  if (shown) {
    const remove = action('Remove from calendar', 'ghost calendar-remove', 'fa-calendar-xmark', () => moveOnCalendar(app, client, false));
    remove.setAttribute('aria-label', `Remove ${caPlural(shown, 'reminder')} from the calendar`);
  }
  action('Add minutes', 'secondary minutes-add', 'fa-file-lines', () => app.openMinutes(client.name));
}
