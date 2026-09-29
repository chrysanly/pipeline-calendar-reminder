// Minutes view: pick a client and date, paste or import a transcript, generate
// the minutes with Groq (an own key, else the CladFlo Worker), edit them, then
// save (minutes only, never the transcript). Saved minutes are listed per client with Copy and Delete.

import { formatDayLabel, toDateKey } from './calendar.js';
import { clientKey } from './storage.js';
import { parseTranscript, MAX_TRANSCRIPT_BYTES } from './transcript.js';
import { loadGroqKey, loadGroqModel, minutesSource, minutesChat } from './groq.js';
import { workerAuth } from './ai.js';
import {
  generateMinutes, normalizeMeeting, minutesToText, actionItemsToLines, linesToActionItems
} from './minutes.js';
import { $, el, withIcon, showView, setBusy } from './ui.js';
import { createCombobox } from './select.js';
import { createDatePicker } from './datepicker.js';

// The minutes being edited: a fresh draft, or a saved one (with its id).
let draft = null;
let busy = false;
// Known client names for the searchable client field, set on every render.
let minutesClientNames = [];

function setProgress(message, isError = false) {
  const node = $('#minutes-progress');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

function needsKey(show) {
  $('#minutes-open-settings').hidden = !show;
}

const splitList = value => value.split(/\n|,/).map(item => item.trim()).filter(Boolean);

function fillEditor(minutes) {
  const form = $('#minutes-edit');
  form.elements.title.value = minutes.title;
  form.elements.date.value = minutes.date;
  form.elements.attendees.value = minutes.attendees.join(', ');
  form.elements.summary.value = minutes.summary;
  form.elements.decisions.value = minutes.decisions.join('\n');
  form.elements.actionItems.value = actionItemsToLines(minutes.actionItems);
  $('#minutes-editor').hidden = false;
}

/** The editor's minutes as a meeting record, ready to save. */
function readEditor() {
  const form = $('#minutes-edit');
  const now = new Date().toISOString();
  return normalizeMeeting({
    ...draft,
    clientName: $('#minutes-client').value.trim(),
    title: form.elements.title.value,
    date: form.elements.date.value,
    attendees: splitList(form.elements.attendees.value),
    summary: form.elements.summary.value,
    decisions: form.elements.decisions.value.split('\n'),
    actionItems: linesToActionItems(form.elements.actionItems.value),
    createdAt: draft.createdAt || now,
    updatedAt: now
  });
}

function closeEditor() {
  draft = null;
  $('#minutes-editor').hidden = true;
}

async function copyText(value, handlers) {
  try {
    await navigator.clipboard.writeText(value);
    handlers.onNotice('Minutes copied', 'Paste them into an email, chat or your CRM.');
  } catch (err) {
    handlers.onNotice('Could not copy', 'Your browser blocked the clipboard. Select the text and copy it by hand.');
  }
}

async function generate(handlers) {
  if (busy) return;
  const key = loadGroqKey();
  const { workerUrl, user } = handlers.minutesWorker();
  if (!minutesSource({ key, workerUrl })) {
    setProgress('The AI is not connected: the CladFlo Worker URL is missing. Add it in Settings → Business.', true);
    needsKey(true);
    return;
  }
  needsKey(false);
  const transcript = $('#minutes-transcript').value.trim();
  if (!transcript) {
    setProgress('Paste or import a transcript first.', true);
    return;
  }
  const client = $('#minutes-client').value.trim();
  const date = $('#minutes-date').value;
  const model = loadGroqModel();
  busy = true;
  setBusy($('#minutes-generate'), true);
  try {
    const auth = key ? {} : await workerAuth(user);
    const minutes = await generateMinutes({
      transcript,
      client,
      date,
      onProgress: message => setProgress(message),
      chat: minutesChat({ key, workerUrl, auth, model })
    });
    draft = { ...minutes, clientName: client, model };
    fillEditor(minutes);
    setProgress('Done. Check the minutes, edit anything, then save.');
  } catch (err) {
    setProgress(err.message, true);
    // The Worker refused (not signed in, or not on its list): its message says why.
    needsKey(false);
  } finally {
    busy = false;
    setBusy($('#minutes-generate'), false);
  }
}

async function importTranscript(file) {
  if (file.size > MAX_TRANSCRIPT_BYTES) throw new Error(`"${file.name}" is over 2 MB.`);
  const parsed = parseTranscript(file.name, await file.text());
  $('#minutes-transcript').value = parsed.text;
  const speakers = parsed.speakers.length ? `, speakers: ${parsed.speakers.join(', ')}` : '';
  $('#minutes-file-info').textContent = `${file.name}: ${parsed.words} words${speakers}.`;
}

function savedItem(meeting, handlers) {
  const item = el('article', 'saved-item');
  item.dataset.id = meeting.id;
  const head = el('div', 'saved-head');
  head.appendChild(el('h4', 'saved-title', meeting.title));
  if (meeting.date) head.appendChild(withIcon(el('span', 'saved-date'), 'fa-calendar-day', formatDayLabel(meeting.date)));
  item.appendChild(head);
  if (meeting.summary) item.appendChild(el('p', 'saved-summary', meeting.summary));

  const details = el('details', 'saved-details');
  details.append(el('summary', '', 'Show minutes'), el('pre', 'saved-text', minutesToText(meeting)));
  item.appendChild(details);

  const actions = el('div', 'saved-actions');
  const button = (className, iconName, label, onClick) => {
    const node = withIcon(el('button', `ghost ${className}`), iconName, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    actions.appendChild(node);
  };
  button('saved-copy', 'fa-copy', 'Copy', () => copyText(minutesToText(meeting), handlers));
  button('saved-edit', 'fa-pen', 'Edit', () => {
    draft = meeting;
    $('#minutes-client').value = meeting.clientName;
    fillEditor(meeting);
    $('#minutes-edit').elements.title.focus();
  });
  button('saved-delete danger-text', 'fa-trash', 'Delete', () => {
    if (!confirm(`Delete the minutes "${meeting.title}"?`)) return;
    if (draft && draft.id === meeting.id) closeEditor();
    handlers.onDeleteMinutes(meeting);
  });
  item.appendChild(actions);
  return item;
}

/** Saved minutes, one group per client (A–Z, "No client" last), newest first. */
function renderSaved(meetings, handlers) {
  const host = $('#saved-minutes');
  host.innerHTML = '';
  $('#saved-count').textContent = `(${meetings.length})`;
  if (!meetings.length) {
    host.appendChild(el('p', 'empty', 'No saved minutes yet.'));
    return;
  }
  const groups = new Map();
  for (const meeting of meetings) {
    const key = clientKey(meeting.clientName);
    if (!groups.has(key)) groups.set(key, { name: meeting.clientName || 'No client', list: [] });
    groups.get(key).list.push(meeting);
  }
  const ordered = [...groups.entries()].sort(([a, x], [b, y]) => (!a) - (!b) || x.name.localeCompare(y.name));
  for (const [, group] of ordered) {
    const section = el('section', 'saved-group');
    section.dataset.client = group.name;
    section.appendChild(withIcon(el('h3', 'saved-client'), 'fa-user', `${group.name} (${group.list.length})`));
    for (const meeting of group.list) section.appendChild(savedItem(meeting, handlers));
    host.appendChild(section);
  }
}

// The client whose profile opened Minutes: "Back" returns there.
let minutesFrom = '';

/** From the Client page: new minutes for this client, dated today. */
export function prefillMinutes(clientName) {
  minutesFrom = clientName;
  $('#minutes-back-label').textContent = `Back to ${clientName}`;
  $('#minutes-client').value = clientName;
  $('#minutes-date').value = toDateKey(new Date());
  setProgress(`New minutes for ${clientName}: paste or import the transcript, then generate.`);
  requestAnimationFrame(() => $('#minutes-transcript').focus());
}

/** state.meetings: newest first; state.events give the client suggestions. */
export function renderMinutes(state, handlers) {
  showView('minutes');
  const names = new Map();
  for (const evt of state.events) if (clientKey(evt.clientName)) names.set(clientKey(evt.clientName), evt.clientName);
  minutesClientNames = [...names.values()].sort((a, b) => a.localeCompare(b));
  if (!$('#minutes-date').value) $('#minutes-date').value = toDateKey(new Date());
  renderSaved(state.meetings, handlers);
}

/**
 * handlers: onSaveMinutes(meeting, isNew), onDeleteMinutes(meeting),
 * onOpenSettings(), onNotice(title, body), minutesWorker() → {workerUrl, user}, onBackToClient(name).
 */
export function bindMinutes(handlers) {
  createDatePicker($('#minutes-date'), { label: 'Choose the meeting date' });
  $('#minutes-back').addEventListener('click', () => {
    const name = minutesFrom || $('#minutes-client').value.trim();
    if (name) handlers.onBackToClient(name);
  });
  // Type to search the clients; a new name can still be typed.
  createCombobox($('#minutes-client'), {
    getOptions: () => minutesClientNames.map(name => ({ value: name, label: name })),
    emptyText: 'A new client'
  });
  $('#minutes-form').addEventListener('submit', e => {
    e.preventDefault();
    generate(handlers);
  });
  const fileInput = $('#minutes-file');
  $('#minutes-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const [file] = fileInput.files;
    fileInput.value = '';
    if (!file) return;
    try {
      await importTranscript(file);
      setProgress('');
    } catch (err) {
      $('#minutes-file-info').textContent = '';
      setProgress(err.message, true);
    }
  });
  $('#minutes-open-settings').addEventListener('click', () => handlers.onOpenSettings());
  $('#minutes-edit').addEventListener('submit', e => {
    e.preventDefault();
    if (!draft) return;
    const meeting = readEditor();
    const isNew = !draft.id;
    handlers.onSaveMinutes(meeting, isNew);
    closeEditor();
    if (isNew) {
      $('#minutes-transcript').value = '';
      $('#minutes-file-info').textContent = '';
    }
    setProgress(isNew ? 'Minutes saved.' : 'Changes saved.');
  });
  $('#minutes-copy').addEventListener('click', () => {
    if (draft) copyText(minutesToText(readEditor()), handlers);
  });
  $('#minutes-discard').addEventListener('click', () => {
    closeEditor();
    setProgress('');
  });
}
