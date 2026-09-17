// The undo stack, kept as plain data so what it does can be tested without a
// component, the same split the rest of core keeps with the panels.
//
// One entry is the whole editable document, the fields, the markers and the
// config together, because an edit like a JSON import changes all of them and
// has to come back as one step. Entries share the fields that did not change
// rather than copying them, so an entry costs an array and not the form.

export const HISTORY_LIMIT = 100;

// How long a run of the same kind of edit keeps folding into one step. A pause
// longer than this starts a new one, so undo lands on a word rather than on a
// letter.
export const MERGE_MS = 700;

export function emptyHistory(present) {
  return { past: [], present, future: [], run: null };
}

// options.merge names the run this edit belongs to. Two edits carrying the same
// name within options.within milliseconds are one step, which is what stops a
// drag or a typed name from filling the stack a pixel or a letter at a time.
//
// options.silent writes the document without recording a step, for the
// corrections the app makes on its own. Nobody did them, so there is nothing to
// put back.
export function recordEdit(history, present, options = {}) {
  if (present === history.present) return history;
  if (options.silent) return { ...history, present };

  const key = options.merge ?? null;
  const at = options.now ?? Date.now();
  const within = options.within ?? MERGE_MS;
  const merging = key !== null && history.run?.key === key && at - history.run.at < within;

  return {
    // Dropping the oldest entry rather than refusing the edit. A session long
    // enough to hit the limit has stopped caring about its first minute.
    past: merging ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    run: key === null ? null : { key, at },
  };
}

export function undo(history) {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    // Whatever run was in progress is over. Typing on after an undo starts its
    // own step instead of folding back into the one just taken off.
    run: null,
  };
}

export function redo(history) {
  if (history.future.length === 0) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
    run: null,
  };
}

export const canUndo = (history) => history.past.length > 0;
export const canRedo = (history) => history.future.length > 0;

// Names the run a patch belongs to, or nothing if it is a one shot change.
//
// Text arrives a letter at a time, so every box gets a run of its own and undo
// takes back the word. A checkbox, a picker or a button is one decision
// already and keeps its own step.
export function typingRun(scope, patch) {
  const keys = Object.keys(patch ?? {});
  if (keys.length !== 1) return null;
  const value = patch[keys[0]];
  const typed = typeof value === 'string' || Array.isArray(value);
  return typed ? `${scope}:${keys[0]}` : null;
}
