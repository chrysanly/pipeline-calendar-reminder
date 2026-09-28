// Settings modal: AI settings (this browser's Groq key and model) and Data
// (Clear all data, confirmed by typing CLEAR).

import {
  GROQ_MODELS, loadGroqKey, saveGroqKey, removeGroqKey, loadGroqModel, saveGroqModel, maskKey, testGroqKey
} from './groq.js';
import { $, el, setBusy } from './ui.js';

export const CLEAR_WORD = 'CLEAR';

function setStatus(selector, message, isError = false) {
  const node = $(selector);
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

/** The saved-key line and the key box's placeholder. */
function renderKeyState() {
  const key = loadGroqKey();
  $('#groq-key').value = '';
  $('#groq-key').placeholder = key ? maskKey(key) : 'gsk_…';
  $('#groq-key-state').textContent = key
    ? `Saved in this browser: ${maskKey(key)}`
    : 'No key saved yet.';
  $('#groq-remove').disabled = !key;
}

export function isSettingsOpen() {
  return !$('#settings').hidden;
}

/** section: 'ai' focuses the key box, 'data' the CLEAR box. */
export function openSettings(section = 'ai') {
  renderKeyState();
  $('#groq-model').value = loadGroqModel();
  setStatus('#groq-status', '');
  setStatus('#clear-status', '');
  $('#clear-confirm').value = '';
  $('#clear-all').disabled = true;
  $('#settings').hidden = false;
  (section === 'data' ? $('#clear-confirm') : $('#groq-key')).focus();
}

export function closeSettings() {
  $('#settings').hidden = true;
  $('#settings-btn').focus();
}

async function testKey() {
  const key = $('#groq-key').value.trim() || loadGroqKey();
  if (!key) {
    setStatus('#groq-status', 'Paste your Groq API key first.', true);
    return;
  }
  const button = $('#groq-test');
  setBusy(button, true);
  setStatus('#groq-status', 'Testing…');
  try {
    await testGroqKey({ key, model: $('#groq-model').value });
    setStatus('#groq-status', 'The key works.');
  } catch (err) {
    setStatus('#groq-status', err.message, true);
  } finally {
    setBusy(button, false);
  }
}

function saveKey() {
  try {
    saveGroqKey($('#groq-key').value);
    renderKeyState();
    setStatus('#groq-status', 'Key saved in this browser.');
  } catch (err) {
    setStatus('#groq-status', err.message, true);
  }
}

function removeKey() {
  removeGroqKey();
  renderKeyState();
  setStatus('#groq-status', 'Key removed from this browser.');
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
  const models = $('#groq-model');
  for (const model of GROQ_MODELS) {
    const option = el('option', '', model.label);
    option.value = model.id;
    models.appendChild(option);
  }
  models.addEventListener('change', () => {
    saveGroqModel(models.value);
    setStatus('#groq-status', 'Model saved.');
  });

  $('#settings-btn').addEventListener('click', () => openSettings('ai'));
  $('#settings-close').addEventListener('click', closeSettings);
  $('#settings').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeSettings();
  });
  $('#groq-save').addEventListener('click', saveKey);
  $('#groq-key').addEventListener('keydown', e => {
    if (e.key === 'Enter') saveKey();
  });
  $('#groq-test').addEventListener('click', testKey);
  $('#groq-remove').addEventListener('click', removeKey);
  $('#clear-confirm').addEventListener('input', e => {
    $('#clear-all').disabled = e.target.value.trim() !== CLEAR_WORD;
  });
  $('#clear-all').addEventListener('click', () => clearAll(handlers));
}
