// Firestore free-plan (Spark) daily quota, as far as this browser can tell.
// Firebase has no API for "quota left", so the app counts its own reads and
// writes per Pacific day (the quota resets at midnight America/Los_Angeles)
// and remembers when Firestore said resource-exhausted. Other people's use
// counts too, so these numbers are an estimate: the Firebase console's Usage
// tab is the exact figure. Pure: storage and "now" can be passed in.

export const WRITES_PER_DAY = 20000;
export const READS_PER_DAY = 50000;
export const QUOTA_KEY = 'cladflo.chat-quota.v1';
const QUOTA_ZONE = 'America/Los_Angeles';

const pacificFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: QUOTA_ZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});
const countFormat = new Intl.NumberFormat('en-US');
const quotaPad = n => String(n).padStart(2, '0');

/** Pacific wall-clock parts of an instant, as numbers. */
function pacificParts(date) {
  const parts = {};
  for (const { type, value } of pacificFormat.formatToParts(date)) parts[type] = Number(value);
  return parts;
}

/** Pacific wall-clock time minus UTC, in ms, at an instant. */
function pacificOffset(date) {
  const p = pacificParts(date);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** The quota day: the date in Pacific time, "YYYY-MM-DD". */
export function quotaDayKey(now = new Date()) {
  const p = pacificParts(now);
  return `${p.year}-${quotaPad(p.month)}-${quotaPad(p.day)}`;
}

/** The next Pacific midnight after `now`, when the quota resets. */
export function nextResetAt(now = new Date()) {
  const p = pacificParts(now);
  const wall = Date.UTC(p.year, p.month - 1, p.day + 1);
  const guess = new Date(wall - pacificOffset(now));
  // The offset can change overnight (daylight saving): use the one at midnight.
  return new Date(wall - pacificOffset(guess));
}

/** "4 h 20 min", "20 min", "3 h"; at least 1 min. */
export function untilText(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  if (!h) return `${min} min`;
  return min ? `${h} h ${min} min` : `${h} h`;
}

/** Local "HH:MM" of a date. */
export const localTime = date => `${quotaPad(date.getHours())}:${quotaPad(date.getMinutes())}`;

/** "resets at 11:00 (in 4 h 20 min)", in the user's local time. */
export function formatReset(date, now = new Date()) {
  return `resets at ${localTime(date)} (in ${untilText(date - now)})`;
}

const freshUsage = now => ({ day: quotaDayKey(now), reads: 0, writes: 0, exhausted: false });
const count = n => Math.max(0, Math.floor(Number(n) || 0));
const quotaStore = () => globalThis.localStorage || null;

/** Today's counters; a new Pacific day (or bad data) starts over at zero. */
export function loadUsage(store = quotaStore(), now = new Date()) {
  let saved = null;
  try {
    saved = store ? JSON.parse(store.getItem(QUOTA_KEY)) : null;
  } catch {
    saved = null;
  }
  if (!saved || typeof saved !== 'object' || saved.day !== quotaDayKey(now)) return freshUsage(now);
  return { day: saved.day, reads: count(saved.reads), writes: count(saved.writes), exhausted: saved.exhausted === true };
}

/** Keep the counters; a full or blocked storage is ignored (the estimate is best effort). */
export function saveUsage(usage, store = quotaStore()) {
  if (!store) return usage;
  try {
    store.setItem(QUOTA_KEY, JSON.stringify(usage));
  } catch {
    // storage full or blocked: keep going without saving
  }
  return usage;
}

function updateUsage(change, { store = quotaStore(), now = new Date() } = {}) {
  const usage = loadUsage(store, now);
  change(usage);
  return saveUsage(usage, store);
}

/** Count `n` document reads (a snapshot's documents). */
export const addReads = (n, options) => updateUsage(u => { u.reads += count(n); }, options);

/** Count `n` document writes (a message is 1, plus its file chunks). */
export const addWrites = (n, options) => updateUsage(u => { u.writes += count(n); }, options);

/** Firestore said resource-exhausted: locked until the next reset. */
export const markExhausted = options => updateUsage(u => { u.exhausted = true; }, options);

/** True while today's quota is used up (a new day clears it on load). */
export const isExhausted = usage => Boolean(usage && usage.exhausted);

/** The quota line under the chat. */
export function quotaSummary(usage, now = new Date()) {
  const reset = nextResetAt(now);
  if (isExhausted(usage)) {
    return `Daily limit reached. Chat resumes at ${localTime(reset)} (in ${untilText(reset - now)}).`;
  }
  const writes = `${countFormat.format(usage.writes)} / ${countFormat.format(WRITES_PER_DAY)} writes`;
  const reads = `${countFormat.format(usage.reads)} / ${countFormat.format(READS_PER_DAY)} reads`;
  return `Daily quota (estimate): ${writes} · ${reads} · ${formatReset(reset, now)}`;
}
