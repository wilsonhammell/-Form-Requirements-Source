import { useRef } from 'react';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// One button each, so adding a field type is a line here and nothing else.
const DRAW_TYPES = [
  { type: 'text', label: 'Text' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'radio', label: 'Radio' },
  { type: 'dropdown', label: 'Dropdown' },
];

export default function Toolbar({
  fileName,
  pageIndex,
  pageCount,
  zoom,
  newFieldType,
  hasPdf,
  busy,
  onOpenPdf,
  onImportJson,
  onExportPdf,
  onExportJson,
  onExportRequirements,
  onPageChange,
  onZoomChange,
  onNewFieldType,
  onEnforceFontStandards,
  noticesHidden,
  onShowNotices,
}) {
  const pdfInput = useRef(null);
  const jsonInput = useRef(null);

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-slate-800">PDF Requirement Designer</h1>
        <input
          ref={pdfInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onOpenPdf(file);
          }}
        />
        <Button onClick={() => pdfInput.current?.click()}>Open PDF</Button>
      </div>

      {fileName && (
        <span className="max-w-[220px] truncate text-xs text-slate-500" title={fileName}>
          {fileName}
        </span>
      )}

      <div className="flex items-center gap-1">
        <Button disabled={!hasPdf || pageIndex <= 0} onClick={() => onPageChange(pageIndex - 1)}>
          Prev
        </Button>
        <span className="min-w-[86px] text-center text-xs text-slate-600">
          Page {hasPdf ? pageIndex + 1 : 0} of {pageCount}
        </span>
        <Button
          disabled={!hasPdf || pageIndex >= pageCount - 1}
          onClick={() => onPageChange(pageIndex + 1)}
        >
          Next
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <label className="text-xs text-slate-500">Zoom</label>
        <select
          className="rounded border border-slate-300 px-1.5 py-1 text-xs"
          value={zoom}
          disabled={!hasPdf}
          onChange={(e) => onZoomChange(Number(e.target.value))}
        >
          {ZOOMS.map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="text-xs text-slate-500">Draw</label>
        {DRAW_TYPES.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            disabled={!hasPdf}
            aria-pressed={newFieldType === type}
            className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
              newFieldType === type
                ? 'border-sky-600 bg-sky-600 text-white'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => onNewFieldType(type)}
          >
            {label}
          </button>
        ))}
      </div>

      <Button disabled={!hasPdf} onClick={onEnforceFontStandards}>
        Enforce Font Standards
      </Button>

      <div className="ml-auto flex items-center gap-2">
        {noticesHidden && (
          <button
            type="button"
            className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
            onClick={onShowNotices}
          >
            Messages
          </button>
        )}
        <input
          ref={jsonInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImportJson(file);
          }}
        />
        <Button disabled={!hasPdf} onClick={() => jsonInput.current?.click()}>
          Import JSON
        </Button>
        <Button disabled={!hasPdf} onClick={onExportJson}>
          Export JSON
        </Button>
        <Button disabled={!hasPdf || busy} onClick={onExportRequirements}>
          Export Requirements
        </Button>
        <Button primary disabled={!hasPdf || busy} onClick={onExportPdf}>
          {busy ? 'Exporting...' : 'Export PDF'}
        </Button>
      </div>
    </header>
  );
}

function Button({ children, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
        primary
          ? 'bg-sky-600 text-white hover:bg-sky-700 disabled:hover:bg-sky-600'
          : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
