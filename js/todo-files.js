// Files and images attached to to-dos. Signed in: Firestore, like chat files
// (no Firebase Storage on the free plan): users/{uid}/todoFiles/{id} holds the
// name and type, chunks/{n} the bytes as base64 pieces, so they follow you to
// any device. Local mode: this browser's IndexedDB. Photos are shrunk first.
// The to-do itself keeps only {id, name, type, size} (js/todos.js).

import { validateAttachment, splitChunks } from './chat.js';
import { shrinkImage, toBase64 } from './chat-files.js';
import { addWrites } from './chat-quota.js';
import { newRecordId } from './store.js';

export const TODO_FILE_DB = 'cladflo-todo-files';
const TODO_FILE_STORE = 'files';

const todoFilesRef = (db, uid) => db.collection('users').doc(uid).collection('todoFiles');

// id → Promise<blob: URL>, so a file is read once per visit.
const todoFileUrls = new Map();

// ---------- this browser (local mode) ----------

let todoIdb = null;

function openTodoIdb() {
  const idb = globalThis.indexedDB;
  if (!idb) return Promise.reject(new Error('This browser cannot keep files (no IndexedDB).'));
  if (!todoIdb) {
    todoIdb = new Promise((resolve, reject) => {
      const request = idb.open(TODO_FILE_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(TODO_FILE_STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    todoIdb.catch(() => { todoIdb = null; });
  }
  return todoIdb;
}

async function idbRun(mode, action) {
  const db = await openTodoIdb();
  return new Promise((resolve, reject) => {
    const request = action(db.transaction(TODO_FILE_STORE, mode).objectStore(TODO_FILE_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- the account (signed in) ----------

async function uploadToAccount(db, uid, id, file) {
  const pieces = splitChunks(await toBase64(file));
  const ref = todoFilesRef(db, uid).doc(id);
  addWrites(1 + pieces.length);
  await ref.set({ name: file.name, type: file.type || '', size: file.size, chunks: pieces.length, at: new Date().toISOString() });
  for (let i = 0; i < pieces.length; i++) {
    await ref.collection('chunks').doc(String(i).padStart(4, '0')).set({ data: pieces[i] });
  }
}

async function readFromAccount(db, uid, meta) {
  const snap = await todoFilesRef(db, uid).doc(meta.id).collection('chunks').get();
  const pieces = snap.docs.slice().sort((a, b) => a.id.localeCompare(b.id)).map(doc => doc.data().data || '');
  if (!pieces.length) throw new Error(`"${meta.name}" could not be found.`);
  const binary = atob(pieces.join(''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: meta.type || 'application/octet-stream' });
}

async function removeFromAccount(db, uid, id) {
  const ref = todoFilesRef(db, uid).doc(id);
  const chunks = await ref.collection('chunks').get();
  for (const doc of chunks.docs) await ref.collection('chunks').doc(doc.id).delete();
  await ref.delete();
}

// ---------- what the page uses ----------

/** Where files go: {db, uid} when signed in, null in local mode. */
const accountOf = app => (app.db() && app.user ? { db: app.db(), uid: app.user.uid } : null);

/**
 * Keep `file` for a to-do (photos shrunk first).
 * @returns {Promise<{id, name, type, size}>} what the to-do stores
 * @throws when the file is empty or over 10 MB, or can't be saved
 */
export async function saveTodoFile(app, file) {
  const ready = await shrinkImage(file);
  const problem = validateAttachment(ready);
  if (problem) throw new Error(problem);
  const meta = { id: newRecordId(), name: ready.name, type: ready.type || '', size: ready.size };
  const account = accountOf(app);
  if (account) await uploadToAccount(account.db, account.uid, meta.id, ready);
  else await idbRun('readwrite', store => store.put({ ...meta, blob: ready }));
  todoFileUrls.set(meta.id, Promise.resolve(URL.createObjectURL(ready)));
  return meta;
}

/** The file as a blob: URL to show or download (read once). */
export function todoFileUrl(app, meta) {
  if (!todoFileUrls.has(meta.id)) {
    const account = accountOf(app);
    const loading = (account
      ? readFromAccount(account.db, account.uid, meta)
      : idbRun('readonly', store => store.get(meta.id)).then(record => {
        if (!record) throw new Error(`"${meta.name}" is not in this browser.`);
        return record.blob;
      })
    ).then(blob => URL.createObjectURL(blob));
    loading.catch(() => todoFileUrls.delete(meta.id)); // can be tried again
    todoFileUrls.set(meta.id, loading);
  }
  return todoFileUrls.get(meta.id);
}

/** Remove a file that is no longer attached (best effort: a failure only leaves it stored). */
export async function removeTodoFile(app, meta) {
  const url = todoFileUrls.get(meta.id);
  todoFileUrls.delete(meta.id);
  if (url) url.then(href => URL.revokeObjectURL(href), () => {});
  try {
    const account = accountOf(app);
    if (account) await removeFromAccount(account.db, account.uid, meta.id);
    else await idbRun('readwrite', store => store.delete(meta.id));
  } catch (err) {
    console.error('Could not remove a to-do file:', err);
  }
}
