import { useEffect, useRef, useState } from 'react';
import { parseOptionLines, formatOptionLines } from '../core/schema.js';

// One option per line, the value written into the PDF and the text the reader
// sees. A bare line means both, and "ON = Ontario" splits them.
export default function OptionsEditor({ options, onChange }) {
  const [draft, setDraft] = useState(() => formatOptionLines(options));

  // Typing reparses, which comes back as a new array every keystroke. Resyncing
  // on that would rewrite the box mid line and swallow the newline or the equals
  // just typed, so a change this box caused is skipped and only a field selected
  // elsewhere refills it.
  const typing = useRef(false);
  useEffect(() => {
    if (typing.current) {
      typing.current = false;
      return;
    }
    setDraft(formatOptionLines(options));
  }, [options]);

  const paired = options.filter((o) => o.value !== o.label);

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600">
        Options <span className="font-normal text-slate-400">one per line</span>
      </label>
      <textarea
        rows={5}
        spellCheck={false}
        value={draft}
        placeholder={'SOLE\nCORP = Corporation'}
        className="mt-1 w-full resize-y rounded border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        onChange={(e) => {
          typing.current = true;
          setDraft(e.target.value);
          onChange(parseOptionLines(e.target.value));
        }}
        onBlur={() => setDraft(formatOptionLines(options))}
      />
      <p className="mt-1 text-xs text-slate-500">
        {options.length} option{options.length === 1 ? '' : 's'}. Write{' '}
        <span className="font-mono">value = label</span> where the stored value differs from what
        the reader sees.
      </p>

      {paired.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 rounded bg-slate-50 p-2">
          {paired.map((o) => (
            <li key={o.value} className="flex items-baseline gap-1.5 text-xs">
              <span className="font-mono text-slate-700">{o.value}</span>
              <span className="text-slate-400">shows as</span>
              <span className="truncate text-slate-600">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
