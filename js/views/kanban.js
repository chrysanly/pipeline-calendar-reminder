// Board page: every client as a card in its status column. Drag a card to
// another column (or pick its Stage) to move the client; set a deal value per
// client; filter the cards (search, status, country, city, remembered per
// browser); export everything as CSV or Excel. Logic lives in deals.js,
// dashboard.js and exporter.js.

import { STATUSES, STATUS_LABELS, applyClientFields } from '../storage.js';
import { CURRENCIES } from '../store.js';
import { boardColumns, stageTotals, formatMoney, formatTotals, validateDeal, dealRecord } from '../deals.js';
import { exportRows, toCsv, toXlsx, exportFileName } from '../exporter.js';
import { loadXlsx } from '../xlsx-loader.js';
import { el, icon, withBusy, STATUS_ICONS } from '../ui.js';
import { filterBoard, parseBoardFilters, hasBoardFilters, locationTree, EMPTY_BOARD_FILTERS } from '../dashboard.js';
import { enhanceSelect, refreshSelect } from '../select.js';
import { markSelectMenu } from '../select-menu.js';

const BOARD_FILTER_KEY = 'cladflo.board-filters.v1';
// The Board's filters, kept across renders and reloads (this browser only).
let boardFilters = readBoardFilters();
// The filter bar's fixed parts, built once so typing survives re-renders.
let filterBar = null;

function readBoardFilters() {
  try {
    return parseBoardFilters(localStorage.getItem(BOARD_FILTER_KEY));
  } catch {
    return { ...EMPTY_BOARD_FILTERS };
  }
}

function setBoardFilters(app, patch) {
  boardFilters = { ...boardFilters, ...patch };
  try {
    localStorage.setItem(BOARD_FILTER_KEY, JSON.stringify(boardFilters));
  } catch {
    // Private mode or full storage: the filters last for this visit only.
  }
  app.render();
}

// The one card whose value form is open, and what has been typed so far, so a
// re-render (a snapshot from another device) does not lose it.
const boardEdit = { key: null, value: '', currency: '', error: '' };

const boardData = app => boardColumns(app.clients(), app.store.all('clients'));

function iconText(name, text) {
  const span = el('span');
  span.append(icon(name), ' ', text);
  return span;
}

// ---------- moving a client ----------

function moveClient(app, key, status) {
  const client = app.clients().find(c => c.key === key);
  if (!client || client.status === status || !STATUSES.includes(status)) return;
  const previous = client.status;
  app.commitEvents(applyClientFields(app.state.events, client.name, { status }, new Date().toISOString()));
  app.log('status', 'client', client.name, client.name, `${STATUS_LABELS[previous]} → ${STATUS_LABELS[status]}`);
  app.hooks.emit('status-change', { clientName: client.name, status, previous });
}

// ---------- deal values ----------

function openDealForm(app, card) {
  Object.assign(boardEdit, {
    key: card.key,
    value: card.value ? String(card.value) : '',
    currency: card.currency || app.settings().currency,
    error: ''
  });
  app.render();
  const input = document.querySelector(`.board-card[data-key="${CSS.escape(card.key)}"] .deal-value`);
  if (input) input.focus();
}

function closeDealForm(app) {
  boardEdit.key = null;
  app.render();
}

async function saveDeal(app, card) {
  const { deal, error } = validateDeal(boardEdit);
  if (!error && !app.canSave()) boardEdit.error = 'Sign in first.';
  else boardEdit.error = error;
  if (boardEdit.error) {
    app.render();
    document.querySelector(`.board-card[data-key="${CSS.escape(card.key)}"] .deal-value`)?.focus();
    return;
  }
  const { id, data } = dealRecord(app.store.all('clients'), card.name, deal);
  boardEdit.key = null;
  if (id) await app.store.update('clients', id, data);
  else await app.store.add('clients', data);
  app.log('edit', 'client', card.name, card.name, `Deal value ${formatMoney(deal.value, deal.currency)}`);
}

function dealForm(app, card) {
  const form = el('form', 'deal-form');
  form.noValidate = true;
  const value = el('input', 'deal-value');
  value.type = 'text';
  value.inputMode = 'decimal';
  value.autocomplete = 'off';
  value.placeholder = '12,500';
  value.value = boardEdit.value;
  value.setAttribute('aria-label', `Deal value for ${card.name}`);
  value.addEventListener('input', () => { boardEdit.value = value.value; });

  const currency = el('select', 'deal-currency');
  currency.setAttribute('aria-label', `Currency for ${card.name}`);
  for (const code of CURRENCIES) {
    const option = el('option', '', code);
    option.value = code;
    currency.appendChild(option);
  }
  currency.value = boardEdit.currency;
  currency.addEventListener('change', () => { boardEdit.currency = currency.value; });

  const error = el('p', 'deal-error', boardEdit.error);
  error.setAttribute('role', 'alert');
  if (boardEdit.error) value.setAttribute('aria-invalid', 'true');

  const cancel = el('button', 'ghost', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => closeDealForm(app));
  const save = el('button', 'primary', 'Save');
  save.type = 'submit';

  form.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(save, () => saveDeal(app, card));
  });
  form.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeDealForm(app);
    }
  });
  const row = el('div', 'deal-row');
  row.append(value, currency);
  const actions = el('div', 'deal-actions');
  actions.append(cancel, save);
  form.append(row, error, actions);
  return form;
}

