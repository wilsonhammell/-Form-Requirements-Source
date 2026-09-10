import { isLoadAttempted } from '../core/schema.js';

// What replaces the property panel when more than one field is selected.
//
// Only the flags worth setting in bulk are here. A customer facing name and a
// note are per field by nature, and Custom Save Validation needs a note each, so
// it can only be turned off from here, never on.
export default function BulkPanel({ fields, dbIndex, onPatch, onDelete, onClear }) {
  const count = (predicate) => fields.filter(predicate).length;

  // Load Validation cannot stand on a name the database does not have, so
  // reconcileField would drop it straight back off. Saying so beats a button
  // that silently does nothing on half the selection.
  const skipped = count((f) => !isLoadAttempted(f.name, dbIndex));

  const lv = count((f) => f.loadValidated);
  const sv = count((f) => f.saveValidated);
  const csv = count((f) => f.customSaveValidated);

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3 text-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold text-slate-800">{fields.length} fields selected</h2>
        <button
          type="button"
          className="text-xs text-slate-500 underline hover:text-slate-800"
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      <Row label="Load Validation" on={lv} total={fields.length}>
        <Set on={() => onPatch({ loadValidated: true })} off={() => onPatch({ loadValidated: false })} />
      </Row>
      {skipped > 0 && (
        <p className="-mt-2 text-xs text-amber-700">
          {skipped} of these {skipped === 1 ? 'is' : 'are'} not in the DB field list, so Load
          Validation will not stick on {skipped === 1 ? 'it' : 'them'}.
        </p>
      )}

      <Row label="Save Validation" on={sv} total={fields.length}>
        <Set
          on={() => onPatch({ saveValidated: true, customSaveValidated: false })}
          off={() => onPatch({ saveValidated: false })}
        />
      </Row>

      <Row label="Custom Save Validation" on={csv} total={fields.length}>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-40"
          disabled={csv === 0}
          onClick={() => onPatch({ customSaveValidated: false })}
        >
          Clear
        </button>
      </Row>
      <p className="-mt-2 text-xs text-slate-500">
        Each one needs its own note, so it is set per field.
      </p>

      <div className="mt-auto border-t border-slate-200 pt-3">
        <button
          type="button"
          className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
          onClick={onDelete}
        >
          Delete {fields.length} fields
        </button>
      </div>
    </div>
  );
}

function Row({ label, on, total, children }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-700">
        {label}
        <span className="ml-1.5 text-xs text-slate-400">
          {on} of {total}
        </span>
      </span>
      <span className="flex gap-1">{children}</span>
    </div>
  );
}

function Set({ on, off }) {
  return (
    <>
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
        onClick={on}
      >
        All
      </button>
      <button
        type="button"
        className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
        onClick={off}
      >
        None
      </button>
    </>
  );
}
