// Entry point: state, wiring, reminder loop.

import { toDateKey, fromDateKey, shiftCursor, formatDayLabel, calendarPeriod, VIEWS, CALENDAR_VIEWS } from './calendar.js';
import { createImportFlow } from './import-flow.js';
import { buildClients } from './dashboard.js';
import {
  STORAGE_KEY, loadEvents, localBackend, addEvent, updateEvent, deleteEvent, findEvent,
  applyClientFields, clientKey, hideFromCalendar, countOnCalendar, STATUS_LABELS
} from './storage.js';
import { createRecordStore } from './record-store.js';
import { startReminderLoop, requestPermission } from './reminders.js';
import { FIREBASE_CONFIG } from './firebase-config.js';
import { APP_CONFIG } from './app-config.js';
import {
  MIGRATED_KEY, isConfigured, selectBackend, planMigration, cloudBackend, connectFirebase
} from './cloud.js';
import { createStore, listBackend, readSettings } from './store.js';
import { createHooks } from './hooks.js';
import { createViewRegistry } from './views/registry.js';
import { FEATURES } from './features.js';
import { initTheme, toggleTheme } from './theme.js';
import {
  renderCalendar, renderPanel, isPanelOpen, swipeDirection, COMPACT_QUERY,
  openModal, closeModal, isModalOpen, readForm, bindForm, withBusy, showView, mountView
} from './ui.js';
import { bindTimeGrid } from './time-grid.js';
import { showBanner, bindBanner, reportError, runWithToast } from './banner.js';
import { installSelectMenus } from './select-menu.js';
import { createDatePicker } from './datepicker.js';
import {
  renderAuth, bindAccountMenu, isAccountMenuOpen, closeAccountMenu, renderSaveStatus, bindSaveRetry
} from './topbar-ui.js';
import { createSaveTracker } from './save-status.js';
import { renderDashboard } from './dashboard-ui.js';
import { renderHistory, bindHistory } from './history-ui.js';
import { renderMinutes, bindMinutes, prefillMinutes } from './minutes-ui.js';
import { bindSettings, openSettings, closeSettings, isSettingsOpen } from './settings-ui.js';
import {
  bindClearCalendar, isClearCalendarOpen, closeClearCalendar
} from './clear-calendar-ui.js';

const VIEW_KEY = 'view';

// Pages that feature modules register (js/features.js).
const views = createViewRegistry();

const isKnownView = view => VIEWS.includes(view) || views.has(view);

/** The saved page; checked again once the features have registered theirs. */
function loadView() {
  try {
    // First visit: the Home dashboard.
    return localStorage.getItem(VIEW_KEY) || 'dashboard';
  } catch (err) {
    return 'dashboard';
  }
}

// ?backend=local forces this browser's localStorage (tests, or working offline
// on purpose). Otherwise Firestore is used once FIREBASE_CONFIG is filled in.
const forceLocal = new URLSearchParams(location.search).get('backend') === 'local';
const firebaseSdk = typeof firebase !== 'undefined' ? firebase : null;
const mode = selectBackend({ config: FIREBASE_CONFIG, sdk: firebaseSdk, forceLocal });

// Where commit() saves. null while signed out in cloud mode.
let backend = mode === 'local' ? localBackend() : null;

const today = new Date();

const initialView = loadView();

const state = {
  view: initialView,
  // Where the Calendar nav button goes: the last of day/week/month used.
  calendarView: CALENDAR_VIEWS.includes(initialView) ? initialView : 'month',
  cursor: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  selectedKey: toDateKey(today),
  openId: null,
  openDay: null, // the day whose full list the sheet shows ("+N more")
  events: backend ? backend.load() : [],
  // Cloud mode until the first snapshot (or sign-out): 'Loading…', not 'No clients'.
  loading: mode === 'cloud',
  // Saved meeting minutes and the History log, newest first (record-store.js).
  meetings: [],
  history: [],
  historyFilter: { action: '', client: '', search: '' }
};

let reminders = null;
// The signed-in user in cloud mode (null signed out and in local mode).
let currentUser = null;
// Firestore in cloud mode (null in local mode), for features like the chat.
let cloudDb = null;

// Feature modules listen here: 'events-change' {prev, next},
// 'status-change' {clientName, status, previous}, 'auth' {user},
// 'store-change' {name} (null: every collection).
const hooks = createHooks();

