// Coordinate transforms between PDF user space and browser display space.
//
// PDF user space is y-up from the bottom-left of the page. The visible area is
// the CropBox, which is not always the MediaBox and does not always start at 0,0.
// Display space is y-down from the top-left of the rendered canvas, in CSS px.
//
// Stored rects are always PDF user space. Scale is a display concern and is
// applied last on the way out, first on the way in. Nothing here mutates state.

// Page /Rotate is clockwise degrees, and may be negative or over 360.
export function normalizeRotation(rotation) {
  const r = Math.round((Number(rotation) || 0) / 90) * 90;
  return ((r % 360) + 360) % 360;
}

// Build the geometry a page needs for transforms. cropBox is [x0, y0, x1, y1]
// in PDF user space, matching pdf.js page.view and pdf-lib getCropBox.
export function makePageGeometry(cropBox, rotation = 0) {
  const [ax, ay, bx, by] = cropBox;
  const x0 = Math.min(ax, bx);
  const y0 = Math.min(ay, by);
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  return {
    x0,
    y0,
    cropWidth: x1 - x0,
    cropHeight: y1 - y0,
    rotation: normalizeRotation(rotation),
  };
}

// Size of the rendered page in CSS px. Rotation by 90 or 270 swaps the axes.
export function viewportSize(geom, scale = 1) {
  const swapped = geom.rotation === 90 || geom.rotation === 270;
  return {
    width: (swapped ? geom.cropHeight : geom.cropWidth) * scale,
    height: (swapped ? geom.cropWidth : geom.cropHeight) * scale,
  };
}

// PDF user space point to display point.
export function pdfPointToView(geom, scale, point) {
  const { x0, y0, cropWidth: cw, cropHeight: ch, rotation } = geom;
  const u = point.x - x0;
  const v = point.y - y0;
  let X;
  let Y;
  switch (rotation) {
    case 90:
      X = v;
      Y = u;
      break;
    case 180:
      X = cw - u;
      Y = v;
      break;
    case 270:
      X = ch - v;
      Y = cw - u;
      break;
    default:
      X = u;
      Y = ch - v;
  }
  return { x: X * scale, y: Y * scale };
}

// Display point to PDF user space point, the exact inverse of pdfPointToView.
export function viewPointToPdf(geom, scale, point) {
  const { x0, y0, cropWidth: cw, cropHeight: ch, rotation } = geom;
  const X = point.x / scale;
  const Y = point.y / scale;
  let u;
  let v;
  switch (rotation) {
    case 90:
      u = Y;
      v = X;
      break;
    case 180:
      u = cw - X;
      v = Y;
      break;
    case 270:
      u = cw - Y;
      v = ch - X;
      break;
    default:
      u = X;
      v = ch - Y;
  }
  return { x: u + x0, y: v + y0 };
}

// A stored rect is {x, y, width, height} with x,y at the lower-left corner in
// PDF user space. Rotation can send any corner to any side, so transform two
// opposite corners and rebuild from the extremes.
export function pdfRectToView(geom, scale, rect) {
  const a = pdfPointToView(geom, scale, { x: rect.x, y: rect.y });
  const b = pdfPointToView(geom, scale, {
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  });
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

// Display rect {left, top, width, height} in CSS px to a stored PDF rect.
export function viewRectToPdf(geom, scale, view) {
  const a = viewPointToPdf(geom, scale, { x: view.left, y: view.top });
  const b = viewPointToPdf(geom, scale, {
    x: view.left + view.width,
    y: view.top + view.height,
  });
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

// Keep a rect inside the CropBox, preserving its size where possible.
export function clampRectToPage(geom, rect) {
  const width = Math.min(rect.width, geom.cropWidth);
  const height = Math.min(rect.height, geom.cropHeight);
  const maxX = geom.x0 + geom.cropWidth - width;
  const maxY = geom.y0 + geom.cropHeight - height;
  return {
    x: Math.min(Math.max(rect.x, geom.x0), maxX),
    y: Math.min(Math.max(rect.y, geom.y0), maxY),
    width,
    height,
  };
}

// pdf-lib writes widget rects as [x0, y0, x1, y1] in PDF user space.
export function rectFromPdfArray(arr) {
  const [ax, ay, bx, by] = arr;
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay),
  };
}
