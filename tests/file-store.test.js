import { test, assert, assertEqual, assertDeepEqual } from './runner.js';
import {
  FILE_LIMIT, MAX_FILE_BYTES, fileRecord, staleFileIds, memoryFileBackend, idbFileBackend, createFileStore
} from '../js/file-store.js';

const NOW = new Date('2026-09-29T08:00:00.000Z');
const bytes = n => new Uint8Array(n).buffer;
const file = { name: 'leads.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

test('fileRecord keeps the name, type, size, time and bytes under a new file id', () => {
  const data = bytes(12);
  const record = fileRecord(file, data, NOW);
  assert(/^file_/.test(record.id), record.id);
  assertDeepEqual({ ...record, id: 'x', data: null },
    { id: 'x', name: 'leads.xlsx', type: file.type, size: 12, savedAt: NOW.toISOString(), data: null });
  assertEqual(record.data, data);
  assertEqual(fileRecord({}, data, NOW).name, 'import.xlsx');
});

test('staleFileIds lists the files past the newest `limit`', () => {
  const at = day => ({ id: `f${day}`, savedAt: `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z` });
  assertDeepEqual(staleFileIds([at(3), at(1), at(4), at(2)], 2), ['f2', 'f1']);
  assertDeepEqual(staleFileIds([at(1)], 2), []);
  assertEqual(FILE_LIMIT, 20);
  assertEqual(MAX_FILE_BYTES, 10 * 1024 * 1024);
});

const pending = [];
const later = (name, fn) => pending.push(fn().then(() => test(name, () => {}), err => test(name, () => { throw err; })));

later('createFileStore saves and loads a file, and a missing id loads as null', async () => {
  const files = createFileStore(memoryFileBackend());
  const id = await files.save(file, bytes(5), NOW);
  const loaded = await files.load(id);
  assertEqual(loaded.name, 'leads.xlsx');
  assertEqual(loaded.data.byteLength, 5);
  assertEqual(await files.load('file_gone'), null);
  assertEqual(await files.load(''), null);
});

later('createFileStore keeps only the newest files and refuses files over the size limit', async () => {
  const backend = memoryFileBackend();
  const files = createFileStore(backend, { limit: 2, maxBytes: 8 });
  const ids = [];
  for (let day = 1; day <= 3; day++) ids.push(await files.save(file, bytes(4), new Date(`2026-09-0${day}T00:00:00.000Z`)));
  assertDeepEqual((await backend.list()).map(r => r.id).sort(), ids.slice(1).sort());
  assertEqual(await files.save(file, bytes(9), NOW), '', 'too big: not kept');
  assertEqual((await backend.list()).length, 2);
});

later('without IndexedDB the file store says so instead of failing silently', async () => {
  let message = '';
  try { await idbFileBackend(null).list(); } catch (err) { message = err.message; }
  assertEqual(message, 'This browser cannot keep files (no IndexedDB).');
});

export const fileStoreTestsDone = Promise.all(pending);
