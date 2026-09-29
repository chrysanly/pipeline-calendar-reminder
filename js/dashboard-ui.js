// Home: the Potential/Active progress chart and the status cards. The pipeline
// board below them is js/views/kanban.js (mounted through app.home).

import { STATUSES, STATUS_LABELS } from './storage.js';
import { buildClients, statusCounts, progressData, duplicateCount } from './dashboard.js';
import { $, el, icon, showView, STATUS_ICONS, STATUS_PLURALS } from './ui.js';

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

function statusCard(status, count, label, iconName, ariaLabel = `${count} ${label}`) {
  const card = el('div', `status-card status-${status}`);
  card.dataset.status = status;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', ariaLabel);
  const iconBox = el('span', 'status-icon');
  iconBox.appendChild(icon(iconName));
  card.append(iconBox, el('span', 'status-count', String(count)), el('span', 'status-label', label));
  return card;
}

/** Home: the progress chart, 4 status cards and a Duplicates card (numbers only). */
export function renderDashboard(state) {
  showView('dashboard');
  const all = buildClients(state.events);
  const counts = statusCounts(all);
  renderProgressChart(all);

  const cards = $('#status-cards');
  cards.innerHTML = '';
  for (const status of STATUSES) {
    cards.appendChild(statusCard(status, counts[status], STATUS_PLURALS[status], STATUS_ICONS[status]));
  }
  // Fifth card: rows an import added again.
  const dupes = duplicateCount(state.events);
  cards.appendChild(statusCard('duplicate', dupes, 'Duplicates', 'fa-clone', `${dupes} duplicate${dupes === 1 ? '' : 's'}`));
}
