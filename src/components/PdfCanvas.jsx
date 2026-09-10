import { useCallback, useEffect, useRef, useState } from 'react';
import {
  makePageGeometry,
  pdfRectToView,
  viewRectToPdf,
  clampRectToPage,
} from '../core/coords.js';
import { isLoadAttempted } from '../core/schema.js';
import { BUTTON_STYLE } from '../core/signingButtons.js';
import { fieldTone } from '../core/fieldTone.js';

// Border, fill and name tag per tone. Load Attempted takes an emerald border but
// keeps the ordinary blue fill, so the page does not read as a wall of green.
const TONE_STYLE = {
  button: { border: 'border-violet-500', fill: 'bg-violet-400/15', tag: 'bg-violet-500' },
  special: { border: 'border-teal-600', fill: 'bg-teal-400/15', tag: 'bg-teal-600' },
  system: { border: 'border-slate-400', fill: 'bg-slate-400/10', tag: 'bg-slate-400' },
  attempted: { border: 'border-emerald-600', fill: 'bg-blue-400/10', tag: 'bg-emerald-600' },
  standard: { border: 'border-blue-500', fill: 'bg-blue-400/10', tag: 'bg-blue-500' },
};

// A glance-level hint of what each box is, since a text field and a dropdown
// are the same shape otherwise.
const TYPE_MARK = {
  checkbox: '✕',
  radio: '●',
  dropdown: '▾',
};

// A submission button is a fixed size by definition, so it moves but does not
// resize.
const FIXED_SIZE_TYPES = ['button'];

