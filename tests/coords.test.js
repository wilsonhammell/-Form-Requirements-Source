import { describe, it, expect } from 'vitest';
import {
  normalizeRotation,
  makePageGeometry,
  viewportSize,
  pdfPointToView,
  viewPointToPdf,
  pdfRectToView,
  viewRectToPdf,
  clampRectToPage,
  rectFromPdfArray,
} from '../src/core/coords.js';

// Letter portrait, CropBox at the origin.
const LETTER = [0, 0, 612, 792];
// Same visible size, but the CropBox is inset from the MediaBox origin.
const INSET = [20, 30, 632, 822];

const close = (a, b) => expect(a).toBeCloseTo(b, 6);

const closePoint = (p, x, y) => {
  close(p.x, x);
  close(p.y, y);
};

const closeRect = (r, x, y, width, height) => {
  close(r.x, x);
  close(r.y, y);
  close(r.width, width);
  close(r.height, height);
};

describe('normalizeRotation', () => {
  it('folds any multiple of 90 into the 0 to 270 range', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-450)).toBe(270);
  });

  it('treats missing or junk rotation as 0', () => {
    expect(normalizeRotation(undefined)).toBe(0);
    expect(normalizeRotation(null)).toBe(0);
    expect(normalizeRotation(NaN)).toBe(0);
  });
});

describe('makePageGeometry', () => {
  it('reads an offset CropBox', () => {
    const g = makePageGeometry(INSET, 0);
    expect(g.x0).toBe(20);
    expect(g.y0).toBe(30);
    expect(g.cropWidth).toBe(612);
    expect(g.cropHeight).toBe(792);
  });

  it('normalizes a CropBox given with reversed corners', () => {
    const g = makePageGeometry([632, 822, 20, 30], 0);
    expect(g.x0).toBe(20);
    expect(g.y0).toBe(30);
    expect(g.cropWidth).toBe(612);
    expect(g.cropHeight).toBe(792);
  });
});

describe('viewportSize', () => {
  it('keeps the axes at 0 and 180', () => {
    expect(viewportSize(makePageGeometry(LETTER, 0), 1)).toEqual({ width: 612, height: 792 });
    expect(viewportSize(makePageGeometry(LETTER, 180), 1)).toEqual({ width: 612, height: 792 });
  });

  it('swaps the axes at 90 and 270', () => {
    expect(viewportSize(makePageGeometry(LETTER, 90), 1)).toEqual({ width: 792, height: 612 });
    expect(viewportSize(makePageGeometry(LETTER, 270), 1)).toEqual({ width: 792, height: 612 });
  });

  it('scales with zoom', () => {
    expect(viewportSize(makePageGeometry(LETTER, 0), 2)).toEqual({ width: 1224, height: 1584 });
  });
});

describe('pdfPointToView, known corners', () => {
  // The PDF origin is the bottom-left of the page. Where that corner lands on
  // screen is the clearest way to pin down each rotation.
  it('maps the page corners at rotation 0', () => {
    const g = makePageGeometry(LETTER, 0);
    closePoint(pdfPointToView(g, 1, { x: 0, y: 0 }), 0, 792);
    closePoint(pdfPointToView(g, 1, { x: 0, y: 792 }), 0, 0);
    closePoint(pdfPointToView(g, 1, { x: 612, y: 792 }), 612, 0);
  });

  it('maps the page corners at rotation 90', () => {
    const g = makePageGeometry(LETTER, 90);
    // Bottom-left goes to top-left.
    closePoint(pdfPointToView(g, 1, { x: 0, y: 0 }), 0, 0);
    // Top-left goes to top-right.
    closePoint(pdfPointToView(g, 1, { x: 0, y: 792 }), 792, 0);
    // Bottom-right goes to bottom-left.
    closePoint(pdfPointToView(g, 1, { x: 612, y: 0 }), 0, 612);
  });

  it('maps the page corners at rotation 180', () => {
    const g = makePageGeometry(LETTER, 180);
    closePoint(pdfPointToView(g, 1, { x: 0, y: 0 }), 612, 0);
    closePoint(pdfPointToView(g, 1, { x: 612, y: 792 }), 0, 792);
  });

  it('maps the page corners at rotation 270', () => {
    const g = makePageGeometry(LETTER, 270);
    closePoint(pdfPointToView(g, 1, { x: 0, y: 0 }), 792, 612);
    closePoint(pdfPointToView(g, 1, { x: 0, y: 792 }), 0, 612);
  });

  it('subtracts the CropBox origin', () => {
    const g = makePageGeometry(INSET, 0);
    closePoint(pdfPointToView(g, 1, { x: 20, y: 30 }), 0, 792);
    closePoint(pdfPointToView(g, 1, { x: 20, y: 822 }), 0, 0);
  });
});

