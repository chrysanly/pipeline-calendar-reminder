import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  localStamp, clientTimeline, filterTimeline, timelineCounts, addNote, removeNote, NOTE_LIMIT,
  parseDue, validateTask, taskRecord, taskState, clientTasks, newActionItems, pickableClients
} from '../js/timeline.js';

// Local times, so the stamps read the same in any time zone.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const NOW = new Date(2026, 8, 28, 12, 0);

const EVENTS = [
  { id: 'e1', title: 'Renewal call', clientName: 'Acme Ltd.', date: '2026-10-05', time: '14:30', notes: 'Bring the deck' },
  { id: 'e2', title: 'Intro', clientName: ' acme  ltd. ', date: '2026-09-01', time: '' },
  { id: 'e3', title: 'Other client', clientName: 'Falcon', date: '2026-09-20', time: '10:00' }
];
const MEETINGS = [
  { id: 'm1', clientName: 'Acme Ltd.', title: 'Kickoff', date: '2026-09-20', summary: 'Agreed scope.', createdAt: at(2026, 9, 20, 16, 5),
    actionItems: [{ task: 'Send proposal', owner: 'Anna', due: '2026-09-30' }, { task: 'Book workshop', owner: '', due: 'next week' }] },
  { id: 'm2', clientName: 'Falcon', title: 'Other', date: '2026-09-21', summary: '' }
];
const HISTORY = [
  { id: 'h1', at: at(2026, 9, 22, 9, 0), action: 'status', kind: 'client', client: 'Acme Ltd.', detail: 'Lead → Potential' },
  { id: 'h2', at: at(2026, 9, 22, 9, 1), action: 'create', kind: 'reminder', client: 'Acme Ltd.', detail: 'dup of the reminder' },
  { id: 'h3', at: at(2026, 9, 23, 9, 0), action: 'edit', kind: 'client', client: 'Acme Ltd.', detail: 'Deal value AED 12,500' }
];
const PROFILE = { id: 'c1', key: 'acme ltd.', name: 'Acme Ltd.', notes: [{ id: 'n1', text: 'Prefers WhatsApp', at: at(2026, 9, 25, 11, 0) }] };
const TIME = [
  { id: 't1', clientName: 'Acme Ltd.', start: at(2026, 9, 24, 9, 0), end: at(2026, 9, 24, 10, 30), minutes: 90, note: 'Wireframes' },
  { id: 't2', clientName: 'Acme Ltd.', start: at(2026, 9, 28, 11, 0), end: null }
];
const EXPENSES = [{ id: 'x1', clientName: 'Acme Ltd.', date: '2026-09-26', amount: 250, currency: 'AED', category: 'Travel', note: 'Taxi' }];

const timeline = () => clientTimeline({
  name: 'ACME LTD.', events: EVENTS, meetings: MEETINGS, history: HISTORY, profile: PROFILE, time: TIME, expenses: EXPENSES
}, NOW);

test('localStamp turns an ISO time into a local sort key', () => {
  assertEqual(localStamp(at(2026, 9, 5, 7, 3)), '2026-09-05T07:03');
  assertEqual(localStamp(''), '');
  assertEqual(localStamp('nonsense'), '');
});

test('clientTimeline merges one client\'s reminders, notes, minutes, changes, time and expenses, newest first', () => {
  const items = timeline();
  assertDeepEqual(items.map(i => i.id), [
    'reminder:e1', 'expense:x1', 'note:n1', 'time:t1', 'activity:h3', 'activity:h1', 'minutes:m1', 'reminder:e2'
  ]);
  const [renewal, expense, note, time, value, status, minutes, intro] = items;
  assertEqual(renewal.upcoming, true);
  assertEqual(intro.upcoming, false);
  assertEqual(intro.allDay, true);
  assertEqual(renewal.detail, 'Bring the deck');
  assertDeepEqual([note.date, note.time, note.detail], ['2026-09-25', '11:00', 'Prefers WhatsApp']);
  assertDeepEqual([minutes.time, minutes.detail, minutes.actionItems.length], ['16:05', 'Agreed scope.', 2]);
  assertEqual(status.detail, 'Lead → Potential');
  assertEqual(value.detail, 'Deal value AED 12,500');
  assertEqual(time.minutes, 90);
  assertDeepEqual([expense.amount, expense.currency, expense.title], [250, 'AED', 'Travel']);
});

test('clientTimeline: a running timer and other clients are left out; no name, no items', () => {
  assert(!timeline().some(i => i.id === 'time:t2'), 'running session listed');
  assertDeepEqual(clientTimeline({ name: '  ', events: EVENTS }), []);
  assertDeepEqual(clientTimeline({ name: 'Nobody' }, NOW), []);
});

