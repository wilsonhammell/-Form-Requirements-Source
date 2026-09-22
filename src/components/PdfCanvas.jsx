import { useCallback, useEffect, useRef, useState } from 'react';
import { PDFDateString, AnnotationMode } from 'pdfjs-dist';
import {
  makePageGeometry,
  pdfRectToView,
  viewRectToPdf,
  clampRectToPage,
} from '../core/coords.js';
import { isLoadAttempted } from '../core/schema.js';
import { BUTTON_STYLE } from '../core/signingButtons.js';
import { fieldTone } from '../core/fieldTone.js';
import { DRAW_MARKER } from '../core/markers.js';
import { readComments, COMMENT_SUBTYPES } from '../core/pdfComments.js';
import { isSystemField } from '../core/systemFields.js';

// Load Attempted takes an emerald border but keeps the ordinary blue fill, so
// the page does not read as a wall of green.
const TONE_STYLE = {
  button: { border: 'border-violet-500', fill: 'bg-violet-400/15', tag: 'bg-violet-500' },
  special: { border: 'border-teal-600', fill: 'bg-teal-400/15', tag: 'bg-teal-600' },
  system: { border: 'border-slate-400', fill: 'bg-slate-400/10', tag: 'bg-slate-400' },
  attempted: { border: 'border-emerald-600', fill: 'bg-blue-400/10', tag: 'bg-emerald-600' },
  standard: { border: 'border-blue-500', fill: 'bg-blue-400/10', tag: 'bg-blue-500' },
};

// A text field and a dropdown are otherwise the same shape.
const TYPE_MARK = {
  checkbox: '✕',
  radio: '●',
  dropdown: '▾',
};

// The button list fixes the size, so a button moves but does not resize.
const FIXED_SIZE_TYPES = ['button'];

