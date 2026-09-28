// Top bar, right side: the account dropdown, the sign-in button and the
// "Saving… / Saved" indicator.

import { $ } from './ui.js';

/**
 * Sign-in area and the signed-out prompt.
 * status: 'local' | 'loading' | 'signed-out' | 'signed-in'
 */
export function renderAuth(status, user) {
  document.body.dataset.auth = status;
  $('#auth-area').hidden = status === 'local';
  $('#sign-in').hidden = status !== 'signed-out';
  $('#account').hidden = status !== 'signed-in';
  $('#signed-out').hidden = status !== 'signed-out';
  if (status !== 'signed-in') closeAccountMenu();

  const name = user ? (user.displayName || user.email || 'Signed in') : '';
  const initial = name.trim().charAt(0).toUpperCase();
  $('#user-name').textContent = name;
  $('#user-name').hidden = status !== 'signed-in';
  $('#account-btn').title = name;
  $('#account-btn').setAttribute('aria-label', name ? `Account: ${name}` : 'Account');
  $('#account-initial').textContent = initial;
  $('#account-menu-initial').textContent = initial;
  $('#account-name').textContent = name;
  $('#account-email').textContent = user && user.email && user.email !== name ? user.email : '';
}

export function isAccountMenuOpen() {
  return !$('#account-menu').hidden;
}

export function closeAccountMenu() {
  $('#account-menu').hidden = true;
  $('#account-btn').setAttribute('aria-expanded', 'false');
}

function openAccountMenu() {
  $('#account-menu').hidden = false;
  $('#account-btn').setAttribute('aria-expanded', 'true');
  $('#sign-out').focus();
}

/** The account button toggles its menu; a click elsewhere closes it. */
export function bindAccountMenu() {
  $('#account-btn').addEventListener('click', () => {
    if (isAccountMenuOpen()) closeAccountMenu();
    else openAccountMenu();
  });
  document.addEventListener('click', e => {
    if (isAccountMenuOpen() && !e.target.closest('#account')) closeAccountMenu();
  });
}

let pending = 0;
let savedTimer = null;

/** Show "Saving…" until every write passed here settles, then "Saved" briefly. */
export function trackSave(promise) {
  const status = $('#sync-status');
  pending++;
  clearTimeout(savedTimer);
  status.hidden = false;
  status.className = 'sync-status is-saving';
  status.textContent = 'Saving…';
  const settle = ok => {
    pending--;
    if (pending > 0) return;
    status.className = `sync-status ${ok ? 'is-saved' : 'is-failed'}`;
    status.textContent = ok ? 'Saved' : 'Not saved';
    savedTimer = setTimeout(() => { status.hidden = true; }, ok ? 1500 : 4000);
  };
  promise.then(() => settle(true), () => settle(false));
  return promise;
}
