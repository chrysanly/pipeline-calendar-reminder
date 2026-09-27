// DOM rendering and event wiring.

import {
  getMonthGrid, getWeekDays, formatRangeLabel, formatDayLabel, weekdayNames,
  toDateKey, eventsSortedByTime
} from './calendar.js';
import { groupByDate, findEvent, STATUSES, STATUS_LABELS } from './storage.js';
import { COUNTRY_NAMES, locationFromPhone } from './phone-location.js';
import { buildClients, statusCounts, locationTree, filterClients, UNKNOWN } from './dashboard.js';

const $ = sel => document.querySelector(sel);

const STATUS_ICONS = {
  lead: 'fa-seedling',
  potential: 'fa-star',
  active: 'fa-circle-check',
  inactive: 'fa-circle-pause'
};
const STATUS_PLURALS = { lead: 'Leads', potential: 'Potential', active: 'Active', inactive: 'Inactive' };

/** Show Home or the calendar, and mark the active view button. */
function showView(view) {
  document.body.dataset.view = view;
  $('#dashboard').hidden = view !== 'dashboard';
  $('.calendar').hidden = view === 'dashboard';
  for (const button of document.querySelectorAll('.views button')) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const i = el('i', `fa-solid ${name}`);
  i.setAttribute('aria-hidden', 'true');
  return i;
}

