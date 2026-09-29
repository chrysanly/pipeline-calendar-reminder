// Generic per-user collections for the feature modules (clients, tasks,
// invoices, …): pure list helpers and a store that keeps every list in memory
// and saves each change through a backend: this browser (same keys as
// records.js) or Firestore at users/{uid}/<name>/{id} (cloud.js).
// Meeting minutes and History stay in record-store.js.

import { collectionBackend } from './cloud.js';
import { recordKey } from './records.js';

/** Every feature collection besides reminders, minutes and History. */
export const COLLECTIONS = [
  'clients', 'tasks', 'time', 'expenses', 'invoices', 'proposals', 'templates', 'settings'
];

/** Random id; crypto when the browser has it. */
export function newRecordId() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Firestore rejects undefined values, so they never reach a record.
function defined(data) {
  return Object.fromEntries(Object.entries(data || {}).filter(([, value]) => value !== undefined));
}

/** A new record: the data plus id, createdAt and updatedAt (ISO strings). */
export function makeRecord(data, now = new Date()) {
  const stamp = now.toISOString();
  const record = { createdAt: stamp, ...defined(data), updatedAt: stamp };
  if (!record.id) record.id = newRecordId();
  return record;
}

export function findRecord(list, id) {
  return list.find(record => record.id === id) || null;
}

/** Replace the record with the same id, or append it. */
export function upsertRecord(list, record) {
  const index = list.findIndex(item => item.id === record.id);
  if (index === -1) return [...list, record];
  return list.map((item, i) => (i === index ? record : item));
}

/** Merge `patch` into one record; the id never changes. Unknown id: unchanged. */
export function patchRecord(list, id, patch, now = new Date()) {
  if (!findRecord(list, id)) return list;
  return list.map(record => (record.id === id
    ? { ...record, ...defined(patch), id, updatedAt: now.toISOString() }
    : record));
}

export function removeRecord(list, id) {
  return list.filter(record => record.id !== id);
}

/** Local mode: one collection in localStorage, same interface as the cloud one. */
export function localListBackend(name, store = typeof localStorage !== 'undefined' ? localStorage : null) {
  const key = recordKey(name);
  return {
    kind: 'local',
    key,
    load() {
      if (!store) return [];
      try {
        const parsed = JSON.parse(store.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed.filter(r => r && typeof r === 'object' && r.id) : [];
      } catch (err) {
        return []; // corrupt payload: start clean rather than break the app
      }
    },
    async write(prev, next) {
      if (store) store.setItem(key, JSON.stringify(next));
    }
  };
}

/** Where a collection lives: Firestore when signed in (db and uid), else this browser. */
export function listBackend(name, { db = null, uid = null, store } = {}) {
  return db && uid ? collectionBackend(db, uid, name) : localListBackend(name, store);
}

/**
 * In-memory lists for every collection. attach() connects a backend per
 * collection (load and/or live subscribe); every change shows at once through
 * onChange(name) and is then written, errors going to onError.
 */
export function createStore({
  names = COLLECTIONS, onChange = () => {}, onError = () => {}, now = () => new Date(), track = run => run()
} = {}) {
  const lists = Object.fromEntries(names.map(name => [name, []]));
  let backends = {};
  let unsubscribers = [];
  let generation = 0;

  function listOf(name) {
    if (!(name in lists)) throw new Error(`Unknown collection "${name}"`);
    return lists[name];
  }

  function commit(name, next) {
    const prev = listOf(name);
    lists[name] = next;
    onChange(name);
    const backend = backends[name];
    if (!backend) return Promise.resolve();
    // A retry (from `track`) writes the list as it is by then.
    let tries = 0;
    const run = () => (backends[name] === backend ? backend.write(prev, tries++ ? lists[name] : next) : null);
    return Promise.resolve()
      .then(() => track(run))
      .catch(err => onError(err));
  }

  function detach() {
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers = [];
    backends = {};
    generation += 1;
    for (const name of names) lists[name] = [];
    onChange(null);
  }

  return {
    names,
    all: name => listOf(name),
    get: (name, id) => findRecord(listOf(name), id),

    add(name, data) {
      const record = makeRecord(data, now());
      return commit(name, [...listOf(name), record]).then(() => record);
    },

    /** Create or replace a record with a known id (e.g. settings/app). */
    put(name, record) {
      const existing = findRecord(listOf(name), record.id);
      const stamped = existing
        ? { ...defined(record), createdAt: existing.createdAt, updatedAt: now().toISOString() }
        : makeRecord(record, now());
      return commit(name, upsertRecord(listOf(name), stamped)).then(() => stamped);
    },

    update(name, id, patch) {
      return commit(name, patchRecord(listOf(name), id, patch, now())).then(() => findRecord(lists[name], id));
    },

    remove(name, id) {
      return commit(name, removeRecord(listOf(name), id));
    },

    /** Connect a backend per collection; factory(name) → { load?, subscribe?, write }. */
    attach(factory) {
      detach();
      const current = generation;
      for (const name of names) {
        const backend = factory(name);
        backends[name] = backend;
        if (backend.load) lists[name] = backend.load();
        if (backend.subscribe) {
          unsubscribers.push(backend.subscribe(list => {
            if (current !== generation) return; // a late snapshot from the previous account
            lists[name] = list;
            onChange(name);
          }, onError));
        }
      }
      onChange(null);
    },

    detach,

    /** Local mode: another tab saved this localStorage key (null: any of them). */
    reloadKey(key) {
      for (const name of names) {
        const backend = backends[name];
        if (!backend || backend.kind !== 'local' || !backend.load) continue;
        if (key !== null && key !== backend.key) continue;
        lists[name] = backend.load();
        onChange(name);
      }
    }
  };
}

// ---------- settings (one record: settings/app) ----------

export const SETTINGS_ID = 'app';

export const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'PHP', 'INR'];

