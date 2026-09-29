import { test, assertEqual, assertDeepEqual } from './runner.js';
import { filterOptions, moveActive } from '../js/select.js';
import { readDateKey, nextRange, rangeRole, shiftDay, DAY_KEYS } from '../js/datepicker.js';
import { menuNeedsSearch, opensMenu, menuPlacement } from '../js/select-menu.js';

const OPTIONS = ['Acme Ltd.', 'Desert Rose', 'Falcon Trading', 'Blue Falcon'].map(label => ({ value: label, label }));
const labels = list => list.map(o => o.label);

test('filterOptions: any case, every word, the ones that start with the query first', () => {
  assertDeepEqual(labels(filterOptions(OPTIONS, '')), labels(OPTIONS), 'blank keeps them all, in order');
  assertDeepEqual(labels(filterOptions(OPTIONS, 'FALCON')), ['Falcon Trading', 'Blue Falcon']);
  assertDeepEqual(labels(filterOptions(OPTIONS, 'falcon blue')), ['Blue Falcon']);
  assertDeepEqual(labels(filterOptions(OPTIONS, '  rose ')), ['Desert Rose']);
  assertDeepEqual(filterOptions(OPTIONS, 'nobody'), []);
  const copy = filterOptions(OPTIONS, '');
  copy.pop();
  assertEqual(OPTIONS.length, 4, 'the input list is untouched');
});

test('moveActive wraps round and starts from the first or last', () => {
  assertEqual(moveActive(-1, 1, 3), 0);
  assertEqual(moveActive(-1, -1, 3), 2);
  assertEqual(moveActive(2, 1, 3), 0);
  assertEqual(moveActive(0, -1, 3), 2);
  assertEqual(moveActive(1, 1, 3), 2);
  assertEqual(moveActive(0, 1, 0), -1, 'nothing listed');
});

test('readDateKey: ISO or day-first dates; blank is empty; impossible dates are null', () => {
  assertEqual(readDateKey('2026-10-03'), '2026-10-03');
  assertEqual(readDateKey('2026-1-3'), '2026-01-03');
  assertEqual(readDateKey('03/10/2026'), '2026-10-03');
  assertEqual(readDateKey('3.10.2026'), '2026-10-03');
  assertEqual(readDateKey(' 03-10-2026 '), '2026-10-03');
  assertEqual(readDateKey(''), '');
  assertEqual(readDateKey(null), '');
  assertEqual(readDateKey('31/02/2026'), null);
  assertEqual(readDateKey('tomorrow'), null);
});

test('nextRange: the first pick sets From, the second To; earlier or after a full range starts again', () => {
  assertDeepEqual(nextRange({}, '2026-10-05'), { from: '2026-10-05', to: '' });
  assertDeepEqual(nextRange({ from: '2026-10-05', to: '' }, '2026-10-09'), { from: '2026-10-05', to: '2026-10-09' });
  assertDeepEqual(nextRange({ from: '2026-10-05', to: '' }, '2026-10-05'), { from: '2026-10-05', to: '2026-10-05' }, 'one day');
  assertDeepEqual(nextRange({ from: '2026-10-05', to: '' }, '2026-10-01'), { from: '2026-10-01', to: '' });
  assertDeepEqual(nextRange({ from: '2026-10-05', to: '2026-10-09' }, '2026-10-20'), { from: '2026-10-20', to: '' });
});

test('rangeRole marks the start, the end and the days between', () => {
  const range = { from: '2026-10-05', to: '2026-10-09' };
  assertDeepEqual(['2026-10-04', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-10'].map(key => rangeRole(key, range)),
    ['', 'start', 'between', 'end', '']);
  assertEqual(rangeRole('2026-10-07', { from: '2026-10-05', to: '' }), '', 'no To yet: nothing between');
  assertEqual(rangeRole('2026-10-07', {}), '');
});

test('shiftDay moves by the arrow keys across months and years', () => {
  assertEqual(shiftDay('2026-10-31', DAY_KEYS.ArrowRight), '2026-11-01');
  assertEqual(shiftDay('2026-01-01', DAY_KEYS.ArrowLeft), '2025-12-31');
  assertEqual(shiftDay('2026-10-28', DAY_KEYS.ArrowDown), '2026-11-04');
  assertEqual(shiftDay('2026-10-03', DAY_KEYS.ArrowUp), '2026-09-26');
});

test('select menus: a search box only over 6 options; the keys that open a menu', () => {
  assertEqual(menuNeedsSearch(4), false, 'Status: a clean list');
  assertEqual(menuNeedsSearch(6), false);
  assertEqual(menuNeedsSearch(7), true);
  assertEqual(menuNeedsSearch(2229), true, 'clients: searchable');
  for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4']) assertEqual(opensMenu(key), true, key);
  for (const key of ['Tab', 'a', 'Escape']) assertEqual(opensMenu(key), false, key);
});

test('menuPlacement: under the select, above it near the bottom, kept on screen', () => {
  const viewport = { width: 1280, height: 800 };
  const below = menuPlacement({ top: 100, bottom: 144, left: 50, width: 160 }, viewport);
  assertDeepEqual([below.above, below.top, below.left, below.width, below.maxHeight], [false, 150, 50, 200, 320]);
  const above = menuPlacement({ top: 700, bottom: 744, left: 50, width: 300 }, viewport);
  assertEqual(above.above, true);
  assertEqual(above.top + above.maxHeight, 694, 'ends just above the select');
  const edge = menuPlacement({ top: 100, bottom: 144, left: 1200, width: 160 }, viewport);
  assertEqual(edge.left + edge.width <= viewport.width - 8, true, 'never past the right edge');
});
