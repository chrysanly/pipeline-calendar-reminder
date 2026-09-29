// Registry of the pages feature modules add (Kanban, Invoices, …) next to the
// built-in ones. Pure: ui.js mounts each view's nav button and section, app.js
// renders the current one.

/** Page ids the app already uses, and the keyboard shortcuts it already has. */
export const BUILT_IN_VIEWS = ['dashboard', 'calendar', 'day', 'week', 'month', 'minutes', 'history', 'settings'];
export const RESERVED_KEYS = ['h', 'b', 'c', 'd', 'w', 'm', 'n', 'l', 't'];

const VIEW_ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * view: { id, label, icon?, key?, css?, nav?: false, render(app, section), bind?(app, section) }
 * icon is a Font Awesome name ('fa-table-columns'); css a stylesheet path
 * ('css/kanban.css'); key a one-letter shortcut.
 */
export function validateView(view, taken = new Map()) {
  if (!view || typeof view !== 'object') throw new Error('A view must be an object.');
  const { id, label, key } = view;
  if (typeof id !== 'string' || !VIEW_ID_RE.test(id)) throw new Error(`Bad view id "${id}": use lower-case letters, digits and dashes.`);
  if (BUILT_IN_VIEWS.includes(id) || taken.has(id)) throw new Error(`The view "${id}" already exists.`);
  if (typeof label !== 'string' || !label.trim()) throw new Error(`The view "${id}" needs a label.`);
  if (typeof view.render !== 'function') throw new Error(`The view "${id}" needs a render(app, section) function.`);
  if (view.bind !== undefined && typeof view.bind !== 'function') throw new Error(`The view "${id}" has a bind that is not a function.`);
  if (key !== undefined) {
    if (typeof key !== 'string' || !/^[a-z]$/.test(key)) throw new Error(`The view "${id}" shortcut must be one letter a–z.`);
    const clash = RESERVED_KEYS.includes(key) || [...taken.values()].some(v => v.key === key);
    if (clash) throw new Error(`The shortcut "${key}" of view "${id}" is already used.`);
  }
  return view;
}

export function createViewRegistry() {
  const views = new Map();
  return {
    /** Add a view; throws on a bad or duplicate one. */
    register(view) {
      views.set(view && view.id, validateView(view, views));
      return view;
    },
    has: id => views.has(id),
    get: id => views.get(id) || null,
    /** In the order they were registered (the nav order). */
    list: () => [...views.values()],
    byKey: key => [...views.values()].find(view => view.key === key) || null
  };
}
