// Home: the Potential/Active progress chart, status cards, locations, and a
// paged, filterable client list.

import { STATUSES, STATUS_LABELS } from './storage.js';
import {
  buildClients, statusCounts, locationTree, filterClients, paginate, parsePageSize, progressData, homeRows,
  pipelineClients, homeStatusFilter, duplicateCount, PAGE_SIZES, UNKNOWN
} from './dashboard.js';
import { renderClientTable } from './client-table.js';
import { $, el, icon, showView, STATUS_ICONS, STATUS_PLURALS } from './ui.js';
import { enhanceSelect, refreshSelect } from './select.js';

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

/** Potential vs Active per month: two bars a month, heights from the busiest month. */
function renderProgressChart(clients) {
  const { months, totals, share, max } = progressData(clients);
  const host = $('#progress-bars');
  host.innerHTML = '';
  host.setAttribute('aria-label', `Now ${totals.potential} potential (${share.potential}% of clients) and ${totals.active} active (${share.active}%). By month: `
    + months.map(m => `${m.label} ${m.potential} potential, ${m.active} active`).join('; '));
  const legend = el('div', 'progress-legend');
  legend.setAttribute('aria-hidden', 'true');
  for (const status of ['potential', 'active']) {
    const item = el('span', `progress-key status-${status}`);
    item.append(el('span', 'progress-swatch'), `${STATUS_LABELS[status]} ${totals[status]}`,
      el('span', 'progress-share', `${share[status]}%`));
    legend.appendChild(item);
  }
  const bars = el('div', 'progress-months');
  bars.setAttribute('aria-hidden', 'true');
  for (const month of months) {
    const group = el('div', 'progress-month');
    group.dataset.month = month.key;
    const pair = el('div', 'progress-pair');
    for (const status of ['potential', 'active']) {
      const bar = el('span', `progress-bar status-${status}`);
      bar.style.setProperty('--size', `${Math.round((month[status] / max) * 100)}%`);
      bar.dataset.count = String(month[status]);
      bar.title = `${month.label}: ${month[status]} ${STATUS_LABELS[status].toLowerCase()}`;
      pair.appendChild(bar);
    }
    group.append(pair, el('span', 'progress-label', month.label));
    bars.appendChild(group);
  }
  host.append(legend, bars);
}

/** Country and city choices for the searchable filters (city list follows the country). */
function fillPlaceFilters(tree, filters) {
  const fill = (select, allLabel, names, value) => {
    select.innerHTML = '';
    for (const [optionValue, label] of [['', allLabel], ...names.map(name => [name, name])]) {
      const option = el('option', '', label);
      option.value = optionValue;
      select.appendChild(option);
    }
    select.value = names.includes(value) ? value : '';
    refreshSelect(select);
  };
  fill($('#client-country-filter'), 'All countries', tree.map(c => c.name), filters.country);
  const countries = filters.country ? tree.filter(c => c.name === filters.country) : tree;
  const cities = [...new Set(countries.flatMap(c => c.cities.map(city => city.name)))].sort((a, b) => a.localeCompare(b));
  fill($('#client-city-filter'), 'All cities', cities, filters.city);
}

/**
 * Home: the progress chart, 4 status cards and a Duplicates card (numbers only), and the pipeline:
 * locations and the client list for potential and active clients only (every
 * client is on the Client tab). state.dash holds the filters: {status, country, city, search}.
 */
export function renderDashboard(state, handlers) {
  showView('dashboard');
  const all = buildClients(state.events);
  const clients = pipelineClients(all);
  const filters = { ...state.dash, status: homeStatusFilter(state.dash.status) };
  const counts = statusCounts(all);
  renderProgressChart(all);

  // Status cards: every client, by status. Just the numbers, not buttons.
  const cards = $('#status-cards');
  cards.innerHTML = '';
  for (const status of STATUSES) {
    const card = el('div', `status-card status-${status}`);
    card.dataset.status = status;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${counts[status]} ${STATUS_PLURALS[status]}`);
    const iconBox = el('span', 'status-icon');
    iconBox.appendChild(icon(STATUS_ICONS[status]));
    card.append(iconBox, el('span', 'status-count', String(counts[status])), el('span', 'status-label', STATUS_PLURALS[status]));
    cards.appendChild(card);
  }
  // Fifth card: rows an import added again (they show on Home with a Duplicate badge).
  const dupes = duplicateCount(state.events);
  const dupCard = el('div', 'status-card status-duplicate');
  dupCard.dataset.status = 'duplicate';
  dupCard.setAttribute('role', 'group');
  dupCard.setAttribute('aria-label', `${dupes} duplicate${dupes === 1 ? '' : 's'}`);
  const dupIcon = el('span', 'status-icon');
  dupIcon.appendChild(icon('fa-clone'));
  dupCard.append(dupIcon, el('span', 'status-count', String(dupes)), el('span', 'status-label', 'Duplicates'));
  cards.appendChild(dupCard);

  // Locations for the potential and active clients the status/search filters leave.
  const scoped = filterClients(clients, { status: filters.status, search: filters.search });
  const locations = $('#location-list');
  locations.innerHTML = '';
  const tree = locationTree(scoped);
  fillPlaceFilters(tree, filters);
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

  // Clients, one page at a time: each client, plus a line per duplicate row.
  const rows = homeRows(clients, state.events);
  const duplicates = rows.length - clients.length;
  const shown = filterClients(rows, filters);
  const dupNote = duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? '' : 's'}` : '';
  $('#client-count').textContent = shown.length === rows.length
    ? `(${rows.length}${dupNote})` : `(${shown.length} of ${rows.length}${dupNote})`;
  $('#client-status-filter').value = filters.status || '';
  refreshSelect($('#client-status-filter'));
  const page = paginate(shown, filters.page, filters.pageSize);
  renderPager(page, filters.pageSize);
  const list = $('#client-list');
  list.innerHTML = '';
  if (!clients.length) {
    list.appendChild(el('p', 'empty dash-empty', state.loading
      ? 'Loading your clients…'
      : all.length
        ? 'No potential or active clients yet: set a status on the Client tab or the Board.'
        : 'No clients yet: add a reminder or import Excel'));
    return;
  }
  if (!shown.length) {
    list.appendChild(el('p', 'empty dash-empty', 'No clients match these filters.'));
    return;
  }

  renderClientTable(list, page.items, { onOpen: handlers.onOpenClient, onStatus: handlers.onClientStatus });
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
  $('#client-country-filter').addEventListener('change', e => handlers.onDashFilter({ country: e.target.value || null, city: null }));
  $('#client-city-filter').addEventListener('change', e => {
    const city = e.target.value || null;
    if (!city) return handlers.onDashFilter({ city: null });
    // A city picked without a country takes the country it is in.
    const place = [...document.querySelectorAll('.loc-city')].find(tag => tag.dataset.city === city);
    return handlers.onDashFilter(place ? { city, country: place.dataset.country } : { city });
  });
  for (const id of ['#client-status-filter', '#client-country-filter', '#client-city-filter']) enhanceSelect($(id));

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
