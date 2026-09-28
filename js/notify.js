// Status-change alerts: when a client moves stage (the Board, or the status
// menu on Home), show a browser notification and/or email you through the Worker's
// /notify. Preferences live in this browser. The rules are pure and tested;
// registerStatusAlerts wires them to the app's 'status-change' hook.

import { STATUS_LABELS } from './storage.js';
import { sendAlertEmail, workerAuth } from './ai.js';

export const ALERT_PREFS_STORAGE = 'cladflo.alerts.v1';
export const DEFAULT_ALERT_PREFS = { browser: true, email: false, statuses: ['active', 'inactive'] };

const alertStore = typeof localStorage !== 'undefined' ? localStorage : null;

export function loadAlertPrefs(store = alertStore) {
  try {
    const saved = JSON.parse((store && store.getItem(ALERT_PREFS_STORAGE)) || 'null');
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_ALERT_PREFS };
    return {
      browser: saved.browser !== false,
      email: saved.email === true,
      statuses: Array.isArray(saved.statuses) ? saved.statuses.filter(s => s in STATUS_LABELS) : DEFAULT_ALERT_PREFS.statuses
    };
  } catch (err) {
    return { ...DEFAULT_ALERT_PREFS };
  }
}

export function saveAlertPrefs(prefs, store = alertStore) {
  const clean = {
    browser: Boolean(prefs.browser),
    email: Boolean(prefs.email),
    statuses: (prefs.statuses || []).filter(s => s in STATUS_LABELS)
  };
  store.setItem(ALERT_PREFS_STORAGE, JSON.stringify(clean));
  return clean;
}

/** Alert for this change? Only a real move into one of the chosen statuses. */
export function shouldAlert(prefs, { status, previous }) {
  if (!status || status === previous) return false;
  if (!prefs.browser && !prefs.email) return false;
  return prefs.statuses.includes(status);
}

/** The alert's words: "Acme Ltd. is now Active" / "Moved from Lead to Active." */
export function alertMessage({ clientName, status, previous }) {
  const subject = `${clientName} is now ${STATUS_LABELS[status] || status}`;
  const text = previous && STATUS_LABELS[previous]
    ? `${clientName} moved from ${STATUS_LABELS[previous]} to ${STATUS_LABELS[status]}.`
    : `${clientName} was set to ${STATUS_LABELS[status]}.`;
  return { subject, text };
}

function browserAlert(subject, text) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    new Notification(subject, { body: text, tag: `status-${subject}` });
    return true;
  } catch (err) {
    return false; // some phones only allow notifications from a service worker
  }
}

/** Feature entry point (js/features.js). */
export function registerStatusAlerts(app) {
  app.hooks.on('status-change', async change => {
    const prefs = loadAlertPrefs();
    if (!shouldAlert(prefs, change)) return;
    const { subject, text } = alertMessage(change);
    if (prefs.browser) browserAlert(subject, text);
    if (!prefs.email) return;
    try {
      const auth = await workerAuth(app.user);
      await sendAlertEmail({ workerUrl: app.settings().workerUrl, auth }, { subject, text });
    } catch (err) {
      app.notify('Email alert not sent', err.message);
    }
  });
}
