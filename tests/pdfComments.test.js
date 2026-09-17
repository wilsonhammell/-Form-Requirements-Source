// Reviewer comments are stripped on export, and nothing else is. Until then a
// click on one shows what it says.
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { stripComments, readComments, COMMENT_SUBTYPES } from '../src/core/pdfComments.js';
import { exportPdf } from '../src/core/pdfExport.js';
import { createField } from '../src/core/schema.js';

// A markup annotation of the given kind, shaped the way Acrobat writes one.
function annotate(doc, page, subtype, extra = {}) {
  const dict = doc.context.obj({
    Type: 'Annot',
    Subtype: subtype,
    Rect: [100, 700, 120, 720],
    Contents: PDFString.of(`a ${subtype} note`),
    T: PDFString.of('Reviewer'),
    ...extra,
  });
  const ref = doc.context.register(dict);
  const annots = doc.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
  const list = annots ? annots.asArray().slice() : [];
  list.push(ref);
  page.node.set(PDFName.of('Annots'), doc.context.obj(list));
  return ref;
}

function subtypes(doc) {
  const out = [];
  for (const page of doc.getPages()) {
    const annots = doc.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const annot = doc.context.lookupMaybe(annots.get(i), PDFDict);
      if (annot) out.push(String(annot.get(PDFName.of('Subtype'))));
    }
  }
  return out.sort();
}

async function formWithComments() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const text = doc.getForm().createTextField('CUSTNAME');
  text.addToPage(page, { x: 50, y: 500, width: 200, height: 20 });
  annotate(doc, page, 'Text');
  // Acrobat always writes QuadPoints on a highlight, and pdf.js paints nothing
  // for one without.
  annotate(doc, page, 'Highlight', { QuadPoints: [100, 720, 120, 720, 100, 700, 120, 700] });
  annotate(doc, page, 'Link', { A: doc.context.obj({ S: 'URI', URI: PDFString.of('#') }) });
  return doc;
}

describe('stripping comments', () => {
  it('removes a sticky note and a highlight, keeping the field and the link', async () => {
    const doc = await formWithComments();
    expect(subtypes(doc)).toEqual(['/Highlight', '/Link', '/Text', '/Widget']);

    expect(stripComments(doc)).toBe(2);
    expect(subtypes(doc)).toEqual(['/Link', '/Widget']);
  });

  it('removes every markup kind Acrobat can leave', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    for (const subtype of COMMENT_SUBTYPES) annotate(doc, page, subtype);

    expect(stripComments(doc)).toBe(COMMENT_SUBTYPES.length);
    expect(subtypes(doc)).toEqual([]);
  });

  it('takes a popup away with the note it belongs to', async () => {
    // A popup is the note window. Left behind it points at an annotation that
    // is no longer there.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const parent = annotate(doc, page, 'Text');
    annotate(doc, page, 'Popup', { Parent: parent });

    expect(stripComments(doc)).toBe(2);
    expect(subtypes(doc)).toEqual([]);
  });

  it('leaves a page with nothing on it alone', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    expect(stripComments(doc)).toBe(0);
  });

  it('leaves an annotation type it does not know about', async () => {
    // The list says what to remove, not what to keep, so something unforeseen
    // survives rather than being swept up.
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    annotate(doc, page, 'Screen');

    expect(stripComments(doc)).toBe(0);
    expect(subtypes(doc)).toEqual(['/Screen']);
  });
});

describe('export', () => {
  it('drops the comments and says how many', async () => {
    const source = await formWithComments();
    const originalBytes = await source.save();

    const { pdfBytes, warnings } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 50, y: 500, width: 200, height: 20 } }),
      ],
    });

    expect(warnings).toEqual(['Removed 2 comments left on the form.']);

    const out = await PDFDocument.load(pdfBytes);
    expect(subtypes(out)).toEqual(['/Link', '/Widget']);
    // The field is still there and still usable.
    expect(out.getForm().getTextField('CUSTNAME')).toBeTruthy();
  });

  it('says nothing when the form carries none', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([612, 792]);
    source.getForm().createTextField('CUSTNAME').addToPage(page, {
      x: 50, y: 500, width: 200, height: 20,
    });
    const originalBytes = await source.save();

    const { warnings } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 50, y: 500, width: 200, height: 20 } }),
      ],
    });
    expect(warnings).toEqual([]);
  });
});

describe('reading comments to open', () => {
  let pdfjs;

  beforeAll(async () => {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      import.meta.url
    ).href;
  });

  // Through pdf.js rather than hand written data, since what pdf.js hands the
  // page is what the reader has to make sense of.
  async function commentsOf(doc) {
    const loaded = await pdfjs.getDocument({ data: await doc.save(), isEvalSupported: false }).promise;
    const page = await loaded.getPage(1);
    const comments = readComments(await page.getAnnotations());
    await loaded.destroy();
    return comments;
  }

  it('gives a note its text, author, date and place on the page', async () => {
    const doc = await formWithComments();
    const page = doc.getPage(0);
    annotate(doc, page, 'Square', {
      Rect: [300, 400, 360, 440],
      Contents: PDFString.of('Move this\rbelow the signature'),
      T: PDFString.of('Underwriting'),
      M: PDFString.of("D:20260917093000-05'00"),
    });

    const comments = await commentsOf(doc);
    const square = comments.find((c) => c.author === 'Underwriting');
    expect(square).toMatchObject({
      rect: { x: 300, y: 400, width: 60, height: 40 },
      text: 'Move this\nbelow the signature',
      date: "D:20260917093000-05'00",
      replies: [],
    });
    // The field and the link are not comments.
    expect(comments.map((c) => c.text).sort()).toEqual([
      'Move this\nbelow the signature',
      'a Highlight note',
      'a Text note',
    ]);
  });

  it('puts replies under the comment they answer, however deep', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const note = annotate(doc, page, 'Text', { Contents: PDFString.of('Is this required?') });
    const reply = annotate(doc, page, 'Text', {
      Contents: PDFString.of('Yes'),
      T: PDFString.of('Compliance'),
      IRT: note,
    });
    annotate(doc, page, 'Text', { Contents: PDFString.of('Thanks'), IRT: reply });
    annotate(doc, page, 'Popup', { Parent: note });

    const comments = await commentsOf(doc);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe('Is this required?');
    expect(comments[0].replies.map((r) => [r.author, r.text])).toEqual([
      ['Compliance', 'Yes'],
      ['Reviewer', 'Thanks'],
    ]);
  });

  it('opens a group member on its own, with the text of the comment it is grouped with', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const note = annotate(doc, page, 'Square', { Contents: PDFString.of('This whole block') });
    annotate(doc, page, 'Square', {
      Rect: [50, 50, 90, 60],
      Contents: PDFString.of('ignored'),
      IRT: note,
      RT: 'Group',
    });

    const comments = await commentsOf(doc);
    expect(comments.map((c) => [c.rect.x, c.text])).toEqual([
      [100, 'This whole block'],
      [50, 'This whole block'],
    ]);
  });

  it('skips a hidden comment and one with nothing to say', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    annotate(doc, page, 'Text', { F: 2 });
    annotate(doc, page, 'Highlight', { Contents: PDFString.of('  ') });

    expect(await commentsOf(doc)).toEqual([]);
  });
});
