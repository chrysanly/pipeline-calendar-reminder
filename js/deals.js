// Deal values and the pipeline forecast. Pure: a deal is a record in the
// `clients` collection (store.js) keyed by the client's name (clientKey), so
// it follows the client whatever reminders it has.

import { STATUSES, clientKey } from './storage.js';
import { CURRENCIES } from './store.js';

/** Chance a deal at this stage closes; the forecast weighs values by it. */
export const STAGE_WEIGHTS = { lead: 0.1, potential: 0.5, active: 1, inactive: 0 };

/** Largest value accepted, so a typo can't wreck every total. */
export const MAX_DEAL = 1e12;

/** "12,500.50", " 800 ", "AED 1,200" → a number with at most 2 decimals; bad or negative → null. */
export function parseAmount(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 && input <= MAX_DEAL ? Math.round(input * 100) / 100 : null;
  const raw = String(input === null || input === undefined ? '' : input).trim().replace(/^[A-Za-z]{3}\s*/, '').replace(/[\s,]/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const value = Number(raw);
  return value <= MAX_DEAL ? value : null;
}

/** The deal record for a client name, or null. */
export function dealFor(deals, name) {
  const key = clientKey(name);
  return key ? deals.find(deal => deal.key === key) || null : null;
}

/**
 * Check a value/currency pair from the form.
 * @returns {{deal: {value: number, currency: string}|null, error: string}}
 */
export function validateDeal({ value, currency }) {
  const amount = parseAmount(value);
  if (amount === null) return { deal: null, error: 'Enter an amount like 12,500 or 800.50.' };
  const code = String(currency || '').trim().toUpperCase();
  if (!CURRENCIES.includes(code)) return { deal: null, error: 'Pick a currency from the list.' };
  return { deal: { value: amount, currency: code }, error: '' };
}

/** What to save for a client: the fields for store.add (new) or store.update (existing id). */
export function dealRecord(deals, name, deal) {
  const existing = dealFor(deals, name);
  const data = { key: clientKey(name), name: String(name).trim().replace(/\s+/g, ' '), value: deal.value, currency: deal.currency };
  return { id: existing ? existing.id : null, data };
}

const byValueThenName = (a, b) => (b.value || 0) - (a.value || 0) || a.name.localeCompare(b.name);

/**
 * Board columns, one per status: the named clients (from buildClients) with
 * their deal, biggest value first, then A–Z.
 */
export function boardColumns(clients, deals) {
  const columns = Object.fromEntries(STATUSES.map(status => [status, []]));
  for (const client of clients) {
    if (!client.key) continue; // reminders without a client are not deals
    const deal = dealFor(deals, client.name);
    columns[client.status in columns ? client.status : 'lead'].push({
      ...client,
      value: deal ? deal.value : 0,
      currency: deal ? deal.currency : ''
    });
  }
  for (const status of STATUSES) columns[status].sort(byValueThenName);
  return columns;
}

const addTo = (totals, currency, amount) => {
  totals[currency] = Math.round(((totals[currency] || 0) + amount) * 100) / 100;
};

/**
 * Per stage: how many clients and the sum of their values per currency (never
 * converted); plus the forecast, each value weighed by its stage's chance.
 * @returns {{stages: Object<string, {count: number, totals: Object<string, number>}>, forecast: Object<string, number>}}
 */
export function stageTotals(columns) {
  const stages = {};
  const forecast = {};
  for (const status of STATUSES) {
    const totals = {};
    for (const card of columns[status] || []) {
      if (!card.currency || !card.value) continue;
      addTo(totals, card.currency, card.value);
      if (STAGE_WEIGHTS[status]) addTo(forecast, card.currency, card.value * STAGE_WEIGHTS[status]);
    }
    stages[status] = { count: (columns[status] || []).length, totals };
  }
  return { stages, forecast };
}

/** "AED 12,500" (no decimals when whole). */
export function formatMoney(amount, currency) {
  const whole = Math.round(amount) === amount;
  const number = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
  return `${currency} ${number}`;
}

/** Totals per currency as one line: "AED 12,500 · USD 800"; '' when empty. */
export function formatTotals(totals) {
  return Object.keys(totals).sort().map(code => formatMoney(totals[code], code)).join(' · ');
}
