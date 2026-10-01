// Top bar: the logo (goes Home), the account dropdown (History, theme,
// Settings, and who you are with Sign out), the sign-in button and the
// "Saving… / Syncing… / Saved" indicator.

import { $ } from './ui.js';
import { SAVE_LABELS } from './save-status.js';

/**
 * Sign-in area and the signed-out prompt.
 * status: 'local' | 'loading' | 'signed-out' | 'signed-in'
 */
export function renderAuth(status, user) {
  document.body.dataset.auth = status;
  const signedIn = status === 'signed-in';
  $('#sign-in').hidden = status !== 'signed-out';
  $('#signed-out').hidden = status !== 'signed-out';
  // The menu (History, theme, Settings) is always there; who you are and Sign out only when signed in.
  $('#account').classList.toggle('is-guest', !signedIn);
  $('.account-info').hidden = !signedIn;
  $('#sign-out').hidden = !signedIn;
  if (!signedIn) closeAccountMenu();

  const name = signedIn && user ? (user.displayName || user.email || 'Signed in') : '';
  const initial = name.trim().charAt(0).toUpperCase();
  $('#user-name').textContent = name || 'Menu';
  $('#account-btn').title = name || 'Menu';
  $('#account-btn').setAttribute('aria-label', name ? `Account: ${name}` : 'Menu: History, theme and Settings');
  if (initial) $('#account-initial').textContent = initial;
  else $('#account-initial').innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
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
  $('#account-menu [role="menuitem"]').focus();
}

/** The account button toggles its menu; a click elsewhere, or on an item, closes it. */
export function bindAccountMenu() {
  $('#account-btn').addEventListener('click', () => {
    if (isAccountMenuOpen()) closeAccountMenu();
    else openAccountMenu();
  });
  $('#account-menu').addEventListener('click', e => {
    if (e.target.closest('[role="menuitem"]')) closeAccountMenu();
  });
  document.addEventListener('click', e => {
    if (isAccountMenuOpen() && !e.target.closest('#account')) closeAccountMenu();
  });
}

/** The logo opens Home, from the top. */
export function bindBrandLink() {
  $('#brand-link').addEventListener('click', () => {
    $('#view-dashboard').click();
    window.scrollTo(0, 0);
  });
}

let savedTimer = null;

/**
 * The save indicator for a summary from save-status.js: 'saving' | 'syncing'
 * | 'saved' | 'failed'. "Saved" shows briefly; "Not saved" stays with Retry.
 */
export function renderSaveStatus(state) {
  const status = $('#sync-status');
  clearTimeout(savedTimer);
  status.hidden = false;
  status.className = `sync-status is-${state}`;
  status.textContent = SAVE_LABELS[state];
  $('#sync-retry').hidden = state !== 'failed';
  if (state === 'saved') savedTimer = setTimeout(() => { status.hidden = true; }, 1500);
}

export function bindSaveRetry(retry) {
  $('#sync-retry').addEventListener('click', retry);
}
