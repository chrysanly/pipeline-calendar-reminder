// Entry point: state, wiring, reminder loop.

import { toDateKey, fromDateKey, shiftCursor, formatDayLabel, VIEWS } from './calendar.js';
import { importWorkbook, mergeImported, importSummary, locationsFromPhoneCount } from './importer.js';
import { buildClients } from './dashboard.js';
import {
  STORAGE_KEY, loadEvents, localBackend, addEvent, updateEvent, deleteEvent, findEvent,
  applyClientFields, clientKey
} from './storage.js';
import { startReminderLoop, requestPermission } from './reminders.js';
import { FIREBASE_CONFIG } from './firebase-config.js';
import {
  MIGRATED_KEY, isConfigured, selectBackend, planMigration, cloudBackend, connectFirebase
} from './cloud.js';
import { initTheme, toggleTheme } from './theme.js';
import {
  renderCalendar, renderPanel, renderAuth, isPanelOpen, swipeDirection, COMPACT_QUERY,
  openModal, closeModal, isModalOpen, readForm, showBanner, bindBanner,
  renderDashboard, bindDashboard, bindForm
} from './ui.js';

const VIEW_KEY = 'view';

function loadView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    // First visit: the Home dashboard.
    return VIEWS.includes(saved) ? saved : 'dashboard';
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

const state = {
  view: loadView(),
  cursor: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  selectedKey: toDateKey(today),
  openId: null,
  events: backend ? backend.load() : [],
  // Home filters: status card, country/city, search box.
  dash: { status: null, country: null, city: null, search: '' },
  // Cloud mode until the first snapshot (or sign-out): 'Loading…', not 'No clients'.
  loading: mode === 'cloud'
};

let reminders = null;

const handlers = {
  onSelectDay(key) {
    state.selectedKey = key;
    render();
  },
  onOpen(id) {
    openReminder(id);
  },
  onMore(key) {
    state.selectedKey = key;
    state.cursor = fromDateKey(key);
    setView('day');
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
  },
  onDashFilter(patch) {
    state.dash = { ...state.dash, ...patch };
    render();
  },
  onClientStatus(clientName, status) {
    commit(applyClientFields(state.events, clientName, { status }, new Date().toISOString()));
  },
  onOpenClient(client) {
    const ref = client.nextReminder || client.latestReminder;
    if (ref) openReminder(ref.id);
  },
  onClientLookup(name) {
    const key = clientKey(name);
    return key ? buildClients(state.events).find(c => c.key === key) || null : null;
  }
};

/** Show the change at once, then save only what changed to the backend. */
function commit(events) {
  const prev = state.events;
  state.events = events;
  render();
  if (!backend) return;
  backend.write(prev, events).catch(err => {
    showBanner('Could not save your change', err && err.message ? err.message : String(err));
  });
}

/** A new list from storage or another device. */
function receive(events) {
  state.events = events;
  state.loading = false;
  if (state.openId && !findEvent(state.events, state.openId)) state.openId = null;
  render();
  if (reminders) reminders.check();
}

function render() {
  if (state.view === 'dashboard') renderDashboard(state, handlers);
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
  render();
}

function setView(view) {
  state.view = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (err) {
    // view just won't survive a reload
  }
  render();
}

function move(delta) {
  if (state.view === 'dashboard') return; // no date range on Home
  state.cursor = shiftCursor(state.view, state.cursor, delta);
  render();
}

function goToToday() {
  const now = new Date();
  state.cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  state.selectedKey = toDateKey(now);
  render();
}

// The Excel reader is ~900 KB, so it loads on the first import instead of
// holding up every page load.
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let xlsxLoading = null;

function loadXlsx() {
  if (typeof XLSX !== 'undefined') return Promise.resolve(XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_URL;
      script.onload = () => (typeof XLSX !== 'undefined' ? resolve(XLSX) : reject(new Error('no XLSX')));
      script.onerror = () => reject(new Error('offline'));
      document.head.appendChild(script);
    }).catch(() => {
      xlsxLoading = null; // allow a retry once back online
      throw new Error('The Excel reader did not load. Check your internet connection and try again.');
    });
  }
  return xlsxLoading;
}

