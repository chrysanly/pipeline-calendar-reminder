// History view: every change, newest first, with action/client filters,
// a search box and a relative time on each entry.

import { HISTORY_ACTIONS, HISTORY_LABELS, filterHistory, historyClients, relativeTime } from './history.js';
import { $, el, icon, showView } from './ui.js';

const ACTION_ICONS = {
  create: 'fa-plus',
  edit: 'fa-pen',
  delete: 'fa-trash',
  status: 'fa-arrows-rotate',
  import: 'fa-file-import',
  minutes: 'fa-file-lines',
  clear: 'fa-broom'
};

/** Rebuild a select's options, keeping the current choice if it still exists. */
function fillSelect(select, allLabel, options, value) {
  select.innerHTML = '';
  const all = el('option', '', allLabel);
  all.value = '';
  select.appendChild(all);
  for (const [optionValue, label] of options) {
    const option = el('option', '', label);
    option.value = optionValue;
    select.appendChild(option);
  }
  select.value = options.some(([v]) => v === value) ? value : '';
}

function renderEntry(entry, now) {
  const item = el('li', `history-item action-${entry.action}`);
  item.dataset.action = entry.action;

  const badge = el('span', 'history-badge');
  badge.append(icon(ACTION_ICONS[entry.action]), HISTORY_LABELS[entry.action]);

  const body = el('div', 'history-body');
  body.appendChild(el('span', 'history-title', entry.title || '(untitled)'));
  const meta = [entry.kind === 'minutes' ? 'Minutes' : '', entry.client, entry.detail].filter(Boolean).join(' · ');
  if (meta) body.appendChild(el('span', 'history-meta', meta));

  const time = el('time', 'history-time', relativeTime(entry.at, now));
  time.dateTime = entry.at;
  time.title = new Date(entry.at).toLocaleString();

  item.append(badge, body, time);
  return item;
}

/** state.history is newest first; state.historyFilter is {action, client, search}. */
export function renderHistory(state) {
  showView('history');
  const filters = state.historyFilter;
  fillSelect($('#history-client'), 'All clients', historyClients(state.history).map(name => [name, name]), filters.client);

  const shown = filterHistory(state.history, filters);
  const total = state.history.length;
  $('#history-count').textContent = shown.length === total ? `(${total})` : `(${shown.length} of ${total})`;

  const list = $('#history-list');
  list.innerHTML = '';
  if (!shown.length) {
    list.appendChild(el('li', 'empty', total ? 'No entries match these filters.' : 'No changes yet. Everything you add, edit or delete shows up here.'));
    return;
  }
  const now = new Date();
  for (const entry of shown) list.appendChild(renderEntry(entry, now));
}

export function bindHistory(handlers) {
  fillSelect($('#history-action'), 'All actions', HISTORY_ACTIONS.map(action => [action, HISTORY_LABELS[action]]), '');
  $('#history-action').addEventListener('change', e => handlers.onHistoryFilter({ action: e.target.value }));
  $('#history-client').addEventListener('change', e => handlers.onHistoryFilter({ client: e.target.value }));
  $('#history-search').addEventListener('input', e => handlers.onHistoryFilter({ search: e.target.value }));
}