const saveErrorText = err => `${err && err.message ? err.message : String(err)} Check your connection, then try again.`;

// Every save (reminders, records, collections) on its own, for the top bar.
const saves = createSaveTracker({
  onChange: renderSaveStatus,
  onError: err => reportError('Could not save your change', saveErrorText(err))
});

// Feature collections (clients, tasks, invoices, settings, …).
const store = createStore({
  track: saves.track,
  onChange(name) {
    hooks.emit('store-change', { name });
    render();
  },
  onError: err => reportError('Could not save your change', saveErrorText(err))
});

const records = createRecordStore({
  track: saves.track,
  onChange(name, list) {
    state[name] = list;
    render();
  },
  onError: (title, message) => reportError(title, message)
});

/** Add a History entry. kind: 'reminder' | 'client' | 'minutes' | 'data' | 'calendar'. */
function log(action, kind, title, client = '', detail = '', fileId = '') {
  records.log({ action, kind, title, client, detail, fileId });
}

// Excel import and Re-import; the files are kept in this browser (file-store.js).
const imports = createImportFlow({
  state,
  commit,
  log,
  afterImport: () => reminders && reminders.check()
});

const CLEAR_PERIOD_NAMES = { day: 'Day', week: 'Week', month: 'Month' };

const reminderWhen = evt => `${evt.date ? formatDayLabel(evt.date) : ''}${evt.time ? `, ${evt.time}` : ''}`;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const handlers = {
  onSelectDay(key) {
    state.selectedKey = key;
    render();
  },
  onOpen(id) {
    openReminder(id);
  },
  /** "+N more": every reminder of that day in the side sheet. */
  onMore(key) {
    state.selectedKey = key;
    state.openDay = key;
    state.openId = null;
    render();
  },
  /** Day/Week grid: a reminder dragged to a new day and time, or to a new length. */
  onMoveEvent(id, patch) {
    const evt = findEvent(state.events, id);
    if (!evt) return;
    const moved = { ...evt, ...patch };
    // A moved reminder fires again at its new time.
    const timeChanged = 'time' in patch || 'date' in patch;
    commit(updateEvent(state.events, id, { ...patch, ...(timeChanged ? { notified: false } : {}), updatedAt: new Date().toISOString() }));
    if (patch.date) state.selectedKey = patch.date;
    const detail = timeChanged ? `Moved to ${reminderWhen(moved)}` : `Length ${patch.durationMinutes} min`;
    log('edit', 'reminder', evt.title, evt.clientName, detail);
    if (reminders) reminders.check();
  },
  onBackToDay() {
    state.openId = null;
    render();
  },
  onEdit(id) {
    openModal(findEvent(state.events, id), state.selectedKey);
  },
  onDelete(id) {
    const evt = findEvent(state.events, id);
    if (!evt) return;
    if (!confirm(`Delete "${evt.title}"?`)) return;
    if (state.openId === id) state.openId = null;
    commit(deleteEvent(state.events, id));
    log('delete', 'reminder', evt.title, evt.clientName, reminderWhen(evt));
  },
  onHistoryFilter(patch) {
    state.historyFilter = { ...state.historyFilter, ...patch };
    render();
  },
  /** Hide reminders in the range from the calendar; Home keeps them. Throws on a bad range. */
  /** The day, week or month on screen, and how many reminders Clear calendar would clear there. */
  clearPeriod() {
    const period = calendarPeriod(state.view, state.cursor);
    return { ...period, count: countOnCalendar(state.events, period) };
  },
  /** Hide the reminders of that period from the calendar; Home keeps them. */
  onClearCalendar(period) {
    const { events, count } = hideFromCalendar(state.events, period);
    if (!count) {
      showBanner('Nothing to clear', `No reminders on the calendar for ${period.label}.`);
      return;
    }
    state.openId = null;
    state.openDay = null;
    const title = `Cleared ${plural(count, 'reminder')} from ${period.label}`;
    log('clear', 'calendar', title, '', `${CLEAR_PERIOD_NAMES[period.view] || 'Period'}: ${period.label}`);
    return runWithToast({
      busy: `Clearing ${plural(count, 'reminder')} from ${period.label}…`,
      done: title,
      body: 'They are still on Home. Open a client and pick Add to calendar to bring them back.',
      failed: 'Could not clear the calendar'
    }, () => commit(events));
  },
  /** A History import entry: import its kept file again. */
  onReimport: entry => imports.reimport(entry),
  onClientStatus(clientName, status) {
    const known = handlers.onClientLookup(clientName);
    commit(applyClientFields(state.events, clientName, { status }, new Date().toISOString()));
    const from = known ? `${STATUS_LABELS[known.status]} → ` : '';
    log('status', 'client', clientName, clientName, `${from}${STATUS_LABELS[status]}`);
    hooks.emit('status-change', { clientName, status, previous: known ? known.status : null });
  },
  onSaveMinutes(meeting, isNew) {
    const forWhom = meeting.clientName ? ` for ${meeting.clientName}` : '';
    log(isNew ? 'minutes' : 'edit', 'minutes', meeting.title, meeting.clientName, isNew ? 'Saved minutes' : 'Edited minutes');
    return runWithToast({
      busy: `Saving minutes "${meeting.title}"${forWhom}…`,
      done: `Minutes "${meeting.title}" saved${forWhom}`,
      body: meeting.clientName ? 'They are on the client timeline too.' : '',
      failed: 'Could not save the minutes'
    }, () => records.commit('meetings', isNew
      ? [meeting, ...state.meetings]
      : state.meetings.map(m => (m.id === meeting.id ? meeting : m))));
  },
  onDeleteMinutes(meeting) {
    records.commit('meetings', state.meetings.filter(m => m.id !== meeting.id));
    log('delete', 'minutes', meeting.title, meeting.clientName, 'Deleted minutes');
  },
  onOpenSettings: () => openSettings(),
  /** Minutes → Back: the client the minutes were opened from. */
  onBackToClient: name => hooks.emit('open-client', { name }),
  /** Minutes without an own Groq key go through this Worker (js/groq.js). */
  minutesWorker: () => ({ workerUrl: app.settings().workerUrl, user: currentUser }),
  workerUrl: () => app.settings().workerUrl,
  onNotice: (title, body) => showBanner(title, body),
  /** Every reminder and every set of minutes goes; the History log stays. */
  async onClearAll() {
    if (mode === 'cloud' && !backend) throw new Error('Sign in first.');
    const counts = { reminders: state.events.length, meetings: state.meetings.length };
    state.openId = null;
    commit([]);
    await records.commit('meetings', []);
    log('clear', 'data', `Cleared ${plural(counts.reminders, 'reminder')}, ${counts.meetings} minutes`);
    return counts;
  },
  /** Home: a named client opens on the Client page; "(No client)" opens its reminder. */
  onOpenClient(client) {
    if (client.key && views.has('client')) {
      // Back on the client's page returns to Home.
      hooks.emit('open-client', { name: client.name, from: 'home' });
      return;
    }
    const ref = client.nextReminder || client.latestReminder;
    if (ref) openReminder(ref.id);
  },
  onClientLookup(name) {
    const key = clientKey(name);
    return key ? buildClients(state.events).find(c => c.key === key) || null : null;
  }
};

