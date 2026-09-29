// DOM rendering and event wiring.

import {
  getMonthGrid, getWeekDays, formatRangeLabel, formatDayLabel, weekdayNames,
  toDateKey, eventsSortedByTime, CALENDAR_VIEWS
} from './calendar.js';
import { groupByDate, findEvent, calendarEvents, STATUSES, STATUS_LABELS } from './storage.js';
import { COUNTRY_NAMES, locationFromPhone } from './phone-location.js';

export const $ = sel => document.querySelector(sel);

export const STATUS_ICONS = {
  lead: 'fa-seedling',
  potential: 'fa-star',
  active: 'fa-circle-check',
  inactive: 'fa-circle-pause'
};
export const STATUS_PLURALS = { lead: 'Leads', potential: 'Potential', active: 'Active', inactive: 'Inactive' };

// Views with their own page; the rest are the calendar. mountView adds more.
const PAGES = { dashboard: '#dashboard', history: '#history', minutes: '#minutes' };

/** Link a feature stylesheet once; the built page already inlines it (data-css). */
export function loadStylesheet(href) {
  if (document.querySelector(`[data-css="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.css = href;
  document.head.appendChild(link);
}

/**
 * A registered view's page (<section id="page-<id>">) in the main layout and,
 * unless view.nav is false, its button in the main nav. Returns the section.
 */
export function mountView(view, onSelect) {
  if (view.css) loadStylesheet(view.css);
  const section = el('section', `page feature-page page-${view.id}`);
  section.id = `page-${view.id}`;
  section.setAttribute('aria-label', view.label);
  section.hidden = true;
  $('.layout').insertBefore(section, $('.calendar'));
  PAGES[view.id] = `#${section.id}`;

  if (view.nav !== false) {
    const button = el('button');
    button.id = `view-${view.id}`;
    button.type = 'button';
    button.dataset.view = view.id;
    button.title = view.key ? `${view.label} (${view.key.toUpperCase()})` : view.label;
    button.append(icon(view.icon || 'fa-circle'), ' ', el('span', 'btn-label', view.label));
    button.addEventListener('click', () => onSelect(view.id));
    $('.views').appendChild(button);
  }
  return section;
}

/**
 * Show one page or the calendar, and mark the active buttons: the main nav
 * (Calendar stands for day/week/month) and the calendar's own view switch.
 */
export function showView(view) {
  document.body.dataset.view = view;
  for (const [name, selector] of Object.entries(PAGES)) $(selector).hidden = view !== name;
  $('.calendar').hidden = view in PAGES;
  for (const button of document.querySelectorAll('button[data-view]')) {
    const target = button.dataset.view;
    const active = target === view || (target === 'calendar' && CALENDAR_VIEWS.includes(view));
    button.classList.toggle('is-active', active);
    if (button.closest('.views')) {
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    } else {
      button.setAttribute('aria-pressed', String(active));
    }
  }
}

/** Spinner on a button while its action runs; it can't be pressed twice. */
export function setBusy(button, busy) {
  button.classList.toggle('is-loading', busy);
  button.disabled = busy;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

/** Run `action` with `button` busy, and always free it again. */
export async function withBusy(button, action) {
  if (button.classList.contains('is-loading')) return undefined;
  setBusy(button, true);
  try {
    return await action();
  } finally {
    setBusy(button, false);
  }
}

function statusDot(status) {
  const dot = el('span', `status-dot status-${status}`);
  dot.title = STATUS_LABELS[status];
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

const MONTH_CHIP_LIMIT = 3;
const COMPACT_CHIP_LIMIT = 2;

/** Phone layout: must match the `max-width: 640px` breakpoint in styles.css. */
export const COMPACT_QUERY = '(max-width: 640px)';

export function isCompact() {
  return typeof matchMedia === 'function' && matchMedia(COMPACT_QUERY).matches;
}

/**
 * A finished pointer gesture as calendar navigation: 1 = next (swipe left),
 * -1 = previous (swipe right), 0 = not a swipe (a tap or a vertical scroll).
 */
export function swipeDirection(dx, dy) {
  if (Math.abs(dx) <= 60 || Math.abs(dy) >= 40) return 0;
  return dx < 0 ? 1 : -1;
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function icon(name) {
  const i = el('i', `fa-solid ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Icon followed directly by text, so the element's text is exactly `text`. */
export function withIcon(node, name, text) {
  node.append(icon(name), text);
  return node;
}

function renderHeader(view, cells) {
  const host = $('#weekdays');
  host.innerHTML = '';
  host.className = `weekdays view-${view}`;
  if (view === 'month') {
    for (const name of weekdayNames()) host.appendChild(el('div', 'weekday', name));
    return;
  }
  const names = weekdayNames();
  for (const cell of cells) {
    const head = el('div', 'weekday');
    if (cell.isToday) head.classList.add('is-today');
    head.append(el('span', 'weekday-name', names[cell.date.getDay()]), el('span', 'weekday-number', String(cell.date.getDate())));
    host.appendChild(head);
  }
}

function renderChip(evt, handlers) {
  const chip = el('div', 'chip');
  chip.dataset.id = evt.id;

  const time = el('span', 'chip-time', evt.time || '--:--');
  time.prepend(statusDot(evt.status || 'lead'));
  if (evt.source === 'import') {
    const mark = icon('fa-file-import chip-import');
    mark.title = 'Imported from Excel';
    time.appendChild(mark);
  }
  // Imported again as a new row (importer.js): the Home badge, on the calendar too.
  if (evt.duplicate) time.appendChild(el('span', 'dup-badge chip-dup', 'Duplicate'));
  chip.appendChild(time);

  const title = el('button', 'chip-title', evt.title);
  title.type = 'button';
  title.title = evt.clientName ? `${evt.title} · ${evt.clientName}` : evt.title;
  title.addEventListener('click', e => {
    e.stopPropagation();
    handlers.onOpen(evt.id);
  });
  chip.appendChild(title);

  if (evt.clientName) chip.appendChild(withIcon(el('span', 'chip-client'), 'fa-user', evt.clientName));
  return chip;
}

function renderDayCell(cell, dayEvents, state, handlers, compact) {
  const { view, selectedKey } = state;
  const node = el('div', 'day');
  node.tabIndex = 0;
  node.dataset.key = cell.key;
  if (!cell.inMonth) node.classList.add('is-outside');
  if (cell.isToday) node.classList.add('is-today');
  if (cell.key === selectedKey) node.classList.add('is-selected');
  node.setAttribute('aria-label', `${formatDayLabel(cell.key)}, ${dayEvents.length} reminder(s)`);

  // Week/day views show the date in the header row; CSS reveals these on phones,
  // where the week is a vertical list with no header.
  if (view !== 'month') node.appendChild(el('span', 'day-name', weekdayNames()[cell.date.getDay()]));
  node.appendChild(el('span', 'day-number', String(cell.date.getDate())));

  const chips = el('div', 'chips');
  const limit = compact ? COMPACT_CHIP_LIMIT : MONTH_CHIP_LIMIT;
  const shown = view === 'month' ? dayEvents.slice(0, limit) : dayEvents;
  for (const evt of shown) chips.appendChild(renderChip(evt, handlers));

  const hidden = dayEvents.length - shown.length;
  if (hidden > 0) {
    // Phone month cells are ~50px wide: "+1" fits, "+1 more" wraps.
    const more = el('button', 'more', compact ? `+${hidden}` : `+${hidden} more`);
    more.setAttribute('aria-label', `${hidden} more`);
    more.type = 'button';
    more.addEventListener('click', e => {
      e.stopPropagation();
      handlers.onMore(cell.key);
    });
    chips.appendChild(more);
  }
  if (view === 'day' && !dayEvents.length) chips.appendChild(el('p', 'empty', 'No reminders for this day yet.'));
  node.appendChild(chips);

  node.addEventListener('click', () => handlers.onSelectDay(cell.key));
  node.addEventListener('keydown', e => {
    if (e.target === node && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      handlers.onSelectDay(cell.key);
    }
  });
  return node;
}

export function renderCalendar(state, handlers) {
  const { view, cursor, events } = state;
  $('#month-label').textContent = formatRangeLabel(view, cursor);
  $('#prev').setAttribute('aria-label', `Previous ${view}`);
  $('#next').setAttribute('aria-label', `Next ${view}`);
  showView(view);

  let cells;
  if (view === 'month') cells = getMonthGrid(cursor.getFullYear(), cursor.getMonth());
  else if (view === 'week') cells = getWeekDays(cursor);
  else cells = getWeekDays(cursor).filter(c => c.key === toDateKey(cursor));

  renderHeader(view, cells);

  const compact = isCompact();
  // Reminders cleared from the calendar stay on Home only.
  const byDate = groupByDate(calendarEvents(events));
  const grid = $('#grid');
  grid.innerHTML = '';
  grid.className = `grid view-${view}`;
  for (const cell of cells) {
    const dayEvents = eventsSortedByTime(byDate.get(cell.key) || []);
    grid.appendChild(renderDayCell(cell, dayEvents, state, handlers, compact));
  }

  renderAgenda(view === 'month' && compact, state, byDate, handlers);
}

/** Phones, month view: the selected day's reminders in full under the grid. */
function renderAgenda(show, state, byDate, handlers) {
  const agenda = $('#day-agenda');
  const list = $('#agenda-list');
  list.innerHTML = '';
  agenda.hidden = !show;
  if (!show) return;
  $('#agenda-label').textContent = formatDayLabel(state.selectedKey);
  const dayEvents = eventsSortedByTime(byDate.get(state.selectedKey) || []);
  for (const evt of dayEvents) list.appendChild(renderChip(evt, handlers));
  if (!dayEvents.length) list.appendChild(el('p', 'empty', 'No reminders for this day yet.'));
}

/**
 * The side sheet: details of `state.openId`, else every reminder of
 * `state.openDay` ("+N more"), else hidden.
 */
export function renderPanel(state, handlers) {
  const panel = $('#panel');
  const evt = state.openId ? findEvent(state.events, state.openId) : null;
  const open = Boolean(evt || state.openDay);
  const list = $('#day-events');
  list.innerHTML = '';
  panel.classList.toggle('is-day-list', !evt && open);
  // On phones and tablets the panel is a sheet over the page: the backdrop
  // closes it and the page behind must not scroll.
  $('#panel-backdrop').hidden = !open;
  document.body.classList.toggle('sheet-open', open);
  panel.hidden = !open;
  if (!open) return;
  if (evt) renderDetails(evt, state, list, handlers);
  else renderDayList(state, list, handlers);
}

function renderDayList(state, list, handlers) {
  const dayEvents = eventsSortedByTime(groupByDate(calendarEvents(state.events)).get(state.openDay) || []);
  $('#day-label').textContent = `${formatDayLabel(state.openDay)} · ${dayEvents.length} reminder${dayEvents.length === 1 ? '' : 's'}`;
  const chips = el('div', 'day-list');
  for (const evt of dayEvents) chips.appendChild(renderChip(evt, handlers));
  if (!dayEvents.length) chips.appendChild(el('p', 'empty', 'No reminders for this day yet.'));
  list.appendChild(chips);
}

function renderDetails(evt, state, list, handlers) {
  $('#day-label').textContent = 'Reminder details';
  if (state.openDay) {
    const back = withIcon(el('button', 'link back-to-day'), 'fa-arrow-left', `All reminders on ${formatDayLabel(state.openDay)}`);
    back.type = 'button';
    back.addEventListener('click', () => handlers.onBackToDay());
    list.appendChild(back);
  }

  const item = el('article', 'event');
  item.dataset.id = evt.id;

  const head = el('div', 'event-head');
  head.appendChild(el('h3', 'event-title', evt.title));
  item.appendChild(head);
  item.appendChild(statusBadge(evt.status || 'lead'));

  if (evt.clientName) item.appendChild(withIcon(el('p', 'event-client'), 'fa-user', evt.clientName));
  if (evt.date) item.appendChild(withIcon(el('p', 'event-date'), 'fa-calendar-day', formatDayLabel(evt.date)));
  item.appendChild(withIcon(el('p', 'event-time'), 'fa-clock', evt.time || '--:--'));
  if (evt.phone) {
    const phone = el('p', 'event-phone');
    const link = el('a', '', evt.phone);
    link.href = `tel:${evt.phone.replace(/[^\d+]/g, '')}`;
    phone.append(icon('fa-phone'), link);
    item.appendChild(phone);
  }
  if (evt.location) item.appendChild(withIcon(el('p', 'event-location'), 'fa-location-dot', evt.location));
  if (evt.city) item.appendChild(withIcon(el('p', 'event-city'), 'fa-city', evt.city));
  if (evt.country) item.appendChild(withIcon(el('p', 'event-country'), 'fa-earth-asia', evt.country));
  if (evt.notes) item.appendChild(el('p', 'event-notes', evt.notes));
  if (evt.reminderMinutesBefore > 0) {
    item.appendChild(withIcon(el('p', 'event-reminder'), 'fa-bell', `Reminder ${evt.reminderMinutesBefore} min before`));
  }

  const actions = el('div', 'event-actions');

  const edit = withIcon(el('button', 'link'), 'fa-pen', 'Edit');
  edit.type = 'button';
  edit.addEventListener('click', () => handlers.onEdit(evt.id));
  actions.appendChild(edit);

  const del = withIcon(el('button', 'link danger'), 'fa-trash', 'Delete');
  del.type = 'button';
  del.addEventListener('click', () => handlers.onDelete(evt.id));
  actions.appendChild(del);

  item.appendChild(actions);
  list.appendChild(item);
}

export function isPanelOpen() {
  return !$('#panel').hidden;
}

export function openModal(evt, dateKey) {
  const form = $('#event-form');
  form.reset();
  $('#form-error').textContent = '';
  $('#modal-title').textContent = evt ? 'Edit reminder' : 'New reminder';
  form.elements.id.value = evt ? evt.id : '';
  form.elements.title.value = evt ? evt.title : '';
  form.elements.clientName.value = evt ? evt.clientName : '';
  form.elements.date.value = evt ? evt.date : dateKey;
  form.elements.time.value = evt ? evt.time : '09:00';
  form.elements.notes.value = evt ? evt.notes : '';
  form.elements.reminderMinutesBefore.value = evt ? String(evt.reminderMinutesBefore) : '15';
  form.elements.status.value = (evt && evt.status) || 'lead';
  for (const field of ['phone', 'location', 'city', 'country']) {
    form.elements[field].value = (evt && evt[field]) || '';
    delete form.elements[field].dataset.auto;
  }
  delete form.elements.status.dataset.touched;

  $('#modal').hidden = false;
  form.elements.title.focus();
}

/**
 * One-time form wiring:
 * - the country picker's options;
 * - phone → City/Country, filling only blank (or earlier auto-filled) fields;
 * - typing a known client's name brings in its status and location, so a new
 *   reminder doesn't reset the client to Lead.
 */
export function bindForm(handlers) {
  const form = $('#event-form');
  const list = $('#country-list');
  for (const name of COUNTRY_NAMES) {
    const option = document.createElement('option');
    option.value = name;
    list.appendChild(option);
  }

  const { phone, city, country, status, clientName } = form.elements;
  const fillFromPhone = () => {
    const found = locationFromPhone(phone.value);
    for (const [field, value] of [[city, found && found.city], [country, found && found.country]]) {
      if (field.value && field.dataset.auto !== '1') continue; // typed by hand: keep
      field.value = value || '';
      if (value) field.dataset.auto = '1';
      else delete field.dataset.auto;
    }
  };
  phone.addEventListener('input', fillFromPhone);
  phone.addEventListener('change', fillFromPhone);
  for (const field of [city, country]) field.addEventListener('input', () => { delete field.dataset.auto; });
  status.addEventListener('change', () => { status.dataset.touched = '1'; });

  clientName.addEventListener('change', () => {
    const known = handlers.onClientLookup(clientName.value);
    if (!known) return;
    if (status.dataset.touched !== '1') status.value = known.status;
    for (const field of ['phone', 'location', 'city', 'country']) {
      if (!form.elements[field].value && known[field]) form.elements[field].value = known[field];
    }
  });
}

export function closeModal() {
  $('#modal').hidden = true;
  // Focus would otherwise stay on a now-hidden control, stranding keyboard users.
  $('#add-event').focus();
}

export function isModalOpen() {
  return !$('#modal').hidden;
}

/** Read the form; returns null and shows an error if invalid. */
export function readForm() {
  const form = $('#event-form');
  const data = {
    id: form.elements.id.value || undefined,
    title: form.elements.title.value.trim(),
    clientName: form.elements.clientName.value.trim(),
    date: form.elements.date.value,
    time: form.elements.time.value,
    notes: form.elements.notes.value.trim(),
    reminderMinutesBefore: Number(form.elements.reminderMinutesBefore.value) || 0,
    status: STATUSES.includes(form.elements.status.value) ? form.elements.status.value : 'lead',
    phone: form.elements.phone.value.trim(),
    location: form.elements.location.value.trim(),
    city: form.elements.city.value.trim(),
    country: form.elements.country.value.trim()
  };
  if (!data.title) {
    $('#form-error').textContent = 'Title is required.';
    return null;
  }
  if (!data.date) {
    $('#form-error').textContent = 'Date is required.';
    return null;
  }
  return data;
}

// ---------- Home dashboard ----------

function statusBadge(status) {
  const badge = el('span', `status-badge status-${status}`);
  badge.append(icon(STATUS_ICONS[status]), STATUS_LABELS[status]);
  return badge;
}
