// Every save in flight, each tracked on its own, summed up for the top bar's
// "Saving… / Syncing… / Saved / Not saved" indicator. No DOM: topbar-ui.js
// draws the summary.

/** Stop waiting for the server after this long; the change is on the device. */
export const SAVE_TIMEOUT_MS = 10000;

export const SAVE_LABELS = {
  saving: 'Saving…',
  syncing: 'Syncing…',
  saved: 'Saved',
  failed: 'Not saved'
};

/** The worst state wins: failed, then saving, then syncing; nothing left is saved. */
export function summarizeSaves(states) {
  const list = [...states];
  for (const state of ['failed', 'saving', 'syncing']) {
    if (list.includes(state)) return state;
  }
  return 'saved';
}

/**
 * track(run) runs one save. `run` returns a promise for the local write; its
 * result may carry `confirmed`, a promise for the server's answer (cloud).
 * The returned promise rejects when the local write fails (the caller reports
 * it); onError(err) reports a refusal from the server. onChange(state) fires
 * on every change. A failed save keeps its `run` so retry() can try it again.
 */
export function createSaveTracker({
  onChange = () => {},
  onError = () => {},
  timeout = SAVE_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const saves = new Map(); // id -> { state, run, timer }
  let nextId = 0;

  const state = () => summarizeSaves([...saves.values()].map(s => s.state));
  const changed = () => onChange(state());

  function finish(id) {
    const save = saves.get(id);
    if (!save) return;
    clearTimer(save.timer);
    saves.delete(id);
    changed();
  }

  function fail(id, run) {
    const save = saves.get(id);
    if (save) clearTimer(save.timer);
    saves.set(id, { state: 'failed', run, timer: null });
    changed();
  }

  function set(id, next) {
    const save = saves.get(id);
    if (!save || save.state === 'failed') return;
    save.state = next;
    changed();
  }

  function track(run) {
    const id = ++nextId;
    // Safety net: a write that never settles still clears the indicator.
    saves.set(id, { state: 'saving', run, timer: setTimer(() => finish(id), timeout) });
    changed();
    return Promise.resolve()
      .then(run)
      .then(result => {
        const confirmed = result && result.confirmed;
        if (!confirmed) {
          finish(id);
          return result;
        }
        set(id, 'syncing');
        confirmed.then(() => finish(id), err => {
          fail(id, run);
          onError(err);
        });
        return result;
      }, err => {
        fail(id, run);
        throw err; // the caller reports a local failure
      });
  }

  /** Run every failed save again. */
  function retry() {
    const failed = [...saves].filter(([, s]) => s.state === 'failed');
    for (const [id, save] of failed) {
      saves.delete(id);
      track(save.run).catch(() => {}); // a new failure is reported by track
    }
    if (!failed.length) changed();
  }

  return { track, retry, state, get size() { return saves.size; } };
}
