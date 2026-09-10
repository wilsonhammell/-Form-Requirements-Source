import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Toolbar from './components/Toolbar.jsx';
import PdfCanvas from './components/PdfCanvas.jsx';
import FieldList, { fieldListOrder } from './components/FieldList.jsx';
import { fieldScope, FIELD_SCOPES } from './core/fieldTone.js';
import PropertyPanel from './components/PropertyPanel.jsx';
import BulkPanel from './components/BulkPanel.jsx';
import FormConfigPanel from './components/FormConfigPanel.jsx';
import { usePdfDocument } from './hooks/usePdfDocument.js';
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
  isSystemField,
  isLastSystemPlacement,
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
  parseDocument,
  serializeDocument,
  fieldIssues,
  SchemaError,
  DEFAULT_FONT,
  FONT_FAMILIES,
  nextRadioExportValue,
  createConfig,
} from './core/schema.js';

import { importPdf, SOURCE } from './core/pdfImport.js';
import { exportPdf } from './core/pdfExport.js';
import { serializeJsonBytes } from './core/pdfEmbed.js';
import { downloadBytes, sidecarName, exportedPdfName, requirementsName } from './core/download.js';
import { requirementsWorkbookBytes } from './core/excelExport.js';
import { renderPageImages } from './core/pageImages.js';

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
  const [fields, setFields] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  // Everything selected, the last row clicked included. One field is the common
  // case and keeps the property panel; more than one gets the bulk bar.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Set by clicking an issue, so the list shows only the fields it counted.
  // Null means no filter, which is the usual state.
  const [issueFilter, setIssueFilter] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [newFieldType, setNewFieldType] = useState('text');
  const [notices, setNotices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState(() => createConfig());
  const [panel, setPanel] = useState('fields');
  const [systemFields, setSystemFields] = useState([]);
  // Maintained in source rather than fetched, so it is ready on first render.
  const buttons = useMemo(() => signingButtons(), []);
  // Which groups are shown, not which one. They are independent, so the fields
  // a form is about can be looked at with the signer rows but without the
  // system plumbing, which is the usual way of working.
  const [scopes, setScopes] = useState(() => new Set(['standard']));
  const showScope = useCallback((...names) => setScopes(new Set(names)), []);
  const toggleScope = useCallback((id) => setScopes((current) => toggled(current, id)), []);

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
  useEffect(() => {
    setFields((current) => reconcileFields(current, dbIndex));
  }, [dbIndex]);

  const selected = fields.find((f) => f.id === selectedId) ?? null;
  const selectedFields = useMemo(
    () => fields.filter((f) => selectedIds.has(f.id)),
    [fields, selectedIds]
  );

  // The system fields outnumber the rest, so being able to look at one or the
  // other is what keeps a page readable. Both the list and the page follow it.
  const inScope = useCallback(
    (f) =>
      scopes.has(
        fieldScope(f, {
          system: isSystemField(f.name, systemIndex),
          submissionButton: isSubmissionButton(f.name, buttonIndex),
        })
      ),
    [scopes, systemIndex, buttonIndex]
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
  const selectField = useCallback(
    (id, modifiers = {}) => {
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

  // Worked out over every field, not the filtered set, so a display copy still
  // knows the canonical placement exists while that one is filtered away.
  const canonicalIds = useMemo(
    () => canonicalSystemIds(fields, systemIndex),
    [fields, systemIndex]
  );

  const pageFields = useMemo(
    () => scopedFields.filter((f) => f.page === pageIndex),
    [scopedFields, pageIndex]
  );
  const issues = useMemo(
    () => [
      ...fieldIssues(fields, dbIndex, systemIndex, isRuntimeFilledDropdown),
      // Only an imported PDF can carry these, since placing cannot produce one.
      ...specialFieldIssues(fields).map((text) => ({ text, level: 'error' })),
    ],
    [fields, dbIndex, systemIndex]
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
  }, []);

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
        setFields(reconcileSpecialTypes(result.fields));
        setConfig(result.config);
        setSelectedId(null);
        setPageIndex(0);
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
      const { fields: loaded, config: loadedConfig } = parseDocument(await file.text(), dbIndex);
      setFields(loaded);
      setConfig(loadedConfig);
      setSelectedId(null);
      say([`Loaded ${loaded.length} field${loaded.length === 1 ? '' : 's'} from ${file.name}.`]);
    } catch (err) {
      const why = err instanceof SchemaError ? err.message : `${err}`;
      say([`Could not import ${file.name}: ${why}`]);
    }
  };

  const handleCreateField = (rect) => {
    const field = createField({
      type: newFieldType,
      page: pageIndex,
      rect,
      // A radio option's placeholder depends on what is already placed.
      ...(newFieldType === 'radio' ? { exportValue: nextRadioExportValue(fields) } : {}),
    });
    setFields((current) => [...current, field]);
    setSelectedId(field.id);
  };

  const patchField = useCallback(
    (id, patch) => {
      setFields((current) =>
        current.map((f) => {
          if (f.id !== id) return f;
          const next = { ...f, ...patch };
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
        })
      );
    },
    [dbIndex, systemIndex]
  );

  // The same patch across a selection. Each field still goes through
  // reconcileField, so a flag that cannot stand on one of them comes straight
  // back off rather than being written and quietly ignored.
  const patchFields = useCallback(
    (ids, patch) => {
      setFields((current) =>
        current.map((f) => (ids.has(f.id) ? reconcileField({ ...f, ...patch }, dbIndex) : f))
      );
    },
    [dbIndex]
  );

  const handleChangeRect = useCallback((id, rect) => {
    setFields((current) => {
      const field = current.find((f) => f.id === id);
      const moved = current.map((f) => (f.id === id ? { ...f, rect } : f));
      // The label and code box sit against the Remote eSign button, so dragging
      // the button drags them too. A delta rather than a re-layout, so nudging
      // either one by hand survives the button moving afterwards.
      if (field?.name.trim() !== ESIGN_ANCHOR) return moved;
      return moveEsignCluster(moved, rect.x - field.rect.x, rect.y - field.rect.y);
    });
  }, []);

  const deleteField = useCallback(
    (id) => {
      if (!id) return;
      setFields((current) => {
        const field = current.find((f) => f.id === id);
        if (!field) return current;
        // Every system name must keep at least one placement. Extra copies of
        // one, put on the form to show the value, delete freely.
        if (isLastSystemPlacement(field, current, systemIndex)) {
          say([`"${field.name}" is a system field, its last placement cannot be removed.`]);
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
    [systemIndex, say]
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
        // Two options of one radio group cannot share a value, so a copy gets
        // the next free placeholder rather than a duplicate.
        ...(source.type === 'radio' ? { exportValue: nextRadioExportValue(fields) } : {}),
      });
      setFields((current) => [...current, copy]);
      setSelectedId(copy.id);
    },
    [fields]
  );

  // Delete works on the selection, unless the user is typing a name.
  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedId) return;
        event.preventDefault();
        deleteField(selectedId);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        if (!selectedId) return;
        event.preventDefault();
        duplicateField(selectedId);
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
  }, [selectedId, deleteField, duplicateField, scopedFields, fields, selectField]);

  // Its own path, so nothing here touches the PDF export.
  const handleExportRequirements = () =>
    whileBusy(
      async () => {
        const bytes = await requirementsWorkbookBytes({
          doc: serializeDocument(fields, { sourceFileName: fileName, config }),
          buttons,
          systemIndex,
          buttonIndex,
          dbIndex,
          pageImages: await renderPageImages(doc),
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
        const { pdfBytes, jsonBytes, warnings } = await exportPdf({
          originalBytes,
          fields,
          buttons,
          systemFields,
          meta: { sourceFileName: fileName, config },
        });
        downloadBytes(pdfBytes, exportedPdfName(fileName), 'application/pdf');
        downloadBytes(jsonBytes, sidecarName(fileName), 'application/json');
        say([`Exported ${exportedPdfName(fileName)} and ${sidecarName(fileName)}.`, ...warnings]);
      },
      (err) => `Export failed: ${err.message}`
    );

  const handleExportJson = () => {
    const bytes = serializeJsonBytes(
      serializeDocument(fields, { sourceFileName: fileName, config })
    );
    downloadBytes(bytes, sidecarName(fileName), 'application/json');
    say([`Exported ${sidecarName(fileName)}.`]);
  };

  // Bulk reset, not a lock: any field can still be tweaked afterward from the
  // property panel.
  const handleEnforceFontStandards = () => {
    setFields((current) => current.map((f) => ({ ...f, font: { ...DEFAULT_FONT } })));
    say([
      `Set ${fields.length} field${fields.length === 1 ? '' : 's'} to ${DEFAULT_FONT_LABEL} ${DEFAULT_FONT.size}.`,
    ]);
  };

  return (
    <div className="flex h-full flex-col bg-slate-100 text-slate-900">
      <Toolbar
        fileName={fileName}
        pageIndex={pageIndex}
        pageCount={pageCount}
        zoom={zoom}
        newFieldType={newFieldType}
        hasPdf={!!doc}
        busy={busy}
        onOpenPdf={handleOpenPdf}
        onImportJson={handleImportJson}
        onExportPdf={handleExportPdf}
        onExportJson={handleExportJson}
        onExportRequirements={handleExportRequirements}
        onPageChange={setPageIndex}
        onZoomChange={setZoom}
        onNewFieldType={setNewFieldType}
        onEnforceFontStandards={handleEnforceFontStandards}
      />

      {(notices.length > 0 || dbError || pdfError) && (
        <div className="border-b border-slate-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-900">
          {dbError && <p>Could not load the DB field list: {dbError}</p>}
          {pdfError && <p>Could not read the PDF: {pdfError.message}</p>}
          {notices.map((note, i) => (
            <p key={i}>{note}</p>
          ))}
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
              selectedId={selectedId}
              dbIndex={dbIndex}
              canonicalIds={canonicalIds}
              buttonIndex={buttonIndex}
              newFieldType={newFieldType}
              selectedIds={selectedIds}
              onSelect={selectField}
              onCreateField={handleCreateField}
              onChangeRect={handleChangeRect}
            />
          ) : (
            <EmptyState />
          )}
        </main>

        <aside className="flex w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="flex border-b border-slate-200">
            {[
              ['fields', 'Fields', fields.length],
              ['config', 'Config', config.productCodes.length || null],
            ].map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                aria-pressed={panel === id}
                className={`flex flex-1 items-baseline justify-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
                  panel === id
                    ? 'border-b-2 border-sky-600 text-slate-700'
                    : 'border-b-2 border-transparent text-slate-400 hover:text-slate-600'
                }`}
                onClick={() => setPanel(id)}
              >
                {label}
                {count !== null && (
                  <span className="text-[10px] font-normal text-slate-400">{count}</span>
                )}
              </button>
            ))}
          </div>

          {panel === 'config' ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <FormConfigPanel
                config={config}
                onChange={(patch) => setConfig((current) => createConfig({ ...current, ...patch }))}
                buttons={buttons}
                isButtonOn={(id) => hasButton(fields, id)}
                signerRows={signerRows}
                jointRows={jointRows}
                hasCombined={hasCombined}
                maxSignerRows={MAX_SIGNER_ROWS}
                maxJointRows={MAX_JOINT_ROWS}
                // Puts back a part deleted from a row, or starts a joint one,
                // without having to draw a box and find the name first.
                onPlaceSpecial={(name) => {
                  setFields((current) => {
                    const anchor = current.find((f) => f.name.trim() === ESIGN_ANCHOR);
                    return addSpecialField(current, name, pageBox, pageIndex, anchor?.rect ?? null);
                  });
                  showScope(isEsignField(name) ? 'submission' : 'signers');
                }}
                // Rows land stacked, out of the way, since only the artwork
                // knows where they belong. Follow to the scope that shows them.
                onAddSignerRow={() => {
                  setFields((current) => addSignerRow(current, pageBox, pageIndex));
                  showScope('signers');
                }}
                // Buttons live in their own scope, so turning one on while
                // looking at another scope looks like nothing happened. Follow
                // the change to where it is visible.
                onToggleButton={(entry, on) => {
                  setFields((current) => {
                    const next = on
                      ? addButton(current, entry, buttons, pageBox, pageIndex)
                      : removeButton(current, entry.identifier);
                    // The label and code box are part of the Remote eSign
                    // channel, so they come and go with its button.
                    if (entry.identifier !== ESIGN_ANCHOR) return next;
                    const button = next.find((f) => f.name.trim() === ESIGN_ANCHOR);
                    return on && button
                      ? addEsignFields(next, button.rect, button.page)
                      : removeEsignFields(next);
                  });
                  if (on) showScope('submission');
                }}
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
            shown={scopedFields.length}
            total={fields.length}
          />

          <div className="min-h-[6rem] flex-1 overflow-auto">
            <FieldList
              fields={scopedFields}
              selectedId={selectedId}
              selectedIds={selectedIds}
              dbIndex={dbIndex}
              systemIndex={systemIndex}
              canonicalIds={canonicalIds}
              onSelect={selectField}
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
            {selectedFields.length > 1 ? (
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
              locked={selected ? isLastSystemPlacement(selected, fields, systemIndex) : false}
              pageCount={pageCount}
              onChange={(patch) => patchField(selectedId, patch)}
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

// Independent toggles rather than tabs. Every field is in exactly one group, so
// any subset is a legible view and All is simply all four on, which doubles as
// the way back. The labels come off FIELD_SCOPES so a fifth group cannot be
// added to the model and quietly go missing here.
const scopeLabel = (id) => id[0].toUpperCase() + id.slice(1);

function ScopeBar({ scopes, onShowAll, onToggle, issueFilter, onClearFilter, shown, total }) {
  const all = scopes.size === FIELD_SCOPES.length;
  const pill = (on) =>
    `rounded px-1.5 py-0.5 text-[11px] font-medium ${
      on ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-100'
    }`;

  return (
    <div className="flex gap-1 border-b border-slate-200 px-3 py-1.5">
      <button type="button" aria-pressed={all} className={pill(all)} onClick={onShowAll}>
        All
      </button>
      {FIELD_SCOPES.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={scopes.has(id)}
          className={pill(scopes.has(id))}
          onClick={() => onToggle(id)}
        >
          {scopeLabel(id)}
        </button>
      ))}
      {issueFilter ? (
        <button
          type="button"
          className="ml-auto self-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 hover:bg-amber-200"
          onClick={onClearFilter}
          title={issueFilter.text}
        >
          showing {shown} from an issue, clear
        </button>
      ) : (
        <span className="ml-auto self-center text-[10px] text-slate-400">
          {shown} of {total}
        </span>
      )}
    </div>
  );
}

const ISSUE_TONE = { error: 'text-red-700', warn: 'text-amber-700' };

function IssueList({ issues, openText, onPick }) {
  return (
    <ul className="border-t border-slate-200 px-3 py-2 text-xs">
      {issues.map((issue, i) => {
        const tone = ISSUE_TONE[issue.level] ?? 'text-slate-500';
        // Only an issue that named fields can be filtered to. A missing signer
        // row has none, since the whole complaint is that it is not there.
        if (!issue.ids || issue.ids.length === 0) {
          return (
            <li key={i} className={tone}>
              {issue.text}
            </li>
          );
        }
        const open = openText === issue.text;
        return (
          <li key={i}>
            <button
              type="button"
              className={`w-full text-left underline decoration-dotted underline-offset-2 hover:decoration-solid ${tone} ${
                open ? 'font-semibold decoration-solid' : ''
              }`}
              onClick={() => onPick(open ? null : issue)}
            >
              {issue.text}
            </button>
          </li>
        );
      })}
    </ul>
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
