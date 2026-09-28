// AI panel on the Client page (fills the #client-ai mount client.js offers on
// 'client-render'): paste notes, upload audio or record with the mic
// (transcribed by the Worker), then find action items (add them as tasks) or
// draft a follow-up email. Its settings hold this browser's Worker access
// token (local mode) and the status-alert preferences (notify.js).

import {
  FOLLOWUP_TONES, loadWorkerToken, saveWorkerToken, findActionItems, draftFollowup, transcribeAudio, audioProblem,
  followupMailto, formatRecording, workerAuth
} from '../ai.js';
import { loadAlertPrefs, saveAlertPrefs } from '../notify.js';
import { validateTask, taskRecord, clientTasks } from '../timeline.js';
import { STATUSES, STATUS_LABELS } from '../storage.js';
import { $, el, icon, withBusy, loadStylesheet } from '../ui.js';

// One panel, moved into whichever mount the Client page renders.
let aiParts = null;
const aiState = { client: '', items: [], recorder: null, recordStart: 0, clockTimer: null };

function aiButton(text, className, iconName) {
  const node = el('button', className);
  node.type = 'button';
  node.append(icon(iconName), ' ', text);
  return node;
}

function aiSay(message, isError = false) {
  aiParts.status.textContent = message;
  aiParts.status.classList.toggle('is-error', isError);
}

function aiCheckbox(labelText, checked) {
  const label = el('label', 'ai-check');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  label.append(box, labelText);
  return { label, box };
}

async function workerOptions(app) {
  return { workerUrl: app.settings().workerUrl, auth: await workerAuth(app.user) };
}

/** Run a Worker call with the button busy and any error in the status line. */
async function aiRun(button, message, action) {
  aiSay(message);
  await withBusy(button, async () => {
    try {
      await action();
    } catch (err) {
      aiSay(err.message, true);
    }
  });
}

// ---------- sources: text, audio file, microphone ----------

function appendTranscript(text) {
  const box = aiParts.text;
  box.value = box.value.trim() ? `${box.value.trim()}\n\n${text}` : text;
}

async function transcribe(app, button, file) {
  const problem = audioProblem(file);
  if (problem) {
    aiSay(problem, true);
    return;
  }
  await aiRun(button, 'Transcribing… long recordings take a minute.', async () => {
    const text = await transcribeAudio(await workerOptions(app), file);
    appendTranscript(text);
    aiSay(text ? 'Transcript added below your notes.' : 'No speech found in that audio.', !text);
  });
}

function stopClock() {
  clearInterval(aiState.clockTimer);
  aiState.clockTimer = null;
  aiParts.clock.textContent = '';
}

