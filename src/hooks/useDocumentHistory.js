import { useCallback, useState } from 'react';
import * as history from '../core/history.js';

// Holds the editable document, the fields and the config, behind an undo stack.
//
// setFields and setConfig take the same updater the useState setters they
// replaced took, so a caller still says what the next value is and nothing has
// to know a stack is underneath. The second argument is what is new: it says
// whether this edit is a step of its own, more of the run already in progress,
// or not the user's doing at all.
export function useDocumentHistory(build) {
  const [state, setState] = useState(() => history.emptyHistory(build()));

  // Both halves at once, for an edit that changes the fields and the config
  // together and has to undo as one.
  const mutate = useCallback((produce, options) => {
    setState((current) => history.recordEdit(current, produce(current.present), options));
  }, []);

  const setFields = useCallback(
    (updater, options) => {
      mutate((doc) => {
        const fields = typeof updater === 'function' ? updater(doc.fields) : updater;
        // An edit that changed nothing, a delete the app refused among them,
        // leaves no step behind to undo.
        return fields === doc.fields ? doc : { ...doc, fields };
      }, options);
    },
    [mutate]
  );

  // Markers are document content like the fields, so they share the stack and a
  // marker placed then undone goes the way a field does.
  const setMarkers = useCallback(
    (updater, options) => {
      mutate((doc) => {
        const markers = typeof updater === 'function' ? updater(doc.markers) : updater;
        return markers === doc.markers ? doc : { ...doc, markers };
      }, options);
    },
    [mutate]
  );

  const setConfig = useCallback(
    (updater, options) => {
      mutate((doc) => {
        const config = typeof updater === 'function' ? updater(doc.config) : updater;
        return config === doc.config ? doc : { ...doc, config };
      }, options);
    },
    [mutate]
  );

  // A new PDF is a new document, so the stack starts over rather than letting
  // undo walk back into the fields of the form before it.
  const reset = useCallback((doc) => setState(history.emptyHistory(doc)), []);

  const undo = useCallback(() => setState(history.undo), []);
  const redo = useCallback(() => setState(history.redo), []);

  return {
    fields: state.present.fields,
    config: state.present.config,
    markers: state.present.markers,
    setFields,
    setMarkers,
    setConfig,
    mutate,
    reset,
    undo,
    redo,
  };
}
