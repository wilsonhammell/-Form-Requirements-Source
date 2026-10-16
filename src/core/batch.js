// A batch: several PDFs opened at once, one of them on screen, so a run of
// forms can be stepped through with Prev and Next and reviewed one after
// another.
//
// Plain data, so what it does can be tested without a component, the same
// split the rest of core keeps. Each entry holds the file it came from and,
// once it has been opened, everything that makes the document what it is:
// the bytes, the undo history and the page it was left on. Leaving a form
// stores that and coming back restores it, so nothing is imported twice and
// an undo still walks back through what was done to that form and no other.
//
// Nothing is imported until a form is first shown. Opening seventy forms is
// reading seventy file handles, not seventy imports.

let nextId = 1;

// Natural order, so "Form 2" comes before "Form 10" the way a folder lists
// them.
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export function isPdfFile(file) {
  return /\.pdf$/i.test(file?.name ?? '') || file?.type === 'application/pdf';
}

export function createBatch(files) {
  const entries = [...files]
    .filter(isPdfFile)
    .sort(byName)
    .map((file) => ({ id: `b${nextId++}`, name: file.name, file, state: null, opened: null, exported: null, failed: null }));
  return { entries, index: entries.length > 0 ? 0 : -1 };
}

// Clamped rather than wrapping. Coming off the end of a run of forms and
// landing back on the first one reads as the batch having started over.
export function stepIndex(batch, delta) {
  if (!batch || batch.entries.length === 0) return -1;
  return Math.min(Math.max(batch.index + delta, 0), batch.entries.length - 1);
}

// The document as it was left: what storeState keeps and restoreState hands
// back. opened is the document as it first came in, which is how an edit is
// told apart from a form only looked at.
export function storeState(batch, index, state) {
  if (!batch || index < 0 || index >= batch.entries.length) return batch;
  const entries = batch.entries.slice();
  const entry = entries[index];
  entries[index] = {
    ...entry,
    state,
    opened: entry.opened ?? state.history.present,
    // opened this time, so whatever stopped it before no longer applies
    failed: null,
  };
  return { ...batch, entries };
}

// The document an export was taken of. A later edit makes it differ, so the
// form reads as edited again until it is exported again.
export function markExported(batch, index, present) {
  if (!batch || index < 0 || index >= batch.entries.length) return batch;
  const entries = batch.entries.slice();
  entries[index] = { ...entries[index], exported: present };
  return { ...batch, entries };
}

// A form that could not be opened. It still takes its place in the batch, so
// Prev and Next step past it rather than trying it again and again; coming
// back to it tries it again.
export function markFailed(batch, index, message) {
  if (!batch || index < 0 || index >= batch.entries.length) return batch;
  const entries = batch.entries.slice();
  entries[index] = { ...entries[index], failed: message };
  return { ...batch, index, entries };
}

export const STATUS = {
  NEW: 'new',
  OPENED: 'opened',
  EDITED: 'edited',
  EXPORTED: 'exported',
  FAILED: 'failed',
};

// present is the live document for the form on screen, whose stored state is
// out of date the moment anything is done to it. Any other form passes none
// and is read from what was stored when it was left.
export function entryStatus(entry, present = entry?.state?.history.present) {
  if (entry?.failed && !entry.state) return STATUS.FAILED;
  if (!entry || present === undefined || entry.opened === null) return STATUS.NEW;
  if (entry.exported === present) return STATUS.EXPORTED;
  return present === entry.opened ? STATUS.OPENED : STATUS.EDITED;
}

// Forms changed since they were opened, or since their last export, which is
// what closing the tab would lose.
export function unexported(batch, livePresent) {
  if (!batch) return [];
  return batch.entries.filter((entry, i) => {
    const present = i === batch.index ? livePresent ?? entry.state?.history.present : undefined;
    return entryStatus(entry, present) === STATUS.EDITED;
  });
}