// A button is the one type that is genuinely drawn in the PDF, so it is drawn
// here too rather than shown as an outline. Acrobat does the same, and shows it
// even while it is hidden, so a designer can see where it sits.
const rgbCss = ([r, g, b]) =>
  `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

// /BS /S B is a bevel, which is a light top left edge and a dark bottom right
// one over the face colour. Two inset shadows are the closest CSS gets.
//
// These are inline, so they beat the border and ring classes every other box
// uses. Selection shows as an outline instead, which nothing here overrides.
function buttonStyle(zoom, selected) {
  const bevel = Math.max(1, Math.round(zoom));
  return {
    background: rgbCss(BUTTON_STYLE.backgroundColor),
    border: `${Math.max(1, BUTTON_STYLE.borderWidth * zoom)}px solid ${rgbCss(BUTTON_STYLE.borderColor)}`,
    boxShadow: `inset ${bevel}px ${bevel}px 0 rgba(255,255,255,0.75), inset -${bevel}px -${bevel}px 0 rgba(0,0,0,0.25)`,
    fontSize: BUTTON_STYLE.fontSize * zoom,
    color: '#000',
    ...(selected ? { outline: '2px solid #0284c7', outlineOffset: '1px' } : null),
  };
}

// Smallest rectangle worth keeping, in screen pixels, so a stray click does not
// leave a sliver of a field behind.
const MIN_DRAW_PX = 6;
const MIN_FIELD_PX = 4;

const HANDLES = [
  ['nw', 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize'],
  ['n', 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize'],
  ['ne', 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize'],
  ['w', 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
  ['e', 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize'],
  ['sw', 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize'],
  ['s', 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize'],
  ['se', 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize'],
];

export default function PdfCanvas({
  doc,
  pageIndex,
  zoom,
  fields,
  selectedId,
  selectedIds,
  dbIndex,
  canonicalIds,
  buttonIndex,
  newFieldType,
  onSelect,
  onCreateField,
  onChangeRect,
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const dragRef = useRef(null);
  const [geom, setGeom] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState(null);
  const [renderError, setRenderError] = useState(null);

  // Render the page. Zoom only ever changes what is painted, never what is stored.
  useEffect(() => {
    if (!doc) {
      setGeom(null);
      return undefined;
    }
    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        const page = await doc.getPage(pageIndex + 1);
        if (cancelled) return;

        // page.view is the CropBox, page.rotate the /Rotate value.
        const pageGeom = makePageGeometry(page.view, page.rotate);
        const viewport = page.getViewport({ scale: zoom });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
        canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        setGeom(pageGeom);
        setSize({ width: viewport.width, height: viewport.height });

        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
        });
        await renderTask.promise;
        if (!cancelled) setRenderError(null);
      } catch (err) {
        // A cancelled render is expected whenever the page or zoom changes.
        if (!cancelled && err?.name !== 'RenderingCancelledException') {
          setRenderError(err.message || String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageIndex, zoom]);

  const pointIn = useCallback((event) => {
    const box = overlayRef.current.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }, []);

  // Everything is measured on screen and converted once, here, on the way into
  // state. Nothing downstream ever sees a screen pixel.
  const commitRect = useCallback(
    (id, viewRect) => {
      const pdfRect = viewRectToPdf(geom, zoom, viewRect);
      onChangeRect(id, clampRectToPage(geom, pdfRect));
    },
    [geom, zoom, onChangeRect]
  );

  const handlePointerDown = (event) => {
    if (!geom || event.button !== 0) return;
    const start = pointIn(event);
    const fieldEl = event.target.closest('[data-field-id]');
    const handleName = event.target.dataset?.handle;

    if (fieldEl) {
      const id = fieldEl.dataset.fieldId;
      const field = fields.find((f) => f.id === id);
      if (!field) return;
      onSelect(id);
      dragRef.current = {
        mode: handleName ? 'resize' : 'move',
        handle: handleName,
        id,
        start,
        origView: pdfRectToView(geom, zoom, field.rect),
      };
    } else {
      onSelect(null);
      dragRef.current = { mode: 'draw', start };
      setDraft({ left: start.x, top: start.y, width: 0, height: 0 });
    }
    capture(overlayRef.current, event.pointerId, true);
    overlayRef.current?.focus();
    event.preventDefault();
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || !geom) return;
    const at = pointIn(event);
    const dx = at.x - drag.start.x;
    const dy = at.y - drag.start.y;

    if (drag.mode === 'draw') {
      setDraft({
        left: Math.min(drag.start.x, at.x),
        top: Math.min(drag.start.y, at.y),
        width: Math.abs(dx),
        height: Math.abs(dy),
      });
      return;
    }

    if (drag.mode === 'move') {
      commitRect(drag.id, {
        left: drag.origView.left + dx,
        top: drag.origView.top + dy,
        width: drag.origView.width,
        height: drag.origView.height,
      });
      return;
    }

    commitRect(drag.id, resizeViewRect(drag.origView, drag.handle, dx, dy));
  };

  const handlePointerUp = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    capture(overlayRef.current, event.pointerId, false);
    if (!drag) return;

    if (drag.mode === 'draw') {
      const rect = draft;
      setDraft(null);
      if (!rect || rect.width < MIN_DRAW_PX || rect.height < MIN_DRAW_PX) return;
      const pdfRect = clampRectToPage(geom, viewRectToPdf(geom, zoom, rect));
      onCreateField(pdfRect);
    }
  };

  if (!doc) return null;

  return (
    <div className="inline-block p-6">
      <div
        className="relative shadow-lg ring-1 ring-slate-300 bg-white"
        style={{ width: size.width, height: size.height }}
      >
        <canvas ref={canvasRef} className="block" />

        <div
          ref={overlayRef}
          // Focusable so a click here takes focus off the name box. The pointer
          // handler calls preventDefault to stop the drag selecting text, which
          // also suppresses the focus change a click would normally make, so
          // without this the keyboard stays in the input a field was named in
          // and Delete edits that text instead of removing the field.
          tabIndex={-1}
          className="absolute inset-0 cursor-crosshair outline-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {geom &&
            fields.map((field) => (
              <FieldBox
                key={field.id}
                field={field}
                view={pdfRectToView(geom, zoom, field.rect)}
                selected={selectedIds ? selectedIds.has(field.id) : field.id === selectedId}
                attempted={isLoadAttempted(field.name, dbIndex)}
                system={canonicalIds?.has(field.id) ?? false}
                caption={buttonIndex?.get(field.name.trim())?.caption ?? ''}
                zoom={zoom}
              />
            ))}

          {draft && (
            <div
              className="absolute border-2 border-dashed border-sky-600 bg-sky-400/20 pointer-events-none"
              style={{
                left: draft.left,
                top: draft.top,
                width: draft.width,
                height: draft.height,
              }}
            >
              <span className="absolute -top-5 left-0 text-[10px] font-medium text-sky-700">
                new {newFieldType}
              </span>
            </div>
          )}
        </div>
      </div>

      {renderError && (
        <p className="mt-2 text-sm text-red-600">Could not render page: {renderError}</p>
      )}
    </div>
  );
}

function FieldBox({ field, view, selected, attempted, system, caption, zoom }) {
  const imported = field.imported;
  const button = field.type === 'button';
  const tone = TONE_STYLE[fieldTone(field, { system, attempted })];
  // A hidden field is not drawn in the exported PDF, so it reads as faint here
  // rather than looking like every other placement. Buttons are the exception:
  // they start hidden and are shown by the starter code, so dimming every one
  // of them would just make the normal case hard to see.
  const dim = field.hidden && !button ? 'opacity-40' : '';
  const border = selected ? 'border-sky-600' : tone.border;
  const fill = selected ? 'bg-sky-400/25' : tone.fill;

  return (
    <div
      data-field-id={field.id}
      className={`absolute border-2 ${border} ${fill} ${dim} ${
        field.editable ? '' : 'border-dashed'
      } ${selected ? 'ring-2 ring-sky-300' : ''} cursor-move`}
      style={{
        left: view.left,
        top: view.top,
        width: view.width,
        height: view.height,
        ...(button ? buttonStyle(zoom, selected) : null),
      }}
      title={field.name || '(unnamed)'}
    >
      <span
        className={`absolute -top-[15px] left-0 max-w-[220px] truncate rounded-t px-1 text-[10px] font-medium leading-[14px] text-white ${tone.tag}`}
      >
        {field.name || '(unnamed)'}
        {imported ? ' · imported' : ''}
        {field.hidden ? ' · hidden' : ''}
      </span>

      {button && caption && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center truncate px-1 leading-none">
          {caption}
        </span>
      )}

      {TYPE_MARK[field.type] && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] leading-none text-slate-500">
          {TYPE_MARK[field.type]}
        </span>
      )}

      {selected &&
        !FIXED_SIZE_TYPES.includes(field.type) &&
        HANDLES.map(([name, position]) => (
          <span
            key={name}
            data-handle={name}
            className={`absolute h-2 w-2 rounded-[2px] border border-white bg-sky-600 ${position}`}
          />
        ))}
    </div>
  );
}

// Pointer capture keeps a drag alive outside the page bounds. It throws on a
// pointer id the browser is not tracking, which is not worth failing a drag over.
function capture(element, pointerId, on) {
  if (!element) return;
  try {
    if (on) element.setPointerCapture(pointerId);
    else if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // No capture, the drag still works as long as the pointer stays on the page.
  }
}

// Resizing happens in screen space so the handle under the cursor always moves
// the edge the user sees, whatever the page rotation is.
export function resizeViewRect(orig, handle, dx, dy) {
  let { left, top, width, height } = orig;
  if (handle.includes('w')) {
    left += dx;
    width -= dx;
  }
  if (handle.includes('e')) {
    width += dx;
  }
  if (handle.includes('n')) {
    top += dy;
    height -= dy;
  }
  if (handle.includes('s')) {
    height += dy;
  }
  // Dragging an edge past its opposite flips the rect rather than inverting it.
  if (width < MIN_FIELD_PX) {
    left = handle.includes('w') ? left + width - MIN_FIELD_PX : left;
    width = MIN_FIELD_PX;
  }
  if (height < MIN_FIELD_PX) {
    top = handle.includes('n') ? top + height - MIN_FIELD_PX : top;
    height = MIN_FIELD_PX;
  }
  return { left, top, width, height };
}
