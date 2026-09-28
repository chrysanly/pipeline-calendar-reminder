// Tiny event bus: the hook points feature modules attach to without app.js
// knowing about them. Events: 'events-change' {prev, next},
// 'status-change' {clientName, status, previous}, 'auth' {user}.

export function createHooks() {
  const handlers = new Map();
  return {
    /** Listen; returns a function that stops listening. */
    on(name, fn) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(fn);
      return () => handlers.get(name).delete(fn);
    },
    /** Call every listener; one that throws does not stop the others. */
    emit(name, payload) {
      for (const fn of handlers.get(name) || []) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`hook "${name}" failed`, err);
        }
      }
    }
  };
}
