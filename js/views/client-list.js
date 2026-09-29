// Client tab, list mode: every client once (no duplicate lines), in the same
// table as Home (js/client-table.js), with search, status, country and city
// filters and pages. Picking a client opens its profile (js/views/client.js).

import { STATUSES, STATUS_LABELS } from '../storage.js';
import { filterClients, locationTree, paginate, PAGE_SIZES } from '../dashboard.js';
import { renderClientTable } from '../client-table.js';
import { enhanceSelect, refreshSelect } from '../select.js';
import { el, icon } from '../ui.js';

// The list's filters and page, kept while the app is open.
const clientListState = { search: '', status: null, country: null, city: null, page: 1, pageSize: PAGE_SIZES[0] };
let listParts = null;

function listSelect(id, label) {
  const select = el('select', 'client-status-filter');
  select.id = id;
  select.setAttribute('aria-label', label);
  return select;
}

function fillListSelect(select, allLabel, options, value) {
  select.innerHTML = '';
  for (const [optionValue, text] of [['', allLabel], ...options]) {
    const option = el('option', '', text);
    option.value = optionValue;
    select.appendChild(option);
  }
  select.value = options.some(([v]) => v === value) ? value : '';
  refreshSelect(select);
}

function pagerButton(id, iconName, text, after) {
  const button = el('button', 'ghost');
  button.type = 'button';
  button.id = id;
  button.setAttribute('aria-label', `${text} page`);
  const label = el('span', 'btn-label', text);
  if (after) button.append(label, ' ', icon(iconName));
  else button.append(icon(iconName), ' ', label);
  return button;
}

/** Build the list card once; `onChange` re-renders the page. */
export function buildClientList(onChange) {
  const section = el('section', 'dash-card dash-clients client-list-card');
  section.setAttribute('aria-labelledby', 'all-clients-title');
  const head = el('div', 'dash-clients-head');
  const title = el('h3', 'dash-title');
  title.id = 'all-clients-title';
  const count = el('span', 'client-count');
  title.append(icon('fa-users'), ' All clients ', count);

  const filters = el('div', 'client-filters');
  const search = el('input', 'client-search');
  search.type = 'search';
  search.id = 'clients-search';
  search.placeholder = 'Search name, phone, city…';
  search.setAttribute('aria-label', 'Search clients');
  search.autocomplete = 'off';
  const status = listSelect('clients-status-filter', 'Filter clients by status');
  const country = listSelect('clients-country-filter', 'Filter clients by country');
  const city = listSelect('clients-city-filter', 'Filter clients by city');
  filters.append(search, status, country, city);
  head.append(title, filters);

  const list = el('div', 'client-list');
  list.id = 'clients-table';

  const pager = el('nav', 'pager');
  pager.setAttribute('aria-label', 'Client list pages');
  const info = el('p', 'pager-info');
  info.setAttribute('aria-live', 'polite');
  const sizeLabel = el('label', 'pager-size', 'Show ');
  const size = el('select');
  size.id = 'clients-page-size';
  size.setAttribute('aria-label', 'Clients per page');
  for (const n of PAGE_SIZES) {
    const option = el('option', '', String(n));
    option.value = String(n);
    size.appendChild(option);
  }
  sizeLabel.appendChild(size);
  const nav = el('div', 'pager-nav');
  const prev = pagerButton('clients-page-prev', 'fa-chevron-left', 'Prev', false);
  const label = el('span', 'page-label');
  const next = pagerButton('clients-page-next', 'fa-chevron-right', 'Next', true);
  nav.append(prev, label, next);
  pager.append(info, sizeLabel, nav);
  section.append(head, list, pager);

  const set = patch => {
    Object.assign(clientListState, { page: 1 }, patch);
    onChange();
  };
  search.addEventListener('input', () => set({ search: search.value }));
  status.addEventListener('change', () => set({ status: status.value || null }));
  country.addEventListener('change', () => set({ country: country.value || null, city: null }));
  city.addEventListener('change', () => set({ city: city.value || null }));
  size.addEventListener('change', () => set({ pageSize: Number(size.value) }));
  for (const [button, delta] of [[prev, -1], [next, 1]]) {
    button.addEventListener('click', () => {
      clientListState.page += delta;
      onChange();
      list.scrollIntoView({ block: 'nearest' });
    });
  }
  for (const select of [status, country, city]) enhanceSelect(select);
  listParts = { section, count, search, status, country, city, list, pager, info, size, prev, next, label };
  return section;
}

/**
 * Render every client (buildClients: one line each). handlers.onOpen(client)
 * opens a profile; handlers.onStatus(name, status) changes one.
 */
export function renderClientList(clients, { loading = false, onOpen, onStatus }) {
  const p = listParts;
  const named = clients.filter(c => c.key);
  const tree = locationTree(named);
  fillListSelect(p.status, 'All statuses', STATUSES.map(s => [s, STATUS_LABELS[s]]), clientListState.status);
  fillListSelect(p.country, 'All countries', tree.map(c => [c.name, c.name]), clientListState.country);
  const places = clientListState.country ? tree.filter(c => c.name === clientListState.country) : tree;
  const cities = [...new Set(places.flatMap(c => c.cities.map(x => x.name)))].sort((a, b) => a.localeCompare(b));
  fillListSelect(p.city, 'All cities', cities.map(name => [name, name]), clientListState.city);
  if (document.activeElement !== p.search) p.search.value = clientListState.search;
  p.size.value = String(clientListState.pageSize);

  const shown = filterClients(named, clientListState);
  p.count.textContent = shown.length === named.length ? `(${named.length})` : `(${shown.length} of ${named.length})`;
  const page = paginate(shown, clientListState.page, clientListState.pageSize);
  clientListState.page = page.page;
  p.pager.hidden = !page.total;
  p.info.textContent = `Showing ${page.start}–${page.end} of ${page.total}`;
  p.label.textContent = `Page ${page.page} of ${page.pages}`;
  p.prev.disabled = page.page <= 1;
  p.next.disabled = page.page >= page.pages;

  p.list.innerHTML = '';
  if (loading) {
    p.list.appendChild(el('p', 'empty dash-empty', 'Loading your clients…'));
    return;
  }
  if (!named.length) {
    p.list.appendChild(el('p', 'empty dash-empty', 'No clients yet: add a reminder with a client name, or import Excel on Home.'));
    return;
  }
  if (!shown.length) {
    p.list.appendChild(el('p', 'empty dash-empty', 'No clients match these filters.'));
    return;
  }
  renderClientTable(p.list, page.items, { onOpen, onStatus });
}
