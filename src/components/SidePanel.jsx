import { FIELD_SCOPES } from '../core/fieldTone.js';

const PANELS = [
  ['fields', 'Fields'],
  ['config', 'Config'],
];

export function PanelTabs({ panel, onPick, counts }) {
  return (
    <div className="flex border-b border-slate-200">
      {PANELS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={panel === id}
          className={`flex flex-1 items-baseline justify-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide ${
            panel === id
              ? 'border-sky-600 text-slate-700'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
          onClick={() => onPick(id)}
        >
          {label}
          {counts[id] !== null && (
            <span className="text-[10px] font-normal text-slate-400">{counts[id]}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// Independent toggles rather than tabs. Every field is in exactly one group, so
// any subset is a legible view and All is simply all four on, which doubles as
// the way back. The labels come off FIELD_SCOPES so a fifth group cannot be
// added to the model and quietly go missing here.
const scopeLabel = (id) => id[0].toUpperCase() + id.slice(1);

export function ScopeBar({ scopes, onShowAll, onToggle, issueFilter, onClearFilter, shown, total }) {
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

export function IssueList({ issues, openText, onPick }) {
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
