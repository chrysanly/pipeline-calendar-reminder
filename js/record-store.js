// The meetings and history lists while the app runs: loaded from and saved to
// the right backend (this browser, or the signed-in account), newest first.

import { RECORD_KINDS, recordBackend, recordKey } from './records.js';
import { normalizeEntry, sortHistory, addHistory, logEntry } from './history.js';
import { normalizeMeeting } from './minutes.js';

const NORMALIZERS = { meetings: normalizeMeeting, history: normalizeEntry };

const newestMeetingFirst = list => list.slice().sort((a, b) =>
  (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
const SORTERS = { meetings: newestMeetingFirst, history: sortHistory };

/**
 * onChange(name, list) after every change; onError(title, message) when a
 * load or save fails.
 */
export function createRecordStore({ onChange, onError }) {
  const lists = Object.fromEntries(RECORD_KINDS.map(name => [name, []]));
  let backends = {};
  let unsubscribes = [];

  const set = (name, list) => {
    lists[name] = SORTERS[name](list);
    onChange(name, lists[name]);
  };
  const message = err => (err && err.message ? err.message : String(err));

  function disconnect() {
    for (const unsubscribe of unsubscribes) unsubscribe();
    unsubscribes = [];
    backends = {};
    for (const name of RECORD_KINDS) set(name, []);
  }

  return {
    get: name => lists[name],

    /** Local mode with no arguments; cloud mode with the signed-in db and uid. */
    connect({ db = null, uid = null, store } = {}) {
      disconnect();
      for (const name of RECORD_KINDS) {
        const backend = recordBackend(name, { db, uid, store, normalize: NORMALIZERS[name] });
        backends[name] = backend;
        unsubscribes.push(backend.subscribe(
          list => { if (backends[name] === backend) set(name, list); },
          err => onError(`Could not load your ${name}`, message(err))
        ));
      }
    },

    disconnect,

    /** Show the change at once, then save only what changed. */
    commit(name, next) {
      const prev = lists[name];
      set(name, next.map(NORMALIZERS[name]));
      const backend = backends[name];
      if (!backend) return Promise.resolve();
      return backend.write(prev, lists[name]).catch(err => onError('Could not save your change', message(err)));
    },

    /** Add one History entry: {action, kind, title, client, detail}. */
    log(entry) {
      return this.commit('history', addHistory(lists.history, [logEntry(entry)]));
    },

    /** Local mode: another tab saved this key, so reload that list. */
    reloadKey(key) {
      for (const name of RECORD_KINDS) {
        const backend = backends[name];
        if (backend && backend.kind === 'local' && (key === null || key === recordKey(name))) set(name, backend.load());
      }
    }
  };
}
