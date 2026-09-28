// Firestore storage: one document per record at users/{uid}/{collection}/{id}
// (reminders in `events`, plus `meetings` and `history`).
// The SDK (Firebase compat, global `firebase`) and the db are passed in, so the
// pure parts are unit-tested and the browser specs can swap in a fake.

import { normalizeEvent } from './storage.js';

/** localStorage flag: this browser's local reminders were already moved up. */
export const MIGRATED_KEY = 'client-calendar.migrated.v1';

// Firestore allows 500 writes per batch; stay under it.
const BATCH_LIMIT = 450;

/** True once FIREBASE_CONFIG has been filled in with a real project. */
export function isConfigured(config) {
  return Boolean(
    config && config.apiKey && config.projectId &&
    !/^YOUR_/.test(config.apiKey) && !/^YOUR_/.test(config.projectId)
  );
}

/** 'cloud' only with a config, a loaded SDK and no ?backend=local override. */
export function selectBackend({ config, sdk, forceLocal = false }) {
  if (forceLocal || !sdk || !isConfigured(config)) return 'local';
  return 'cloud';
}

// Key order must not matter when comparing a record with its stored copy, at
// any depth (minutes hold arrays of objects).
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
};
const stableJson = record => JSON.stringify(canonical(record));

/**
 * What must be written to turn `prev` into `next`.
 * @returns {{upserts: object[], deletes: string[]}}
 */
export function diffEvents(prev, next) {
  const before = new Map(prev.map(evt => [evt.id, stableJson(evt)]));
  const kept = new Set(next.map(evt => evt.id));
  return {
    upserts: next.filter(evt => before.get(evt.id) !== stableJson(evt)),
    deletes: prev.filter(evt => !kept.has(evt.id)).map(evt => evt.id)
  };
}

/**
 * Reminders to upload on first sign-in: this browser's local ones, but only
 * if the cloud is still empty and this has not run before.
 */
export function planMigration(localEvents, cloudEvents, alreadyMigrated) {
  if (alreadyMigrated || cloudEvents.length || !localEvents.length) return [];
  return localEvents.slice();
}

/**
 * Any list of records with ids, one document each at users/{uid}/{name}/{id}.
 * `normalize` turns a stored document back into a record.
 */
export function collectionBackend(db, uid, name, normalize = data => data) {
  const docs = db.collection('users').doc(uid).collection(name);
  const fromDoc = doc => normalize({ ...doc.data(), id: doc.id });

  return {
    kind: 'cloud',
    name,

    /** Live list: fires now, and again on every change from any device. */
    subscribe(onChange, onError) {
      return docs.onSnapshot(snap => onChange(snap.docs.map(fromDoc)), onError);
    },

    /** The server's copy, bypassing the offline cache (used for migration). */
    async fetchServer() {
      const snap = await docs.get({ source: 'server' });
      return snap.docs.map(fromDoc);
    },

    /** Write only what changed between the two lists. */
    async write(prev, next) {
      const { upserts, deletes } = diffEvents(prev, next);
      const ops = [
        ...upserts.map(({ id, ...data }) => batch => batch.set(docs.doc(id), data)),
        ...deletes.map(id => batch => batch.delete(docs.doc(id)))
      ];
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
        await batch.commit();
      }
      return { upserts: upserts.length, deletes: deletes.length };
    }
  };
}

/** Reminders at users/{uid}/events/{id}. */
export function cloudBackend(db, uid) {
  return collectionBackend(db, uid, 'events', normalizeEvent);
}

/** Initialise the compat SDK once; returns auth, db and sign-in helpers. */
export function connectFirebase(firebaseSdk, config) {
  if (!firebaseSdk.apps || !firebaseSdk.apps.length) firebaseSdk.initializeApp(config);
  const auth = firebaseSdk.auth();
  const db = firebaseSdk.firestore();
  // Offline cache shared across tabs; unsupported browsers just stay online-only.
  db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

  return {
    auth,
    db,
    async signIn() {
      const provider = new firebaseSdk.auth.GoogleAuthProvider();
      try {
        await auth.signInWithPopup(provider);
      } catch (err) {
        const code = err && err.code;
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        // Phones and strict browsers block popups; a full-page redirect still works.
        if (code === 'auth/popup-blocked') return auth.signInWithRedirect(provider);
        throw err;
      }
    },
    signOut: () => auth.signOut()
  };
}
