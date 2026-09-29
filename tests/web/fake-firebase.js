// In-memory stand-in for the Firebase compat SDK (app + auth + firestore),
// injected by cloud.spec.mjs with page.addInitScript. Only the calls the app
// makes are implemented. Test controls live on window.__fake.
(() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const parentOf = path => path.slice(0, path.lastIndexOf('/'));

  const docs = new Map(); // 'users/u/events/id' -> data
  const log = []; // every write: { op, path, data, origin }
  const listeners = new Set(); // { colPath, next }
  const authListeners = new Set();
  let currentUser = null;

  // query: { field, dir, limit } from orderBy(...).limit(...) (the chat).
  function snapshotOf(colPath, query = {}) {
    const prefix = `${colPath}/`;
    let entries = [...docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'));
    if (query.field) {
      const sign = query.dir === 'desc' ? -1 : 1;
      entries.sort(([, a], [, b]) => sign * String(a[query.field]).localeCompare(String(b[query.field])));
    }
    if (query.limit) entries = entries.slice(0, query.limit);
    const list = entries.map(([path, data]) => ({ id: path.slice(prefix.length), data: () => clone(data) }));
    return { docs: list, size: list.length, empty: !list.length, metadata: { fromCache: false, hasPendingWrites: false } };
  }

  function apply(ops, origin) {
    const touched = new Set();
    for (const [op, path, data] of ops) {
      if (op === 'set') docs.set(path, clone(data));
      else docs.delete(path);
      touched.add(parentOf(path));
      log.push({ op, path, data: data ? clone(data) : undefined, origin });
    }
    for (const l of listeners) if (touched.has(l.colPath)) l.next(snapshotOf(l.colPath, l.query));
  }

  function docRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      collection: name => collectionRef(`${path}/${name}`),
      // Single-document calls (the client portal, portals/{token}).
      async set(data) {
        // window.__fakeHold.denyWrites: the rules refuse (not on the chat list).
        if ((window.__fakeHold || {}).denyWrites) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        apply([['set', path, data]], 'app');
      },
      async delete() { apply([['delete', path]], 'app'); },
      async get() {
        const data = docs.get(path);
        return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)) };
      }
    };
  }

  function collectionRef(path, query = {}) {
    return {
      path,
      doc: id => docRef(`${path}/${id}`),
      orderBy: (field, dir = 'asc') => collectionRef(path, { ...query, field, dir }),
      limit: n => collectionRef(path, { ...query, limit: n }),
      onSnapshot(next, error) {
        // window.__fakeHold.denyChatReads: the rules refuse the chat (not on the list, or not deployed).
        if ((window.__fakeHold || {}).denyChatReads && path.startsWith('chat/')) {
          setTimeout(() => error && error(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })), 0);
          return () => {};
        }
        const l = { colPath: path, next, query };
        listeners.add(l);
        // window.__fakeHold.snapshot: the first snapshot never arrives (slow network).
        if (!(window.__fakeHold || {}).snapshot) setTimeout(() => { if (listeners.has(l)) next(snapshotOf(path, query)); }, 0);
        return () => listeners.delete(l);
      },
      get: async () => snapshotOf(path, query)
    };
  }

  const db = {
    collection: name => collectionRef(name),
    batch() {
      const ops = [];
      return {
        set(ref, data) { ops.push(['set', ref.path, data]); },
        delete(ref) { ops.push(['delete', ref.path]); },
        // Applied on the device at once, like Firestore; the promise is the server's answer.
        commit() {
          apply(ops, 'app');
          const hold = window.__fakeHold || {};
          // window.__fakeHold.serverAck: the server never answers (the write stays pending).
          if (hold.serverAck) return new Promise(() => {});
          // window.__fakeHold.denyBatch: the server refuses the write (rules, quota).
          if (hold.denyBatch) return Promise.reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
          return Promise.resolve();
        }
      };
    },
    enablePersistence: () => Promise.resolve()
  };

  function setUser(user) {
    currentUser = user;
    for (const cb of authListeners) cb(user);
  }

  const TEST_USER = { uid: 'user-1', displayName: 'Test User', email: 'test@example.com' };

  const auth = {
    get currentUser() { return currentUser; },
    onAuthStateChanged(cb) {
      authListeners.add(cb);
      // window.__fakeHold.auth: auth never answers (Firebase unreachable).
      if (!(window.__fakeHold || {}).auth) setTimeout(() => cb(currentUser), 0);
      return () => authListeners.delete(cb);
    },
    async signInWithPopup() { setUser(TEST_USER); return { user: TEST_USER }; },
    async signInWithRedirect() { setUser(TEST_USER); },
    async signOut() { setUser(null); }
  };

  function GoogleAuthProvider() {}

  const firebase = {
    apps: [],
    initializeApp(config) {
      window.__fake.config = config;
      firebase.apps.push({ config });
      return firebase.apps[0];
    },
    app: () => firebase.apps[0],
    auth: Object.assign(() => auth, { GoogleAuthProvider }),
    firestore: () => db
  };

  window.firebase = firebase;
  window.__fake = {
    config: null,
    log,
    setUser,
    /** Seed or change a doc as if from another device. */
    remoteSet: (path, data) => apply([['set', path, data]], 'remote'),
    remoteDelete: path => apply([['delete', path]], 'remote'),
    /** Seed without notifying (before the app subscribes). */
    seed: (path, data) => docs.set(path, clone(data)),
    dump: () => Object.fromEntries([...docs.entries()].map(([p, d]) => [p, clone(d)])),
    appWrites: () => log.filter(w => w.origin === 'app')
  };
})();
