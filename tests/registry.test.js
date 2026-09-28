import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import { createViewRegistry, validateView, BUILT_IN_VIEWS } from '../js/views/registry.js';
import { createHooks } from '../js/hooks.js';

const render = () => {};
const view = (id, extra = {}) => ({ id, label: id[0].toUpperCase() + id.slice(1), render, ...extra });

function throwsMessage(fn) {
  try {
    fn();
  } catch (err) {
    return err.message;
  }
  return '';
}

// ---------- view registry ----------

test('the registry keeps views in registration order and finds them by id and key', () => {
  const views = createViewRegistry();
  views.register(view('kanban', { key: 'k', icon: 'fa-table-columns', css: 'css/kanban.css' }));
  views.register(view('invoices', { key: 'i' }));
  assertDeepEqual(views.list().map(v => v.id), ['kanban', 'invoices']);
  assert(views.has('kanban') && !views.has('nope'));
  assertEqual(views.get('invoices').label, 'Invoices');
  assertEqual(views.get('nope'), null);
  assertEqual(views.byKey('k').id, 'kanban');
  assertEqual(views.byKey('z'), null);
});

test('the registry refuses duplicate and built-in ids', () => {
  const views = createViewRegistry();
  views.register(view('kanban'));
  assert(/already exists/.test(throwsMessage(() => views.register(view('kanban')))));
  for (const id of BUILT_IN_VIEWS) assert(/already exists/.test(throwsMessage(() => views.register(view(id)))), id);
  assertEqual(views.list().length, 1);
});

test('validateView checks the id, label, render, bind and shortcut', () => {
  assert(/Bad view id/.test(throwsMessage(() => validateView(view('Bad Id')))));
  assert(/needs a label/.test(throwsMessage(() => validateView({ id: 'x', label: ' ', render }))));
  assert(/render/.test(throwsMessage(() => validateView({ id: 'x', label: 'X' }))));
  assert(/bind/.test(throwsMessage(() => validateView(view('x', { bind: 'yes' })))));
  assert(/one letter/.test(throwsMessage(() => validateView(view('x', { key: 'ab' })))));
  assert(/already used/.test(throwsMessage(() => validateView(view('x', { key: 'h' })))), 'built-in shortcut');
  const taken = new Map([['kanban', view('kanban', { key: 'k' })]]);
  assert(/already used/.test(throwsMessage(() => validateView(view('x', { key: 'k' }), taken))));
  assertEqual(throwsMessage(() => validateView(view('client-view', { key: 'p' }), taken)), '');
});

// ---------- hooks ----------

test('hooks call every listener with the payload, in order, until they stop listening', () => {
  const hooks = createHooks();
  const calls = [];
  const stop = hooks.on('status-change', p => calls.push(['a', p.status]));
  hooks.on('status-change', p => calls.push(['b', p.status]));
  hooks.emit('status-change', { clientName: 'Acme', status: 'active' });
  stop();
  hooks.emit('status-change', { clientName: 'Acme', status: 'inactive' });
  hooks.emit('nobody-listens', {});
  assertDeepEqual(calls, [['a', 'active'], ['b', 'active'], ['b', 'inactive']]);
});

test('a listener that throws does not stop the others', () => {
  const hooks = createHooks();
  const calls = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    hooks.on('auth', () => { throw new Error('boom'); });
    hooks.on('auth', ({ user }) => calls.push(user));
    hooks.emit('auth', { user: 'u1' });
  } finally {
    console.error = quiet;
  }
  assertDeepEqual(calls, ['u1']);
});
