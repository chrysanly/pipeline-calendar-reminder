import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  WRITES_PER_DAY, READS_PER_DAY, QUOTA_KEY, quotaDayKey, nextResetAt, untilText, localTime, formatReset,
  loadUsage, saveUsage, addReads, addWrites, markExhausted, isExhausted, quotaSummary
} from '../js/chat-quota.js';

const at = iso => new Date(iso);

/** An in-memory localStorage. */
function fakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    data
  };
}

test('quota: the free-plan daily limits', () => {
  assertEqual(WRITES_PER_DAY, 20000);
  assertEqual(READS_PER_DAY, 50000);
});

test('quotaDayKey is the Pacific date, switching at Pacific midnight', () => {
  assertEqual(quotaDayKey(at('2026-09-30T06:22:00Z')), '2026-09-29', '23:22 PDT is still the 29th');
  assertEqual(quotaDayKey(at('2026-09-30T06:59:59Z')), '2026-09-29');
  assertEqual(quotaDayKey(at('2026-09-30T07:00:00Z')), '2026-09-30', 'midnight PDT');
  assertEqual(quotaDayKey(at('2026-12-15T07:59:59Z')), '2026-12-14', 'winter: PST is UTC-8');
  assertEqual(quotaDayKey(at('2026-12-15T08:00:00Z')), '2026-12-15');
});

test('nextResetAt is the next Pacific midnight, in summer and winter', () => {
  assertEqual(nextResetAt(at('2026-09-30T06:22:00Z')).toISOString(), '2026-09-30T07:00:00.000Z');
  assertEqual(nextResetAt(at('2026-09-30T07:00:00Z')).toISOString(), '2026-10-01T07:00:00.000Z', 'at midnight: the next one');
  assertEqual(nextResetAt(at('2026-12-15T10:00:00Z')).toISOString(), '2026-12-16T08:00:00.000Z');
});

test('nextResetAt across daylight-saving changes', () => {
  // Fall back on Sun 1 Nov 2026 at 02:00 PDT.
  assertEqual(nextResetAt(at('2026-10-31T20:00:00Z')).toISOString(), '2026-11-01T07:00:00.000Z', 'midnight before the change is PDT');
  assertEqual(nextResetAt(at('2026-11-01T12:00:00Z')).toISOString(), '2026-11-02T08:00:00.000Z', 'after the change: PST');
  // Spring forward on Sun 8 Mar 2026 at 02:00 PST.
  assertEqual(nextResetAt(at('2026-03-07T20:00:00Z')).toISOString(), '2026-03-08T08:00:00.000Z', 'midnight before the change is PST');
  assertEqual(nextResetAt(at('2026-03-08T12:00:00Z')).toISOString(), '2026-03-09T07:00:00.000Z', 'after the change: PDT');
});

test('untilText and formatReset read as hours and minutes', () => {
  assertEqual(untilText((4 * 60 + 20) * 60000), '4 h 20 min');
  assertEqual(untilText(20 * 60000), '20 min');
  assertEqual(untilText(3 * 3600000), '3 h');
  assertEqual(untilText(1000), '1 min', 'rounds up');
  assertEqual(untilText(-5000), '1 min', 'never 0 or negative');
  const now = at('2026-09-30T02:40:00Z');
  const reset = nextResetAt(now);
  assertEqual(formatReset(reset, now), `resets at ${localTime(reset)} (in 4 h 20 min)`);
  assert(/^\d\d:\d\d$/.test(localTime(reset)));
});

test('loadUsage: nothing saved, bad JSON or another day start at zero', () => {
  const now = at('2026-09-30T02:00:00Z');
  const fresh = { day: '2026-09-29', reads: 0, writes: 0, exhausted: false };
  assertDeepEqual(loadUsage(fakeStore(), now), fresh);
  assertDeepEqual(loadUsage(fakeStore({ [QUOTA_KEY]: '{oops' }), now), fresh);
  assertDeepEqual(loadUsage(fakeStore({ [QUOTA_KEY]: 'null' }), now), fresh);
  const yesterday = JSON.stringify({ day: '2026-09-28', reads: 900, writes: 50, exhausted: true });
  assertDeepEqual(loadUsage(fakeStore({ [QUOTA_KEY]: yesterday }), now), fresh, 'a new Pacific day starts over');
  assertDeepEqual(loadUsage(null, now), fresh, 'no storage');
});

test('loadUsage cleans saved numbers and the flag', () => {
  const now = at('2026-09-30T02:00:00Z');
  const saved = JSON.stringify({ day: '2026-09-29', reads: -4, writes: '12.7', exhausted: 'yes' });
  assertDeepEqual(loadUsage(fakeStore({ [QUOTA_KEY]: saved }), now), { day: '2026-09-29', reads: 0, writes: 12, exhausted: false });
});

test('addReads and addWrites add up for the day and are saved', () => {
  const store = fakeStore();
  const now = at('2026-09-30T02:00:00Z');
  addReads(100, { store, now });
  addReads(12, { store, now });
  addWrites(1, { store, now });
  const usage = addWrites(3, { store, now });
  assertDeepEqual(usage, { day: '2026-09-29', reads: 112, writes: 4, exhausted: false });
  assertDeepEqual(loadUsage(store, now), usage, 'saved');
  addReads(-5, { store, now });
  addWrites('x', { store, now });
  assertDeepEqual(loadUsage(store, now), usage, 'bad counts are ignored');
});

test('counters start over when the Pacific day changes', () => {
  const store = fakeStore();
  addWrites(40, { store, now: at('2026-09-30T06:59:00Z') });
  const next = addWrites(1, { store, now: at('2026-09-30T07:01:00Z') });
  assertDeepEqual(next, { day: '2026-09-30', reads: 0, writes: 1, exhausted: false });
});

test('markExhausted locks the day; the reset clears it', () => {
  const store = fakeStore();
  const now = at('2026-09-30T02:00:00Z');
  assert(!isExhausted(loadUsage(store, now)));
  addWrites(5, { store, now });
  const usage = markExhausted({ store, now });
  assert(isExhausted(usage));
  assertEqual(usage.writes, 5, 'counts kept');
  assert(isExhausted(loadUsage(store, at('2026-09-30T06:59:59Z'))), 'still locked before midnight Pacific');
  assert(!isExhausted(loadUsage(store, at('2026-09-30T07:00:00Z'))), 'free again after the reset');
  assert(!isExhausted(null));
});

test('saveUsage ignores a full or missing storage', () => {
  const usage = { day: '2026-09-29', reads: 1, writes: 1, exhausted: false };
  const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  assertEqual(saveUsage(usage, full), usage);
  assertEqual(saveUsage(usage, null), usage);
});

test('quotaSummary: the estimate with limits and reset, or the time chat resumes', () => {
  const now = at('2026-09-30T02:40:00Z');
  const reset = localTime(nextResetAt(now));
  const usage = { day: '2026-09-29', reads: 4100, writes: 312, exhausted: false };
  assertEqual(quotaSummary(usage, now),
    `Daily quota (estimate): 312 / 20,000 writes · 4,100 / 50,000 reads · resets at ${reset} (in 4 h 20 min)`);
  assertEqual(quotaSummary({ ...usage, exhausted: true }, now), `Daily limit reached. Chat resumes at ${reset} (in 4 h 20 min).`);
});
