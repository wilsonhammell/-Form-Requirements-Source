// Between PDF user space, y-up from the bottom-left of the CropBox, and display
// space, y-down from the top-left of the canvas in CSS px. The CropBox is not
// always the MediaBox and does not always start at 0,0.
//
// Stored rects are always PDF user space. Scale is a display concern, applied
// last on the way out and first on the way in.

// Page /Rotate is clockwise degrees, and may be negative or over 360.
export function normalizeRotation(rotation) {
  const r = Math.round((Number(rotation) || 0) / 90) * 90;
  return ((r % 360) + 360) % 360;
}

// cropBox is [x0, y0, x1, y1], matching pdf.js page.view and pdf-lib getCropBox.
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

// Rotation by 90 or 270 swaps the axes.
export function viewportSize(geom, scale = 1) {
  const swapped = geom.rotation === 90 || geom.rotation === 270;
  return {
    width: (swapped ? geom.cropHeight : geom.cropWidth) * scale,
    height: (swapped ? geom.cropWidth : geom.cropHeight) * scale,
  };
}

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

// The exact inverse of pdfPointToView.
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

// Rotation can send any corner to any side, so two opposite corners are
// transformed and the rect rebuilt from the extremes.
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

// Size is preserved where it can be.
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
