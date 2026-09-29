// Excel import from Home and Re-import from History: the progress toast, the
// merge, the kept file (js/file-store.js) and the History entry.

import { formatDayLabel } from './calendar.js';
import { importWorkbook, mergeImported, mergeImportedAsync, importSummary, locationsFromPhoneCount } from './importer.js';
import { createFileStore } from './file-store.js';
import { loadXlsx } from './xlsx-loader.js';
import { showBanner, showProgress } from './banner.js';

/**
 * state: the app state (events, selectedKey); commit(events) saves;
 * log(action, kind, title, client, detail, fileId) writes History;
 * afterImport() runs once the reminders are saved.
 */
export function createImportFlow({ state, commit, log, afterImport = () => {}, files = createFileStore() }) {
  /** Keep the file for Re-import; '' when it can't be kept (too big, no IndexedDB). */
  async function keepFile(file, data) {
    try {
      return await files.save(file, data);
    } catch (err) {
      return '';
    }
  }

  /** Import an Excel file; `fileId` is set when History re-imports a kept file. */
  async function importFile(file, { fileId = '' } = {}) {
    try {
      showProgress('Importing…', file.name);
      const reader = await loadXlsx();
      const data = await file.arrayBuffer();
      const result = importWorkbook(reader, data, {
        selectedKey: state.selectedKey,
        now: new Date()
      });
      if (!result.events.length) throw new Error(`No rows with a company name in "${result.sheetName}".`);

      // A normal upload adds duplicates; Re-import from History updates them.
      const isReimport = Boolean(fileId);
      const before = state.events;
      let merged = await mergeImportedAsync(before, result.events, {
        reimport: isReimport,
        onProgress: (done, total) => showProgress(`Importing ${done}/${total}`, file.name)
      });
      // Something else saved meanwhile (a popup marked done, another tab): merge into that.
      if (state.events !== before) merged = mergeImported(state.events, result.events, { reimport: isReimport });
      const summary = importSummary(result, formatDayLabel(state.selectedKey), merged);
      commit(merged.events);
      const keptId = fileId || await keepFile(file, data);
      log('import', 'reminder', file.name, '', fileId ? `Re-import · ${summary}` : summary, keptId);
      const located = locationsFromPhoneCount(result.events);
      // Imports are raw data: Home only until a client is put on the calendar.
      const notes = ['They are on Home, not the calendar: open a client and pick Add to calendar.'];
      if (located) notes.push(`${located} location${located === 1 ? '' : 's'} detected from phone numbers.`);
      if (!keptId) notes.push('The file was not kept, so History cannot re-import it.');
      showBanner(summary, notes.concat(result.warnings).join(' '));
      afterImport();
    } catch (err) {
      showBanner('Import failed', err.message);
    }
  }

  /** A History import entry: import its kept file again. */
  async function reimport(entry) {
    let stored = null;
    try {
      stored = await files.load(entry.fileId);
    } catch (err) {
      // reported below, like a file that is gone
    }
    if (!stored) {
      showBanner('Cannot re-import', `"${entry.title}" is no longer kept in this browser. Import it again from Home.`);
      return;
    }
    await importFile(new File([stored.data], stored.name, { type: stored.type }), { fileId: stored.id });
  }

  return { importFile, reimport };
}