/** Icon followed directly by text, so the element's text is exactly `text`. */
function withIcon(node, name, text) {
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
  const byDate = groupByDate(events);
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

/** Show the details panel for `state.openId`, or hide it. */
export function renderPanel(state, handlers) {
  const panel = $('#panel');
  const evt = state.openId ? findEvent(state.events, state.openId) : null;
  const list = $('#day-events');
  list.innerHTML = '';
  // On phones and tablets the panel is a sheet over the page: the backdrop
  // closes it and the page behind must not scroll.
  $('#panel-backdrop').hidden = !evt;
  document.body.classList.toggle('sheet-open', Boolean(evt));
  if (!evt) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $('#day-label').textContent = 'Reminder details';

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

/**
 * Top-bar sign-in area and the signed-out prompt.
 * status: 'local' | 'loading' | 'signed-out' | 'signed-in'
 */
export function renderAuth(status, user) {
  document.body.dataset.auth = status;
  $('#auth-area').hidden = status === 'local';
  $('#sign-in').hidden = status !== 'signed-out';
  $('#sign-out').hidden = status !== 'signed-in';
  const name = $('#user-name');
  name.hidden = status !== 'signed-in';
  name.textContent = user ? (user.displayName || user.email || 'Signed in') : '';
  // Phones show just a round initial instead of the full name.
  name.dataset.initial = name.textContent.trim().charAt(0).toUpperCase();
  name.title = name.textContent;
  $('#signed-out').hidden = status !== 'signed-out';
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

function tag(className, label, count, active, onClick) {
  const button = el('button', `loc-tag ${className}`);
  button.type = 'button';
  button.append(el('span', 'loc-name', label));
  if (count !== undefined) button.append(el('span', 'loc-count', String(count)));
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', String(active));
  button.addEventListener('click', onClick);
  return button;
}

function formatNext(ref) {
  if (!ref) return 'No upcoming reminder';
  return `${formatDayLabel(ref.date)}${ref.time ? `, ${ref.time}` : ''}`;
}

/**
 * Home: 4 status cards, locations (country → city), and the client list.
 * state.dash holds the filters: {status, country, city, search}.
 */
export function renderDashboard(state, handlers) {
  showView('dashboard');
  const filters = state.dash;
  const clients = buildClients(state.events);
  const counts = statusCounts(clients);

  // Status cards: click to filter, click again to clear.
  const cards = $('#status-cards');
  cards.innerHTML = '';
  for (const status of STATUSES) {
    const active = filters.status === status;
    const card = el('button', `status-card status-${status}`);
    card.type = 'button';
    card.dataset.status = status;
    card.classList.toggle('is-active', active);
    card.setAttribute('aria-pressed', String(active));
    card.setAttribute('aria-label', `${counts[status]} ${STATUS_PLURALS[status]}`);
    const iconBox = el('span', 'status-icon');
    iconBox.appendChild(icon(STATUS_ICONS[status]));
    card.append(iconBox, el('span', 'status-count', String(counts[status])), el('span', 'status-label', STATUS_PLURALS[status]));
    card.addEventListener('click', () => handlers.onDashFilter({ status: active ? null : status }));
    cards.appendChild(card);
  }

  // Locations for the clients the status/search filters leave.
  const scoped = filterClients(clients, { status: filters.status, search: filters.search });
  const locations = $('#location-list');
  locations.innerHTML = '';
  const tree = locationTree(scoped);
  if (!tree.length) locations.appendChild(el('p', 'empty', 'No locations yet.'));
  for (const country of tree) {
    const group = el('div', 'loc-group');
    const countryActive = filters.country === country.name && !filters.city;
    const countryTag = tag('loc-country', country.name, country.count, countryActive,
      () => handlers.onDashFilter(countryActive ? { country: null, city: null } : { country: country.name, city: null }));
    countryTag.dataset.country = country.name;
    countryTag.prepend(icon(country.name === UNKNOWN ? 'fa-circle-question' : 'fa-earth-asia'));
    group.appendChild(countryTag);

    const cities = country.cities.filter(c => !(country.cities.length === 1 && c.name === UNKNOWN));
    if (cities.length) {
      const cityList = el('div', 'loc-cities');
      for (const city of cities) {
        const cityActive = filters.country === country.name && filters.city === city.name;
        const cityTag = tag('loc-city', city.name, city.count, cityActive,
          () => handlers.onDashFilter(cityActive ? { city: null } : { country: country.name, city: city.name }));
        cityTag.dataset.country = country.name;
        cityTag.dataset.city = city.name;
        cityTag.prepend(icon('fa-city'));
        cityList.appendChild(cityTag);
      }
      group.appendChild(cityList);
    }
    locations.appendChild(group);
  }

  // Active filters as removable tags.
  const active = $('#active-filters');
  active.innerHTML = '';
  const removable = [];
  if (filters.status) removable.push([`Status: ${STATUS_LABELS[filters.status]}`, { status: null }]);
  if (filters.country) removable.push([filters.country, { country: null, city: null }]);
  if (filters.city) removable.push([filters.city, { city: null }]);
  for (const [label, patch] of removable) {
    const button = el('button', 'filter-tag');
    button.type = 'button';
    button.setAttribute('aria-label', `Remove filter ${label}`);
    button.append(el('span', '', label), icon('fa-xmark'));
    button.addEventListener('click', () => handlers.onDashFilter(patch));
    active.appendChild(button);
  }
  active.hidden = !removable.length;

  // Clients.
  const shown = filterClients(clients, filters);
  $('#client-count').textContent = shown.length === clients.length
    ? `(${clients.length})` : `(${shown.length} of ${clients.length})`;
  const list = $('#client-list');
  list.innerHTML = '';
  if (!clients.length) {
    list.appendChild(el('p', 'empty dash-empty', state.loading
      ? 'Loading your clients…'
      : 'No clients yet: add a reminder or import Excel'));
    return;
  }
  if (!shown.length) {
    list.appendChild(el('p', 'empty dash-empty', 'No clients match these filters.'));
    return;
  }

  const head = el('div', 'client-row client-head');
  for (const label of ['Client', 'Status', 'City, country', 'Phone', 'Reminders', 'Next reminder']) {
    head.appendChild(el('span', '', label));
  }
  list.appendChild(head);

  for (const client of shown) {
    const row = el('div', `client-row status-${client.status}`);
    row.dataset.client = client.name;

    const name = el('button', 'client-name', client.name);
    name.type = 'button';
    name.title = 'Open this client\'s next reminder';
    name.addEventListener('click', () => handlers.onOpenClient(client));

    const select = el('select', `client-status status-${client.status}`);
    select.setAttribute('aria-label', `Status of ${client.name}`);
    for (const status of STATUSES) {
      const option = el('option', '', STATUS_LABELS[status]);
      option.value = status;
      select.appendChild(option);
    }
    select.value = client.status;
    if (!client.key) {
      select.disabled = true;
      select.title = 'Add a client name to these reminders to set a status';
    }
    select.addEventListener('change', () => handlers.onClientStatus(client.name, select.value));

    const placeText = [client.city, client.country].filter(Boolean).join(', ') || '—';
    const where = withIcon(el('span', 'client-place'), 'fa-location-dot', placeText);
    if (client.location) where.title = client.location;

    const phone = el('span', 'client-phone');
    if (client.phone) {
      const link = el('a', '', client.phone);
      link.href = `tel:${client.phone.replace(/[^\d+]/g, '')}`;
      phone.append(icon('fa-phone'), link);
    } else {
      phone.append(icon('fa-phone'), '—');
    }

    const reminders = withIcon(el('span', 'client-reminders'), 'fa-bell', String(client.reminderCount));
    reminders.title = `${client.reminderCount} reminder(s)`;
    const next = withIcon(el('span', 'client-next'), 'fa-clock', formatNext(client.nextReminder));

    row.append(name, select, where, phone, reminders, next);
    list.appendChild(row);
  }
}

export function bindDashboard(handlers) {
  $('#client-search').addEventListener('input', e => handlers.onDashFilter({ search: e.target.value }));
}

let bannerTimer = null;
let bannerOpen = null;

/** In-app toast: "Hey you have a …" plus the reminder details. */
export function showBanner(title, body, onOpen) {
  const banner = $('#banner');
  $('#banner-title').textContent = title;
  $('#banner-body').textContent = body || '';
  bannerOpen = onOpen || null;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, 30000);
}

export function hideBanner() {
  clearTimeout(bannerTimer);
  $('#banner').hidden = true;
}

export function bindBanner() {
  $('#banner-close').addEventListener('click', hideBanner);
  $('#banner-title').addEventListener('click', () => {
    if (bannerOpen) bannerOpen();
    hideBanner();
  });
}
