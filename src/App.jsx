import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toolbar from './components/Toolbar.jsx';
import PdfCanvas from './components/PdfCanvas.jsx';
import FieldList, { fieldListOrder } from './components/FieldList.jsx';
import { fieldScope, FIELD_SCOPES, MARKER_SCOPE } from './core/fieldTone.js';
import PropertyPanel from './components/PropertyPanel.jsx';
import MarkerPanel from './components/MarkerPanel.jsx';
import BulkPanel from './components/BulkPanel.jsx';
import FormConfigPanel from './components/FormConfigPanel.jsx';
import FormTablePicker from './components/FormTablePicker.jsx';
import { PanelTabs, ScopeBar, IssueList, PanelResizer, usePanelWidth } from './components/SidePanel.jsx';
import { usePdfDocument } from './hooks/usePdfDocument.js';
import { useDocumentHistory } from './hooks/useDocumentHistory.js';
import { typingRun } from './core/history.js';
import { loadDbFields, buildDbIndex, buildCaseInsensitiveIndex } from './core/dbFields.js';
import {
  signingButtons,
  buildButtonIndex,
  isSubmissionButton,
  hasButton,
  addButton,
  removeButton,
} from './core/signingButtons.js';
import {
  loadSystemFields,
  buildSystemIndex,
  isFixedSystemPlacement,
  ensureSystemFields,
  canonicalSystemIds,
} from './core/systemFields.js';
import {
  isSpecialField,
  isRuntimeFilledDropdown,
  isEsignField,
  specialFieldType,
  reconcileSpecialTypes,
  availableSpecialNames,
  removeSpecialField,
  addSignerRow,
  addSpecialField,
  deriveSignerRows,
  deriveJointRows,
  hasCombinedJoint,
  specialFieldIssues,
  MAX_SIGNER_ROWS,
  MAX_JOINT_ROWS,
  ESIGN_ANCHOR,
  addEsignFields,
  removeEsignFields,
  moveEsignCluster,
} from './core/specialFields.js';
import {
  createField,
  reconcileField,
  reconcileFields,
  adoptNameValues,
  nameTakenByType,
  namePatch,
  sameNameValues,
  parseDocument,
  serializeDocument,
  fieldIssues,
  SchemaError,
  DEFAULT_FONT,
  FONT_FAMILIES,
  nextRadioExportValue,
  createConfig,
} from './core/schema.js';

import { createMarker, markerIssues, DRAW_MARKER } from './core/markers.js';
import { spreadGroupSave, adoptGroupSave } from './core/checkBoxGroups.js';
import { importPdf, loadPdfBytes, formatsFromPdf, SOURCE } from './core/pdfImport.js';
import { exportPdf } from './core/pdfExport.js';
import { serializeJsonBytes } from './core/pdfEmbed.js';
import { downloadBytes, sidecarName, exportedPdfName, requirementsName } from './core/download.js';
import { requirementsWorkbookBytes } from './core/excelExport.js';
import { readFormTable, prefillFromRow } from './core/formTable.js';
import { renderPageImages } from './core/pageImages.js';
import { suggestedFontSize } from './core/pageText.js';

const DEFAULT_FONT_LABEL =
  FONT_FAMILIES.find((f) => f.value === DEFAULT_FONT.family)?.label ?? DEFAULT_FONT.family;

