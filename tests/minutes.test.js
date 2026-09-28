import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  notesPrompt, mergePrompt, parseMinutesJson, normalizeMinutes, normalizeMeeting, minutesToText,
  actionItemsToLines, linesToActionItems, generateMinutes
} from '../js/minutes.js';

const MINUTES = {
  title: 'Renewal kickoff',
  date: '2026-09-28',
  attendees: ['Anna', 'Omar'],
  summary: 'Agreed the renewal.',
  decisions: ['Renew for 12 months'],
  actionItems: [{ task: 'Send contract', owner: 'Anna', due: '2026-10-01' }]
};

test('notesPrompt names the part, the client and the date', () => {
  const [system, user] = notesPrompt('Anna: hi', 1, 3, { client: 'Acme', date: '2026-09-28' });
  assertEqual(system.role, 'system');
  assert(/notes/i.test(system.content), system.content);
  assert(user.content.includes('Transcript part 2 of 3') && user.content.includes('Anna: hi'), user.content);
  assert(user.content.includes('Client: Acme') && user.content.includes('2026-09-28'), user.content);
});

test('mergePrompt asks for one JSON object in the minutes shape', () => {
  const [system, user] = mergePrompt('Part 1: notes', { client: 'Acme' });
  for (const field of ['title', 'date', 'attendees', 'summary', 'decisions', 'actionItems', 'task', 'owner', 'due']) {
    assert(system.content.includes(`"${field}"`), `prompt mentions ${field}`);
  }
  assert(/JSON/.test(system.content));
  assert(user.content.includes('Notes from each part') && user.content.includes('Part 1: notes'));
  assert(mergePrompt('Anna: hi', {}, false)[1].content.includes('Transcript:'));
});

test('parseMinutesJson reads clean JSON, code fences, surrounding text and trailing commas', () => {
  assertEqual(parseMinutesJson(JSON.stringify(MINUTES)).title, 'Renewal kickoff');
  assertEqual(parseMinutesJson('```json\n{"title": "A"}\n```').title, 'A');
  assertEqual(parseMinutesJson('Here you go: {"title": "B", "decisions": ["x",],} Hope it helps').title, 'B');
  for (const bad of ['', 'no json here', '[1, 2]', '{broken']) {
    let message = '';
    try { parseMinutesJson(bad); } catch (err) { message = err.message; }
    assert(/not valid minutes/.test(message), `"${bad}" → ${message}`);
  }
});

test('normalizeMinutes repairs missing or oddly shaped fields', () => {
  const minutes = normalizeMinutes({
    attendees: 'Anna; Omar',
    decisions: [' Renew ', '', { text: 'Discount 5%' }],
    actionItems: ['Call back', { action: 'Send deck', assignee: 'Omar', deadline: 'Friday' }, { owner: 'nobody' }],
    date: 'next week'
  }, { client: 'Acme', date: '2026-09-28' });
  assertEqual(minutes.title, 'Meeting with Acme');
  assertEqual(minutes.date, '2026-09-28', 'a non-date falls back to the meeting date');
  assertDeepEqual(minutes.attendees, ['Anna', 'Omar']);
  assertDeepEqual(minutes.decisions, ['Renew', 'Discount 5%']);
  assertDeepEqual(minutes.actionItems, [
    { task: 'Call back', owner: '', due: '' },
    { task: 'Send deck', owner: 'Omar', due: 'Friday' }
  ]);
  assertEqual(normalizeMinutes(null).title, 'Meeting minutes');
});

test('normalizeMeeting keeps the minutes and who/when, never the transcript', () => {
  const meeting = normalizeMeeting({ ...MINUTES, clientName: ' Acme ', transcript: 'secret words', createdAt: 'c' });
  assert(/^mtg_/.test(meeting.id), meeting.id);
  assertEqual(meeting.clientName, 'Acme');
  assert(!('transcript' in meeting), 'no transcript');
  assertDeepEqual(Object.keys(meeting), ['id', 'clientName', 'title', 'date', 'attendees', 'summary', 'decisions', 'actionItems', 'model', 'createdAt', 'updatedAt']);
});

test('minutesToText renders every section for Copy', () => {
  const text = minutesToText(MINUTES, 'Acme');
  assertEqual(text, [
    'Renewal kickoff',
    'Client: Acme · Date: 2026-09-28',
    'Attendees: Anna, Omar',
    '', 'Summary', 'Agreed the renewal.',
    '', 'Decisions', '- Renew for 12 months',
    '', 'Action items', '- Send contract (Anna), due 2026-10-01'
  ].join('\n'));
  assertEqual(minutesToText({ ...normalizeMinutes({ title: 'Bare' }) }, ''), 'Bare');
});

test('action items round-trip through the "task | owner | due" edit box', () => {
  const items = [{ task: 'Send contract', owner: 'Anna', due: 'Fri' }, { task: 'Call', owner: '', due: '' }];
  const lines = actionItemsToLines(items);
  assertEqual(lines, 'Send contract | Anna | Fri\nCall');
  assertDeepEqual(linesToActionItems(lines), items);
  assertDeepEqual(linesToActionItems('\n | Omar\n'), []);
});

const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

later('generateMinutes: a short transcript is one JSON request', async () => {
  const calls = [];
  const progress = [];
  const minutes = await generateMinutes({
    transcript: 'Anna: We renew.',
    client: 'Acme',
    date: '2026-09-28',
    onProgress: m => progress.push(m),
    chat: async (messages, options) => { calls.push({ messages, options }); return JSON.stringify(MINUTES); }
  });
  assertEqual(calls.length, 1);
  assertEqual(calls[0].options.json, true);
  assert(calls[0].messages[1].content.includes('Anna: We renew.'));
  assertDeepEqual(progress, ['Writing the minutes…']);
  assertEqual(minutes.title, 'Renewal kickoff');
});

later('generateMinutes: a 3-part transcript makes notes per part, then merges them', async () => {
  const transcript = ['Anna: part one', 'Omar: part two', 'Anna: part three'].join('\n');
  const calls = [];
  const progress = [];
  const minutes = await generateMinutes({
    transcript,
    maxChars: 16,
    onProgress: m => progress.push(m),
    chat: async (messages, options) => {
      calls.push({ messages, options });
      return options.json ? '```json\n{"title": "Merged", "actionItems": [{"task": "Follow up"}]}\n```' : `notes ${calls.length}`;
    }
  });
  assertDeepEqual(progress, ['Part 1 of 3…', 'Part 2 of 3…', 'Part 3 of 3…', 'Writing the minutes…']);
  assertEqual(calls.length, 4);
  assertDeepEqual(calls.map(c => c.options.json), [false, false, false, true]);
  assert(calls[1].messages[1].content.includes('Omar: part two'));
  const merged = calls[3].messages[1].content;
  assert(merged.includes('Part 1:\nnotes 1') && merged.includes('Part 3:\nnotes 3'), merged);
  assertEqual(minutes.title, 'Merged');
  assertDeepEqual(minutes.actionItems, [{ task: 'Follow up', owner: '', due: '' }]);
});

later('generateMinutes refuses an empty transcript', async () => {
  let message = '';
  try { await generateMinutes({ transcript: '  ', chat: async () => '{}' }); } catch (err) { message = err.message; }
  assert(/transcript first/.test(message), message);
});

export const minutesTestsDone = Promise.all(pending);