/**
 * Show the change at once, then save only what changed to the backend.
 * @returns {Promise<void>} settles when the save is done (a failure is reported, not thrown)
 */
function commit(events) {
  const prev = state.events;
  state.events = events;
  render();
  hooks.emit('events-change', { prev, next: events });
  if (!backend) return Promise.resolve();
  const target = backend;
  let tries = 0;
  // A retry writes what is on screen by then, so it never undoes a later edit.
  const run = () => (backend === target ? target.write(prev, tries++ ? state.events : events) : null);
  return saves.track(run).catch(err => {
    reportError('Could not save your change', saveErrorText(err));
  });
}

/** A new list from storage or another device. */
function receive(events) {
  const prev = state.events;
  state.events = events;
  state.loading = false;
  if (state.openId && !findEvent(state.events, state.openId)) state.openId = null;
  render();
  hooks.emit('events-change', { prev, next: events });
  if (reminders) reminders.check();
}

// What features add to Home (the pipeline board), in order: {bind, render}.
const homeParts = [];

// Features render only once the app has registered them all.
let started = false;

function render() {
  if (!started) return;
  const feature = views.get(state.view);
  if (feature) {
    showView(state.view);
    feature.render(app, feature.section);
  } else if (state.view === 'dashboard') {
    renderDashboard(state);
    for (const part of homeParts) part.render(app, part.section);
  }
  else if (state.view === 'history') renderHistory(state, handlers);
  else if (state.view === 'minutes') renderMinutes(state, handlers);
  else renderCalendar(state, handlers);
  renderPanel(state, handlers);
}

