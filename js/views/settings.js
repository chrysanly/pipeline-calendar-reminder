// Settings → Business: currency, payment links and the Worker URL, one record
// at settings/app in the generic store (store.js). The section lives in the
// Settings dialog (index.html #business-form); settings-ui.js owns the rest.

import { CURRENCIES, DEFAULT_SETTINGS, SETTINGS_ID, readSettings, validateSettings } from '../store.js';
import { $, el, setBusy } from '../ui.js';

const BUSINESS_FIELDS = Object.keys(DEFAULT_SETTINGS);

function bizStatus(message, isError = false) {
  const node = $('#biz-status');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

function showBusinessErrors(errors) {
  const form = $('#business-form');
  for (const name of BUSINESS_FIELDS) {
    const field = form.elements[name];
    $(`#biz-${name}-error`).textContent = errors[name] || '';
    if (errors[name]) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  }
}

/** The saved values (not the .env fallback, which shows as the placeholder). */
function fillBusinessForm(app) {
  const form = $('#business-form');
  const values = readSettings(app.store.all('settings'));
  for (const name of BUSINESS_FIELDS) form.elements[name].value = values[name];
  if (app.config.workerUrl) form.elements.workerUrl.placeholder = app.config.workerUrl;
  showBusinessErrors({});
  bizStatus('');
}

async function saveBusiness(app) {
  const form = $('#business-form');
  const input = Object.fromEntries(BUSINESS_FIELDS.map(name => [name, form.elements[name].value]));
  const { settings, errors } = validateSettings(input);
  showBusinessErrors(errors);
  const invalid = BUSINESS_FIELDS.find(name => errors[name]);
  if (invalid) {
    bizStatus('Fix the highlighted fields.', true);
    form.elements[invalid].focus();
    return;
  }
  if (!app.canSave()) {
    bizStatus('Sign in first.', true);
    return;
  }
  const button = $('#biz-save');
  setBusy(button, true);
  try {
    await app.store.put('settings', { id: SETTINGS_ID, ...settings });
    fillBusinessForm(app);
    bizStatus('Business settings saved.');
  } catch (err) {
    bizStatus(err && err.message ? err.message : String(err), true);
  } finally {
    setBusy(button, false);
  }
}

/** Feature entry point (js/features.js). */
export function registerBusinessSettings(app) {
  const currency = $('#biz-currency');
  for (const code of CURRENCIES) {
    const option = el('option', '', code);
    option.value = code;
    currency.appendChild(option);
  }
  $('#business-form').addEventListener('submit', e => {
    e.preventDefault();
    saveBusiness(app);
  });
  $('#settings-btn').addEventListener('click', () => fillBusinessForm(app));
  // Another device or tab saved: refresh, unless the user is editing right now.
  app.hooks.on('store-change', ({ name }) => {
    if ((name === 'settings' || name === null) && $('#settings').hidden) fillBusinessForm(app);
  });
  fillBusinessForm(app);
}
