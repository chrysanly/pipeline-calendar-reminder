// The daily-quota line above the chat composer (estimate from js/chat-quota.js),
// and the composer locked while the free daily limit is reached.

import { quotaSummary, isExhausted, loadUsage, nextResetAt } from '../chat-quota.js';
import { isQuotaError } from '../chat.js';
import { el } from '../ui.js';

const OPEN_PLACEHOLDER = 'Write to your team… (Enter sends, Shift+Enter for a new line)';
const LOCKED_PLACEHOLDER = 'Chat is paused until the daily limit resets.';

export function buildQuotaLine() {
  const line = el('p', 'chat-quota');
  line.setAttribute('role', 'status');
  line.title = 'Counted by this browser only: other people and calendar sync use the same quota. The Firebase console (Usage) has the exact figure.';
  return line;
}

export function renderQuotaLine(line, usage, now = new Date()) {
  line.textContent = quotaSummary(usage, now);
  line.classList.toggle('is-locked', isExhausted(usage));
}

/** Text box, Send and Attach off (or back on). */
export function lockCompose({ form, input, submit, attach }, locked) {
  form.classList.toggle('is-locked', locked);
  for (const control of [input, submit, attach]) control.disabled = locked;
  input.placeholder = locked ? LOCKED_PLACEHOLDER : OPEN_PLACEHOLDER;
}

let wasLocked = false;
let resetTimer = null;

/**
 * Draw the line and lock or unlock the composer from the stored usage.
 * While locked, looks again just after the reset; `onReset()` once it has passed.
 */
export function showQuota(parts, onReset, now = new Date()) {
  const usage = loadUsage(undefined, now);
  const locked = isExhausted(usage);
  renderQuotaLine(parts.quota, usage, now);
  lockCompose(parts, locked);
  clearTimeout(resetTimer);
  if (locked) resetTimer = setTimeout(() => showQuota(parts, onReset), nextResetAt(now) - now + 1000);
  const reset = wasLocked && !locked;
  wasLocked = locked;
  if (reset) onReset();
}

/** Firestore only logs a quota error on a write it keeps retrying, so listen to its log. */
export function watchQuotaLog(onQuota) {
  const firebase = globalThis.firebase;
  if (!firebase || typeof firebase.onLog !== 'function') return;
  firebase.onLog(entry => { if (isQuotaError(entry)) onQuota(); }, { level: 'warn' });
}