function openReminder(id) {
  const evt = findEvent(state.events, id);
  if (!evt) return;
  state.openId = id;
  if (evt.date) state.selectedKey = evt.date;
  render();
}

function closePanel() {
  state.openId = null;
  state.openDay = null;
  render();
}

function setView(view) {
  if (!isKnownView(view)) return;
  state.view = view;
  if (CALENDAR_VIEWS.includes(view)) state.calendarView = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (err) {
    // view just won't survive a reload
  }
  render();
}

function move(delta) {
  if (!CALENDAR_VIEWS.includes(state.view)) return; // no date range on the other pages
  state.cursor = shiftCursor(state.view, state.cursor, delta);
  render();
}

function goToToday() {
  const now = new Date();
  state.cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  state.selectedKey = toDateKey(now);
  render();
}

/**
 * Swipe left/right on the calendar for next/previous. Touch and pen only, so
 * mouse text selection is untouched; CSS `touch-action: pan-y` leaves vertical
 * scrolling to the browser and hands horizontal moves to us.
 */
function bindSwipe(target) {
  let start = null;
  target.addEventListener('pointerdown', e => {
    start = e.pointerType === 'mouse' || !e.isPrimary || e.target.closest('.tg-event') ? null : { x: e.clientX, y: e.clientY };
  });
  target.addEventListener('pointercancel', () => { start = null; });
  target.addEventListener('pointerup', e => {
    // A reminder being dragged on the Day/Week grid is not a swipe.
    if (!start || document.body.classList.contains('is-dragging-any')) {
      start = null;
      return;
    }
    const delta = swipeDirection(e.clientX - start.x, e.clientY - start.y);
    start = null;
    if (delta) move(delta);
  });
}

