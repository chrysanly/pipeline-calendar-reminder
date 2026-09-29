// Clear calendar dialog, opened from the Calendar toolbar. It clears exactly
// the day, week or month on screen (handlers.clearPeriod()): the reminders
// only leave the calendar (storage.js hideFromCalendar); Home and the data
// keep them.

import { $ } from './ui.js';

const CLEAR_NAMES = { day: 'day', week: 'week', month: 'month' };

// The period the open dialog will clear.
let clearing = null;

export function isClearCalendarOpen() {
  return !$('#clear-calendar').hidden;
}

/** The dialog's texts for a period {view, label, count}. */
export function clearCalendarText({ view, label, count }) {
  const name = CLEAR_NAMES[view] || 'period';
  const reminders = `${count} reminder${count === 1 ? '' : 's'}`;
  return {
    title: `Clear ${label}`,
    count: count
      ? `${reminders} on the calendar this ${name} will be cleared.`
      : `Nothing on the calendar this ${name}: there is nothing to clear.`,
    warning: `This only clears the calendar for this ${name}. Those reminders are the same ones the Day, Week and Month views show, `
      + 'so they leave those views too, and stop popping up. Home, your clients and all their data stay. '
      + 'To bring a client back, open it and pick Add to calendar.'
  };
}

export function openClearCalendar(handlers) {
  clearing = handlers.clearPeriod();
  const text = clearCalendarText(clearing);
  $('#clear-calendar-title').textContent = text.title;
  $('#clear-calendar-count').textContent = text.count;
  $('#clear-calendar-warning-text').textContent = text.warning;
  $('#clear-calendar-error').textContent = '';
  $('#clear-calendar-submit').disabled = !clearing.count;
  $('#clear-calendar').hidden = false;
  $(clearing.count ? '#clear-calendar-submit' : '#clear-calendar-cancel').focus();
}

export function closeClearCalendar() {
  clearing = null;
  $('#clear-calendar').hidden = true;
  $('#clear-calendar-btn').focus();
}

/** handlers.clearPeriod() → {view, from, to, label, count}; handlers.onClearCalendar(period) clears and reports. */
export function bindClearCalendar(handlers) {
  $('#clear-calendar-btn').addEventListener('click', () => openClearCalendar(handlers));
  $('#clear-calendar-close').addEventListener('click', closeClearCalendar);
  $('#clear-calendar-cancel').addEventListener('click', closeClearCalendar);
  $('#clear-calendar').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeClearCalendar();
  });
  $('#clear-calendar-form').addEventListener('submit', e => {
    e.preventDefault();
    if (!clearing || !clearing.count) return;
    const period = clearing;
    try {
      handlers.onClearCalendar(period);
      closeClearCalendar();
    } catch (err) {
      $('#clear-calendar-error').textContent = err.message;
    }
  });
}
