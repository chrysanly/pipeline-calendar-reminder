// In-app toast (#banner): reminder popups, notices, and the import progress spinner.

import { $ } from './ui.js';

let bannerTimer = null;
let bannerOpen = null;
// Bumped by reportError, so runWithToast knows a save failed behind its back.
let errorCount = 0;

/** In-app toast: "Hey you have a …" plus the reminder details. */
export function showBanner(title, body, onOpen) {
  const banner = $('#banner');
  banner.classList.remove('is-busy');
  banner.removeAttribute('aria-busy');
  $('#banner-title').textContent = title;
  $('#banner-body').textContent = body || '';
  bannerOpen = onOpen || null;
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hideBanner, 30000);
}

/**
 * The toast with a spinner, e.g. "Importing 50/200". It stays up until the
 * next showBanner (the result) replaces it.
 */
export function showProgress(title, body = '') {
  showBanner(title, body);
  clearTimeout(bannerTimer);
  $('#banner').classList.add('is-busy');
  $('#banner').setAttribute('aria-busy', 'true');
}

/**
 * A save with a descriptive toast: `busy` (spinner) while `action` runs, then
 * the result, e.g. "Saving follow-up for Acme…" → "Follow-up for Acme saved".
 * done(result) and body(result) may be text or a function of what action returned.
 * On an error: `failed` plus the error and what to do next.
 * @returns {Promise<{ok: boolean, result?: any, error?: Error}>}
 */
export async function runWithToast({ busy, done, body = '', failed = 'Could not save', retry = 'Check your connection and try again.' }, action) {
  showProgress(busy);
  const errorsBefore = errorCount;
  try {
    const result = await action();
    // The save was refused and reportError already said why: keep that message.
    if (errorCount !== errorsBefore) return { ok: false };
    const text = value => (typeof value === 'function' ? value(result) : value);
    showBanner(text(done), text(body));
    return { ok: true, result };
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    showBanner(failed, `${reason} ${retry}`.trim());
    return { ok: false, error };
  }
}

/** A failed save (store.js / commit onError): the toast says what failed. */
export function reportError(title, body) {
  errorCount++;
  showBanner(title, body);
}

export function hideBanner() {
  clearTimeout(bannerTimer);
  $('#banner').hidden = true;
}

export function bindBanner() {
  $('#banner-close').addEventListener('click', hideBanner);
  $('#banner-title').addEventListener('click', () => {
    if (bannerOpen) bannerOpen();
    hideBanner();
  });
}
