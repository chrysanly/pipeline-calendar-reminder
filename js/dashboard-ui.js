// Home: status cards, locations, and a paged, filterable client list.

import { STATUSES, STATUS_LABELS } from './storage.js';
import { formatDayLabel } from './calendar.js';
import { buildClients, statusCounts, locationTree, filterClients, paginate, parsePageSize, PAGE_SIZES, UNKNOWN } from './dashboard.js';
import { $, el, icon, withIcon, showView, STATUS_ICONS, STATUS_PLURALS } from './ui.js';

const PAGE_SIZE_KEY = 'cladflo.page-size.v1';

/** The clients-per-page choice this browser saved last, or 25. */
export function loadPageSize() {
  try {
    return parsePageSize(localStorage.getItem(PAGE_SIZE_KEY));
  } catch {
    return PAGE_SIZES[0];
  }
}

export function savePageSize(size) {
  try {
    localStorage.setItem(PAGE_SIZE_KEY, String(size));
  } catch {
    // Private mode or full storage: the choice lasts for this visit only.
  }
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

  // Clients, one page at a time.
  const shown = filterClients(clients, filters);
  $('#client-count').textContent = shown.length === clients.length
    ? `(${clients.length})` : `(${shown.length} of ${clients.length})`;
  $('#client-status-filter').value = filters.status || '';
  const page = paginate(shown, filters.page, filters.pageSize);
  renderPager(page, filters.pageSize);
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

  for (const client of page.items) {
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

/** "Showing 26–50 of 312", page n of m, and the page size (25 / 50 / 100 / custom). */
function renderPager({ page, pages, start, end, total }, pageSize) {
  $('#client-pager').hidden = !total;
  $('#pager-info').textContent = `Showing ${start}–${end} of ${total}`;
  $('#page-label').textContent = `Page ${page} of ${pages}`;
  $('#page-prev').disabled = page <= 1;
  $('#page-next').disabled = page >= pages;
  $('#page-prev').dataset.page = String(page - 1);
  $('#page-next').dataset.page = String(page + 1);

  const custom = customOpen || !PAGE_SIZES.includes(pageSize);
  $('#page-size').value = custom ? 'custom' : String(pageSize);
  const input = $('#page-size-custom');
  input.hidden = !custom;
  if (document.activeElement !== input) input.value = String(pageSize);
}

// "Custom…" picked but no number entered yet: keep the box open across renders.
let customOpen = false;

export function bindDashboard(handlers) {
  $('#client-search').addEventListener('input', e => handlers.onDashFilter({ search: e.target.value }));
  $('#client-status-filter').addEventListener('change', e => handlers.onDashFilter({ status: e.target.value || null }));

  for (const button of [$('#page-prev'), $('#page-next')]) {
    button.addEventListener('click', () => {
      handlers.onDashFilter({ page: Number(button.dataset.page) });
      $('#client-list').scrollIntoView({ block: 'nearest' });
    });
  }

  $('#page-size').addEventListener('change', e => {
    customOpen = e.target.value === 'custom';
    if (customOpen) {
      const input = $('#page-size-custom');
      input.hidden = false;
      input.focus();
      input.select();
      return;
    }
    handlers.onDashFilter({ pageSize: Number(e.target.value) });
  });
  $('#page-size-custom').addEventListener('change', e => {
    customOpen = false;
    handlers.onDashFilter({ pageSize: parsePageSize(e.target.value, handlers.pageSize()) });
  });
}
