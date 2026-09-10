// Rasterising pages for the requirements workbook.
//
// Apart from excelExport.js because this needs pdf.js and a canvas and so only
// runs in the browser, which keeps the workbook builder testable in node.

import { AnnotationMode } from 'pdfjs-dist/build/pdf.mjs';

// Wide enough to read the small print, not so wide the workbook bloats.
const TARGET_WIDTH = 900;

/** One PNG per page, sized for a spreadsheet column band. */
export async function renderPageImages(doc, { targetWidth = TARGET_WIDTH } = {}) {
  if (!doc) return [];
  const images = [];

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
