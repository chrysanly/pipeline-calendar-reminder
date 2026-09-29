// Date picker and date range picker, no libraries. The inputs keep a plain
// 'YYYY-MM-DD' value (typing one, or 28/09/2026, works too); the calendar
// button opens a month grid: arrow keys move between days, Enter picks,
// Escape closes. The range picker fills From, then To, in one calendar.

import { toDateKey, fromDateKey, getMonthGrid, weekdayNames, formatMonthLabel, formatDayLabel } from './calendar.js';
import { el, icon } from './ui.js';

/** 'YYYY-MM-DD' or day-first 28/09/2026 (also - or .) → a date key; '' blank; null invalid. */
export function readDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y;
  let m;
  let d;
  if (match) [, y, m, d] = match.map(Number);
  else if ((match = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = match.map(Number);
  else return null;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? toDateKey(date) : null;
}

/**
 * The range after picking `key`: the first pick (or one after a full range)
 * starts a new range; the second sets To, or starts again if it is before From.
 */
export function nextRange({ from = '', to = '' } = {}, key) {
  if (!from || to || key < from) return { from: key, to: '' };
  return { from, to: key };
}

/** 'start' | 'end' | 'between' | '' for how `key` sits in the range. */
export function rangeRole(key, { from = '', to = '' } = {}) {
  if (key === from) return 'start';
  if (key === to) return 'end';
  return from && to && key > from && key < to ? 'between' : '';
}

/** Days the arrow keys move: ←/→ one day, ↑/↓ a week. */
export const DAY_KEYS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

export function shiftDay(key, days) {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

/**
 * The month grid card, placed in the page flow right after `after` (so a
 * dialog that scrolls never clips it). getRange() → {from, to} marks the days;
 * onPick(key) returns true to close. `toggles` are the calendar buttons.
 */
function monthPopup(after, toggles, { label, getRange, onPick, hint = () => '' }) {
  const popup = el('div', 'dp-popup');
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', label);
  popup.hidden = true;
  after.insertAdjacentElement('afterend', popup);
  let month = new Date();
  let focusKey = '';
  let opener = toggles[0];

  const navButton = (iconName, text, delta) => {
    const button = el('button', 'icon ghost dp-nav');
    button.type = 'button';
    button.setAttribute('aria-label', text);
    button.appendChild(icon(iconName));
    button.addEventListener('click', () => {
      month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
      render();
    });
    return button;
  };

  function render() {
    const range = getRange();
    popup.innerHTML = '';
    const head = el('div', 'dp-head');
    head.append(navButton('fa-chevron-left', 'Previous month', -1),
      el('strong', 'dp-month', formatMonthLabel(month.getFullYear(), month.getMonth())),
      navButton('fa-chevron-right', 'Next month', 1));
    const grid = el('div', 'dp-grid');
    grid.setAttribute('role', 'grid');
    for (const name of weekdayNames()) grid.appendChild(el('span', 'dp-weekday', name.slice(0, 2)));
    for (const cell of getMonthGrid(month.getFullYear(), month.getMonth())) {
      const day = el('button', 'dp-day', String(cell.date.getDate()));
      day.type = 'button';
      day.dataset.date = cell.key;
      day.setAttribute('aria-label', formatDayLabel(cell.key));
      const role = rangeRole(cell.key, range);
      if (role) day.classList.add(`is-${role}`);
      day.setAttribute('aria-pressed', String(role === 'start' || role === 'end'));
      day.classList.toggle('is-other', !cell.inMonth);
      day.classList.toggle('is-today', cell.isToday);
      day.tabIndex = cell.key === focusKey ? 0 : -1;
      grid.appendChild(day);
    }
    const foot = el('div', 'dp-foot');
    foot.appendChild(el('span', 'dp-hint', hint(range)));
    const today = el('button', 'ghost dp-today', 'Today');
    today.type = 'button';
    today.dataset.date = toDateKey(new Date());
    foot.appendChild(today);
    popup.append(head, grid, foot);
  }

  function focusDay(key, moveFocus = true) {
    focusKey = key;
    const date = fromDateKey(key);
    if (date.getMonth() !== month.getMonth() || date.getFullYear() !== month.getFullYear()) {
      month = new Date(date.getFullYear(), date.getMonth(), 1);
    }
    render();
    const day = popup.querySelector(`.dp-day[data-date="${key}"]`);
    if (day && moveFocus) day.focus();
  }

  function setExpanded(open) {
    for (const toggle of toggles) toggle.setAttribute('aria-expanded', String(open));
  }

  function open(from = toggles[0]) {
    opener = from;
    const { from: start, to } = getRange();
    popup.hidden = false;
    setExpanded(true);
    focusDay(to || start || toDateKey(new Date()));
  }

  function close(returnFocus = true) {
    popup.hidden = true;
    setExpanded(false);
    if (returnFocus) opener.focus();
  }

  popup.addEventListener('click', e => {
    const pick = e.target.closest('[data-date]');
    if (!pick) return;
    if (onPick(pick.dataset.date)) close();
    else focusDay(pick.dataset.date);
  });
  popup.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // Close the calendar only, not the dialog around it.
      e.stopPropagation();
      close();
      return;
    }
    const day = e.target.closest('.dp-day');
    if (day && DAY_KEYS[e.key]) {
      e.preventDefault();
      focusDay(shiftDay(day.dataset.date, DAY_KEYS[e.key]));
    }
  });
  for (const toggle of toggles) {
    toggle.setAttribute('aria-haspopup', 'dialog');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => (popup.hidden ? open(toggle) : close()));
  }
  return { open, close, isOpen: () => !popup.hidden, render };
}

/** Tidy a typed date to 'YYYY-MM-DD' when it can be read; leave it for the form's check otherwise. */
function normalizeTyped(input) {
  const key = readDateKey(input.value);
  if (key) input.value = key;
}

/**
 * A text date input with its calendar button inside the field, on the right
 * (css/pickers.css .dp-field). @returns the button
 */
function dateField(input, label) {
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = 'YYYY-MM-DD';
  input.autocomplete = 'off';
  input.addEventListener('change', () => normalizeTyped(input));
  const field = el('span', 'dp-field');
  input.parentNode.insertBefore(field, input);
  field.appendChild(input);
  const button = el('button', 'dp-toggle');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.appendChild(icon('fa-calendar-days'));
  field.appendChild(button);
  return button;
}

/** A date input with a calendar button in it; the calendar opens under its label. */
export function createDatePicker(input, { label = 'Choose a date' } = {}) {
  const button = dateField(input, label);
  const after = input.closest('.row') || input.closest('label') || button.parentNode;
  return monthPopup(after, [button], {
    label,
    getRange: () => ({ from: readDateKey(input.value) || '', to: '' }),
    onPick(key) {
      input.value = key;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  });
}

/** From / To inputs, each with a calendar button, sharing one calendar under them. */
export function createRangePicker(fromInput, toInput, { label = 'Choose dates' } = {}) {
  const buttons = [dateField(fromInput, `${label}: From`), dateField(toInput, `${label}: To`)];
  const after = toInput.closest('.row') || toInput.closest('label') || buttons[1].parentNode;
  const getRange = () => ({ from: readDateKey(fromInput.value) || '', to: readDateKey(toInput.value) || '' });
  return monthPopup(after, buttons, {
    label,
    getRange,
    hint: ({ from, to }) => (from && !to ? 'Now pick the last day' : 'Pick the first day'),
    onPick(key) {
      const range = nextRange(getRange(), key);
      fromInput.value = range.from;
      toInput.value = range.to;
      return Boolean(range.to);
    }
  });
}
