// The transforms in coords.js are hand written, so they can be self consistent
// and still disagree with what pdf.js actually draws. These tests build real
// PDFs with pdf-lib, open them with pdf.js, and compare our numbers against the
// viewport pdf.js would render with.
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { makePageGeometry, pdfPointToView, viewportSize } from '../src/core/coords.js';

let pdfjs;

beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Under node there is no worker thread, point pdf.js at the worker file so it
  // can load it in process.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).href;
});

// Build a one page PDF with the given box sizes and rotation.
async function buildPdf({ mediaBox, cropBox, rotation }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]]);
  page.setMediaBox(mediaBox[0], mediaBox[1], mediaBox[2] - mediaBox[0], mediaBox[3] - mediaBox[1]);
  if (cropBox) {
    page.setCropBox(cropBox[0], cropBox[1], cropBox[2] - cropBox[0], cropBox[3] - cropBox[1]);
  }
  page.setRotation({ type: 'degrees', angle: rotation });
  return doc.save();
}

async function loadFirstPage(bytes) {
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;
  return doc.getPage(1);
}

const CASES = [
  { name: 'letter, no crop, 0deg', mediaBox: [0, 0, 612, 792], cropBox: null, rotation: 0 },
  { name: 'letter, no crop, 90deg', mediaBox: [0, 0, 612, 792], cropBox: null, rotation: 90 },
  { name: 'letter, no crop, 180deg', mediaBox: [0, 0, 612, 792], cropBox: null, rotation: 180 },
  { name: 'letter, no crop, 270deg', mediaBox: [0, 0, 612, 792], cropBox: null, rotation: 270 },
  {
    name: 'inset CropBox, 0deg',
    mediaBox: [0, 0, 612, 792],
    cropBox: [20, 30, 592, 762],
    rotation: 0,
  },
  {
    name: 'inset CropBox, 90deg',
    mediaBox: [0, 0, 612, 792],
    cropBox: [20, 30, 592, 762],
    rotation: 90,
  },
  {
    name: 'inset CropBox, 270deg',
    mediaBox: [0, 0, 612, 792],
    cropBox: [36, 48, 500, 700],
    rotation: 270,
  },
  {
    name: 'A4 landscape, offset CropBox, 180deg',
    mediaBox: [0, 0, 841.89, 595.28],
    cropBox: [10.5, 12.25, 800, 560],
    rotation: 180,
  },
];

describe('parity with the pdf.js viewport', () => {
  for (const testCase of CASES) {
    it(`matches pdf.js for ${testCase.name}`, async () => {
      const bytes = await buildPdf(testCase);
      const page = await loadFirstPage(bytes);

      // page.view is the CropBox pdf.js renders, the same input our geometry takes.
      const geom = makePageGeometry(page.view, page.rotate);

      for (const scale of [1, 1.5, 0.75]) {
        const viewport = page.getViewport({ scale });
        const size = viewportSize(geom, scale);

        expect(size.width).toBeCloseTo(viewport.width, 4);
        expect(size.height).toBeCloseTo(viewport.height, 4);

        // Sample points across the CropBox, corners included.
        const [x0, y0, x1, y1] = page.view;
        for (const fx of [0, 0.25, 0.5, 1]) {
          for (const fy of [0, 0.33, 0.5, 1]) {
            const pt = { x: x0 + (x1 - x0) * fx, y: y0 + (y1 - y0) * fy };
            const ours = pdfPointToView(geom, scale, pt);
            const theirs = viewport.convertToViewportPoint(pt.x, pt.y);
            expect(ours.x).toBeCloseTo(theirs[0], 4);
            expect(ours.y).toBeCloseTo(theirs[1], 4);
          }
        }
      }
    });
  }
});
