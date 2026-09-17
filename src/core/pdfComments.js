// Reviewer comments live in the same page /Annots array as the fields, so
// dropping them is a filter on that array rather than anything structural.
//
// The list says what to remove rather than what to keep, so an annotation type
// nobody thought about survives.
//
// Until export they are still on the page, and readComments is what lets a
// click on one show what it says.

import { PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { rectFromPdfArray } from './coords.js';

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

// Annotation flag, PDF 32000-1 table 165 bit 2. pdf.js lists a hidden
// annotation but paints nothing for it, so there is nothing to click.
const ANNOT_HIDDEN = 1 << 1;

// A popup is the note window of another comment, not a comment of its own.
const NOTE_SUBTYPES = new Set(COMMENT_SUBTYPES.filter((name) => name !== 'Popup'));

/**
 * One page's pdf.js getAnnotations() as the comments a click can open, each
 * with its replies. Dates stay the raw PDF date string, so this runs in node.
 */
export function readComments(annotations) {
  const byId = new Map();
  for (const annot of annotations ?? []) {
    if (!NOTE_SUBTYPES.has(annot.subtype) || !Array.isArray(annot.rect)) continue;
    byId.set(annot.id, {
      id: annot.id,
      rect: rectFromPdfArray(annot.rect),
      author: annot.titleObj?.str ?? '',
      date: annot.modificationDate ?? annot.creationDate ?? '',
      // Acrobat breaks lines with a bare CR, which HTML shows as a space.
      text: (annot.contentsObj?.str ?? '').replace(/\r\n?/g, '\n'),
      hidden: ((annot.annotationFlags ?? 0) & ANNOT_HIDDEN) !== 0,
      // A group member is a second shape of its parent's comment and pdf.js
      // already copies the parent's text onto it, so only /RT /R is a reply.
      replyTo: annot.replyType === 'R' ? annot.inReplyTo : null,
      replies: [],
    });
  }

  // A reply to a reply still belongs under the comment that started it. The
  // seen set stops a pair pointing at each other from looping.
  const rootOf = (comment) => {
    const seen = new Set();
    let at = comment;
    while (at.replyTo && byId.has(at.replyTo) && !seen.has(at.id)) {
      seen.add(at.id);
      at = byId.get(at.replyTo);
    }
    return at;
  };

  const top = [];
  for (const comment of byId.values()) {
    const root = rootOf(comment);
    if (root === comment) top.push(comment);
    else root.replies.push({ id: comment.id, author: comment.author, date: comment.date, text: comment.text });
  }

  // An empty highlight has nothing to show, so a click on it still draws.
  return top
    .filter((c) => !c.hidden && (c.text.trim() || c.replies.length > 0))
    .map(({ id, rect, author, date, text, replies }) => ({ id, rect, author, date, text, replies }));
}
