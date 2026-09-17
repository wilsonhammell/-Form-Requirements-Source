// Rasterising pages for the requirements workbook.
//
// Apart from excelExport.js because this needs pdf.js and a canvas and so only
// runs in the browser, which keeps the workbook builder testable in node.

import { AnnotationMode } from 'pdfjs-dist/build/pdf.mjs';

// Wide enough to read the small print, not so wide the workbook bloats.
const TARGET_WIDTH = 900;

// Amber-600, the marker tone, as a canvas colour. Kept in step with TONE_HEX by
// the test that reads both.
const MARKER_INK = '#d97706';

/** One PNG per page, sized for a spreadsheet column band. */
export async function renderPageImages(doc, { targetWidth = TARGET_WIDTH, markers = [] } = {}) {
  if (!doc) return [];
  const images = [];
  const markersByPage = new Map();
  for (const marker of markers) {
    if (!markersByPage.has(marker.page)) markersByPage.set(marker.page, []);
    markersByPage.get(marker.page).push(marker);
  }

  for (let index = 0; index < doc.numPages; index += 1) {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvas,
      canvasContext: canvas.getContext('2d'),
      viewport,
      // Their existing screenshots include the field boxes, which cover the
      // printed labels underneath.
      annotationMode: AnnotationMode.DISABLE,
    }).promise;

    // Drawn after the page, because this is the one thing the picture has to
    // show that the printed form does not. A row in the table gives a reader
    // coordinates; the picture is what tells them where the box goes.
    drawMarkers(canvas, viewport, markersByPage.get(index) ?? []);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    images.push({
      page: index,
      data: new Uint8Array(await blob.arrayBuffer()),
      // Points rather than pixels, so the picture lands at a sensible size in
      // the sheet rather than at screen resolution.
      width: Math.round(base.width),
      height: Math.round(base.height),
    });
  }

  return images;
}

// convertToViewportRectangle rather than arithmetic on the rect, so a page with
// a /Rotate lands where pdf.js actually drew it.
function drawMarkers(canvas, viewport, markers) {
  if (markers.length === 0) return;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = MARKER_INK;
  ctx.fillStyle = MARKER_INK;
  ctx.font = '11px Helvetica, Arial, sans-serif';
  ctx.textBaseline = 'bottom';

  for (const marker of markers) {
    const { x, y, width, height } = marker.rect;
    const [ax, ay, bx, by] = viewport.convertToViewportRectangle([x, y, x + width, y + height]);
    const left = Math.min(ax, bx);
    const top = Math.min(ay, by);
    const w = Math.abs(bx - ax);
    const h = Math.abs(by - ay);

    ctx.setLineDash([4, 3]);
    ctx.strokeRect(left, top, w, h);

    const label = (marker.role ?? '').trim() || '(not specified)';
    // Above the box where there is room, inside the top of it where there is
    // not, so a marker at the very top of a page keeps its label on the picture.
    const baseline = top >= 14 ? top - 3 : top + h - 3;
    ctx.setLineDash([]);
    // The form underneath is dense, so the caption gets its own ground rather
    // than being read against whatever line it lands on.
    const box = ctx.measureText(label);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(left, baseline - 11, box.width + 4, 13);
    ctx.fillStyle = MARKER_INK;
    ctx.fillText(label, left + 2, baseline);
  }

  ctx.restore();
}
