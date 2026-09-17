import { describe, it, expect } from 'vitest';
import {
  emptyHistory,
  recordEdit,
  undo,
  redo,
  canUndo,
  canRedo,
  typingRun,
  HISTORY_LIMIT,
  MERGE_MS,
} from '../src/core/history.js';

const doc = (n) => ({ fields: [{ id: 'a', name: `n${n}` }], config: { formId: `${n}` } });

// Every edit is given its time, so nothing here waits on a clock.
const edit = (history, present, options = {}) =>
  recordEdit(history, present, { now: 0, ...options });

describe('recordEdit', () => {
  it('keeps the document it is handed and remembers the one before it', () => {
    const first = doc(1);
    const second = doc(2);
    const after = edit(emptyHistory(first), second);
    expect(after.present).toBe(second);
    expect(after.past).toEqual([first]);
    expect(canUndo(after)).toBe(true);
    expect(canRedo(after)).toBe(false);
  });

  it('records nothing when the edit changed nothing', () => {
    const only = doc(1);
    const start = emptyHistory(only);
    expect(edit(start, only)).toBe(start);
  });

  it('writes a silent edit without leaving a step to undo', () => {
    const after = edit(emptyHistory(doc(1)), doc(2), { silent: true });
    expect(after.present).toEqual(doc(2));
    expect(canUndo(after)).toBe(false);
  });

  it('folds a run of the same edit into one step', () => {
    const start = doc(1);
    let h = edit(emptyHistory(start), doc(2), { merge: 'field:a:name' });
    h = edit(h, doc(3), { merge: 'field:a:name', now: 10 });
    h = edit(h, doc(4), { merge: 'field:a:name', now: 20 });
    expect(h.past).toEqual([start]);
    expect(undo(h).present).toBe(start);
  });

  it('starts a new step once the run goes quiet', () => {
    let h = edit(emptyHistory(doc(1)), doc(2), { merge: 'field:a:name' });
    h = edit(h, doc(3), { merge: 'field:a:name', now: MERGE_MS + 1 });
    expect(h.past).toHaveLength(2);
  });

  it('keeps a run going however long the gesture lasts when it is not timed', () => {
    let h = edit(emptyHistory(doc(1)), doc(2), { merge: 'rect:7', within: Infinity });
    h = edit(h, doc(3), { merge: 'rect:7', within: Infinity, now: 60_000 });
    expect(h.past).toHaveLength(1);
  });

  it('does not fold two runs that happen to be quick', () => {
    let h = edit(emptyHistory(doc(1)), doc(2), { merge: 'field:a:name' });
    h = edit(h, doc(3), { merge: 'field:b:name' });
    expect(h.past).toHaveLength(2);
  });

  it('gives an unnamed edit its own step every time', () => {
    let h = edit(emptyHistory(doc(1)), doc(2));
    h = edit(h, doc(3));
    expect(h.past).toHaveLength(2);
  });

  it('drops the oldest step once the stack is full', () => {
    let h = emptyHistory(doc(0));
    for (let i = 1; i <= HISTORY_LIMIT + 10; i += 1) h = edit(h, doc(i));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toEqual(doc(10));
  });
});

describe('undo and redo', () => {
  it('walks back and forward over the same documents', () => {
    const one = doc(1);
    const two = doc(2);
    const three = doc(3);
    let h = edit(edit(emptyHistory(one), two), three);

    h = undo(h);
    expect(h.present).toBe(two);
    h = undo(h);
    expect(h.present).toBe(one);
    expect(canUndo(h)).toBe(false);

    h = redo(h);
    expect(h.present).toBe(two);
    h = redo(h);
    expect(h.present).toBe(three);
    expect(canRedo(h)).toBe(false);
  });

  it('stands still at either end', () => {
    const start = emptyHistory(doc(1));
    expect(undo(start)).toBe(start);
    expect(redo(start)).toBe(start);
  });

  it('drops what was undone once a new edit is made', () => {
    let h = edit(edit(emptyHistory(doc(1)), doc(2)), doc(3));
    h = undo(h);
    h = edit(h, doc(4));
    expect(canRedo(h)).toBe(false);
    expect(h.present).toEqual(doc(4));
  });

  it('does not fold the next edit into the run it interrupted', () => {
    let h = edit(emptyHistory(doc(1)), doc(2), { merge: 'field:a:name' });
    h = undo(h);
    h = edit(h, doc(3), { merge: 'field:a:name' });
    expect(undo(h).present).toEqual(doc(1));
  });
});

describe('typingRun', () => {
  it('names a run for text and for a list typed as text', () => {
    expect(typingRun('field:a', { name: 'DNA_REQ' })).toBe('field:a:name');
    expect(typingRun('config', { productCodes: ['M101'] })).toBe('config:productCodes');
  });

  it('leaves a one shot change unnamed', () => {
    expect(typingRun('field:a', { hidden: true })).toBe(null);
    expect(typingRun('field:a', { font: { size: 10 } })).toBe(null);
    // Two keys at once is a decision the panel made, not a keystroke.
    expect(typingRun('field:a', { saveValidated: true, customSaveValidated: false })).toBe(null);
  });
});