describe('pdfRectToView, known values', () => {
  it('places a text field near the top of an unrotated page', () => {
    const g = makePageGeometry(LETTER, 0);
    const view = pdfRectToView(g, 1, { x: 100, y: 700, width: 200, height: 20 });
    expect(view).toEqual({ left: 100, top: 72, width: 200, height: 20 });
  });

  it('swaps width and height on a rotated page', () => {
    const g = makePageGeometry(LETTER, 90);
    const view = pdfRectToView(g, 1, { x: 100, y: 700, width: 200, height: 20 });
    // PDF x runs down the screen, PDF y runs across it.
    expect(view).toEqual({ left: 700, top: 100, width: 20, height: 200 });
  });

  it('scales with zoom but keeps the aspect', () => {
    const g = makePageGeometry(LETTER, 0);
    const view = pdfRectToView(g, 2, { x: 100, y: 700, width: 200, height: 20 });
    expect(view).toEqual({ left: 200, top: 144, width: 400, height: 40 });
  });
});

describe('round trips', () => {
  const rotations = [0, 90, 180, 270];
  const scales = [0.5, 1, 1.5, 3];
  const boxes = [LETTER, INSET];
  const rects = [
    { x: 100, y: 700, width: 200, height: 20 },
    { x: 0, y: 0, width: 612, height: 792 },
    { x: 55.25, y: 123.75, width: 13.5, height: 13.5 },
  ];

  it('survives pdf to view to pdf for every rotation, zoom and CropBox', () => {
    for (const box of boxes) {
      for (const rotation of rotations) {
        const g = makePageGeometry(box, rotation);
        for (const scale of scales) {
          for (const rect of rects) {
            // The inset CropBox shifts the usable area, so shift the rect with it.
            const r = { ...rect, x: rect.x + g.x0, y: rect.y + g.y0 };
            const back = viewRectToPdf(g, scale, pdfRectToView(g, scale, r));
            closeRect(back, r.x, r.y, r.width, r.height);
          }
        }
      }
    }
  });

  it('survives point to view to point', () => {
    for (const rotation of rotations) {
      const g = makePageGeometry(INSET, rotation);
      const p = { x: 321.5, y: 654.25 };
      closePoint(viewPointToPdf(g, 1.75, pdfPointToView(g, 1.75, p)), p.x, p.y);
    }
  });

  it('gives the same stored rect at every zoom level', () => {
    const g = makePageGeometry(LETTER, 90);
    const rect = { x: 100, y: 700, width: 200, height: 20 };
    const atOne = viewRectToPdf(g, 1, pdfRectToView(g, 1, rect));
    for (const scale of [0.25, 0.75, 2, 4]) {
      const atScale = viewRectToPdf(g, scale, pdfRectToView(g, scale, rect));
      closeRect(atScale, atOne.x, atOne.y, atOne.width, atOne.height);
    }
  });
});

describe('viewRectToPdf', () => {
  it('converts a drawn rectangle on an unrotated page', () => {
    const g = makePageGeometry(LETTER, 0);
    const rect = viewRectToPdf(g, 1, { left: 100, top: 72, width: 200, height: 20 });
    closeRect(rect, 100, 700, 200, 20);
  });

  it('converts a drawn rectangle on a rotated page', () => {
    const g = makePageGeometry(LETTER, 90);
    const rect = viewRectToPdf(g, 1, { left: 700, top: 100, width: 20, height: 200 });
    closeRect(rect, 100, 700, 200, 20);
  });

  it('keeps the rect inside an offset CropBox', () => {
    const g = makePageGeometry(INSET, 0);
    const rect = viewRectToPdf(g, 1, { left: 0, top: 0, width: 10, height: 10 });
    closeRect(rect, 20, 812, 10, 10);
  });
});

describe('clampRectToPage', () => {
  it('pushes a rect back inside the CropBox', () => {
    const g = makePageGeometry(INSET, 0);
    closeRect(clampRectToPage(g, { x: -100, y: -100, width: 50, height: 50 }), 20, 30, 50, 50);
    closeRect(clampRectToPage(g, { x: 5000, y: 5000, width: 50, height: 50 }), 582, 772, 50, 50);
  });

  it('shrinks a rect larger than the page', () => {
    const g = makePageGeometry(LETTER, 0);
    closeRect(clampRectToPage(g, { x: 0, y: 0, width: 900, height: 900 }), 0, 0, 612, 792);
  });

  it('leaves a rect that already fits', () => {
    const g = makePageGeometry(LETTER, 0);
    closeRect(clampRectToPage(g, { x: 100, y: 100, width: 50, height: 20 }), 100, 100, 50, 20);
  });
});

describe('pdf rect arrays', () => {
  it('reads the form pdf-lib writes', () => {
    closeRect(rectFromPdfArray([100, 700, 300, 720]), 100, 700, 200, 20);
  });

  it('normalizes an array whose corners are reversed', () => {
    closeRect(rectFromPdfArray([300, 720, 100, 700]), 100, 700, 200, 20);
  });
});