test('filterTimeline and timelineCounts', () => {
  const items = timeline();
  assertDeepEqual(filterTimeline(items, 'activity').map(i => i.id), ['activity:h3', 'activity:h1']);
  assertEqual(filterTimeline(items).length, 8);
  assertDeepEqual(timelineCounts(items), { reminder: 2, note: 1, minutes: 1, activity: 2, time: 1, expense: 1 });
});

test('addNote puts a new note first; blank and long notes are refused; removeNote by id', () => {
  const notes = addNote(PROFILE.notes, '  Call after Eid  ', new Date(2026, 8, 28, 9, 0));
  assertEqual(notes.length, 2);
  assertEqual(notes[0].text, 'Call after Eid');
  assert(notes[0].id.startsWith('note_'));
  assertEqual(PROFILE.notes.length, 1, 'input untouched');
  assertDeepEqual(removeNote(notes, notes[0].id), PROFILE.notes);
  assertEqual(addNote(undefined, 'first').length, 1);
  for (const [text, re] of [['  ', /Write the note/], ['x'.repeat(NOTE_LIMIT + 1), /under 5,000/]]) {
    let message = '';
    try { addNote([], text); } catch (err) { message = err.message; }
    assert(re.test(message), message);
  }
});

test('parseDue reads ISO and day-first dates and rejects impossible ones', () => {
  assertEqual(parseDue('2026-10-03'), '2026-10-03');
  assertEqual(parseDue('3/10/2026'), '2026-10-03');
  assertEqual(parseDue('03.10.2026'), '2026-10-03');
  assertEqual(parseDue(''), '');
  for (const bad of ['31/02/2026', 'next week', '2026-13-01', '10/3']) assertEqual(parseDue(bad), null, bad);
});

test('validateTask accepts the form or one "task | owner | due" line', () => {
  assertDeepEqual(validateTask(' Send deck | Anna | 30/09/2026 '), { task: { task: 'Send deck', owner: 'Anna', due: '2026-09-30' }, error: '' });
  assertDeepEqual(validateTask({ task: 'Call back' }), { task: { task: 'Call back', owner: '', due: '' }, error: '' });
  assert(/what needs doing/.test(validateTask({ task: ' ' }).error));
  assert(/due date/.test(validateTask('Send | Anna | soon').error));
  assert(/300/.test(validateTask({ task: 'x'.repeat(301) }).error));
});

test('taskRecord, taskState and clientTasks order open tasks by due date, then done ones', () => {
  const record = taskRecord(' Acme  Ltd. ', { task: 'Send deck', owner: 'Anna', due: '2026-09-30' }, { meetingId: 'm1' });
  assertDeepEqual(record, { clientKey: 'acme ltd.', clientName: 'Acme Ltd.', task: 'Send deck', owner: 'Anna', due: '2026-09-30', done: false, meetingId: 'm1' });
  const today = '2026-09-28';
  assertEqual(taskState({ due: '2026-09-27' }, today), 'overdue');
  assertEqual(taskState({ due: today }, today), 'today');
  assertEqual(taskState({ due: '' }, today), 'open');
  assertEqual(taskState({ due: '2026-09-01', done: true }, today), 'done');

  const tasks = [
    { id: 'a', clientKey: 'acme ltd.', task: 'Undated', due: '' },
    { id: 'b', clientKey: 'acme ltd.', task: 'Later', due: '2026-10-10' },
    { id: 'c', clientKey: 'acme ltd.', task: 'Done old', due: '', done: true, updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'd', clientKey: 'acme ltd.', task: 'Soon', due: '2026-09-29' },
    { id: 'e', clientKey: 'falcon', task: 'Not mine', due: '' },
    { id: 'f', clientName: 'ACME LTD.', task: 'Done new', done: true, updatedAt: '2026-09-20T00:00:00Z' }
  ];
  assertDeepEqual(clientTasks(tasks, 'Acme Ltd.').map(t => t.id), ['d', 'b', 'a', 'f', 'c']);
});

test('newActionItems: a meeting\'s action items not yet tasks; a vague due date becomes blank', () => {
  const tasks = [{ clientKey: 'acme ltd.', task: 'send PROPOSAL' }];
  assertDeepEqual(newActionItems(MEETINGS[0], tasks), [{ task: 'Book workshop', owner: '', due: '' }]);
  assertEqual(newActionItems(MEETINGS[0], []).length, 2);
  assertDeepEqual(newActionItems({ clientName: 'X' }, []), []);
});

test('pickableClients: named clients A–Z', () => {
  assertDeepEqual(pickableClients([{ key: 'z', name: 'Zed' }, { key: '', name: '(No client)' }, { key: 'a', name: 'Acme' }]), ['Acme', 'Zed']);
});
