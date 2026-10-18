import { useEffect, useState } from 'react';
import { VERDICT } from '../core/review.js';

const LOOK = {
  [VERDICT.NONE]: { text: 'Not reviewed', cls: 'bg-slate-600 text-slate-100' },
  [VERDICT.APPROVED]: { text: 'Approved', cls: 'bg-emerald-600 text-white' },
  [VERDICT.CHANGES]: { text: 'Needs changes', cls: 'bg-amber-500 text-slate-900' },
  [VERDICT.REBUILT]: { text: 'Rebuilt since your verdict - look again', cls: 'bg-sky-500 text-white' },
};

// The verdict on the form on screen, given here and kept on disk by the
// review station: Approve, or Needs changes with a note saying what. The note
// is saved when it loses focus, and with either button.
export default function ReviewBar({ form, verdict, status, counts, saving, onVerdict, onNextToReview, changes, onShowField }) {
  const [note, setNote] = useState(verdict?.note ?? '');
  // a different form, or a verdict saved: the box shows what is on disk
  useEffect(() => setNote(verdict?.note ?? ''), [form?.name, verdict?.note]);

  const btn = 'rounded px-3 py-1 text-sm font-medium disabled:opacity-40';
  const look = LOOK[status] ?? LOOK[VERDICT.NONE];
  const left = counts[VERDICT.NONE] + counts[VERDICT.REBUILT];
  return (
    <section
      aria-label="Review"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-700 bg-slate-900 px-4 py-1.5 text-slate-100"
    >
      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${look.cls}`}>{look.text}</span>
      <button
        type="button"
        className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
        disabled={saving}
        onClick={() => onVerdict(VERDICT.APPROVED, note)}
      >
        Approve
      </button>
      <button
        type="button"
        className={`${btn} bg-amber-500 text-slate-900 hover:bg-amber-400`}
        disabled={saving}
        onClick={() => onVerdict(VERDICT.CHANGES, note)}
      >
        Needs changes
      </button>
      <input
        aria-label="Note"
        className="min-w-[240px] flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-white placeholder:text-slate-400"
        placeholder="What needs changing (saved when you click away)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => {
          if (note !== (verdict?.note ?? '')) onVerdict(verdict?.status ?? VERDICT.NONE, note);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button
        type="button"
        className={`${btn} bg-slate-600 text-white hover:bg-slate-500`}
        disabled={saving || (!verdict && !note)}
        onClick={() => onVerdict(VERDICT.NONE, '')}
        title="Clear the verdict and note"
      >
        Clear
      </button>
      <button
        type="button"
        className={`${btn} bg-slate-600 text-white hover:bg-slate-500`}
        disabled={left === 0}
        onClick={onNextToReview}
        title="The next form with no verdict, or rebuilt since its verdict"
      >
        Next to review ›
      </button>
      <span className="text-xs text-slate-300">
        <span className="text-emerald-300">{counts[VERDICT.APPROVED]} approved</span>
        {' · '}
        <span className="text-amber-300">{counts[VERDICT.CHANGES]} need changes</span>
        {counts[VERDICT.REBUILT] > 0 && (
          <>
            {' · '}
            <span className="text-sky-300">{counts[VERDICT.REBUILT]} rebuilt since</span>
          </>
        )}
        {' · '}
        {counts[VERDICT.NONE]} not reviewed
      </span>
      {status === VERDICT.REBUILT && changes && (
        <div className="basis-full rounded bg-slate-800 px-2 py-1 text-xs text-slate-200">
          <span className="font-semibold text-sky-300">
            What changed since your verdict
            {changes.basis === 'history' ? ' (from the mapping history)' : ''}:
          </span>
          {changes.changes.length === 0 ? (
            <span> nothing found that a reviewer would see.</span>
          ) : (
            <ul className="mt-1 max-h-32 list-none overflow-y-auto">
              {changes.changes.map((c, i) => (
                <li key={i}>
                  {c.field ? (
                    <button
                      type="button"
                      className="font-mono text-sky-300 underline hover:text-sky-200"
                      onClick={() => onShowField(c.field)}
                      title="Show this field"
                    >
                      {c.field}
                    </button>
                  ) : null}
                  {c.field ? ': ' : '• '}
                  {c.what}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