async function importFile(file) {
  try {
    const reader = await loadXlsx();
    const result = importWorkbook(reader, await file.arrayBuffer(), {
      selectedKey: state.selectedKey,
      now: new Date()
    });
    if (!result.events.length) throw new Error(`No rows with a company name in "${result.sheetName}".`);

    const summary = importSummary(result, formatDayLabel(state.selectedKey));
    const first = result.events[0].date;
    state.selectedKey = first;
    state.cursor = fromDateKey(first);
    commit(mergeImported(state.events, result.events).events);
    const located = locationsFromPhoneCount(result.events);
    const notes = located ? [`${located} location${located === 1 ? '' : 's'} detected from phone numbers.`] : [];
    showBanner(summary, notes.concat(result.warnings).join(' '));
    if (reminders) reminders.check();
  } catch (err) {
    showBanner('Import failed', err.message);
  }
}

/**
 * Swipe left/right on the calendar for next/previous. Touch and pen only, so
 * mouse text selection is untouched; CSS `touch-action: pan-y` leaves vertical
 * scrolling to the browser and hands horizontal moves to us.
 */
function bindSwipe(target) {
  let start = null;
  target.addEventListener('pointerdown', e => {
    start = e.pointerType === 'mouse' || !e.isPrimary ? null : { x: e.clientX, y: e.clientY };
  });
  target.addEventListener('pointercancel', () => { start = null; });
  target.addEventListener('pointerup', e => {
    if (!start) return;
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
    document.querySelector(`#view-${view}`).addEventListener('click', () => setView(view));
  }
  document.querySelector('#theme-toggle').addEventListener('click', toggleTheme);
  document.querySelector('#panel-close').addEventListener('click', closePanel);
  document.querySelector('#panel-backdrop').addEventListener('click', closePanel);
  bindSwipe(document.querySelector('.calendar'));
  // Crossing the phone breakpoint changes the month layout (chip limit, agenda).
  if (typeof matchMedia === 'function') {
    const compact = matchMedia(COMPACT_QUERY);
    if (compact.addEventListener) compact.addEventListener('change', render);
  }
  document.querySelector('#add-event').addEventListener('click', () => openModal(null, state.selectedKey));
  const fileInput = document.querySelector('#import-file');
  document.querySelector('#import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    if (file) await importFile(file);
    fileInput.value = ''; // so picking the same file again still fires `change`
  });
  document.querySelector('#modal-close').addEventListener('click', closeModal);
  document.querySelector('#modal-cancel').addEventListener('click', closeModal);
  document.querySelector('#modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  bindBanner();
  bindForm(handlers);
  bindDashboard(handlers);

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
    closeModal();
    requestPermission();
    // A reminder that is already due pops up right away, not on the next tick.
    if (reminders) reminders.check();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (isModalOpen()) closeModal();
      else if (isPanelOpen()) closePanel();
      return;
    }
    if (isModalOpen()) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else if (key === 't') goToToday();
    else if (key === 'h') setView('dashboard');
    else if (key === 'd') setView('day');
    else if (key === 'w') setView('week');
    else if (key === 'm') setView('month');
  });

  // Local mode: another tab saved, so pick up its events. (In cloud mode the
  // Firestore snapshot keeps every tab and device in sync instead.)
  if (mode === 'local') {
    window.addEventListener('storage', e => {
      if (e.key !== STORAGE_KEY && e.key !== null) return;
      receive(loadEvents());
    });
  }

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
  let unsubscribe = null;

  const signIn = () => fb.signIn().catch(err => showBanner('Sign-in failed', signInError(err)));
  document.querySelector('#sign-in').addEventListener('click', signIn);
  document.querySelector('#prompt-sign-in').addEventListener('click', signIn);
  document.querySelector('#sign-out').addEventListener('click', () => fb.signOut());

  renderAuth('loading');
  fb.auth.onAuthStateChanged(user => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;

    if (!user) {
      backend = null;
      renderAuth('signed-out');
      receive([]);
      return;
    }

    const target = cloudBackend(fb.db, user.uid);
    backend = target;
    state.loading = true; // until this account's first snapshot
    renderAuth('signed-in', user);
    unsubscribe = target.subscribe(
      events => { if (backend === target) receive(events); },
      err => showBanner('Could not load your reminders', err && err.message ? err.message : String(err))
    );
    migrateLocal(target, user.uid).catch(err => showBanner('Could not move local reminders', err.message));
  });
}

initTheme();
document.querySelector('#copyright-year').textContent = String(new Date().getFullYear());
bind();
if (mode === 'cloud') startCloud();
else renderAuth('local');
render();
startReminders();
requestPermission();

// Config filled in but the SDK didn't load (offline, blocked): say so, since
// anything added now stays in this browser only.
if (mode === 'local' && !forceLocal && isConfigured(FIREBASE_CONFIG)) {
  showBanner('Working offline', 'Could not reach Firebase, so changes are saved in this browser only. Reload when you are back online.');
}
