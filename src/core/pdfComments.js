// Reviewer comments live in the same page /Annots array as the fields, so
// dropping them is a filter on that array rather than anything structural.
//
// The list says what to remove rather than what to keep, so an annotation type
// nobody thought about survives.

import { PDFName, PDFDict, PDFArray } from 'pdf-lib';

// Markup annotations, PDF 32000-1 table 169, plus the popup that carries a
// markup annotation's note window.
export const COMMENT_SUBTYPES = [
  'Text',
  'FreeText',
  'Line',
  'Square',
  'Circle',
  'Polygon',
  'PolyLine',
  'Highlight',
  'Underline',
  'Squiggly',
  'StrikeOut',
  'Stamp',
  'Caret',
  'Ink',
  'FileAttachment',
  'Sound',
  'Redact',
  'Popup',
];

const REMOVED = new Set(COMMENT_SUBTYPES.map((name) => `/${name}`));

/** Returns how many went, so the caller can say so rather than do it silently. */
export function stripComments(pdfDoc) {
  const context = pdfDoc.context;
  let removed = 0;

  for (const page of pdfDoc.getPages()) {
    const annots = context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (!annots) continue;

    const keep = [];
    for (let i = 0; i < annots.size(); i += 1) {
      const ref = annots.get(i);
      const annot = context.lookupMaybe(ref, PDFDict);
      // Anything unreadable is left alone rather than guessed at.
      const subtype = annot ? String(annot.get(PDFName.of('Subtype')) ?? '') : '';

      if (annot && REMOVED.has(subtype)) {
        removed += 1;
        continue;
      }
      keep.push(ref);
    }

    if (keep.length !== annots.size()) {
      page.node.set(PDFName.of('Annots'), context.obj(keep));
    }
  }

  return removed;
}