function bind() {
  document.querySelector('#prev').addEventListener('click', () => move(-1));
  document.querySelector('#next').addEventListener('click', () => move(1));
  document.querySelector('#today').addEventListener('click', goToToday);
  for (const view of VIEWS) {
    // Minutes has no navbar button: the client profile's Add minutes opens it.
    const button = document.querySelector(`#view-${view}`);
    if (button) button.addEventListener('click', () => setView(view));
  }
  document.querySelector('#view-calendar').addEventListener('click', () => setView(state.calendarView));
  document.querySelector('#theme-toggle').addEventListener('click', toggleTheme);
  bindAccountMenu();
  bindSaveRetry(() => saves.retry());
  document.querySelector('#panel-close').addEventListener('click', closePanel);
  document.querySelector('#panel-backdrop').addEventListener('click', closePanel);
  bindSwipe(document.querySelector('.calendar'));
  bindTimeGrid(document.querySelector('#grid'), handlers);
  // Crossing the phone breakpoint changes the month layout (chip limit, agenda).
  if (typeof matchMedia === 'function') {
    const compact = matchMedia(COMPACT_QUERY);
    if (compact.addEventListener) compact.addEventListener('change', render);
  }
  document.querySelector('#add-event').addEventListener('click', () => openModal(null, state.selectedKey));
  const fileInput = document.querySelector('#import-file');
  const importBtn = document.querySelector('#import-btn');
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (file) await withBusy(importBtn, () => imports.importFile(file));
    fileInput.value = ''; // so picking the same file again still fires `change`
  });
  document.querySelector('#modal-close').addEventListener('click', closeModal);
  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  document.querySelector('#modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  bindBanner();
  bindForm(handlers);
  // The reminder's date: the app's date picker (the value stays 'YYYY-MM-DD').
  createDatePicker(document.querySelector('#event-form [name="date"]'), { label: 'Choose the reminder date' });
  // Every select[data-picker] (statuses, Remind me, History filters) opens the app's menu.
  installSelectMenus();
  bindHistory(handlers);
  bindMinutes(handlers);
  bindSettings(handlers);
  bindClearCalendar(handlers);

  document.querySelector('#event-form').addEventListener('submit', e => {
    e.preventDefault();
    const data = readForm();
    if (!data) return;
    data.updatedAt = new Date().toISOString();
    // Blank location fields take what the client already has, so saving one
    // reminder never wipes the client's details.
    const known = handlers.onClientLookup(data.clientName);
    if (known) {
      for (const field of ['phone', 'location', 'city', 'country']) data[field] = data[field] || known[field];
    }
    // Editing resets the notified flag so a moved reminder fires again.
    let next = data.id
      ? updateEvent(state.events, data.id, { ...data, notified: false })
      : addEvent(state.events, { ...data, notified: false });
    // One client, one status and location: copy them to all its reminders.
    const shared = { status: data.status };
    for (const field of ['phone', 'location', 'city', 'country']) if (data[field]) shared[field] = data[field];
    next = applyClientFields(next, data.clientName, shared, data.updatedAt);
    state.selectedKey = data.date;
    state.cursor = fromDateKey(data.date);
    commit(next);
    log(data.id ? 'edit' : 'create', 'reminder', data.title, data.clientName, reminderWhen(data));
    closeModal();
    requestPermission();
    // A reminder that is already due pops up right away, not on the next tick.
    if (reminders) reminders.check();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (isAccountMenuOpen()) closeAccountMenu();
      else if (isSettingsOpen()) closeSettings();
      else if (isClearCalendarOpen()) closeClearCalendar();
      else if (isModalOpen()) closeModal();
      else if (isPanelOpen()) closePanel();
      return;
    }
    if (isModalOpen() || isSettingsOpen() || isClearCalendarOpen()) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else if (key === 't') goToToday();
    else if (key === 'h' || key === 'b') setView('dashboard'); // B: the board, on Home
    else if (key === 'c') setView(state.calendarView);
    else if (key === 'd') setView('day');
    else if (key === 'w') setView('week');
    else if (key === 'm') setView('month');
    else if (key === 'l') setView('history');
    else if (views.byKey(key)) setView(views.byKey(key).id);
  });

  // Local mode: another tab saved, so pick up its changes. (In cloud mode the
  // Firestore snapshots keep every tab and device in sync instead.)
  if (mode === 'local') {
    window.addEventListener('storage', e => {
      if (e.key === STORAGE_KEY || e.key === null) receive(loadEvents());
      records.reloadKey(e.key);
      store.reloadKey(e.key);
    });
  }

  // Keep "5 min ago" in the History view current.
  setInterval(() => { if (state.view === 'history') render(); }, 60000);

  // Timers are throttled in background tabs; check as soon as we're back.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && reminders) reminders.check();
  });
}

function startReminders() {
  reminders = startReminderLoop({
    getEvents: () => state.events,
    markNotified: id => commit(updateEvent(state.events, id, { notified: true })),
    onBanner: (evt, title, body) => showBanner(title, body, () => openReminder(evt.id)),
    onOpen: openReminder
  });
}

function readFlag(key) {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    return null;
  }
}

/** First sign-in: move this browser's local reminders up, once, if the cloud is empty. */
async function migrateLocal(target, uid) {
  if (readFlag(MIGRATED_KEY)) return;
  const local = loadEvents();
  if (!local.length) return;
  let cloud;
  try {
    cloud = await target.fetchServer();
  } catch (err) {
    return; // offline: try again on the next sign-in
  }
  if (backend !== target) return; // signed out meanwhile
  const upload = planMigration(local, cloud, false);
  if (upload.length) {
    await target.write([], upload);
    showBanner(`Moved ${upload.length} reminder${upload.length === 1 ? '' : 's'} to the cloud`, '');
  }
  try {
    localStorage.setItem(MIGRATED_KEY, uid);
  } catch (err) {
    // the cloud now has data, so planMigration would skip it anyway
  }
}

function signInError(err) {
  if (location.protocol === 'file:') {
    return 'Sign-in does not work from a file opened from disk. Use the live site or npm start.';
  }
  return err && err.message ? err.message : String(err);
}

