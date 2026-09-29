// Imported files, kept in this browser's IndexedDB so History can import one
// again. Files never go to the account: re-import works in the browser that
// imported them. Clear all data keeps them, like the History log.

import { recordId } from './records.js';

export const FILE_DB = 'cladflo-files';
export const FILE_STORE = 'files';

/** The newest files kept; older ones are dropped when a new one is saved. */
export const FILE_LIMIT = 20;

/** Bigger files import as usual but aren't kept for re-import. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** What is stored for one file: its bytes plus what History and File need. */
export function fileRecord({ name, type }, data, now = new Date()) {
  return {
    id: recordId('file'),
    name: String(name || 'import.xlsx'),
    type: String(type || ''),
    size: data.byteLength,
    savedAt: now.toISOString(),
    data
  };
}

/** Ids of the files older than the newest `limit`. */
export function staleFileIds(records, limit = FILE_LIMIT) {
  return records
    .slice()
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(limit)
    .map(record => record.id);
}

/** An in-memory backend with the IndexedDB backend's interface (tests, no IndexedDB). */
export function memoryFileBackend() {
  const files = new Map();
  return {
    put: async record => { files.set(record.id, record); },
    get: async id => files.get(id) || null,
    list: async () => [...files.values()],
    remove: async id => { files.delete(id); }
  };
}

const done = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/** The browser's IndexedDB, opened on first use. */
export function idbFileBackend(idb = globalThis.indexedDB) {
  let opened = null;
  const open = () => {
    if (!idb) return Promise.reject(new Error('This browser cannot keep files (no IndexedDB).'));
    if (!opened) {
      const request = idb.open(FILE_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE, { keyPath: 'id' });
      opened = done(request);
    }
    return opened;
  };
  const run = async (mode, action) => {
    const db = await open();
    return done(action(db.transaction(FILE_STORE, mode).objectStore(FILE_STORE)));
  };
  return {
    put: record => run('readwrite', store => store.put(record)),
    get: async id => (await run('readonly', store => store.get(id))) || null,
    list: () => run('readonly', store => store.getAll()),
    remove: id => run('readwrite', store => store.delete(id))
  };
}

/** save(file) → the new file id, or '' when the file is too big to keep; load(id) → the record or null. */
export function createFileStore(backend = idbFileBackend(), { limit = FILE_LIMIT, maxBytes = MAX_FILE_BYTES } = {}) {
  return {
    async save(file, data, now = new Date()) {
      if (data.byteLength > maxBytes) return '';
      const record = fileRecord(file, data, now);
      await backend.put(record);
      for (const id of staleFileIds(await backend.list(), limit)) await backend.remove(id);
      return record.id;
    },
    load: id => (id ? backend.get(id) : Promise.resolve(null))
  };
}
