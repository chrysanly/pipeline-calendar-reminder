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

    /**
     * Write only what changed between the two lists. Resolves as soon as
     * Firestore has the change on this device (commit() applies it locally at
     * once); `confirmed` settles when the server accepts or refuses it, which
     * on a slow or offline connection can take minutes.
     */
    async write(prev, next) {
      const { upserts, deletes } = diffEvents(prev, next);
      const ops = [
        ...upserts.map(({ id, ...data }) => batch => batch.set(docs.doc(id), data)),
        ...deletes.map(id => batch => batch.delete(docs.doc(id)))
      ];
      const commits = [];
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + BATCH_LIMIT)) op(batch);
        commits.push(batch.commit());
      }
      const confirmed = Promise.all(commits).then(() => {});
      confirmed.catch(() => {}); // reported by whoever watches `confirmed`
      return { upserts: upserts.length, deletes: deletes.length, confirmed };
    }
  };
}

/** Reminders at users/{uid}/events/{id}. */
export function cloudBackend(db, uid) {
  return collectionBackend(db, uid, 'events', normalizeEvent);
}

// ---------- client portal (portals/{token}, see firestore.rules) ----------

/** Top-level collection of shared client pages; the token is the only key. */
export const PORTALS = 'portals';

/** Unguessable portal token: 32 hex characters from crypto. */
export function newPortalToken(cryptoApi = globalThis.crypto) {
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('This browser cannot make a secure share link.');
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export const isPortalToken = token => typeof token === 'string' && /^[0-9a-f]{32}$/.test(token);

/**
 * One owner's shared pages: publish (create or replace) and unpublish, plus
 * the public read the portal page uses. Only the owner may write (rules).
 */
export function portalBackend(db, uid) {
  const ref = token => {
    if (!isPortalToken(token)) throw new Error('Invalid portal link.');
    return db.collection(PORTALS).doc(token);
  };
  return {
    async publish(token, data, now = new Date()) {
      const doc = { ...data, ownerUid: uid, updatedAt: now.toISOString() };
      await ref(token).set(doc);
      return doc;
    },
    unpublish: token => ref(token).delete(),
    /** The shared page, or null when the link was removed. */
    async read(token) {
      const snap = await ref(token).get();
      return snap.exists ? { ...snap.data(), token } : null;
    }
  };
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
