import { useEffect, useMemo, useRef, useState } from 'react';
import { searchDbFields } from '../core/dbFields.js';
import { isSpecialField } from '../core/specialFields.js';

// The name is the whole point of the tool, so this shows the DB list to pick
// from but never blocks a custom name. What it will not do is quietly persist a
// label, only the identifier is ever written.
export default function NameCombobox({
  value,
  dbFields,
  dbIndex,
  caseIndex,
  specialNames = [],
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const matches = useMemo(
    () => searchDbFields(dbFields, value ?? '', 40),
    [dbFields, value]
  );

  // Signer and joint names are offered above the DB list, and only while
  // placing one would be legal. That is what keeps rows contiguous and the
  // combined line unique, with no rule to break.
  const specialMatches = useMemo(() => {
    const q = (value ?? '').trim().toLowerCase();
    const hit = (o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q);
    return specialNames.filter((o) => !q || hit(o)).slice(0, 12);
  }, [specialNames, value]);

  const options = useMemo(
    () => [
      ...specialMatches.map((o) => ({ identifier: o.name, label: o.label, special: true })),
      ...matches.map((m) => ({ identifier: m.identifier, label: m.label, special: false })),
    ],
    [specialMatches, matches]
  );

  const trimmed = (value ?? '').trim();
  const special = isSpecialField(trimmed);
  const attempted = dbIndex.has(trimmed);
  // An exact match on everything but case is the most common near miss, and it
  // fails silently downstream, so call it out.
  const nearMiss = !attempted && trimmed ? caseIndex.get(trimmed.toLowerCase()) : undefined;

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  useEffect(() => setHighlight(0), [value]);

  const choose = (identifier) => {
    onChange(identifier);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && options[highlight]) {
        event.preventDefault();
        choose(options[highlight].identifier);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <label className="block text-xs font-medium text-slate-600">Name</label>
      <input
        ref={inputRef}
        type="text"
        value={value ?? ''}
        spellCheck={false}
        autoComplete="off"
        placeholder="Pick from the DB list or type a custom name"
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        // Selected on focus so the existing name can be typed straight over.
        // Renaming is the common action here and a field arrives with a name
        // already in the box, so a bare caret means selecting the lot by hand
        // before every edit. A second click still places the caret to amend.
        onFocus={(e) => {
          e.target.select();
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      <div className="mt-1.5 flex items-center gap-2">
        {special ? (
          <span className="inline-flex items-center gap-1 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-800">
            Signer field, filled by the starter code
          </span>
        ) : attempted ? (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">
            Load Attempted
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
            Custom name, not in DB list
          </span>
        )}
        {attempted && (
          <span className="truncate text-xs text-slate-500">{dbIndex.get(trimmed).label}</span>
        )}
      </div>

      {nearMiss && (
        <button
          type="button"
          className="mt-1 block text-left text-xs text-amber-700 underline decoration-dotted"
          onClick={() => choose(nearMiss.identifier)}
        >
          Case differs from {nearMiss.identifier}, matching is exact. Use it?
        </button>
      )}

      {open && options.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded border border-slate-300 bg-white shadow-lg">
          {options.map((entry, index) => (
            <li key={entry.identifier}>
              {entry.special && index === 0 && (
                <div className="bg-teal-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                  Signer and joint fields
                </div>
              )}
              {!entry.special && index > 0 && options[index - 1].special && (
                <div className="bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  DB fields
                </div>
              )}
              <button
                type="button"
                className={`flex w-full items-baseline justify-between gap-3 px-2 py-1.5 text-left text-sm ${
                  index === highlight ? 'bg-sky-50' : 'hover:bg-slate-50'
                }`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(entry.identifier)}
              >
                <span className={`font-mono ${entry.special ? 'text-teal-800' : 'text-slate-800'}`}>
                  {entry.identifier}
                </span>
                <span className="truncate text-xs text-slate-500">{entry.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
