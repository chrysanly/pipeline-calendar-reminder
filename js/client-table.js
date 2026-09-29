// The client table shared by Home and the Client tab: a header row, then one
// row per client (Home adds a row per duplicate import, with its badge).
// Styles: .client-list / .client-row in css/dashboard.css.

import { STATUSES, STATUS_LABELS } from './storage.js';
import { formatDayLabel } from './calendar.js';
import { el, icon, withIcon } from './ui.js';
import { markSelectMenu } from './select-menu.js';

export const CLIENT_TABLE_COLUMNS = ['Client', 'Status', 'City, country', 'Phone', 'Reminders', 'Next reminder'];

export function formatNextReminder(ref) {
  if (!ref) return 'No upcoming reminder';
  return `${formatDayLabel(ref.date)}${ref.time ? `, ${ref.time}` : ''}`;
}

function statusSelect(client, onStatus) {
  const select = markSelectMenu(el('select', `client-status status-${client.status}`), 'status');
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
  select.addEventListener('change', () => onStatus(client.name, select.value));
  return select;
}

function phoneCell(phone) {
  const cell = el('span', 'client-phone');
  if (!phone) {
    cell.append(icon('fa-phone'), '—');
    return cell;
  }
  const link = el('a', '', phone);
  link.href = `tel:${phone.replace(/[^\d+]/g, '')}`;
  cell.append(icon('fa-phone'), link);
  return cell;
}

function clientRow(client, { onOpen, onStatus }) {
  const row = el('div', `client-row status-${client.status}${client.isDuplicate ? ' is-duplicate' : ''}`);
  row.dataset.client = client.name;
  if (client.isDuplicate) row.dataset.duplicate = 'true';

  const name = el('button', 'client-name', client.name);
  name.type = 'button';
  name.title = client.key ? 'Open this client' : 'Open the next reminder';
  name.addEventListener('click', () => onOpen(client));
  const who = el('span', 'client-who');
  who.appendChild(name);
  if (client.isDuplicate) {
    const badge = withIcon(el('span', 'dup-badge'), 'fa-clone', 'Duplicate');
    badge.title = `${client.name} was already in your data: this row was imported again`;
    who.appendChild(badge);
  }

  const placeText = [client.city, client.country].filter(Boolean).join(', ') || '—';
  const where = withIcon(el('span', 'client-place'), 'fa-location-dot', placeText);
  if (client.location) where.title = client.location;
  const reminders = withIcon(el('span', 'client-reminders'), 'fa-bell', String(client.reminderCount));
  reminders.title = `${client.reminderCount} reminder(s)`;
  const next = withIcon(el('span', 'client-next'), 'fa-clock', formatNextReminder(client.nextReminder));

  row.append(who, statusSelect(client, onStatus), where, phoneCell(client.phone), reminders, next);
  return row;
}

/**
 * Fill `list` with the table for `items` (one page). onOpen(client) opens a
 * client; onStatus(name, status) changes one.
 */
export function renderClientTable(list, items, handlers) {
  const head = el('div', 'client-row client-head');
  for (const label of CLIENT_TABLE_COLUMNS) head.appendChild(el('span', '', label));
  list.appendChild(head);
  for (const client of items) list.appendChild(clientRow(client, handlers));
}
