import { useEffect, useMemo, useState } from 'react';
import { defaultSheet } from '../core/formTable.js';

// Picks one form out of the forms workbook. Closes on a pick, Cancel or Escape.
export default function FormTablePicker({ fileName, sheets, onPick, onClose }) {
  const [sheetName, setSheetName] = useState(() => defaultSheet(sheets)?.name ?? '');
  const [query, setQuery] = useState('');
  const sheet = sheets.find((s) => s.name === sheetName) ?? sheets[0];

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const rows = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return sheet.rows.filter((row) => {
      const text = `${row.values.formName} ${row.values.formId ?? ''}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [sheet, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded bg-white shadow-xl">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Fill from Form Table</h2>
            <span className="truncate text-xs text-slate-500" title={fileName}>
              {fileName}
            </span>
          </div>
          {sheets.length > 1 && (
            <select
              value={sheet.name}
              aria-label="Sheet"
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              onChange={(e) => setSheetName(e.target.value)}
            >
              {sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            autoFocus
            spellCheck={false}
            value={query}
            placeholder="Search"
            aria-label="Search"
            className="rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rows.length === 1) onPick(sheet, rows[0]);
            }}
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-auto py-1">
          {rows.map((row) => (
            <li key={row.row}>
              <button
                type="button"
                className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-sky-50"
                onClick={() => onPick(sheet, row)}
              >
                <span>{row.values.formName}</span>
                {row.values.formId && !/^n\/?a$/i.test(row.values.formId) && (
                  <span className="shrink-0 font-mono text-xs text-slate-500">{row.values.formId}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t border-slate-200 p-2">
          <button
            type="button"
            className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
