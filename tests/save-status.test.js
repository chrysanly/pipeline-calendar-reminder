import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import { summarizeSaves, createSaveTracker, SAVE_LABELS } from '../js/save-status.js';

test('summarizeSaves: nothing in flight is saved', () => {
  assertEqual(summarizeSaves([]), 'saved');
});

test('summarizeSaves: the worst state wins (failed, saving, syncing)', () => {
  assertEqual(summarizeSaves(['syncing', 'saving']), 'saving');
  assertEqual(summarizeSaves(['syncing', 'failed', 'saving']), 'failed');
  assertEqual(summarizeSaves(['syncing']), 'syncing');
});

test('every state has a label', () => {
  for (const state of ['saving', 'syncing', 'saved', 'failed']) assert(SAVE_LABELS[state], state);
});

/** A tracker with hand-driven timers; `seen` collects every summary. */
function tracker() {
  const timers = new Map();
  let nextTimer = 0;
  const seen = [];
  const errors = [];
  const saves = createSaveTracker({
    onChange: state => seen.push(state),
    onError: err => errors.push(err.message),
    timeout: 10000,
    setTimer: fn => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimer: id => timers.delete(id)
  });
  const fireTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { saves, seen, errors, timers, fireTimers };
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

later('a local save (no confirmation) goes Saving… then Saved', async () => {
  const { saves, seen, timers } = tracker();
  await saves.track(() => Promise.resolve());
  assertDeepEqual(seen, ['saving', 'saved']);
  assertEqual(timers.size, 0, 'the safety timer is cleared');
});

later('a cloud save shows Syncing… until the server confirms', async () => {
  const { saves, seen } = tracker();
  const server = deferred();
  await saves.track(() => ({ confirmed: server.promise }));
  assertEqual(saves.state(), 'syncing');
  server.resolve();
  await tick();
  assertDeepEqual(seen, ['saving', 'syncing', 'saved']);
});

later('a write that never settles is cleared by the safety timeout', async () => {
  const { saves, fireTimers } = tracker();
  await saves.track(() => ({ confirmed: new Promise(() => {}) }));
  assertEqual(saves.state(), 'syncing');
  fireTimers();
  assertEqual(saves.state(), 'saved');
  assertEqual(saves.size, 0);
});

later('each save is tracked on its own: a stuck one does not block a quick one', async () => {
  const { saves, fireTimers } = tracker();
  await saves.track(() => ({ confirmed: new Promise(() => {}) }));
  await saves.track(() => ({ confirmed: Promise.resolve() }));
  await tick();
  assertEqual(saves.size, 1, 'only the stuck save is left');
  fireTimers();
  assertEqual(saves.size, 0);
});

later('a refused write shows Not saved, reports once and retries', async () => {
  const { saves, errors } = tracker();
  let calls = 0;
  let refuse = true;
  const run = () => {
    calls++;
    return { confirmed: refuse ? Promise.reject(new Error('denied')) : Promise.resolve() };
  };
  await saves.track(run);
  await tick();
  assertEqual(saves.state(), 'failed');
  assertDeepEqual(errors, ['denied']);
  refuse = false;
  saves.retry();
  await tick();
  await tick();
  assertEqual(calls, 2);
  assertEqual(saves.state(), 'saved');
});

later('a local failure rejects to the caller and is not reported twice', async () => {
  const { saves, errors } = tracker();
  let caught = null;
  await saves.track(() => Promise.reject(new Error('quota'))).catch(err => { caught = err.message; });
  assertEqual(caught, 'quota');
  assertEqual(saves.state(), 'failed');
  assertDeepEqual(errors, []);
});

later('the timeout does not hide a failure', async () => {
  const { saves, fireTimers } = tracker();
  await saves.track(() => Promise.reject(new Error('x'))).catch(() => {});
  fireTimers();
  assertEqual(saves.state(), 'failed');
});

export const saveStatusTestsDone = Promise.all(pending);
