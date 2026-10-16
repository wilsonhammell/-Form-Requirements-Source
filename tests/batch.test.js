import { describe, it, expect } from 'vitest';
import {
  createBatch,
  stepIndex,
  storeState,
  markExported,
  markFailed,
  entryStatus,
  unexported,
  isPdfFile,
  STATUS,
} from '../src/core/batch.js';
import { emptyHistory, recordEdit } from '../src/core/history.js';

const file = (name, type = 'application/pdf') => ({ name, type });
const doc = (tag) => ({ fields: [{ id: tag }], config: {}, markers: [] });
const state = (history) => ({ bytes: new Uint8Array(), fileName: 'x.pdf', history, pageIndex: 0, notices: [], showComments: true });

describe('createBatch', () => {
  it('keeps the PDFs, in natural name order, and starts on the first', () => {
    const batch = createBatch([file('Form 10.pdf'), file('notes.txt', 'text/plain'), file('Form 2.pdf'), file('a.PDF', '')]);
    expect(batch.entries.map((e) => e.name)).toEqual(['a.PDF', 'Form 2.pdf', 'Form 10.pdf']);
    expect(batch.index).toBe(0);
    expect(new Set(batch.entries.map((e) => e.id)).size).toBe(3);
    expect(batch.entries.every((e) => e.state === null && e.opened === null && e.exported === null)).toBe(true);
  });

  it('is empty, on no form, when nothing is a PDF', () => {
    expect(createBatch([file('a.docx', '')])).toEqual({ entries: [], index: -1 });
  });

  it('knows a PDF by its name or its type', () => {
    expect(isPdfFile(file('A.Pdf', ''))).toBe(true);
    expect(isPdfFile(file('scan', 'application/pdf'))).toBe(true);
    expect(isPdfFile(file('a.xlsx', ''))).toBe(false);
  });
});

describe('stepIndex', () => {
  const batch = { ...createBatch([file('a.pdf'), file('b.pdf'), file('c.pdf')]), index: 1 };
  it('moves one either way', () => {
    expect(stepIndex(batch, 1)).toBe(2);
    expect(stepIndex(batch, -1)).toBe(0);
  });
  it('stops at the ends rather than wrapping', () => {
    expect(stepIndex({ ...batch, index: 2 }, 1)).toBe(2);
    expect(stepIndex({ ...batch, index: 0 }, -1)).toBe(0);
  });
  it('has nowhere to go without a batch', () => {
    expect(stepIndex(null, 1)).toBe(-1);
  });
});

describe('storeState and entryStatus', () => {
  const start = createBatch([file('a.pdf'), file('b.pdf')]);
  const opened = emptyHistory(doc('a'));

  it('reads a form never shown as new', () => {
    expect(entryStatus(start.entries[1])).toBe(STATUS.NEW);
  });

  it('remembers the document as first opened, and reads an unchanged one as opened', () => {
    const batch = storeState(start, 0, state(opened));
    expect(batch.entries[0].opened).toBe(opened.present);
    expect(entryStatus(batch.entries[0])).toBe(STATUS.OPENED);
    expect(start.entries[0].state).toBeNull();
  });

  it('reads a form changed since it opened as edited, and keeps what it was opened as', () => {
    let batch = storeState(start, 0, state(opened));
    const edited = recordEdit(opened, doc('a2'));
    batch = storeState(batch, 0, state(edited));
    expect(batch.entries[0].opened).toBe(opened.present);
    expect(entryStatus(batch.entries[0])).toBe(STATUS.EDITED);
  });

  it('reads the form on screen from the live document, not what was stored for it', () => {
    const batch = storeState(start, 0, state(opened));
    expect(entryStatus(batch.entries[0], doc('changed on screen'))).toBe(STATUS.EDITED);
    expect(entryStatus(batch.entries[0], opened.present)).toBe(STATUS.OPENED);
  });

  it('reads a form exported as it stands as exported, and edited again after another change', () => {
    const edited = recordEdit(opened, doc('a2'));
    let batch = storeState(storeState(start, 0, state(opened)), 0, state(edited));
    batch = markExported(batch, 0, edited.present);
    expect(entryStatus(batch.entries[0])).toBe(STATUS.EXPORTED);
    const later = recordEdit(edited, doc('a3'));
    batch = storeState(batch, 0, state(later));
    expect(entryStatus(batch.entries[0])).toBe(STATUS.EDITED);
  });

  it('leaves the batch alone for an index it does not have', () => {
    expect(storeState(start, 5, state(opened))).toBe(start);
    expect(markExported(start, -1, null)).toBe(start);
  });
});

describe('unexported', () => {
  it('lists the forms that closing the tab would lose, the one on screen read live', () => {
    const a = emptyHistory(doc('a'));
    const b = emptyHistory(doc('b'));
    let batch = createBatch([file('a.pdf'), file('b.pdf'), file('c.pdf')]);
    batch = storeState(batch, 0, state(a));
    // opened first, as the app stores a form the moment it imports it, then edited
    batch = storeState(batch, 1, state(b));
    batch = storeState(batch, 1, state(recordEdit(b, doc('b2'))));
    batch = { ...batch, index: 0 };
    expect(unexported(batch, a.present).map((e) => e.name)).toEqual(['b.pdf']);
    expect(unexported(batch, doc('a edited')).map((e) => e.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(unexported(null)).toEqual([]);
  });
});

describe('markFailed', () => {
  it('keeps a form that would not open in its place, marked, and on screen', () => {
    const batch = markFailed(createBatch([file('a.pdf'), file('b.pdf')]), 1, 'Could not open b.pdf: broken');
    expect(batch.index).toBe(1);
    expect(entryStatus(batch.entries[1])).toBe(STATUS.FAILED);
    expect(batch.entries[1].failed).toMatch(/broken/);
  });

  it('forgets the failure once the form opens after all', () => {
    let batch = markFailed(createBatch([file('a.pdf')]), 0, 'nope');
    batch = storeState(batch, 0, state(emptyHistory(doc('a'))));
    expect(batch.entries[0].failed).toBeNull();
    expect(entryStatus(batch.entries[0])).toBe(STATUS.OPENED);
  });
});
