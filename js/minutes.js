// Meeting minutes from a transcript, in two steps: each part of the transcript
// becomes short notes, then the notes are merged into one set of minutes (JSON).
// Pure: the chat call is passed in, so tests never reach Groq.

import { chunkText, CHUNK_CHARS } from './groq.js';
import { recordId } from './records.js';

const minuteText = value => (value === null || value === undefined ? '' : String(value).trim());

const MINUTES_SHAPE = '{"title": string, "date": "YYYY-MM-DD", "attendees": [string], "summary": string, ' +
  '"decisions": [string], "actionItems": [{"task": string, "owner": string, "due": string}]}';

function meetingContext({ client, date }) {
  return [client ? `Client: ${client}` : '', date ? `Meeting date: ${date}` : ''].filter(Boolean).join('\n');
}

/** Step 1: one part of the transcript → notes. */
export function notesPrompt(part, index, total, context = {}) {
  return [
    {
      role: 'system',
      content: 'You take notes from part of a business meeting transcript. Write concise bullet points: ' +
        'who spoke, what was discussed, every decision, and every action item with its owner and due date ' +
        'when stated. Keep names, numbers and dates exactly as said. Do not invent anything.'
    },
    {
      role: 'user',
      content: `${meetingContext(context)}\nTranscript part ${index + 1} of ${total}:\n\n${part}`.trim()
    }
  ];
}

/** Step 2: the notes (or a short transcript) → minutes as JSON. */
export function mergePrompt(material, context = {}, fromNotes = true) {
  return [
    {
      role: 'system',
      content: 'You write meeting minutes for a business development team. Reply with one JSON object only, ' +
        `shaped exactly like ${MINUTES_SHAPE}. Use "" when the owner or due date is unknown. ` +
        'Keep the summary to 3–6 sentences. Do not invent attendees, decisions or tasks.'
    },
    {
      role: 'user',
      content: `${meetingContext(context)}\n${fromNotes ? 'Notes from each part of the meeting' : 'Transcript'}:\n\n${material}`.trim()
    }
  ];
}

/** Strip code fences, keep the outermost {...}, drop trailing commas. */
function repairJson(raw) {
  const unfenced = String(raw || '').replace(/```(?:json)?/gi, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return unfenced.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1');
}

/**
 * The model's reply as an object. Accepts code fences, text around the JSON
 * and trailing commas.
 * @throws when there is no JSON object to be found
 */
export function parseMinutesJson(raw) {
  for (const candidate of [raw, repairJson(raw)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (err) {
      // try the repaired text next
    }
  }
  throw new Error('The AI reply was not valid minutes. Try Generate again.');
}

const stringList = value => {
  const list = Array.isArray(value) ? value : minuteText(value) ? minuteText(value).split(/\n|;/) : [];
  return list.map(item => minuteText(typeof item === 'object' && item ? item.text || item.name || '' : item)).filter(Boolean);
};

function actionItem(item) {
  if (typeof item === 'string') return { task: minuteText(item), owner: '', due: '' };
  const data = item || {};
  return {
    task: minuteText(data.task || data.action || data.item),
    owner: minuteText(data.owner || data.assignee || data.who),
    due: minuteText(data.due || data.dueDate || data.deadline)
  };
}

const isDateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Any object → the minutes shape, with the meeting's client and date as fallbacks. */
export function normalizeMinutes(data, context = {}) {
  const source = data || {};
  const date = minuteText(source.date);
  return {
    title: minuteText(source.title) || (context.client ? `Meeting with ${context.client}` : 'Meeting minutes'),
    date: isDateKey(date) ? date : minuteText(context.date),
    attendees: stringList(source.attendees),
    summary: minuteText(source.summary),
    decisions: stringList(source.decisions),
    actionItems: (Array.isArray(source.actionItems) ? source.actionItems : []).map(actionItem).filter(a => a.task)
  };
}

/** A saved meeting: the minutes plus who and when. Never the transcript. */
export function normalizeMeeting(data) {
  const clientName = minuteText(data.clientName);
  return {
    id: data.id || recordId('mtg'),
    clientName,
    ...normalizeMinutes(data, { client: clientName, date: data.date }),
    model: minuteText(data.model),
    createdAt: minuteText(data.createdAt),
    updatedAt: minuteText(data.updatedAt)
  };
}

/** Plain text for Copy (email, chat, CRM notes). */
export function minutesToText(minutes, client = minutes.clientName) {
  const lines = [minutes.title];
  const meta = [client ? `Client: ${client}` : '', minutes.date ? `Date: ${minutes.date}` : ''].filter(Boolean);
  if (meta.length) lines.push(meta.join(' · '));
  if (minutes.attendees.length) lines.push(`Attendees: ${minutes.attendees.join(', ')}`);
  if (minutes.summary) lines.push('', 'Summary', minutes.summary);
  if (minutes.decisions.length) lines.push('', 'Decisions', ...minutes.decisions.map(d => `- ${d}`));
  if (minutes.actionItems.length) {
    lines.push('', 'Action items', ...minutes.actionItems.map(a =>
      `- ${a.task}${a.owner ? ` (${a.owner})` : ''}${a.due ? `, due ${a.due}` : ''}`));
  }
  return lines.join('\n');
}

/** "task | owner | due", one action item per line, for the edit box. */
export function actionItemsToLines(items) {
  return items.map(a => [a.task, a.owner, a.due].join(' | ').replace(/( \| )+$/, '')).join('\n');
}

export function linesToActionItems(value) {
  return minuteText(value).split('\n').map(line => {
    const [task = '', owner = '', due = ''] = line.split('|').map(part => part.trim());
    return { task, owner, due };
  }).filter(a => a.task);
}

/**
 * Transcript → minutes.
 * chat(messages, {json}) returns the reply text; onProgress(message) reports each step.
 * One part goes straight to the minutes; longer transcripts are noted part by part first.
 */
export async function generateMinutes({ transcript, client = '', date = '', chat, onProgress = () => {}, maxChars = CHUNK_CHARS }) {
  const parts = chunkText(transcript, maxChars);
  if (!parts.length) throw new Error('Paste or import a transcript first.');
  const context = { client, date };

  let material = parts[0];
  if (parts.length > 1) {
    const notes = [];
    for (let i = 0; i < parts.length; i++) {
      onProgress(`Part ${i + 1} of ${parts.length}…`);
      notes.push(await chat(notesPrompt(parts[i], i, parts.length, context), { json: false }));
    }
    material = notes.map((note, i) => `Part ${i + 1}:\n${note}`).join('\n\n');
  }
  onProgress('Writing the minutes…');
  const reply = await chat(mergePrompt(material, context, parts.length > 1), { json: true });
  return normalizeMinutes(parseMinutesJson(reply), context);
}