const rgbCss = ([r, g, b]) =>
  `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

// A button is the one type genuinely drawn in the PDF, so it is drawn here too
// rather than outlined. /BS /S B is a bevel, and two inset shadows are the
// closest CSS gets.
//
// Inline, so these beat the border and ring classes every other box uses, which
// is why selection shows as an outline instead.
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

// Names the drag a rect change belongs to. A move or a resize arrives as a
// stream of rects, one a mouse move, and the name is what lets the undo stack
// fold them back into the single gesture the user made.
let gestureCount = 0;

const COMMENT_SUBTYPE_SET = new Set(COMMENT_SUBTYPES);

// A form hides its message boxes with a script when it opens, and pdf.js runs no
// scripts, so DNA_REQ would paint over the whole page. Only the appearance goes,
// the box above it still shows and still takes a click.
//
// Hidden comments go the same way, so turning them off clears the page rather
// than leaving ink nothing answers a click on.
function hideAppearances(storage, annotations, systemIndex, showComments) {
  for (const annotation of annotations) {
    const hide =
      annotation.subtype === 'Widget'
        ? isSystemField(annotation.fieldName, systemIndex)
        : COMMENT_SUBTYPE_SET.has(annotation.subtype) && !showComments;
    if (hide) {
      storage.setValue(annotation.id, { noView: true });
    } else if (storage.getRawValue(annotation.id)?.noView) {
      storage.remove(annotation.id);
    }
  }
}

// Screen pixels, so a stray click does not leave a sliver of a field behind.
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
  markers = [],
  selectedId,
  selectedIds,
  selectedMarkerId,
  dbIndex,
  canonicalIds,
  buttonIndex,
  systemIndex,
  showComments = true,
  drawKind,
  onSelect,
  onSelectMarker,
  onCreateField,
  onCreateMarker,
  onChangeRect,
  onChangeMarkerRect,
}) {
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const dragRef = useRef(null);
  const [geom, setGeom] = useState(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [comments, setComments] = useState([]);
  const [openCommentId, setOpenCommentId] = useState(null);
  const popupRef = useRef(null);

  // pdf.js paints the comments into the canvas along with the page, which says
  // nothing about where they are. Read apart from the render so a zoom does not
  // read them again.
  useEffect(() => {
    setComments([]);
    setOpenCommentId(null);
    if (!doc) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const page = await doc.getPage(pageIndex + 1);
        const annotations = await page.getAnnotations();
        if (!cancelled) setComments(readComments(annotations));
      } catch {
        // No comments to click is no worse than before, the page still draws.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex]);

  // Escape or a press anywhere else closes it. Capture, so the press that
  // starts a drag on the page closes it before the drag begins.
  useEffect(() => {
    if (!openCommentId) return undefined;
    const onPointerDown = (event) => {
      if (!popupRef.current?.contains(event.target)) setOpenCommentId(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenCommentId(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openCommentId]);

  // Hiding comments takes an open one with it, so showing them again does not
  // bring back a pop-up nobody asked for.
  useEffect(() => {
    if (!showComments) setOpenCommentId(null);
  }, [showComments]);

  // Zoom only ever changes what is painted, never what is stored.
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
        hideAppearances(doc.annotationStorage, await page.getAnnotations(), systemIndex, showComments);
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
          annotationMode: AnnotationMode.ENABLE_STORAGE,
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
  }, [doc, pageIndex, zoom, systemIndex, showComments]);

  const pointIn = useCallback((event) => {
    const box = overlayRef.current.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }, []);

  // Measured on screen and converted once here, so nothing downstream ever sees
  // a screen pixel.
  const commitRect = useCallback(
    (id, viewRect, gesture, marker) => {
      const pdfRect = viewRectToPdf(geom, zoom, viewRect);
      const clamped = clampRectToPage(geom, pdfRect);
      if (marker) onChangeMarkerRect(id, clamped, gesture);
      else onChangeRect(id, clamped, gesture);
    },
    [geom, zoom, onChangeRect, onChangeMarkerRect]
  );

  const handlePointerDown = (event) => {
    if (!geom || event.button !== 0) return;
    const start = pointIn(event);
    const markerEl = event.target.closest('[data-marker-id]');
    const fieldEl = event.target.closest('[data-field-id]');
    const handleName = event.target.dataset?.handle;

    if (markerEl) {
      const id = markerEl.dataset.markerId;
      const marker = markers.find((m) => m.id === id);
      if (!marker) return;
      onSelectMarker(id);
      dragRef.current = {
        mode: handleName ? 'resize' : 'move',
        handle: handleName,
        id,
        marker: true,
        start,
        gesture: ++gestureCount,
        origView: pdfRectToView(geom, zoom, marker.rect),
      };
    } else if (fieldEl) {
      const id = fieldEl.dataset.fieldId;
      const field = fields.find((f) => f.id === id);
      if (!field) return;
      onSelect(id);
      dragRef.current = {
        mode: handleName ? 'resize' : 'move',
        handle: handleName,
        id,
        start,
        gesture: ++gestureCount,
        origView: pdfRectToView(geom, zoom, field.rect),
      };
    } else {
      onSelect(null);
      onSelectMarker(null);
      // A comment is still somewhere to draw. Only a press that never becomes
      // a drag opens it, which pointer up decides.
      const commentId = event.target.closest('[data-comment-id]')?.dataset.commentId ?? null;
      dragRef.current = { mode: 'draw', start, commentId };
      setDraft({ left: start.x, top: start.y, width: 0, height: 0 });
    }
    capture(overlayRef.current, event.pointerId, true);
    // preventScroll matters. Focusing an element scrolls it into view, and
    // zoomed in the overlay is taller than the window, so the default would
    // scroll the page out from under the gesture that just started. The press
    // was measured before that scroll and every move after it measured against
    // a box that had shifted, which came out as a rect the right shape at the
    // top and the wrong size at the bottom.
    overlayRef.current?.focus({ preventScroll: true });
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
      commitRect(
        drag.id,
        {
          left: drag.origView.left + dx,
          top: drag.origView.top + dy,
          width: drag.origView.width,
          height: drag.origView.height,
        },
        drag.gesture,
        drag.marker
      );
      return;
    }

    commitRect(
      drag.id,
      resizeViewRect(drag.origView, drag.handle, dx, dy),
      drag.gesture,
      drag.marker
    );
  };

  const handlePointerUp = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    capture(overlayRef.current, event.pointerId, false);
    if (!drag) return;

    if (drag.mode === 'draw') {
      const rect = draft;
      setDraft(null);
      if (!rect || rect.width < MIN_DRAW_PX || rect.height < MIN_DRAW_PX) {
        if (drag.commentId) setOpenCommentId(drag.commentId);
        return;
      }
      const pdfRect = clampRectToPage(geom, viewRectToPdf(geom, zoom, rect));
      if (drawKind === DRAW_MARKER) onCreateMarker(pdfRect);
      else onCreateField(pdfRect);
    }
  };

  if (!doc) return null;

  const openComment = comments.find((c) => c.id === openCommentId) ?? null;

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
            // Larger boxes first, so a small one is never buried under a big one.
            // A page sized DNA_REQ would otherwise swallow every click.
            [...fields]
              .sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
              .map((field) => (
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

          {/* After the fields, so a marker over one stays clickable. They are
              small and they are what someone is looking for when they placed
              one. */}
          {geom &&
            markers.map((marker) => (
              <MarkerBox
                key={marker.id}
                marker={marker}
                view={pdfRectToView(geom, zoom, marker.rect)}
                selected={marker.id === selectedMarkerId}
              />
            ))}

          {/* Last, so a comment is never buried under a field or a marker. Hiding
              comments is how to reach whatever is underneath one. */}
          {geom &&
            showComments &&
            comments.map((comment) => (
              <CommentBox
                key={comment.id}
                comment={comment}
                view={pdfRectToView(geom, zoom, comment.rect)}
                open={comment.id === openCommentId}
              />
            ))}

          {draft && (
            <div
              className={`absolute border-2 border-dashed pointer-events-none ${
                drawKind === DRAW_MARKER
                  ? 'border-amber-600 bg-amber-400/20'
                  : 'border-sky-600 bg-sky-400/20'
              }`}
              style={{
                left: draft.left,
                top: draft.top,
                width: draft.width,
                height: draft.height,
              }}
            >
              <span
                className={`absolute -top-5 left-0 text-[10px] font-medium ${
                  drawKind === DRAW_MARKER ? 'text-amber-700' : 'text-sky-700'
                }`}
              >
                new {drawKind}
              </span>
            </div>
          )}
        </div>

        {/* Beside the overlay rather than in it, so pressing in here to select
            the text is not taken for the start of a drawn field. */}
        {geom && openComment && (
          <CommentPopup
            ref={popupRef}
            comment={openComment}
            view={pdfRectToView(geom, zoom, openComment.rect)}
            page={size}
          />
        )}
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
  // Buttons are the exception. Every one starts hidden and is shown by the
  // starter code, so dimming them would make the normal case the hard one to see.
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

// Amber and dashed all round, so it never reads as a field however it is drawn.
// A field uses a dashed border to mean read-only, which a marker has no notion
// of, so the two cannot be confused on the page.
function MarkerBox({ marker, view, selected }) {
  const role = (marker.role ?? '').trim();
  return (
    <div
      data-marker-id={marker.id}
      className={`absolute border-2 border-dashed ${
        selected ? 'border-sky-600 bg-sky-400/25 ring-2 ring-sky-300' : 'border-amber-600 bg-amber-400/20'
      } cursor-move`}
      style={{ left: view.left, top: view.top, width: view.width, height: view.height }}
      title={role ? `Initials: ${role}` : 'Initials, nobody named yet'}
    >
      <span
        className={`absolute -top-[15px] left-0 max-w-[220px] truncate rounded-t px-1 text-[10px] font-medium leading-[14px] text-white ${
          role ? 'bg-amber-600' : 'bg-red-600'
        }`}
      >
        {role || 'who initials here?'}
      </span>

      {selected &&
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

// Nothing of its own is drawn, pdf.js has already painted the comment. The
// ring is what says a click will open it.
function CommentBox({ comment, view, open }) {
  return (
    <div
      data-comment-id={comment.id}
      className={`absolute cursor-pointer ${
        open ? 'ring-2 ring-yellow-500' : 'hover:ring-2 hover:ring-yellow-500/70'
      }`}
      style={{ left: view.left, top: view.top, width: view.width, height: view.height }}
    />
  );
}

const POPUP_WIDTH = 288;
const POPUP_MAX_HEIGHT = 288;
const POPUP_MIN_HEIGHT = 96;
const POPUP_GAP = 4;

// Below the comment unless it only fits above, and never taller than the room
// on that side, so a comment on any edge keeps its pop-up on the page. A long
// thread scrolls inside it instead. Where neither side has room, as with a box
// nearly the height of the page, it is pulled back over the comment rather
// than left hanging off the page.
function commentPopupPlacement(view, page) {
  const roomBelow = page.height - (view.top + view.height) - POPUP_GAP;
  const roomAbove = view.top - POPUP_GAP;
  const below = roomBelow >= POPUP_MAX_HEIGHT || roomBelow >= roomAbove;
  const maxHeight = Math.max(
    POPUP_MIN_HEIGHT,
    Math.min(POPUP_MAX_HEIGHT, below ? roomBelow : roomAbove)
  );
  const furthest = Math.max(0, page.height - maxHeight);
  return {
    left: Math.max(0, Math.min(view.left, page.width - POPUP_WIDTH)),
    maxHeight,
    ...(below
      ? { top: Math.min(view.top + view.height + POPUP_GAP, furthest) }
      : { bottom: Math.min(page.height - view.top + POPUP_GAP, furthest) }),
  };
}

function CommentPopup({ ref, comment, view, page }) {
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Comment"
      className="absolute z-10 overflow-y-auto rounded border border-slate-300 bg-white p-3 text-xs text-slate-800 shadow-lg"
      style={{ width: POPUP_WIDTH, ...commentPopupPlacement(view, page) }}
    >
      <CommentEntry entry={comment} />
      {comment.replies.map((reply) => (
        <div key={reply.id} className="mt-2 border-l-2 border-slate-200 pl-2">
          <CommentEntry entry={reply} />
        </div>
      ))}
    </div>
  );
}

function CommentEntry({ entry }) {
  const parsed = entry.date ? PDFDateString.toDateObject(entry.date) : null;
  const date = parsed ? parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return (
    <>
      {(entry.author || date) && (
        <p className="flex justify-between gap-2 text-[11px] text-slate-500">
          <span className="truncate font-semibold text-slate-700">{entry.author}</span>
          <span className="shrink-0">{date}</span>
        </p>
      )}
      {entry.text && <p className="mt-0.5 whitespace-pre-wrap break-words">{entry.text}</p>}
    </>
  );
}

// Keeps a drag alive outside the page bounds. Throws on a pointer id the
// browser is not tracking, which is not worth failing a drag over.
function capture(element, pointerId, on) {
  if (!element) return;
  try {
    if (on) element.setPointerCapture(pointerId);
    else if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // No capture, the drag still works as long as the pointer stays on the page.
  }
}

// In screen space, so the handle under the cursor moves the edge the user sees
// whatever the page rotation is.
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
  // Dragging an edge past its opposite pins the rect rather than inverting it.
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
