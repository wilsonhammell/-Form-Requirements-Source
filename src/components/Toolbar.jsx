import { useEffect, useRef, useState } from 'react';
import { DRAW_MARKER } from '../core/markers.js';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// The same bounds the property panel's font size box uses.
const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 72;

// One button each, so adding a field type is a line here and nothing else.
const DRAW_TYPES = [
  { type: 'text', label: 'Text' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'dropdown', label: 'Dropdown' },
];

// Set apart by a rule, because this one does not draw a field. It records where
// FileOptics should be configured to put an initials box and never reaches the
// PDF.
const DRAW_MARKERS = [{ type: DRAW_MARKER, label: 'Initials' }];

export default function Toolbar({
  fileName,
  pageIndex,
  pageCount,
  zoom,
  drawKind,
  hasPdf,
  busy,
  commentsShown,
  onToggleComments,
  onOpenPdf,
  onImportJson,
  onImportFormTable,
  onExportPdf,
  onExportJson,
  onExportRequirements,
  onPageChange,
  onZoomChange,
  onDrawKind,
  onEnforceFontStandards,
  suggestedSize,
  noticesHidden,
  onShowNotices,
}) {
  const pdfInput = useRef(null);
  const jsonInput = useRef(null);
  const tableInput = useRef(null);
  const [fontSize, setFontSize] = useState('');

  // Typed, not assumed: the size a form is standardised on differs from form to
  // form, so the button waits for one rather than picking it.
  const size = Number(fontSize);
  const sizeGiven =
    fontSize.trim() !== '' && Number.isFinite(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE;

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-white px-4 py-2">
      {/* Outside the menus, which unmount on close, so the picker a menu item
          opens still has an input to report back to. */}
      {/* Several at once, a folder's worth: they open as a batch to step
          through with Prev and Next. */}
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length > 0) onOpenPdf(files);
        }}
      />
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
      <input
        ref={tableInput}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onImportFormTable(file);
        }}
      />

      <h1 className="text-sm font-semibold text-slate-800">PDF Requirement Designer</h1>

      {fileName && (
        <span className="max-w-[220px] truncate text-xs text-slate-500" title={fileName}>
          {fileName}
        </span>
      )}

      {/* A dropdown rather than Prev and Next, so every page is one pick away,
          a page with nothing placed on it included. */}
      <select
        aria-label="Page"
        className="rounded border border-slate-300 px-1.5 py-1 text-xs"
        value={hasPdf && pageCount > 0 ? pageIndex : 0}
        disabled={!hasPdf}
        onChange={(e) => onPageChange(Number(e.target.value))}
      >
        {hasPdf && pageCount > 0 ? (
          Array.from({ length: pageCount }, (_, page) => (
            <option key={page} value={page}>
              Page {page + 1} of {pageCount}
            </option>
          ))
        ) : (
          <option value={0}>Page 0 of {pageCount}</option>
        )}
      </select>

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
          <DrawButton
            key={type}
            label={label}
            disabled={!hasPdf}
            on={drawKind === type}
            onClick={() => onDrawKind(type)}
          />
        ))}
        <span className="mx-0.5 h-4 w-px bg-slate-300" />
        {DRAW_MARKERS.map(({ type, label }) => (
          <DrawButton
            key={type}
            label={label}
            disabled={!hasPdf}
            on={drawKind === type}
            marker
            onClick={() => onDrawKind(type)}
          />
        ))}
      </div>

      {/* Filled when on, the way a filter pill is, since it shows and hides
          rather than picking what a drag draws. */}
      <button
        type="button"
        disabled={!hasPdf}
        aria-pressed={commentsShown}
        className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
          commentsShown
            ? 'border-slate-700 bg-slate-700 text-white'
            : 'border-slate-300 text-slate-700 hover:bg-slate-50'
        }`}
        onClick={onToggleComments}
      >
        Comments
      </button>

      <div className="flex items-center gap-1.5">
        {/* Before the box rather than after it, so the pair stays a pair and
            the row reads in the order it is used: here is the size the form is
            printed in, type one, apply it. */}
        {typeof suggestedSize === 'number' && (
          <span className="text-xs text-slate-500">Suggested Size - {suggestedSize}</span>
        )}
        <input
          type="number"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          step={0.5}
          value={fontSize}
          disabled={!hasPdf}
          placeholder="Size"
          aria-label="Font size"
          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-40"
          onChange={(e) => setFontSize(e.target.value)}
        />
        <Button disabled={!hasPdf || !sizeGiven} onClick={() => onEnforceFontStandards(size)}>
          Enforce Font Standards
        </Button>
      </div>

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
        <Menu
          label="Import"
          items={[
            { label: 'Open PDF(s)', onClick: () => pdfInput.current?.click() },
            { label: 'Import JSON', disabled: !hasPdf, onClick: () => jsonInput.current?.click() },
            { label: 'Fill from Form Table', disabled: !hasPdf, onClick: () => tableInput.current?.click() },
          ]}
        />
        <Menu
          label={busy ? 'Exporting...' : 'Export'}
          primary
          disabled={!hasPdf}
          items={[
            { label: 'Export JSON', onClick: onExportJson },
            { label: 'Export Requirements', disabled: busy, onClick: onExportRequirements },
            { label: 'Export PDF', disabled: busy, onClick: onExportPdf },
          ]}
        />
      </div>
    </header>
  );
}

// A button that opens its actions underneath. Closes on a pick, a click anywhere
// else, or Escape.
function Menu({ label, items, primary, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        primary={primary}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex items-center gap-1">
          {label}
          <svg viewBox="0 0 10 6" className="h-1.5 w-2.5" aria-hidden="true">
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-full rounded border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Amber when it is on, the marker's colour everywhere else, so the page you are
// about to draw on and the box you draw agree.
function DrawButton({ label, on, marker, disabled, onClick }) {
  const active = marker ? 'border-amber-600 bg-amber-600 text-white' : 'border-sky-600 bg-sky-600 text-white';
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      className={`rounded border px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${
        on ? active : 'border-slate-300 text-slate-700 hover:bg-slate-50'
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Button({ children, onClick, disabled, primary, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...rest}
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