// Adding and removing one member, for the two Sets the UI toggles.
const toggled = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export default function App() {
  const [dbFields, setDbFields] = useState([]);
  const [dbError, setDbError] = useState(null);

  const [fileName, setFileName] = useState('');
  const [originalBytes, setOriginalBytes] = useState(null);
  // The three states an edit can touch, held together behind the undo stack.
  // Only what the form is made of belongs here. Which page is open, what is selected
  // and how far it is zoomed are where the user left them, not something Ctrl+Z
  // should be walking backwards through.
  const {
    fields,
    config,
    markers,
    setFields,
    setMarkers,
    setConfig,
    mutate: mutateDocument,
    reset: resetDocument,
    undo,
    redo,
  } = useDocumentHistory(() => ({ fields: [], config: createConfig(), markers: [] }));
  const [selectedId, setSelectedId] = useState(null);
  // Its own selection. A marker shares none of a field's controls, so the two
  // are never selected at once and picking one clears the other.
  const [selectedMarkerId, setSelectedMarkerId] = useState(null);
  // Everything selected, the last row clicked included. One field is the common
  // case and keeps the property panel; more than one gets the bulk bar.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Set by clicking an issue, so the list shows only the fields it counted.
  // Null means no filter, which is the usual state.
  const [issueFilter, setIssueFilter] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  // What a drag on the page makes. A field type, or DRAW_MARKER, which is the
  // one thing here that is not a field.
  const [drawKind, setDrawKind] = useState('text');
  const [notices, setNotices] = useState([]);
  // Minimized rather than cleared, since an import note or an export warning is
  // worth reading again. Anything new opens it back up.
  const [noticesOpen, setNoticesOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  // Opens on Config, the first tab and the form level questions answered first.
  const [panel, setPanel] = useState('config');
  const [panelWidth, setPanelWidth] = usePanelWidth();
  const [systemFields, setSystemFields] = useState([]);
  // Maintained in source rather than fetched, so it is ready on first render.
  const buttons = useMemo(() => signingButtons(), []);
  // Which groups are shown, not which one. They are independent, so the fields
  // a form is about can be looked at with the signer rows but without the
  // system plumbing, which is the usual way of working.
  const [scopes, setScopes] = useState(() => new Set(['standard']));
  const showScope = useCallback((...names) => setScopes(new Set(names)), []);
  const toggleScope = useCallback((id) => setScopes((current) => toggled(current, id)), []);
  // Apart from the scopes, since comments are not fields. Shown on top when on,
  // so turning them off is how to reach a field under one.
  const [showComments, setShowComments] = useState(true);

  const { doc, error: pdfError } = usePdfDocument(originalBytes);
  const pageCount = doc?.numPages ?? 0;

  // The CropBox of the page being looked at, so a button can be given a slot
  // measured against the real page rather than an assumed one.
  const [pageBox, setPageBox] = useState([0, 0, 612, 792]);
  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    doc
      .getPage(pageIndex + 1)
      .then((page) => {
        if (!cancelled) setPageBox(page.view);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex]);

  // What the printed form is set in, offered beside the font size box. Read
  // once when the document opens, since the pages do not change under us.
  const [suggestedSize, setSuggestedSize] = useState(null);
  useEffect(() => {
    if (!doc) {
      setSuggestedSize(null);
      return undefined;
    }
    let cancelled = false;
    suggestedFontSize(doc)
      .then((size) => {
        if (!cancelled) setSuggestedSize(size);
      })
      // A form with no readable text simply gets no suggestion.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc]);

  const dbIndex = useMemo(() => buildDbIndex(dbFields), [dbFields]);
  const systemIndex = useMemo(() => buildSystemIndex(systemFields), [systemFields]);
  const buttonIndex = useMemo(() => buildButtonIndex(buttons), [buttons]);
  const caseIndex = useMemo(() => buildCaseInsensitiveIndex(dbFields), [dbFields]);

  useEffect(() => {
    loadDbFields()
      .then(setDbFields)
      .catch((err) => setDbError(err.message));
    loadSystemFields()
      .then(setSystemFields)
      .catch((err) => setDbError(err.message));
  }, []);

  // The DB list is swappable, so a reload can invalidate a validation flag.
  // Silent: the list moved, nobody edited anything, and undoing back to a flag
  // the list no longer supports would only have it taken off again.
  useEffect(() => {
    setFields((current) => reconcileFields(current, dbIndex), { silent: true });
  }, [dbIndex, setFields]);

  const selected = fields.find((f) => f.id === selectedId) ?? null;
  const selectedMarker = markers.find((m) => m.id === selectedMarkerId) ?? null;
  const selectedFields = useMemo(
    () => fields.filter((f) => selectedIds.has(f.id)),
    [fields, selectedIds]
  );

  // Worked out over every field, not the filtered set, so a display copy still
  // knows the canonical placement exists while that one is filtered away.
  const canonicalIds = useMemo(
    () => canonicalSystemIds(fields, systemIndex),
    [fields, systemIndex]
  );

  // The system fields outnumber the rest, so being able to look at one or the
  // other is what keeps a page readable. Both the list and the page follow it.
  //
  // Only the canonical placement filters as System. A second box carrying a
  // system name is there to show the value, so it filters as Standard, which is
  // also what stops a standard field renamed to a system name from vanishing
  // out from under whoever just named it.
  const inScope = useCallback(
    (f) =>
      scopes.has(
        fieldScope(f, {
          system: canonicalIds.has(f.id),
          submissionButton: isSubmissionButton(f.name, buttonIndex),
        })
      ),
    [scopes, canonicalIds, buttonIndex]
  );
  const scopedFields = useMemo(() => {
    const inList = fields.filter(inScope);
    if (!issueFilter) return inList;
    // The issue's fields win over the scope tabs, since the point of clicking one
    // is to see exactly what it named wherever those fields live.
    const wanted = new Set(issueFilter.ids);
    return fields.filter((f) => wanted.has(f.id));
  }, [fields, inScope, issueFilter]);

  // Plain click replaces the selection, Ctrl or Cmd adds and removes one, Shift
  // takes everything between the last row clicked and this one, in the order the
  // list shows them rather than the order the fields happen to be stored in.
  const selectMarker = useCallback((id) => {
    setSelectedMarkerId(id);
    if (id) {
      setSelectedId(null);
      setSelectedIds(new Set());
    }
  }, []);

  const selectField = useCallback(
    (id, modifiers = {}) => {
      setSelectedMarkerId(null);
      if (!id) {
        setSelectedId(null);
        setSelectedIds(new Set());
        return;
      }

      if (modifiers.toggle) {
        setSelectedIds((current) => toggled(current, id));
        setSelectedId(id);
        return;
      }

      if (modifiers.shift && selectedId) {
        const order = fieldListOrder(scopedFields);
        const from = order.indexOf(selectedId);
        const to = order.indexOf(id);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          setSelectedIds(new Set(order.slice(lo, hi + 1)));
          setSelectedId(id);
          return;
        }
      }

      setSelectedId(id);
      setSelectedIds(new Set([id]));
    },
    [selectedId, scopedFields]
  );

  const pageFields = useMemo(
    () => scopedFields.filter((f) => f.page === pageIndex),
    [scopedFields, pageIndex]
  );
  // The same rule the fields follow: an issue's members win over the scope
  // tabs, so clicking one shows exactly what it named.
  const scopedMarkers = useMemo(() => {
    if (issueFilter) {
      const wanted = new Set(issueFilter.ids);
      return markers.filter((m) => wanted.has(m.id));
    }
    return scopes.has(MARKER_SCOPE) ? markers : [];
  }, [markers, scopes, issueFilter]);
  const pageMarkers = useMemo(
    () => scopedMarkers.filter((m) => m.page === pageIndex),
    [scopedMarkers, pageIndex]
  );
  const issues = useMemo(
    () => [
      ...fieldIssues(fields, dbIndex, systemIndex, isRuntimeFilledDropdown),
      // Only an imported PDF can carry these, since placing cannot produce one.
      ...specialFieldIssues(fields).map((text) => ({ text, level: 'error' })),
      ...markerIssues(markers),
    ],
    [fields, markers, dbIndex, systemIndex]
  );
  // An issue that no longer holds should not leave the list filtered to nothing.
  useEffect(() => {
    if (!issueFilter) return;
    const still = issues.some((i) => i.text === issueFilter.text);
    if (!still) setIssueFilter(null);
  }, [issues, issueFilter]);

  // What the picker may offer. Worked out without the selected field, so it can
  // keep the name it has or swap for another the row is missing.
  const specialNames = useMemo(
    () => availableSpecialNames(fields.filter((f) => f.id !== selectedId)),
    [fields, selectedId]
  );

  const signerRows = useMemo(() => deriveSignerRows(fields), [fields]);
  const jointRows = useMemo(() => deriveJointRows(fields), [fields]);
  const hasCombined = useMemo(() => hasCombinedJoint(fields), [fields]);

  const say = useCallback((messages) => {
    setNotices(Array.isArray(messages) ? messages : [messages]);
    setNoticesOpen(true);
  }, []);

  // The load errors do not go through say, so they open the bar themselves.
  useEffect(() => {
    if (dbError || pdfError) setNoticesOpen(true);
  }, [dbError, pdfError]);

  const hasNotices = notices.length > 0 || !!dbError || !!pdfError;

  // The three jobs slow enough to disable the toolbar. Whatever they throw is
  // said out loud rather than leaving the button looking like it did nothing.
  const whileBusy = useCallback(
    async (run, describeError) => {
      setBusy(true);
      try {
        await run();
      } catch (err) {
        say([describeError(err)]);
      } finally {
        setBusy(false);
      }
    },
    [say]
  );

  const handleOpenPdf = (file) =>
    whileBusy(
      async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await importPdf(bytes, dbIndex, systemFields, buttons);
        setOriginalBytes(bytes);
        setFileName(file.name);
        // A signer name saved as a text field elsewhere comes back a dropdown,
        // the same correction system field types get.
        resetDocument({
          fields: reconcileSpecialTypes(result.fields),
          config: result.config,
          markers: result.markers,
        });
        setSelectedId(null);
        setSelectedMarkerId(null);
        setPageIndex(0);
        setShowComments(true);
        const label = {
          [SOURCE.EMBEDDED]: 'Embedded requirements found',
          [SOURCE.ACROFORM]: 'Existing AcroForm found',
          [SOURCE.FLAT]: 'Flat PDF',
        }[result.source];
        say([`${label}. ${result.notes.join(' ')}`]);
      },
      (err) => `Could not open ${file.name}: ${err.message}`
    );

  const handleImportJson = async (file) => {
    try {
      const {
        fields: parsed,
        config: loadedConfig,
        markers: loadedMarkers,
        predatesFormat,
      } = parseDocument(await file.text(), dbIndex);
      // A sidecar saved before the format existed says nothing about it, so the
      // open PDF does, the same as opening a PDF with older embedded JSON.
      const { fields: loaded, notes: formatNotes } =
        predatesFormat.size > 0 && originalBytes
          ? formatsFromPdf(parsed, await loadPdfBytes(originalBytes), predatesFormat)
          : { fields: parsed, notes: [] };
      // One step, not three. The import replaces the fields, the markers and the
      // config of the PDF still open, so undo puts them all back the way the
      // wrong sidecar found them.
      mutateDocument(() => ({
        // A sidecar saved before the flag existed has none, so its system
        // fields are placed the same way an import places them.
        fields: ensureSystemFields(loaded, systemFields, pageBox),
        config: loadedConfig,
        markers: loadedMarkers,
      }));
      setSelectedId(null);
      setSelectedMarkerId(null);
      say([
        [`Loaded ${loaded.length} field${loaded.length === 1 ? '' : 's'} from ${file.name}.`, ...formatNotes].join(' '),
      ]);
    } catch (err) {
      const why = err instanceof SchemaError ? err.message : `${err}`;
      say([`Could not import ${file.name}: ${why}`]);
    }
  };

  const [formTable, setFormTable] = useState(null);

  const handleImportFormTable = async (file) => {
    try {
      const sheets = await readFormTable(await file.arrayBuffer());
      if (sheets.length === 0) {
        say([`No sheet in ${file.name} has a NEW FORM NAME column.`]);
        return;
      }
      setFormTable({ fileName: file.name, sheets });
    } catch (err) {
      say([`Could not read ${file.name}: ${err.message ?? err}`]);
    }
  };

  // One step, so undo puts the config and the buttons back together.
  const handlePickFormRow = (sheet, row) => {
    setFormTable(null);
    const { config: patch, buttons: wanted, notes } = prefillFromRow(row, sheet.titles);
    mutateDocument((current) => {
      let next = current.fields;
      for (const entry of buttons) {
        if (entry.identifier in wanted) next = withButton(next, entry, wanted[entry.identifier]);
      }
      return { ...current, fields: next, config: createConfig({ ...current.config, ...patch }) };
    });
    setPanel('config');
    say([`Filled from ${sheet.name} row ${row.row}, ${row.values.formName}.`, ...notes]);
  };

  const handleCreateField = (rect) => {
    const field = createField({
      type: drawKind,
      page: pageIndex,
      rect,
      // A radio option's placeholder depends on what is already placed.
      ...(drawKind === 'radio' ? { exportValue: nextRadioExportValue(fields) } : {}),
    });
    setFields((current) => [...current, field]);
    setSelectedId(field.id);
  };

  // Drawn like a field and stored nowhere near one. Nothing is named, nothing is
  // typed, and nothing about it reaches the exported PDF.
  const handleCreateMarker = (rect) => {
    const marker = createMarker({ page: pageIndex, rect });
    setMarkers((current) => [...current, marker]);
    selectMarker(marker.id);
    // A marker drawn while the Signers scope is off would vanish the moment it
    // was placed, the same reason the Config placements switch scope.
    if (!scopes.has(MARKER_SCOPE)) showScope(MARKER_SCOPE);
  };

  const patchMarker = useCallback(
    (id, patch) => {
      setMarkers(
        (current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        // The role and the note are typed, so a run of keystrokes in one box is
        // one step.
        { merge: typingRun(`marker:${id}`, patch) }
      );
    },
    [setMarkers]
  );

  const handleChangeMarkerRect = useCallback(
    (id, rect, gesture) => {
      setMarkers((current) => current.map((m) => (m.id === id ? { ...m, rect } : m)), {
        merge: gesture ? `markerRect:${gesture}` : null,
        within: Infinity,
      });
    },
    [setMarkers]
  );

  const deleteMarker = useCallback(
    (id) => {
      if (!id) return;
      setMarkers((current) => current.filter((m) => m.id !== id));
      setSelectedMarkerId((sel) => (sel === id ? null : sel));
    },
    [setMarkers]
  );

  const duplicateMarker = useCallback(
    (id) => {
      const source = markers.find((m) => m.id === id);
      if (!source) return;
      // Offset so the copy is visibly on top of, not hidden behind, the original.
      const copy = createMarker({
        ...source,
        id: undefined,
        rect: { ...source.rect, x: source.rect.x + 8, y: source.rect.y - 8 },
      });
      setMarkers((current) => [...current, copy]);
      selectMarker(copy.id);
    },
    [markers, setMarkers, selectMarker]
  );

  // The field as it stood before its name was first typed over, so a name the
  // settle refuses can be put back along with the type it carried. Taken here
  // rather than in the updater, which may not have run by the time it settles.
  const beforeRename = useRef(new Map());
  // A refusal is decided in the updater, so the notice waits for the render.
  const refusedName = useRef(null);

  const patchField = useCallback(
    (id, patch) => {
      if (patch.name !== undefined && !beforeRename.current.has(id)) {
        const original = fields.find((f) => f.id === id);
        if (original) beforeRename.current.set(id, original);
      }
      setFields(
        (current) => {
          const patched = current.map((f) => {
            if (f.id !== id) return f;
            let next = { ...f, ...patch };
            // Once a field is renamed by hand it is no longer an inferred import.
            if (patch.name !== undefined) next.imported = false;
            // A special field's type follows its name. A signer's name is a
            // dropdown, the rest are text, so naming a box settles its type.
            //
            // A system field's type follows its name too, for the same reason
            // import corrects one on the way in: the list is authoritative, so
            // there is one right answer and no call for the user to make.
            if (patch.name !== undefined) {
              const system = systemIndex.get(patch.name.trim());
              next.type = system?.type ?? specialFieldType(patch.name) ?? next.type;
              if (system && system.type === 'text') {
                next.exportValue = '';
                next.options = [];
              }
            }
            return reconcileField(next, dbIndex);
          });
          // The other placements of the name follow, whatever it is called now,
          // and Save Validation goes to the rest of a check box group.
          const shared = namePatch(patch);
          const name = patched.find((f) => f.id === id)?.name.trim();
          if (!name || Object.keys(shared).length === 0) return patched;
          const named = patched.map((f) =>
            f.id !== id && f.name.trim() === name ? reconcileField({ ...f, ...shared }, dbIndex) : f
          );
          return spreadGroupSave(named, new Set([name]), patch, (f) => reconcileField(f, dbIndex));
        },
        // A name, a note or an options list is typed, so the keystrokes fold
        // into one step per box. A checkbox or a picker is one decision and
        // keeps a step of its own.
        { merge: typingRun(`field:${id}`, patch) }
      );
    },
    [fields, dbIndex, systemIndex, setFields]
  );

  // A box joins the field it is named after once the name is settled, not as it
  // is typed, or every name passed through on the way would hand it its values.
  const settleName = useCallback(
    (id) => {
      const before = beforeRename.current.get(id);
      beforeRename.current.delete(id);
      // Same as Acrobat, a name held by another type is refused. Only a rename
      // made here is put back, so a file that arrived this way is never emptied
      // by clicking into its name box. Written over the typed name rather than
      // stacked on it, so undo cannot bring the refused name back.
      setFields(
        (current) => {
          const field = current.find((f) => f.id === id);
          const taken = field && before ? nameTakenByType(field, current) : null;
          if (!taken) return current;
          refusedName.current = `"${field.name.trim()}" is already a ${taken} field, one name cannot be both ${taken} and ${field.type}.`;
          const restored = {
            ...field,
            name: before.name,
            type: before.type,
            exportValue: before.exportValue,
            options: before.options,
            imported: before.imported,
          };
          return current.map((f) => (f.id === id ? reconcileField(restored, dbIndex) : f));
        },
        { silent: true }
      );
      setFields((current) => {
        const field = current.find((f) => f.id === id);
        if (!field) return current;
        const joined = reconcileField(adoptGroupSave(adoptNameValues(field, current), current), dbIndex);
        if (sameNameValues(joined, field)) return current;
        return current.map((f) => (f.id === id ? joined : f));
      });
    },
    [dbIndex, setFields]
  );

  useEffect(() => {
    if (!refusedName.current) return;
    say(refusedName.current);
    refusedName.current = null;
  }, [fields, say]);

  // Clicking another box can take the panel away before the name box blurs.
  const lastSelected = useRef(null);
  useEffect(() => {
    if (lastSelected.current && lastSelected.current !== selectedId) settleName(lastSelected.current);
    lastSelected.current = selectedId;
  }, [selectedId, settleName]);

  // The same patch across a selection. Each field still goes through
  // reconcileField, so a flag that cannot stand on one of them comes straight
  // back off rather than being written and quietly ignored.
  const patchFields = useCallback(
    (ids, patch) => {
      setFields((current) => {
        // Every placement of a selected name, not only the ones selected.
        const names = new Set(
          current.filter((f) => ids.has(f.id)).map((f) => f.name.trim()).filter(Boolean)
        );
        const shared = namePatch(patch);
        const patched = current.map((f) => {
          if (ids.has(f.id)) return reconcileField({ ...f, ...patch }, dbIndex);
          if (names.has(f.name.trim())) return reconcileField({ ...f, ...shared }, dbIndex);
          return f;
        });
        return spreadGroupSave(patched, names, patch, (f) => reconcileField(f, dbIndex));
      });
    },
    [dbIndex, setFields]
  );

  // The canvas names each drag, since it arrives as a rect a mouse move rather
  // than one at the end of it. Every rect carrying that name is the same step,
  // with no time limit on it, so a drag undoes as the one move it looked like
  // however long the pointer was held down.
  const handleChangeRect = useCallback(
    (id, rect, gesture) => {
      setFields(
        (current) => {
          const field = current.find((f) => f.id === id);
          const moved = current.map((f) => (f.id === id ? { ...f, rect } : f));
          // The label and code box sit against the Remote eSign button, so dragging
          // the button drags them too. A delta rather than a re-layout, so nudging
          // either one by hand survives the button moving afterwards.
          if (field?.name.trim() !== ESIGN_ANCHOR) return moved;
          return moveEsignCluster(moved, rect.x - field.rect.x, rect.y - field.rect.y);
        },
        { merge: gesture ? `rect:${gesture}` : null, within: Infinity }
      );
    },
    [setFields]
  );

  const deleteField = useCallback(
    (id) => {
      if (!id) return;
      setFields((current) => {
        const field = current.find((f) => f.id === id);
        if (!field) return current;
        // Every system name keeps the placement this tool put there. Extra
        // copies of one, put on the form to show the value, delete freely.
        if (isFixedSystemPlacement(field, current, systemIndex)) {
          say([`"${field.name}" is a system field, its system placement cannot be removed.`]);
          return current;
        }
        setSelectedId((sel) => (sel === id ? null : sel));
        // Emptying a signer or joint row would leave a gap the starter code
        // walks straight into, so the rows after it shift down to close it.
        // Positions stay put, only the names move up.
        const { fields: left, renumbered } = removeSpecialField(current, id);
        if (renumbered.length > 0) {
          say([`Rows renumbered: ${renumbered.map((r) => `${r.from} to ${r.to}`).join(', ')}.`]);
        }
        return left;
      });
    },
    [systemIndex, say, setFields]
  );

  const duplicateField = useCallback(
    (id) => {
      const source = fields.find((f) => f.id === id);
      if (!source) return;
      // Offset so the copy is visibly on top of, not hidden behind, the original.
      const copy = createField({
        ...source,
        id: undefined,
        rect: { ...source.rect, x: source.rect.x + 8, y: source.rect.y - 8 },
        imported: false,
        systemPlacement: false,
        // Two options of one radio group cannot share a value, so a copy gets
        // the next free placeholder rather than a duplicate.
        ...(source.type === 'radio' ? { exportValue: nextRadioExportValue(fields) } : {}),
      });
      setFields((current) => [...current, copy]);
      setSelectedId(copy.id);
    },
    [fields, setFields]
  );

  // Ctrl+D copies a field where it stands, which cannot reach another page, and
  // a field has no page control of its own. The clipboard is how a placement
  // crosses pages: a paste lands on whatever page is open, so a signature box
  // wanted again on page 4 is a copy, a page turn and a paste.
  //
  // The app's own clipboard rather than the system one. Copying a field never
  // costs the user what they had on the system clipboard, and nothing can
  // arrive here that this app did not put here.
  const clipboard = useRef({ fields: [], markers: [] });

  const copySelection = useCallback(() => {
    if (selectedMarkerId) {
      const marker = markers.find((m) => m.id === selectedMarkerId);
      if (marker) clipboard.current = { fields: [], markers: [marker] };
      return;
    }

    // With nothing selected the clipboard is left alone rather than emptied, so
    // a stray Ctrl+C cannot lose what was copied a moment ago.
    const ids = selectedIds.size > 0 ? selectedIds : new Set(selectedId ? [selectedId] : []);
    const copied = fields.filter((f) => ids.has(f.id));
    if (copied.length > 0) clipboard.current = { fields: copied, markers: [] };
  }, [fields, markers, selectedId, selectedIds, selectedMarkerId]);

  const pasteClipboard = useCallback(() => {
    const { fields: sourceFields, markers: sourceMarkers } = clipboard.current;
    if (sourceFields.length === 0 && sourceMarkers.length === 0) return;

    // Onto the page it was copied from, offset the way a duplicate is, or the
    // copy sits hidden behind the original. Onto any other page the coordinates
    // are the whole point, so they are kept exactly: the same spot, further on.
    const landing = (source) =>
      source.page === pageIndex
        ? { ...source.rect, x: source.rect.x + 8, y: source.rect.y - 8 }
        : { ...source.rect };

    // Built before the stack is touched, not inside the updater, since an
    // updater can run more than once and would paste twice.
    const skipped = [];
    const newFields = [];
    for (const source of sourceFields) {
      const name = source.name.trim();
      // The one rule a paste cannot bend. A submission button is a channel the
      // form offers rather than a box on it, so it appears at most once.
      if (isSubmissionButton(name, buttonIndex)) {
        skipped.push(name);
        continue;
      }

      newFields.push(
        createField({
          ...source,
          id: undefined,
          page: pageIndex,
          rect: landing(source),
          // Once pasted it is a placement this tool made, not one an import
          // inferred, the same way a duplicate is.
          imported: false,
          systemPlacement: false,
          // Two options of one radio group cannot share a value, so each copy
          // takes the next free placeholder, the ones made here included.
          ...(source.type === 'radio'
            ? { exportValue: nextRadioExportValue([...fields, ...newFields]) }
            : {}),
        })
      );
    }

    const newMarkers = sourceMarkers.map((source) =>
      createMarker({ ...source, id: undefined, page: pageIndex, rect: landing(source) })
    );

    if (skipped.length > 0) {
      say([`Not pasted: ${skipped.join(', ')}. A submission button appears at most once.`]);
    }
    if (newFields.length === 0 && newMarkers.length === 0) return;

    // Both halves in one step, so a paste of a signer row and its initials
    // marker comes back off with one Ctrl+Z. The clipboard is a snapshot, so a
    // copy of a name still on the form takes what that field says now.
    mutateDocument((doc) => ({
      ...doc,
      fields: [...doc.fields, ...newFields.map((f) => adoptNameValues(f, doc.fields))],
      markers: [...doc.markers, ...newMarkers],
    }));

    // What was just pasted is what is selected, so it can be dragged into place
    // straight away.
    if (newFields.length > 0) {
      setSelectedMarkerId(null);
      setSelectedId(newFields[newFields.length - 1].id);
      setSelectedIds(new Set(newFields.map((f) => f.id)));
    } else {
      selectMarker(newMarkers[newMarkers.length - 1].id);
    }
  }, [fields, pageIndex, buttonIndex, mutateDocument, say, selectMarker]);

  // Delete works on the selection, unless the user is typing a name.
  useEffect(() => {
    const onKeyDown = (event) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      // Ahead of the text box guard below, unlike Delete. Every box in here is
      // a controlled input, so the browser's own undo has nothing of its own to
      // put back and would leave the box and the field disagreeing. One stack
      // for the whole app is the answer that holds wherever the cursor is.
      if (mod && (key === 'z' || key === 'y')) {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) redo();
        else undo();
        return;
      }

      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedMarkerId) {
          event.preventDefault();
          deleteMarker(selectedMarkerId);
          return;
        }
        if (!selectedId) return;
        event.preventDefault();
        deleteField(selectedId);
      } else if (mod && key === 'd') {
        if (!selectedId) return;
        event.preventDefault();
        duplicateField(selectedId);
      } else if (mod && key === 'c') {
        // Only when there is something of ours to take. With nothing selected
        // the browser's own copy is left to do its job.
        if (!selectedId && !selectedMarkerId) return;
        event.preventDefault();
        copySelection();
      } else if (mod && key === 'v') {
        const held = clipboard.current;
        if (held.fields.length === 0 && held.markers.length === 0) return;
        event.preventDefault();
        pasteClipboard();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        // Walk the list in the order it is drawn. Shift keeps the rows passed
        // over, which is the quickest way to pick up a run of fields.
        const order = fieldListOrder(scopedFields);
        if (order.length === 0) return;
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const at = selectedId ? order.indexOf(selectedId) : -1;
        const next = at === -1 ? order[step === 1 ? 0 : order.length - 1] : order[at + step];
        if (next === undefined) return;
        selectField(next, { shift: event.shiftKey });
        const field = fields.find((f) => f.id === next);
        if (field) setPageIndex(field.page);
      } else if (event.key === 'Escape') {
        selectField(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedId,
    selectedMarkerId,
    deleteField,
    deleteMarker,
    duplicateField,
    copySelection,
    pasteClipboard,
    scopedFields,
    fields,
    selectField,
    undo,
    redo,
  ]);

  // Its own path, so nothing here touches the PDF export.
  const handleExportRequirements = () =>
    whileBusy(
      async () => {
        const bytes = await requirementsWorkbookBytes({
          doc: serializeDocument(fields, { sourceFileName: fileName, config, markers }),
          buttons,
          systemIndex,
          buttonIndex,
          dbIndex,
          // The markers go to the pictures as well as the table. A row gives a
          // reader coordinates, the picture is what shows them the place.
          pageImages: await renderPageImages(doc, { markers }),
          sheetName: fileName.replace(/\.pdf$/i, '') || 'Form',
        });
        downloadBytes(
          bytes,
          requirementsName(fileName),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        say([`Exported ${requirementsName(fileName)}.`]);
      },
      (err) => `Requirements export failed: ${err.message}`
    );

  const handleExportPdf = () =>
    whileBusy(
      async () => {
        const { pdfBytes, warnings } = await exportPdf({
          originalBytes,
          fields,
          buttons,
          systemFields,
          // Markers ride along so the embedded JSON carries them back on the
          // next open. Nothing in exportPdf reads them, which is the point:
          // they never become part of the form.
          meta: { sourceFileName: fileName, config, markers },
        });
        // The JSON is already inside the PDF. Export JSON is there for a copy.
        downloadBytes(pdfBytes, exportedPdfName(fileName), 'application/pdf');
        say([`Exported ${exportedPdfName(fileName)}.`, ...warnings]);
      },
      (err) => `Export failed: ${err.message}`
    );

  const handleExportJson = () => {
    const bytes = serializeJsonBytes(
      serializeDocument(fields, { sourceFileName: fileName, config, markers })
    );
    downloadBytes(bytes, sidecarName(fileName), 'application/json');
    say([`Exported ${sidecarName(fileName)}.`]);
  };

  // The three Config actions that place fields. Each follows the change to the
  // scope that shows it, since a field appearing in a scope you are not looking
  // at reads as nothing having happened.

  // Puts back a part deleted from a row, or starts a joint one, without having
  // to draw a box and know the name.
  const placeSpecialField = useCallback(
    (name) => {
      setFields((current) => {
        const anchor = current.find((f) => f.name.trim() === ESIGN_ANCHOR);
        return addSpecialField(current, name, pageBox, pageIndex, anchor?.rect ?? null);
      });
      showScope(isEsignField(name) ? 'submission' : 'signers');
    },
    [pageBox, pageIndex, showScope, setFields]
  );

  // Rows land stacked and out of the way, since only the artwork knows where
  // they belong.
  const addSignerRowHere = useCallback(() => {
    setFields((current) => addSignerRow(current, pageBox, pageIndex));
    showScope('signers');
  }, [pageBox, pageIndex, showScope, setFields]);

  const withButton = useCallback(
    (current, entry, on) => {
      const next = on
        ? addButton(current, entry, buttons, pageBox, pageIndex)
        : removeButton(current, entry.identifier);
      // The label and code box are part of the Remote eSign channel, so they
      // come and go with its button.
      if (entry.identifier !== ESIGN_ANCHOR) return next;
      const button = next.find((f) => f.name.trim() === ESIGN_ANCHOR);
      return on && button
        ? addEsignFields(next, button.rect, button.page)
        : removeEsignFields(next);
    },
    [buttons, pageBox, pageIndex]
  );

  const toggleButton = useCallback(
    (entry, on) => {
      setFields((current) => withButton(current, entry, on));
      if (on) showScope('submission');
    },
    [withButton, showScope, setFields]
  );

  // A reset rather than a lock, any field can be changed again afterwards. The
  // size is the one typed in the toolbar; the family is the standard family.
  const handleEnforceFontStandards = (size) => {
    setFields((current) => current.map((f) => ({ ...f, font: { ...DEFAULT_FONT, size } })));
    say([
      `Set ${fields.length} field${fields.length === 1 ? '' : 's'} to ${DEFAULT_FONT_LABEL} ${size}.`,
    ]);
  };

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      <Toolbar
        fileName={fileName}
        pageIndex={pageIndex}
        pageCount={pageCount}
        zoom={zoom}
        drawKind={drawKind}
        hasPdf={!!doc}
        busy={busy}
        commentsShown={showComments}
        onToggleComments={() => setShowComments((on) => !on)}
        onOpenPdf={handleOpenPdf}
        onImportJson={handleImportJson}
        onImportFormTable={handleImportFormTable}
        onExportPdf={handleExportPdf}
        onExportJson={handleExportJson}
        onExportRequirements={handleExportRequirements}
        onPageChange={setPageIndex}
        onZoomChange={setZoom}
        onDrawKind={setDrawKind}
        onEnforceFontStandards={handleEnforceFontStandards}
        suggestedSize={suggestedSize}
        noticesHidden={hasNotices && !noticesOpen}
        onShowNotices={() => setNoticesOpen(true)}
      />

      {formTable && (
        <FormTablePicker
          fileName={formTable.fileName}
          sheets={formTable.sheets}
          onPick={handlePickFormRow}
          onClose={() => setFormTable(null)}
        />
      )}

      {hasNotices && noticesOpen && (
        <div
          role="status"
          className="flex items-start gap-3 border-b border-slate-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900"
        >
          <div className="min-w-0 flex-1">
            {dbError && <p>Could not load the DB field list: {dbError}</p>}
            {pdfError && <p>Could not read the PDF: {pdfError.message}</p>}
            {notices.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
          </div>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 font-medium text-amber-800 hover:bg-amber-100"
            onClick={() => setNoticesOpen(false)}
          >
            Hide
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          {doc ? (
            <PdfCanvas
              doc={doc}
              pageIndex={pageIndex}
              zoom={zoom}
              fields={pageFields}
              markers={pageMarkers}
              selectedId={selectedId}
              selectedMarkerId={selectedMarkerId}
              dbIndex={dbIndex}
              canonicalIds={canonicalIds}
              buttonIndex={buttonIndex}
              systemIndex={systemIndex}
              showComments={showComments}
              drawKind={drawKind}
              selectedIds={selectedIds}
              onSelect={selectField}
              onSelectMarker={selectMarker}
              onCreateField={handleCreateField}
              onCreateMarker={handleCreateMarker}
              onChangeRect={handleChangeRect}
              onChangeMarkerRect={handleChangeMarkerRect}
            />
          ) : (
            <EmptyState />
          )}
        </main>

        <aside
          className="relative flex shrink-0 flex-col border-l border-slate-200 bg-white"
          style={{ width: panelWidth }}
        >
          <PanelResizer width={panelWidth} onResize={setPanelWidth} />
          <PanelTabs
            panel={panel}
            onPick={setPanel}
            counts={{
              fields: fields.length + markers.length,
              config: config.productCodes.length || null,
            }}
          />

          {panel === 'config' ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <FormConfigPanel
                config={config}
                onChange={(patch) =>
                  setConfig((current) => createConfig({ ...current, ...patch }), {
                    // The text answers are typed, so a run of keystrokes in one
                    // box is one step. A checkbox or a picker keeps its own.
                    merge: typingRun('config', patch),
                  })
                }
                buttons={buttons}
                isButtonOn={(id) => hasButton(fields, id)}
                signerRows={signerRows}
                jointRows={jointRows}
                hasCombined={hasCombined}
                maxSignerRows={MAX_SIGNER_ROWS}
                maxJointRows={MAX_JOINT_ROWS}
                onPlaceSpecial={placeSpecialField}
                onAddSignerRow={addSignerRowHere}
                onToggleButton={toggleButton}
              />
            </div>
          ) : (
            <>
          {/* The list gives way to the property panel rather than the other way
              round. The panel has a fixed set of controls that all need to be
              reachable, the list is just longer or shorter. */}
          <ScopeBar
            scopes={scopes}
            onShowAll={() => showScope(...FIELD_SCOPES)}
            onToggle={toggleScope}
            issueFilter={issueFilter}
            onClearFilter={() => setIssueFilter(null)}
            shown={scopedFields.length + scopedMarkers.length}
            total={fields.length + markers.length}
          />

          <div className="min-h-[6rem] flex-1 overflow-auto">
            <FieldList
              fields={scopedFields}
              markers={scopedMarkers}
              selectedId={selectedId}
              selectedIds={selectedIds}
              selectedMarkerId={selectedMarkerId}
              dbIndex={dbIndex}
              systemIndex={systemIndex}
              canonicalIds={canonicalIds}
              onSelect={selectField}
              onSelectMarker={selectMarker}
              onGoToPage={setPageIndex}
            />
          </div>

          {issues.length > 0 && (
            <IssueList issues={issues} openText={issueFilter?.text} onPick={setIssueFilter} />
          )}

          {/* Capped, or the panel takes whatever height its controls want and
              the list is squeezed to its floor of a few rows. It already
              scrolls, so it scrolls inside the cap instead. */}
          <div className="max-h-[55%] shrink-0 overflow-auto border-t border-slate-200">
            {selectedMarker ? (
              <MarkerPanel
                marker={selectedMarker}
                pageCount={pageCount}
                onChange={(patch) => patchMarker(selectedMarkerId, patch)}
                onDelete={() => deleteMarker(selectedMarkerId)}
                onDuplicate={() => duplicateMarker(selectedMarkerId)}
              />
            ) : selectedFields.length > 1 ? (
              <BulkPanel
                fields={selectedFields}
                dbIndex={dbIndex}
                onPatch={(patch) => patchFields(selectedIds, patch)}
                onDelete={() => selectedIds.forEach((id) => deleteField(id))}
                onClear={() => selectField(null)}
              />
            ) : (
            <PropertyPanel
              field={selected}
              dbFields={dbFields}
              dbIndex={dbIndex}
              caseIndex={caseIndex}
              systemIndex={systemIndex}
              buttonIndex={buttonIndex}
              specialNames={specialNames}
              locked={selected ? isFixedSystemPlacement(selected, fields, systemIndex) : false}
              nameTakenBy={selected ? nameTakenByType(selected, fields) : null}
              pageCount={pageCount}
              onChange={(patch) => patchField(selectedId, patch)}
              onNameSettled={() => settleName(selectedId)}
              onDelete={() => deleteField(selectedId)}
              onDuplicate={() => duplicateField(selectedId)}
            />
            )}
          </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}


function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="max-w-md text-center">
        <h2 className="text-base font-medium text-slate-700">Open a PDF to begin</h2>
        <p className="mt-2 text-sm text-slate-500">
          Drag on the page to draw a field, name it from the DB field list, then export the PDF
          and its requirements JSON.
        </p>
        <p className="mt-4 text-xs text-slate-400">
          A PDF exported here reopens with its field set intact.
        </p>
      </div>
    </div>
  );
}
