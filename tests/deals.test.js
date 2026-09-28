import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  STAGE_WEIGHTS, parseAmount, dealFor, validateDeal, dealRecord, boardColumns, stageTotals, formatMoney, formatTotals
} from '../js/deals.js';

const client = (name, status, extra = {}) => ({ key: name.toLowerCase(), name, status, ...extra });
const DEALS = [
  { id: 'd1', key: 'acme ltd.', name: 'Acme Ltd.', value: 12000, currency: 'AED' },
  { id: 'd2', key: 'falcon trading', name: 'Falcon Trading', value: 800.5, currency: 'USD' },
  { id: 'd3', key: 'palm holdings', name: 'Palm Holdings', value: 5000, currency: 'AED' },
  { id: 'd4', key: 'oasis group', name: 'Oasis Group', value: 3000, currency: 'AED' }
];

test('parseAmount reads amounts with commas, spaces and a currency prefix', () => {
  assertEqual(parseAmount('12,500.50'), 12500.5);
  assertEqual(parseAmount(' 800 '), 800);
  assertEqual(parseAmount('AED 1,200'), 1200);
  assertEqual(parseAmount(0), 0);
  assertEqual(parseAmount(19.999), 20);
  for (const bad of ['', 'abc', '-5', '1.234', '1e5', null, undefined, NaN, -1, '9999999999999']) {
    assertEqual(parseAmount(bad), null, `accepted ${bad}`);
  }
});

test('dealFor finds a deal by client name, whatever the case and spacing', () => {
  assertEqual(dealFor(DEALS, '  ACME   Ltd. ').id, 'd1');
  assertEqual(dealFor(DEALS, 'Nobody'), null);
  assertEqual(dealFor(DEALS, ''), null);
});

test('validateDeal checks the amount and the currency', () => {
  assertDeepEqual(validateDeal({ value: '1,500', currency: 'usd' }), { deal: { value: 1500, currency: 'USD' }, error: '' });
  assert(/amount/.test(validateDeal({ value: 'lots', currency: 'AED' }).error));
  assert(/currency/.test(validateDeal({ value: '10', currency: 'BTC' }).error));
});

test('dealRecord updates the existing deal or makes a new one keyed by client name', () => {
  assertDeepEqual(dealRecord(DEALS, 'acme ltd.', { value: 1, currency: 'AED' }),
    { id: 'd1', data: { key: 'acme ltd.', name: 'acme ltd.', value: 1, currency: 'AED' } });
  assertDeepEqual(dealRecord(DEALS, ' New  Co ', { value: 2, currency: 'EUR' }),
    { id: null, data: { key: 'new co', name: 'New Co', value: 2, currency: 'EUR' } });
});

test('boardColumns: one column per status, biggest deal first, then A–Z; no-client rows left out', () => {
  const clients = [
    client('Palm Holdings', 'lead'), client('Acme Ltd.', 'lead'), client('Zed Co', 'lead'), client('Bee Co', 'lead'),
    client('Falcon Trading', 'active'), client('Oasis Group', 'unknown-status'),
    { key: '', name: '(No client)', status: 'lead' }
  ];
  const columns = boardColumns(clients, DEALS);
  assertDeepEqual(Object.keys(columns), ['lead', 'potential', 'active', 'inactive']);
  assertDeepEqual(columns.lead.map(c => c.name), ['Acme Ltd.', 'Palm Holdings', 'Oasis Group', 'Bee Co', 'Zed Co']);
  assertEqual(columns.lead[0].value, 12000);
  assertEqual(columns.lead[3].currency, '');
  assertEqual(columns.active[0].currency, 'USD');
  assertDeepEqual(columns.potential, []);
});

test('stageTotals sums per stage and currency and weighs the forecast by stage', () => {
  const columns = boardColumns([
    client('Acme Ltd.', 'lead'), client('Palm Holdings', 'potential'), client('Oasis Group', 'potential'),
    client('Falcon Trading', 'active'), client('Gone Co', 'inactive')
  ], [...DEALS, { id: 'd5', key: 'gone co', name: 'Gone Co', value: 999, currency: 'AED' }]);
  const { stages, forecast } = stageTotals(columns);
  assertDeepEqual(stages.lead, { count: 1, totals: { AED: 12000 } });
  assertDeepEqual(stages.potential, { count: 2, totals: { AED: 8000 } });
  assertDeepEqual(stages.active, { count: 1, totals: { USD: 800.5 } });
  assertDeepEqual(stages.inactive, { count: 1, totals: { AED: 999 } });
  assertEqual(STAGE_WEIGHTS.inactive, 0);
  assertDeepEqual(forecast, { AED: 12000 * 0.1 + 8000 * 0.5, USD: 800.5 });
  assertDeepEqual(stageTotals(boardColumns([], [])).forecast, {});
});

test('formatMoney and formatTotals', () => {
  assertEqual(formatMoney(12500, 'AED'), 'AED 12,500');
  assertEqual(formatMoney(800.5, 'USD'), 'USD 800.50');
  assertEqual(formatTotals({ USD: 800.5, AED: 5200 }), 'AED 5,200 · USD 800.50');
  assertEqual(formatTotals({}), '');
});