// ---------- the board ----------

function stageSelect(app, card) {
  const select = markSelectMenu(el('select', `card-stage status-${card.status}`), 'status');
  select.setAttribute('aria-label', `Stage for ${card.name}`);
  for (const status of STATUSES) {
    const option = el('option', '', STATUS_LABELS[status]);
    option.value = status;
    select.appendChild(option);
  }
  select.value = card.status;
  select.addEventListener('change', () => moveClient(app, card.key, select.value));
  return select;
}

function boardCard(app, card) {
  const item = el('li', `board-card status-${card.status}`);
  item.dataset.key = card.key;
  item.draggable = boardEdit.key !== card.key;
  item.appendChild(el('h4', 'card-name', card.name));
  const place = [card.city, card.country].filter(Boolean).join(', ');
  if (place) item.appendChild(el('p', 'card-place', place));

  if (boardEdit.key === card.key) {
    item.appendChild(dealForm(app, card));
    return item;
  }
  const value = el('p', card.value ? 'card-value' : 'card-value is-empty', card.value ? formatMoney(card.value, card.currency) : 'No value yet');
  const edit = el('button', 'ghost card-edit');
  edit.type = 'button';
  edit.setAttribute('aria-label', `${card.value ? 'Edit' : 'Set'} value for ${card.name}`);
  edit.append(icon(card.value ? 'fa-pen' : 'fa-plus'), ' ', el('span', 'btn-label', card.value ? 'Edit value' : 'Set value'));
  edit.addEventListener('click', () => openDealForm(app, card));
  const actions = el('div', 'card-actions');
  actions.append(stageSelect(app, card), edit);
  item.append(value, actions);
  return item;
}

function boardColumn(app, status, cards, stage) {
  const column = el('section', `board-col status-${status}`);
  column.dataset.status = status;
  column.setAttribute('aria-label', STATUS_LABELS[status]);
  const head = el('header', 'board-col-head');
  const title = el('h3', 'board-col-title');
  title.append(iconText(STATUS_ICONS[status], STATUS_LABELS[status]), el('span', 'client-count', String(stage.count)));
  head.append(title, el('p', 'board-col-total', formatTotals(stage.totals) || '—'));
  const list = el('ul', 'board-cards');
  for (const card of cards) list.appendChild(boardCard(app, card));
  if (!cards.length) list.appendChild(el('li', 'board-empty', hasBoardFilters(boardFilters) ? 'No clients match the filters' : 'Drop a client here'));
  column.append(head, list);
  return column;
}

function renderBoard(app, section) {
  const board = section.querySelector('.board');
  board.innerHTML = '';
  if (app.state.loading) {
    board.appendChild(el('p', 'board-loading', 'Loading…'));
    return;
  }
  const all = boardData(app);
  renderBoardFilters(all);
  const { columns, shown, total } = filterBoard(all, boardFilters);
  filterBar.count.textContent = hasBoardFilters(boardFilters) ? `${shown} of ${total} clients` : `${total} client${total === 1 ? '' : 's'}`;
  const { stages, forecast } = stageTotals(columns);
  if (boardEdit.key && !STATUSES.some(s => columns[s].some(c => c.key === boardEdit.key))) boardEdit.key = null;
  for (const status of STATUSES) board.appendChild(boardColumn(app, status, columns[status], stages[status]));
  section.querySelector('.board-forecast').textContent = formatTotals(forecast)
    ? `Forecast: ${formatTotals(forecast)}`
    : 'Set deal values to see a forecast.';
}

/** Mouse drag and drop between columns (touch and keyboard use the Stage menu). */
function bindDrag(app, board) {
  let dragged = null;
  const columnOf = target => target.closest && target.closest('.board-col');
  board.addEventListener('dragstart', e => {
    const card = e.target.closest && e.target.closest('.board-card');
    if (!card) return;
    dragged = card.dataset.key;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragged);
    card.classList.add('is-dragging');
  });
  board.addEventListener('dragend', () => {
    dragged = null;
    for (const node of board.querySelectorAll('.is-dragging, .is-over')) node.classList.remove('is-dragging', 'is-over');
  });
  board.addEventListener('dragover', e => {
    const column = columnOf(e.target);
    if (!column || !dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    for (const node of board.querySelectorAll('.board-col.is-over')) if (node !== column) node.classList.remove('is-over');
    column.classList.add('is-over');
  });
  board.addEventListener('drop', e => {
    const column = columnOf(e.target);
    if (!column) return;
    e.preventDefault();
    const key = dragged || e.dataTransfer.getData('text/plain');
    dragged = null;
    moveClient(app, key, column.dataset.status);
  });
}

// ---------- filters ----------

function filterSelect(id, label) {
  const select = el('select', 'board-filter-select');
  select.id = id;
  select.setAttribute('aria-label', label);
  return select;
}

