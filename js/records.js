// Storage for lists of records other than reminders (meeting minutes, the
// history log). The same interface in both modes: this browser's localStorage
// under client-calendar.<name>.v1, or Firestore at users/{uid}/<name>/{id}.

import { collectionBackend } from './cloud.js';

/** The record lists the app keeps next to the reminders. */
export const RECORD_KINDS = ['meetings', 'history'];

const localStore = typeof localStorage !== 'undefined' ? localStorage : null;

export const recordKey = name => `client-calendar.${name}.v1`;

export function recordId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The saved list, or [] when there is none or it is unreadable. */
export function loadRecords(name, store = localStore) {
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(recordKey(name)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(r => r && typeof r === 'object' && r.id) : [];
  } catch (err) {
    return [];
  }
}

export function localRecordBackend(name, store = localStore, normalize = data => data) {
  const load = () => loadRecords(name, store).map(normalize);
  return {
    kind: 'local',
    name,
    key: recordKey(name),
    load,
    /** Fires now with the saved list; another tab's saves arrive via app.js. */
    subscribe(onChange) {
      onChange(load());
      return () => {};
    },
    write(prev, next) {
      try {
        if (store) store.setItem(recordKey(name), JSON.stringify(next));
        return Promise.resolve();
      } catch (err) {
        return Promise.reject(err);
      }
    }
  };
}

/**
 * Where a record list lives: Firestore when signed in (db and uid given),
 * otherwise this browser.
 */
export function recordBackend(name, { db = null, uid = null, store = localStore, normalize } = {}) {
  if (!RECORD_KINDS.includes(name)) throw new Error(`Unknown record list "${name}".`);
  return db && uid ? collectionBackend(db, uid, name, normalize) : localRecordBackend(name, store, normalize);
}
