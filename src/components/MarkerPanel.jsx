// The panel for an initials marker. Its own component rather than a branch in
// PropertyPanel, because a marker shares none of a field's controls: it has no
// name, no type, no font, no validation and nothing that reaches the PDF.

const LABEL = 'block text-xs font-medium text-slate-600';
const INPUT =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';
const HINT = 'text-xs text-slate-400';

export default function MarkerPanel({ marker, pageCount, onChange, onDelete, onDuplicate }) {
  const role = (marker.role ?? '').trim();

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
        Initials marker. It records where FileOptics should be configured to put an initials box
        and who initials there. Nothing about it is written to the PDF.
      </p>

      <div>
        <label className={LABEL}>
          Who initials here
          {!role && <span className="ml-1 font-normal text-red-600">required</span>}
        </label>
        <input
          type="text"
          className={`${INPUT} ${role ? '' : 'border-red-400'}`}
          value={marker.role ?? ''}
          placeholder="Branch manager, guarantor, member..."
          onChange={(e) => onChange({ role: e.target.value })}
        />
        <p className={`${HINT} mt-1`}>
          {role
            ? 'Goes in the requirements workbook and on the page picture.'
            : 'Without it the workbook cannot say whose initials this is.'}
        </p>
      </div>

      <div>
        <label className={LABEL}>Note</label>
        <textarea
          className={`${INPUT} min-h-[64px]`}
          value={marker.note ?? ''}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-slate-50 p-2 text-xs">
        <dt className="text-slate-500">Page</dt>
        <dd className="text-right font-mono text-slate-700">
          {marker.page + 1} of {pageCount || '?'}
        </dd>
        <dt className="text-slate-500">x, y</dt>
        <dd className="text-right font-mono text-slate-700">
          {round(marker.rect.x)}, {round(marker.rect.y)}
        </dd>
        <dt className="text-slate-500">w x h</dt>
        <dd className="text-right font-mono text-slate-700">
          {round(marker.rect.width)} x {round(marker.rect.height)}
        </dd>
        <dt className="col-span-2 pt-1 text-[10px] uppercase tracking-wide text-slate-400">
          PDF user space, points
        </dt>
      </dl>

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          onClick={onDuplicate}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="flex-1 rounded border border-red-300 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

const round = (n) => Math.round(n * 100) / 100;
