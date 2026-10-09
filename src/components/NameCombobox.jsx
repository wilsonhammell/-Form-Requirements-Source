import { useEffect, useMemo, useRef, useState } from 'react';
import { matchScore, searchDbFields } from '../core/dbFields.js';
import { isSpecialField } from '../core/specialFields.js';

// Offers the DB list but never blocks a custom name. What it will not do is
// quietly persist a label, only the identifier is ever written.
export default function NameCombobox({
  value,
  dbFields,
  dbIndex,
  caseIndex,
  specialNames = [],
  takenBy,
  type,
  onChange,
  onSettle,
}) {
  const [open, setOpen] = useState(false);
  // The box arrives holding a name, so filtering waits for a keystroke. Filter
  // by the name already there and every other choice is hidden.
  const [filtering, setFiltering] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const query = filtering ? value ?? '' : '';

  const matches = useMemo(() => searchDbFields(dbFields, query), [dbFields, query]);

  // Above the DB list, and only while placing one would be legal, which is what
  // keeps rows contiguous with no rule to break.
  const specialMatches = useMemo(() => {
    return specialNames.filter((o) => matchScore(o.name, o.label, query) >= 0);
  }, [specialNames, query]);

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
  // The most common near miss, and one that fails silently downstream.
  const nearMiss = !attempted && trimmed ? caseIndex.get(trimmed.toLowerCase()) : undefined;

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  // Scrolls the list itself, never the panel around it.
  const reveal = (index) => {
    const list = listRef.current;
    const item = list?.children[index];
    if (!item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  };

  const move = (index) => {
    setHighlight(index);
    reveal(index);
  };

  // Typing lands on the best match. Opening lands on the name already there, or
  // on nothing, so Enter straight after focus cannot swap it for the top entry.
  useEffect(() => {
    move(filtering ? 0 : options.findIndex((o) => o.identifier === trimmed));
  }, [value, filtering, open]);

  const choose = (identifier) => {
    onChange(identifier);
    onSettle?.();
    setFiltering(false);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      move(Math.min(highlight + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(Math.max(highlight - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && options[highlight]) {
        event.preventDefault();
        choose(options[highlight].identifier);
      } else {
        onSettle?.();
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
          setFiltering(true);
          setOpen(true);
        }}
        // Renaming is the common action and the box arrives with a name in it,
        // so a bare caret would mean selecting the lot by hand before every
        // edit. A second click still places the caret to amend.
        onFocus={(e) => {
          e.target.select();
          setFiltering(false);
          setOpen(true);
        }}
        // A pick leaves focus in the box, so no focus event follows to reopen it.
        onClick={() => setOpen(true)}
        onBlur={() => onSettle?.()}
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

      {takenBy && (
        <p className="mt-1 text-xs text-red-700">
          Already a {takenBy} field, one name cannot be both {takenBy} and {type}.
        </p>
      )}

      {open && options.length > 0 && (
        <ul ref={listRef} className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded border border-slate-300 bg-white shadow-lg">
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
                // Keeps focus in the box, or refocusing it after a pick reopens the list.
                onMouseDown={(e) => e.preventDefault()}
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