async function toggleRecording(app) {
  const button = aiParts.record;
  if (aiState.recorder) {
    aiState.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
    aiSay('This browser cannot record audio. Upload a recording instead.', true);
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    aiSay('Microphone blocked. Allow it in the browser, or upload a recording.', true);
    return;
  }
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.addEventListener('dataavailable', e => { if (e.data && e.data.size) chunks.push(e.data); });
  recorder.addEventListener('stop', () => {
    for (const track of stream.getTracks()) track.stop();
    aiState.recorder = null;
    stopClock();
    setRecordButton(false);
    const type = recorder.mimeType || 'audio/webm';
    const file = new File(chunks, `recording.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type });
    transcribe(app, button, file);
  });
  aiState.recorder = recorder;
  aiState.recordStart = Date.now();
  recorder.start(1000);
  setRecordButton(true);
  aiSay('Recording… press Stop when the meeting ends.');
  aiParts.clock.textContent = '0:00';
  aiState.clockTimer = setInterval(() => { aiParts.clock.textContent = formatRecording(Date.now() - aiState.recordStart); }, 500);
}

function setRecordButton(recording) {
  const button = aiParts.record;
  button.innerHTML = '';
  button.append(icon(recording ? 'fa-stop' : 'fa-microphone'), ' ', recording ? 'Stop recording' : 'Record');
  button.classList.toggle('is-recording', recording);
  button.setAttribute('aria-pressed', String(recording));
}

// ---------- action items ----------

function renderItems(summary) {
  const out = aiParts.itemsOut;
  out.hidden = false;
  aiParts.summary.textContent = summary;
  aiParts.summary.hidden = !summary;
  aiParts.itemList.innerHTML = '';
  aiState.items.forEach((item, i) => {
    const meta = [item.owner, item.due].filter(Boolean).join(' · ');
    const { label, box } = aiCheckbox(item.task, true);
    box.dataset.index = String(i);
    const li = el('li', 'ai-item');
    li.appendChild(label);
    if (meta) li.appendChild(el('span', 'ai-item-meta', meta));
    aiParts.itemList.appendChild(li);
  });
  if (!aiState.items.length) aiParts.itemList.appendChild(el('li', 'list-empty', 'No clear action items in these notes.'));
  aiParts.addTasks.hidden = !aiState.items.length;
}

async function addSelectedTasks(app) {
  if (!app.canSave()) {
    aiSay('Sign in first.', true);
    return;
  }
  const known = new Set(clientTasks(app.store.all('tasks'), aiState.client).map(t => t.task.toLowerCase()));
  const picked = [...aiParts.itemList.querySelectorAll('input:checked')].map(box => aiState.items[Number(box.dataset.index)]);
  let added = 0;
  let skipped = 0;
  for (const item of picked) {
    // A vague due date ("next week") is dropped rather than refusing the task.
    let { task } = validateTask(item);
    if (!task) ({ task } = validateTask({ ...item, due: '' }));
    if (!task || known.has(task.task.toLowerCase())) {
      skipped++;
      continue;
    }
    await app.store.add('tasks', taskRecord(aiState.client, task, { source: 'ai' }));
    known.add(task.task.toLowerCase());
    added++;
  }
  aiSay(`Added ${added} task${added === 1 ? '' : 's'}${skipped ? ` (${skipped} already on the list)` : ''}.`);
}

// ---------- follow-up email ----------

function renderEmail({ subject, body }) {
  aiParts.emailOut.hidden = false;
  aiParts.subject.value = subject;
  aiParts.body.value = body;
}

async function copyEmail() {
  const text = `Subject: ${aiParts.subject.value}\n\n${aiParts.body.value}`;
  try {
    await navigator.clipboard.writeText(text);
    aiSay('Email copied.');
  } catch (err) {
    aiParts.body.select();
    aiSay('Copy blocked by the browser: the text is selected, press Ctrl+C.', true);
  }
}

// ---------- settings ----------

function buildSettings(app) {
  const details = el('details', 'ai-settings');
  details.appendChild(el('summary', '', 'AI and alert settings'));

  const tokenInput = el('input');
  tokenInput.type = 'password';
  tokenInput.autocomplete = 'off';
  tokenInput.placeholder = loadWorkerToken() ? '•••••••• saved' : 'APP_TOKEN from the Worker';
  const tokenLabel = el('label', 'client-field');
  tokenLabel.append('Worker access token (only without sign-in)', tokenInput);
  const saveToken = aiButton('Save token', 'ghost', 'fa-key');
  saveToken.addEventListener('click', () => {
    saveWorkerToken(tokenInput.value);
    tokenInput.value = '';
    tokenInput.placeholder = loadWorkerToken() ? '•••••••• saved' : 'APP_TOKEN from the Worker';
    aiSay(loadWorkerToken() ? 'Access token saved in this browser.' : 'Access token removed.');
  });

  const prefs = loadAlertPrefs();
  const browser = aiCheckbox('Browser notification', prefs.browser);
  const email = aiCheckbox('Email me (through the Worker)', prefs.email);
  const statusBoxes = STATUSES.map(status => {
    const box = aiCheckbox(STATUS_LABELS[status], prefs.statuses.includes(status));
    box.box.value = status;
    return box;
  });
  const save = () => saveAlertPrefs({
    browser: browser.box.checked,
    email: email.box.checked,
    statuses: statusBoxes.filter(b => b.box.checked).map(b => b.box.value)
  });
  for (const { box } of [browser, email, ...statusBoxes]) box.addEventListener('change', save);

  const allow = aiButton('Allow browser notifications', 'ghost', 'fa-bell');
  allow.hidden = typeof Notification === 'undefined' || Notification.permission === 'granted';
  allow.addEventListener('click', async () => {
    const answer = await Notification.requestPermission();
    allow.hidden = answer === 'granted';
    aiSay(answer === 'granted' ? 'Browser notifications are on.' : 'Notifications are blocked in this browser.', answer !== 'granted');
  });

  const alerts = el('fieldset', 'ai-alerts');
  alerts.appendChild(el('legend', '', 'Alert me when a client moves to'));
  const statusRow = el('div', 'ai-check-row');
  statusRow.append(...statusBoxes.map(b => b.label));
  alerts.append(statusRow, browser.label, email.label, allow);
  const tokenRow = el('div', 'ai-token-row');
  tokenRow.append(tokenLabel, saveToken);
  details.append(tokenRow, alerts);
  if (app.mode === 'cloud') tokenRow.hidden = true; // signed in, the Firebase token is used
  return details;
}

// ---------- building the panel (once) ----------

function buildPanel(app) {
  const panel = el('section', 'dash-card ai-panel');
  const heading = el('h3', 'dash-title');
  heading.append(icon('fa-wand-magic-sparkles'), ' AI assistant');

  const setup = el('p', 'ai-setup');
  const openSettings = aiButton('Open Settings', 'ghost', 'fa-gear');
  openSettings.addEventListener('click', () => $('#settings-btn').click());
  setup.append('Set your Worker URL in Settings → Business to use the AI. ', openSettings);

  const text = el('textarea', 'ai-text');
  text.rows = 6;
  text.placeholder = 'Paste meeting notes or a transcript, or upload / record audio.';
  const textLabel = el('label', 'client-field');
  textLabel.append('Notes or transcript', text);

  const file = el('input');
  file.type = 'file';
  file.accept = 'audio/*,video/mp4,video/webm';
  file.hidden = true;
  const upload = aiButton('Upload audio', 'ghost', 'fa-file-audio');
  const record = aiButton('Record', 'ghost ai-record', 'fa-microphone');
  record.setAttribute('aria-pressed', 'false');
  const clock = el('span', 'ai-clock');
  clock.setAttribute('aria-live', 'off');
  const sources = el('div', 'ai-row');
  sources.append(upload, file, record, clock);

  const findItems = aiButton('Find action items', 'primary', 'fa-list-check');
  const tone = el('select', 'ai-tone');
  tone.setAttribute('aria-label', 'Email tone');
  for (const name of FOLLOWUP_TONES) {
    const option = el('option', '', `${name[0].toUpperCase()}${name.slice(1)} tone`);
    option.value = name;
    tone.appendChild(option);
  }
  const followup = aiButton('Draft follow-up email', 'secondary', 'fa-envelope');
  const run = el('div', 'ai-row');
  run.append(findItems, followup, tone);

  const status = el('p', 'form-status ai-status');
  status.setAttribute('role', 'status');

  const itemsOut = el('div', 'ai-out ai-items');
  itemsOut.hidden = true;
  const summary = el('p', 'ai-summary');
  const itemList = el('ul', 'ai-item-list');
  const addTasks = aiButton('Add selected as tasks', 'primary', 'fa-plus');
  itemsOut.append(el('h4', '', 'Action items'), summary, itemList, addTasks);

  const emailOut = el('div', 'ai-out ai-email');
  emailOut.hidden = true;
  const subject = el('input', 'ai-subject');
  subject.type = 'text';
  const subjectLabel = el('label', 'client-field');
  subjectLabel.append('Subject', subject);
  const body = el('textarea', 'ai-body');
  body.rows = 8;
  const bodyLabel = el('label', 'client-field');
  bodyLabel.append('Email', body);
  const copy = aiButton('Copy', 'ghost', 'fa-copy');
  const mail = el('a', 'button-link ghost');
  mail.append(icon('fa-paper-plane'), ' Open in email');
  const emailActions = el('div', 'ai-row');
  emailActions.append(copy, mail);
  emailOut.append(el('h4', '', 'Follow-up email'), subjectLabel, bodyLabel, emailActions);

  panel.append(heading, setup, textLabel, sources, run, status, itemsOut, emailOut, buildSettings(app));
  aiParts = { panel, setup, text, file, upload, record, clock, status, itemsOut, summary, itemList, addTasks, emailOut, subject, body, tone, mail };

  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const [picked] = file.files;
    file.value = '';
    if (picked) await transcribe(app, upload, picked);
  });
  record.addEventListener('click', () => toggleRecording(app));
  findItems.addEventListener('click', () => {
    if (!text.value.trim()) return aiSay('Paste notes or a transcript first.', true);
    return aiRun(findItems, 'Finding action items…', async () => {
      const result = await findActionItems(await workerOptions(app), { text: text.value, client: aiState.client });
      aiState.items = result.actionItems;
      renderItems(result.summary);
      aiSay(`Found ${result.actionItems.length} action item${result.actionItems.length === 1 ? '' : 's'}.`);
    });
  });
  addTasks.addEventListener('click', () => withBusy(addTasks, () => addSelectedTasks(app)));
  followup.addEventListener('click', () => {
    if (!text.value.trim()) return aiSay('Paste notes or a transcript first.', true);
    return aiRun(followup, 'Drafting the email…', async () => {
      renderEmail(await draftFollowup(await workerOptions(app), {
        text: text.value, client: aiState.client, actionItems: aiState.items, tone: tone.value
      }));
      aiSay('Draft ready: check it before sending.');
    });
  });
  copy.addEventListener('click', copyEmail);
  const updateMail = () => { mail.href = followupMailto({ subject: subject.value, body: body.value }); };
  subject.addEventListener('input', updateMail);
  body.addEventListener('input', updateMail);
  emailOut.addEventListener('focusin', updateMail);
  mail.addEventListener('pointerdown', updateMail);
}

/** A different client: start clean (a recording in progress is stopped). */
function switchClient(name) {
  if (aiState.recorder) aiState.recorder.stop();
  aiState.client = name;
  aiState.items = [];
  aiParts.text.value = '';
  aiParts.itemsOut.hidden = true;
  aiParts.emailOut.hidden = true;
  aiSay('');
}

function showPanel(app, { client, mount }) {
  if (!aiParts) buildPanel(app);
  if (aiParts.panel.parentElement !== mount) mount.appendChild(aiParts.panel);
  if (aiState.client !== client.name) switchClient(client.name);
  aiParts.setup.hidden = Boolean(app.settings().workerUrl);
}

/** Feature entry point (js/features.js). */
export function registerAiPanel(app) {
  loadStylesheet('css/ai.css');
  app.hooks.on('client-render', payload => showPanel(app, payload));
}
