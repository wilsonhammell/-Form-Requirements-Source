// Comments on every edge and corner of a page, for checking where a comment's
// pop-up opens. The browser check opens it, and it can be written out to look
// at by hand:
//
//   node -e "import('./tests/browser/commentEdges.js').then(async (m) => require('fs').writeFileSync('comment-edges.pdf', await m.commentEdgesPdf()))"
//
// Every comment carries its own appearance the way Acrobat writes one. pdf.js
// paints nothing for a comment without, so it would be there to click but not
// to see.

import { PDFDocument, PDFHexString, PDFString, StandardFonts, degrees } from 'pdf-lib';

const NOTE = 20;

// Page 1 is upright, page 2 is turned 90 so its corners land somewhere else on
// screen. Each count is what a click can open, replies sit inside their note.
export const COMMENT_COUNTS = [12, 5];

export async function commentEdgesPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([612, 792]);
  p1.drawText('Comment placement test, page 1', { x: 200, y: 560, size: 14, font });

  note(doc, p1, [0, 792 - NOTE, NOTE, 792], 'Top left corner', 'Underwriting');
  note(doc, p1, [296, 792 - NOTE, 296 + NOTE, 792], 'Top edge, centre', 'Compliance');
  note(
    doc,
    p1,
    [612 - NOTE, 792 - NOTE, 612, 792],
    'Top right corner. This one is long on purpose, so the pop-up has to wrap it over several lines and still keep inside the right edge of the page.\r\rIt also has a second paragraph after a blank line.',
    'Marketing'
  );
  note(doc, p1, [0, 386, NOTE, 386 + NOTE], 'Left edge, middle', 'Underwriting');
  note(doc, p1, [296, 386, 296 + NOTE, 386 + NOTE], 'Centre of the page', 'Compliance');
  note(doc, p1, [612 - NOTE, 386, 612, 386 + NOTE], 'Right edge, middle', 'Marketing');
  note(doc, p1, [0, 0, NOTE, NOTE], 'Bottom left corner', 'Underwriting');
  note(doc, p1, [296, 0, 296 + NOTE, NOTE], 'Bottom edge, centre', 'Compliance');

  const thread = note(
    doc,
    p1,
    [612 - NOTE, 0, 612, NOTE],
    'Bottom right corner, with a thread long enough that the pop-up has to scroll.',
    'Underwriting'
  );
  const replies = [
    ['Compliance', 'Agreed, this needs to move.'],
    ['Underwriting', 'Moving it would push the signature onto page 2.\rCan we shrink the disclosure instead?'],
    ['Marketing', 'The disclosure wording is fixed by legal.'],
    ['Compliance', 'Then the signature block goes to page 2.\rI will confirm with the business.'],
    ['Underwriting', 'Confirmed on the call.'],
    ['Marketing', 'Updated the draft.\rPlease check the new layout before this goes out.'],
  ];
  replies.forEach(([author, text], i) => reply(doc, p1, thread, [612 - NOTE, 0, 612, NOTE], text, author, i));

  box(doc, p1, [40, 40, 110, 752], 'Tall box down the left side, no room above or below it', 'Compliance');
  box(doc, p1, [440, 620, 612 - NOTE - 8, 760], 'Box towards the top right corner', 'Marketing');
  freeText(doc, p1, [130, 30, 570, 60], 'Wide text box along the bottom', 'Underwriting');

  // Turned 90 clockwise, so the PDF's bottom left is the top left on screen.
  const p2 = doc.addPage([612, 792]);
  p2.setRotation(degrees(90));
  p2.drawText('Comment placement test, page 2, rotated', { x: 150, y: 400, size: 14, font });

  note(doc, p2, [0, 0, NOTE, NOTE], 'Page 2, top left on screen', 'Underwriting');
  note(doc, p2, [0, 792 - NOTE, NOTE, 792], 'Page 2, top right on screen', 'Compliance');
  note(doc, p2, [612 - NOTE, 0, 612, NOTE], 'Page 2, bottom left on screen', 'Marketing');
  note(doc, p2, [612 - NOTE, 792 - NOTE, 612, 792], 'Page 2, bottom right on screen', 'Underwriting');
  note(doc, p2, [296, 386, 296 + NOTE, 386 + NOTE], 'Page 2, centre', 'Compliance');

  return doc.save();
}

// A sticky note, drawn as the yellow page with ruled lines Acrobat uses.
function note(doc, page, rect, text, author) {
  const [w, h] = size(rect);
  const draw = [
    'q 1 0.85 0.2 rg 0.45 0.35 0 RG 1 w',
    `0.5 0.5 ${w - 1} ${h - 1} re B`,
    '0.8 w',
    `4 ${h - 6} m ${w - 4} ${h - 6} l S`,
    `4 ${h - 10} m ${w - 4} ${h - 10} l S`,
    `4 ${h - 14} m ${w - 8} ${h - 14} l S`,
    'Q',
  ].join('\n');
  // Print, NoZoom and NoRotate, the flags Acrobat sets on a note.
  return annotate(doc, page, 'Text', rect, text, author, 0, { F: 28, AP: { N: form(doc, rect, draw) } });
}

// Acrobat writes a reply as a note of its own with nothing to draw, pointing
// at what it answers.
function reply(doc, page, parent, rect, text, author, index) {
  return annotate(doc, page, 'Text', rect, text, author, index + 1, { F: 28, IRT: parent });
}

function box(doc, page, rect, text, author) {
  const [w, h] = size(rect);
  const draw = `q 0.85 0.1 0.1 RG 1.5 w 0.75 0.75 ${w - 1.5} ${h - 1.5} re S Q`;
  return annotate(doc, page, 'Square', rect, text, author, 0, { F: 4, AP: { N: form(doc, rect, draw) } });
}

function freeText(doc, page, rect, text, author) {
  const [w, h] = size(rect);
  const draw = [
    'q 0.9 0.95 1 rg 0.1 0.3 0.7 RG 1 w',
    `0.5 0.5 ${w - 1} ${h - 1} re B`,
    `BT /Helv 10 Tf 0 0 0 rg 6 ${h / 2 - 3} Td (${text}) Tj ET`,
    'Q',
  ].join('\n');
  const resources = { Font: { Helv: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' } } };
  return annotate(doc, page, 'FreeText', rect, text, author, 0, {
    F: 4,
    DA: PDFString.of('/Helv 10 Tf 0 g'),
    AP: { N: form(doc, rect, draw, resources) },
  });
}

function annotate(doc, page, subtype, rect, text, author, minutes, extra) {
  const ref = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: subtype,
      Rect: rect,
      Contents: PDFHexString.fromText(text),
      T: PDFHexString.fromText(author),
      // A minute apart, so a thread reads in order.
      M: PDFString.of(`D:2026091514${String(minutes).padStart(2, '0')}00-04'00`),
      ...extra,
    })
  );
  page.node.addAnnot(ref);
  return ref;
}

function form(doc, rect, content, resources = {}) {
  const [w, h] = size(rect);
  return doc.context.register(
    doc.context.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: resources })
  );
}

const size = ([x0, y0, x1, y1]) => [x1 - x0, y1 - y0];