export const DEFAULT_SETTINGS = {
  currency: 'AED',
  stripeLink: '',
  paypalLink: '',
  gcashNumber: '',
  gcashQr: '',
  workerUrl: ''
};

const trimmed = value => (value === null || value === undefined ? '' : String(value).trim());

/**
 * The effective settings: the saved record over `fallback` (e.g. the Worker
 * URL from .env) over the defaults. Blank saved values fall through.
 */
export function readSettings(list, fallback = {}) {
  const saved = findRecord(list, SETTINGS_ID) || {};
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    out[key] = trimmed(saved[key]) || trimmed(fallback[key]) || DEFAULT_SETTINGS[key];
  }
  return out;
}

/** https URL (http only for localhost), without a trailing slash; '' if invalid. */
function cleanUrl(value, { allowLocalhost = false } = {}) {
  const raw = trimmed(value);
  if (!raw) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch (err) {
    return null;
  }
  const local = allowLocalhost && url.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.protocol !== 'https:' && !local) return null;
  if (!url.hostname.includes('.') && !local) return null;
  return url.href.replace(/\/$/, '');
}

/** Philippine mobile number for GCash: 09XXXXXXXXX or +639XXXXXXXXX. */
function cleanGcash(value) {
  const raw = trimmed(value).replace(/[\s()-]/g, '');
  if (!raw) return '';
  return /^(?:\+63|0)9\d{9}$/.test(raw) ? raw : null;
}

/**
 * Check and tidy the Settings form.
 * @returns {{settings: object, errors: Object<string, string>}}
 */
export function validateSettings(input) {
  const errors = {};
  const settings = {};
  const currency = trimmed(input.currency).toUpperCase();
  if (CURRENCIES.includes(currency)) settings.currency = currency;
  else errors.currency = 'Pick a currency from the list.';

  const urls = {
    stripeLink: 'Enter the https:// Stripe Payment Link.',
    paypalLink: 'Enter a link like https://paypal.me/yourname.',
    gcashQr: 'Enter the https:// link of your GCash QR image.',
    workerUrl: 'Enter the https:// address of your Worker.'
  };
  for (const [key, message] of Object.entries(urls)) {
    const url = cleanUrl(input[key], { allowLocalhost: key === 'workerUrl' });
    if (url === null) errors[key] = message;
    else settings[key] = url;
  }

  const gcash = cleanGcash(input.gcashNumber);
  if (gcash === null) errors.gcashNumber = 'Use a PH mobile number: 09XX XXX XXXX or +63 9XX XXX XXXX.';
  else settings.gcashNumber = gcash;

  return { settings, errors };
}
