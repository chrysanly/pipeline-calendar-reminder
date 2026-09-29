// Settings modal: Business (js/views/settings.js fills that form) and Data
// (Clear all data, confirmed by typing CLEAR). The AI runs through the CladFlo
// Worker set up for the site, so there is no API key to enter here.

import { $, setBusy } from './ui.js';

export const CLEAR_WORD = 'CLEAR';

function setStatus(selector, message, isError = false) {
  const node = $(selector);
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

export function isSettingsOpen() {
  return !$('#settings').hidden;
}

/** section: 'data' focuses the CLEAR box; otherwise the close button. */
export function openSettings(section = '') {
  setStatus('#clear-status', '');
  $('#clear-confirm').value = '';
  $('#clear-all').disabled = true;
  $('#settings').hidden = false;
  (section === 'data' ? $('#clear-confirm') : $('#settings-close')).focus();
}

export function closeSettings() {
  $('#settings').hidden = true;
  $('#settings-btn').focus();
}

/** handlers.onClearAll() resolves to {reminders, meetings} deleted. */
async function clearAll(handlers) {
  if ($('#clear-confirm').value.trim() !== CLEAR_WORD) return;
  const button = $('#clear-all');
  setBusy(button, true);
  try {
    const { reminders, meetings } = await handlers.onClearAll();
    $('#clear-confirm').value = '';
    setBusy(button, false);
    button.disabled = true; // until the word is typed again
    setStatus('#clear-status', `Cleared ${reminders} reminder${reminders === 1 ? '' : 's'}, ${meetings} minutes.`);
  } catch (err) {
    setBusy(button, false);
    setStatus('#clear-status', err.message, true);
  }
}

export function bindSettings(handlers) {
  $('#settings-btn').addEventListener('click', () => openSettings());
  $('#settings-close').addEventListener('click', closeSettings);
  $('#settings').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeSettings();
  });
  $('#clear-confirm').addEventListener('input', e => {
    $('#clear-all').disabled = e.target.value.trim() !== CLEAR_WORD;
  });
  $('#clear-all').addEventListener('click', () => clearAll(handlers));
}
