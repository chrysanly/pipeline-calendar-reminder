// Small DOM builders shared by the Client page modules (client.js,
// client-work.js, client-actions.js).

import { el, icon, withBusy } from '../ui.js';

export function cpSay(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

/** Saves need a backend (local mode, or signed in). */
export function cpCanWrite(app, status) {
  if (app.canSave()) return true;
  cpSay(status, 'Sign in first.', true);
  return false;
}

export function cpButton(text, className, iconName, label) {
  const node = el('button', className);
  node.type = 'button';
  if (iconName) node.append(icon(iconName), ' ');
  node.append(text);
  if (label) node.setAttribute('aria-label', label);
  return node;
}

export function cpField(labelText, control) {
  const label = el('label', 'client-field');
  label.append(labelText, control);
  return label;
}

export function cpInput(name, { type = 'text', placeholder = '', inputMode } = {}) {
  const node = el('input');
  node.type = type;
  node.name = name;
  node.placeholder = placeholder;
  node.autocomplete = 'off';
  if (inputMode) node.inputMode = inputMode;
  return node;
}

export function cpSelect(name, values, labels = {}) {
  const node = el('select');
  node.name = name;
  for (const value of values) {
    const option = el('option', '', labels[value] || value);
    option.value = value;
    node.appendChild(option);
  }
  return node;
}

export function cpCard(title, iconName, className) {
  const section = el('section', `dash-card client-card ${className}`);
  const heading = el('h3', 'dash-title');
  heading.append(icon(iconName), ' ', title);
  section.appendChild(heading);
  return section;
}

export function cpForm(className, fields, submitText) {
  const node = el('form', `stack-form ${className}`);
  node.noValidate = true;
  const status = el('p', 'form-status');
  status.setAttribute('role', 'status');
  const submit = cpButton(submitText, 'primary', 'fa-plus');
  submit.type = 'submit';
  node.append(...fields, submit, status);
  return { node, status, submit };
}

export function cpOnSubmit(formParts, action) {
  formParts.node.addEventListener('submit', e => {
    e.preventDefault();
    withBusy(formParts.submit, action);
  });
}