function fillFilterSelect(select, allLabel, options, value) {
  select.innerHTML = '';
  for (const [optionValue, text] of [['', allLabel], ...options]) {
    const option = el('option', '', text);
    option.value = optionValue;
    select.appendChild(option);
  }
  select.value = options.some(([v]) => v === value) ? value : '';
  refreshSelect(select);
}

function buildBoardFilters(app) {
  const bar = el('form', 'board-filters');
  bar.setAttribute('role', 'search');
  bar.setAttribute('aria-label', 'Filter the board');
  bar.addEventListener('submit', e => e.preventDefault());
  const search = el('input', 'client-search board-search');
  search.type = 'search';
  search.id = 'board-search';
  search.placeholder = 'Search name, phone, city…';
  search.setAttribute('aria-label', 'Search the board');
  search.autocomplete = 'off';
  search.value = boardFilters.search;
  search.addEventListener('input', () => setBoardFilters(app, { search: search.value }));
  const status = filterSelect('board-status-filter', 'Filter the board by status');
  const country = filterSelect('board-country-filter', 'Filter the board by country');
  const city = filterSelect('board-city-filter', 'Filter the board by city');
  const clear = el('button', 'ghost board-clear');
  clear.type = 'button';
  clear.append(icon('fa-filter-circle-xmark'), ' ', el('span', 'btn-label', 'Clear filters'));
  clear.addEventListener('click', () => {
    search.value = '';
    setBoardFilters(app, { ...EMPTY_BOARD_FILTERS });
  });
  const count = el('p', 'board-filter-count');
  count.setAttribute('aria-live', 'polite');
  bar.append(search, status, country, city, clear, count);
  status.addEventListener('change', () => setBoardFilters(app, { status: status.value || null }));
  country.addEventListener('change', () => setBoardFilters(app, { country: country.value || null, city: null }));
  city.addEventListener('change', () => setBoardFilters(app, { city: city.value || null }));
  filterBar = { bar, search, status, country, city, clear, count };
  return bar;
}

/** The choices come from every card, so a filter never hides its own options. */
function renderBoardFilters(columns) {
  const cards = STATUSES.flatMap(s => columns[s]);
  const tree = locationTree(cards);
  fillFilterSelect(filterBar.status, 'All statuses', STATUSES.map(s => [s, STATUS_LABELS[s]]), boardFilters.status);
  fillFilterSelect(filterBar.country, 'All countries', tree.map(c => [c.name, c.name]), boardFilters.country);
  const places = boardFilters.country ? tree.filter(c => c.name === boardFilters.country) : tree;
  const cities = [...new Set(places.flatMap(c => c.cities.map(x => x.name)))].sort((a, b) => a.localeCompare(b));
  fillFilterSelect(filterBar.city, 'All cities', cities.map(name => [name, name]), boardFilters.city);
  if (document.activeElement !== filterBar.search) filterBar.search.value = boardFilters.search;
  filterBar.clear.disabled = !hasBoardFilters(boardFilters);
}

// ---------- export ----------

function download(data, type, name) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = el('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportClients(app, kind) {
  const rows = exportRows(app.state.events, app.store.all('clients'));
  if (!rows.length) {
    app.notify('Nothing to export yet', 'Add a reminder with a client first.');
    return;
  }
  try {
    if (kind === 'csv') download(toCsv(rows), 'text/csv;charset=utf-8', exportFileName('csv'));
    else {
      const XLSX = await loadXlsx();
      download(toXlsx(XLSX, rows), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exportFileName('xlsx'));
    }
  } catch (err) {
    app.notify('Export failed', err && err.message ? err.message : String(err));
  }
}

function exportButton(app, kind, iconName, label) {
  const button = el('button', 'secondary');
  button.type = 'button';
  button.id = `export-${kind}`;
  button.title = `Download every reminder as ${label}; it imports back with Import Excel`;
  button.append(icon(iconName), ' ', el('span', 'btn-label', `Export ${label}`));
  button.addEventListener('click', () => withBusy(button, () => exportClients(app, kind)));
  return button;
}

function buildBoardPage(app, section) {
  const head = el('div', 'page-head');
  const text = el('div');
  text.append(el('h2', 'page-title', 'Board'), el('p', 'page-sub board-forecast'));
  const actions = el('div', 'board-export');
  actions.append(exportButton(app, 'csv', 'fa-file-csv', 'CSV'), exportButton(app, 'xlsx', 'fa-file-excel', 'Excel'));
  head.append(text, actions);
  const filters = buildBoardFilters(app);
  const board = el('div', 'board');
  section.append(head, filters, board);
  for (const select of [filterBar.status, filterBar.country, filterBar.city]) enhanceSelect(select);
  bindDrag(app, board);
}

/** Feature entry point (js/features.js). */
export function registerKanban(app) {
  app.views.register({
    id: 'board',
    label: 'Board',
    icon: 'fa-table-columns',
    key: 'b',
    css: 'css/kanban.css',
    bind: buildBoardPage,
    render: renderBoard
  });
}
