import { STATUS } from '../core/batch.js';

// What each form of a batch is at, as a mark in the list. A select's options
// take text only, so the mark is a character rather than a colour.
const MARK = {
  [STATUS.NEW]: '  ',
  [STATUS.OPENED]: '·',
  [STATUS.EDITED]: '●',
  [STATUS.EXPORTED]: '✓',
  [STATUS.FAILED]: '✗',
};

const TITLE = {
  [STATUS.NEW]: 'not opened yet',
  [STATUS.OPENED]: 'opened, not changed',
  [STATUS.EDITED]: 'changed, not exported',
  [STATUS.EXPORTED]: 'exported',
  [STATUS.FAILED]: 'could not be opened',
};

// The run of PDFs opened together: Prev and Next to step through them in
// order, and the list to jump straight to one, each marked with where it is at
// so what still needs looking at is easy to find.
export default function BatchBar({ entries, index, statuses, busy, onPrev, onNext, onPick }) {
  const count = (status) => statuses.filter((s) => s === status).length;
  const edited = count(STATUS.EDITED);
  const exported = count(STATUS.EXPORTED);
  const unopened = count(STATUS.NEW);
  const failed = count(STATUS.FAILED);

  const arrow =
    'flex items-center gap-1 rounded px-3 py-1 text-sm font-medium text-white ' +
    'bg-slate-600 hover:bg-slate-500 disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <nav
      aria-label="Batch"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-slate-800 px-4 py-1.5 text-slate-100"
    >
      <button
        type="button"
        className={arrow}
        disabled={busy || index <= 0}
        onClick={onPrev}
        title="Previous form"
        aria-label="Previous form"
      >
        <span aria-hidden="true">‹</span> Prev
      </button>

      <label className="flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0 tabular-nums text-slate-300">
          {index + 1} of {entries.length}
        </span>
        <select
          aria-label="Form"
          className="min-w-0 max-w-[520px] rounded border border-slate-500 bg-slate-700 px-2 py-1 text-sm text-white"
          value={index}
          disabled={busy}
          onChange={(e) => onPick(Number(e.target.value))}
        >
          {entries.map((entry, i) => (
            <option key={entry.id} value={i} title={TITLE[statuses[i]]}>
              {`${MARK[statuses[i]] ?? ''} ${i + 1}. ${entry.name}`}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={arrow}
        disabled={busy || index >= entries.length - 1}
        onClick={onNext}
        title="Next form"
        aria-label="Next form"
      >
        Next <span aria-hidden="true">›</span>
      </button>

      <span className="text-xs text-slate-300" title="● changed, not exported · ✓ exported · · opened">
        {edited > 0 && <span className="text-amber-300">● {edited} edited, not exported</span>}
        {edited > 0 && (exported > 0 || unopened > 0) && ' · '}
        {exported > 0 && <span className="text-emerald-300">✓ {exported} exported</span>}
        {exported > 0 && unopened > 0 && ' · '}
        {unopened > 0 && <span>{unopened} not opened yet</span>}
        {failed > 0 && (edited > 0 || exported > 0 || unopened > 0) && ' · '}
        {failed > 0 && <span className="text-rose-300">✗ {failed} could not be opened</span>}
      </span>
    </nav>
  );
}