function startCloud() {
  const fb = connectFirebase(firebaseSdk, FIREBASE_CONFIG);
  cloudDb = fb.db;
  let unsubscribe = null;

  const signIn = e => withBusy(e.currentTarget, () => fb.signIn())
    .catch(err => showBanner('Sign-in failed', signInError(err)));
  document.querySelector('#sign-in').addEventListener('click', signIn);
  document.querySelector('#prompt-sign-in').addEventListener('click', signIn);
  document.querySelector('#sign-out').addEventListener('click', e => withBusy(e.currentTarget, () => fb.signOut()));

  renderAuth('loading');
  fb.auth.onAuthStateChanged(user => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;

    currentUser = user || null;

    if (!user) {
      backend = null;
      records.disconnect();
      store.detach();
      hooks.emit('auth', { user: null });
      renderAuth('signed-out');
      receive([]);
      return;
    }

    const target = cloudBackend(fb.db, user.uid);
    backend = target;
    records.connect({ db: fb.db, uid: user.uid });
    store.attach(name => listBackend(name, { db: fb.db, uid: user.uid }));
    hooks.emit('auth', { user });
    state.loading = true; // until this account's first snapshot
    renderAuth('signed-in', user);
    unsubscribe = target.subscribe(
      events => { if (backend === target) receive(events); },
      err => showBanner('Could not load your reminders', err && err.message ? err.message : String(err))
    );
    migrateLocal(target, user.uid).catch(err => showBanner('Could not move local reminders', err.message));
  });
}

/** What a feature module gets: the shared state, data, hooks and page registry. */
const app = {
  mode,
  config: APP_CONFIG,
  hooks,
  store,
  get state() { return state; },
  get user() { return currentUser; },
  /** Firestore once cloud mode has started; null in local mode. */
  db: () => cloudDb,
  /** Saves reach a backend: local mode, or signed in. */
  canSave: () => mode === 'local' || Boolean(currentUser),
  /** Business settings (settings/app) over the .env Worker URL over the defaults. */
  settings: () => readSettings(store.all('settings'), APP_CONFIG),
  clients: () => buildClients(state.events),
  home: {
    /** Add a part to Home: bind(app, section) once, render(app, section) with Home. */
    add(part) {
      part.section = document.querySelector('#home-board');
      part.bind(app, part.section);
      homeParts.push(part);
      return part;
    }
  },
  views: {
    /** Add a page with a nav button; see js/views/registry.js for the fields. */
    register(view) {
      views.register(view);
      view.section = mountView(view, setView);
      if (view.bind) view.bind(app, view.section);
      return view;
    }
  },
  render,
  setView,
  openReminder,
  commitEvents: events => commit(events),
  /** A client's status, as the Home table's Status menu sets it (logged, hooks told). */
  setClientStatus: (name, status) => handlers.onClientStatus(name, status),
  /** Client page → Minutes, with the client filled in. */
  openMinutes(clientName) {
    prefillMinutes(clientName);
    setView('minutes');
  },
  log,
  notify: (title, body = '') => showBanner(title, body)
};

// The splash stays at least this long, so a fast load does not just flash it.
const SPLASH_MIN_MS = 600;

/** The first view is drawn: fade the splash out and remove it. */
function hideSplash() {
  const splash = document.querySelector('#app-loading');
  if (!splash) return;
  // The app is usable at once; the splash only finishes its short show on top.
  splash.classList.add('is-done');
  const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
  setTimeout(() => {
    splash.classList.add('is-leaving');
    // transitionend does not fire with reduced motion (no transition): a timer too.
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    setTimeout(() => splash.remove(), 400);
  }, wait);
}

/** Each feature on its own: one that throws is reported and the rest still load. */
function registerFeatures() {
  for (const register of FEATURES) {
    try {
      register(app);
    } catch (err) {
      console.error('feature failed to load', err);
      showBanner('A feature failed to load', err && err.message ? err.message : String(err));
    }
  }
}

initTheme();
document.querySelector('#copyright-year').textContent = String(new Date().getFullYear());
bind();
registerFeatures();
if (!isKnownView(state.view)) state.view = 'dashboard';
if (mode === 'cloud') startCloud();
else {
  renderAuth('local');
  records.connect();
  store.attach(name => listBackend(name));
  hooks.emit('auth', { user: null });
}
started = true;
render();
hideSplash();
startReminders();
requestPermission();

// Config filled in but the SDK didn't load (offline, blocked): say so, since
// anything added now stays in this browser only.
if (mode === 'local' && !forceLocal && isConfigured(FIREBASE_CONFIG)) {
  showBanner('Working offline', 'Could not reach Firebase, so changes are saved in this browser only. Reload when you are back online.');
}
