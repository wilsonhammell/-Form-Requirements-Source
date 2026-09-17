// The message boxes the starter code shows a person, drawn and placed the way
// the example forms have them. The numbers are measured off those forms.
//
// Two boxes now. FORM_MESSAGE carries every one line message, the starter code
// setting the text and the colour together, and DNA_REQ still covers the form.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from 'pdf-lib';
import {
  MESSAGE_BOXES,
  MESSAGE_COLORS,
  layoutSystemFields,
  normalizeSystemFields,
  ensureSystemFields,
} from '../src/core/systemFields.js';
import { exportPdf } from '../src/core/pdfExport.js';
import { importPdf } from '../src/core/pdfImport.js';
import { createField } from '../src/core/schema.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';
import { helperScript } from '../src/starter/index.js';

const LETTER = [0, 0, 612, 792];
const NAMES = ['FORM_MESSAGE', 'DNA_REQ'];
const LIST = normalizeSystemFields([
  { identifier: 'FORM_MESSAGE', placement: 'wide', multiline: true },
  { identifier: 'DNA_REQ', placement: 'wide', multiline: true },
]);

async function flatPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

async function exportBoxes(extra = []) {
  const originalBytes = await flatPdf();
  const fields = [...ensureSystemFields([], LIST, LETTER), ...extra];
  const { pdfBytes } = await exportPdf({ originalBytes, fields, systemFields: LIST });
  return pdfBytes;
}

function lookOf(doc, name) {
  const ctx = doc.context;
  const field = doc.getForm().getField(name);
  const widget = field.acroField.getWidgets()[0];
  const mk = ctx.lookupMaybe(widget.dict.get(PDFName.of('MK')), PDFDict);
  const colour = (key) => {
    const list = mk && ctx.lookupMaybe(mk.get(PDFName.of(key)), PDFArray);
    return list ? list.asArray().map((n) => Number(n)) : null;
  };
  const daObj = widget.dict.get(PDFName.of('DA')) ?? field.acroField.dict.get(PDFName.of('DA'));
  const da = daObj instanceof PDFString || daObj instanceof PDFHexString ? daObj.decodeText() : '';
  return {
    border: colour('BC'),
    background: colour('BG'),
    da,
    noScroll: (field.acroField.getFlags() & (1 << 23)) !== 0,
  };
}

// Field names in the order the page draws them, bottom first.
function stackOf(doc, pageIndex = 0) {
  const ctx = doc.context;
  return doc.getPage(pageIndex).node.Annots().asArray().map((ref) => {
    const widget = ctx.lookup(ref, PDFDict);
    const parent = ctx.lookupMaybe(widget.get(PDFName.of('Parent')), PDFDict);
    return (widget.get(PDFName.of('T')) ?? parent?.get(PDFName.of('T'))).decodeText();
  });
}

const closeTo = (actual, expected) => {
  expect(actual).not.toBeNull();
  expected.forEach((value, i) => expect(actual[i]).toBeCloseTo(value, 3));
};

describe('how a message box is drawn', () => {
  it('draws the border and the text in the box colour', async () => {
    const doc = await PDFDocument.load(await exportBoxes());
    for (const name of NAMES) {
      const look = lookOf(doc, name);
      closeTo(look.border, MESSAGE_BOXES[name].color);
      expect(look.da).toContain(`${MESSAGE_BOXES[name].color.join(' ')} rg`);
    }
  });

  it('seeds both boxes red, the colour all but one message uses', () => {
    for (const name of NAMES) expect(MESSAGE_BOXES[name].color).toEqual(MESSAGE_COLORS.error);
  });

  it('puts every box on white', async () => {
    const doc = await PDFDocument.load(await exportBoxes());
    for (const name of NAMES) closeTo(lookOf(doc, name).background, [1, 1, 1]);
  });

  it('leaves every box scrolling, so a long message is reachable', async () => {
    const doc = await PDFDocument.load(await exportBoxes());
    expect(NAMES.filter((name) => lookOf(doc, name).noScroll)).toEqual([]);
  });

  it('leaves an ordinary field transparent', async () => {
    const custname = createField({ name: 'CUSTNAME', page: 0, rect: { x: 50, y: 700, width: 200, height: 18 } });
    const doc = await PDFDocument.load(await exportBoxes([custname]));
    const look = lookOf(doc, 'CUSTNAME');
    expect(look.border).toBeNull();
    expect(look.background).toBeNull();
    expect(look.da.startsWith('0 g')).toBe(true);
  });

  it('keeps the look through a second export', async () => {
    const first = await exportBoxes();
    const dbIndex = buildDbIndex(normalizeDbFields([]));
    const reopened = await importPdf(first, dbIndex, LIST);
    const { pdfBytes } = await exportPdf({
      originalBytes: first,
      fields: reopened.fields,
      systemFields: LIST,
    });
    const doc = await PDFDocument.load(pdfBytes);
    for (const name of NAMES) {
      const look = lookOf(doc, name);
      closeTo(look.border, MESSAGE_BOXES[name].color);
      expect(look.da).toContain(`${MESSAGE_BOXES[name].color.join(' ')} rg`);
    }
  });
});

// The starter code ships as text rather than as a module, so it cannot import
// the colours it recolours the strip with. This is what keeps the copies equal.
describe('the colours the starter code recolours the strip with', () => {
  const script = helperScript();

  it('matches MESSAGE_COLORS', () => {
    expect(script).toContain(`["RGB", ${MESSAGE_COLORS.error.join(', ')}]`);
    expect(script).toContain(`["RGB", ${MESSAGE_COLORS.success.join(', ')}]`);
  });

  it('sets both the text and the border, so the whole box changes tone', () => {
    expect(script).toContain('box.textColor = tone;');
    expect(script).toContain('box.strokeColor = tone;');
  });

  it('clears the strip on every submit attempt', () => {
    expect(script).toMatch(/function resetValidationState\(\)[\s\S]*?clearFormMessage\(\);/);
  });
});

describe('how the message boxes stack', () => {
  it('puts them above a field added after them, DNA_REQ on top', async () => {
    const custname = createField({ name: 'CUSTNAME', page: 0, rect: { x: 50, y: 700, width: 200, height: 18 } });
    const stack = stackOf(await PDFDocument.load(await exportBoxes([custname])));
    expect(stack).toEqual(['CUSTNAME', ...Object.keys(MESSAGE_BOXES)]);
    expect(stack.at(-1)).toBe('DNA_REQ');
  });

  it('lifts boxes a form buried, leaving every other field in tab order', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([612, 792]);
    ['FIRST', 'DNA_REQ', 'SECOND', 'FORM_MESSAGE', 'THIRD'].forEach((name, i) => {
      source.getForm().createTextField(name).addToPage(page, { x: 50, y: 700 - i * 30, width: 200, height: 18 });
    });
    const bytes = await source.save();
    const reopened = await importPdf(bytes, buildDbIndex(normalizeDbFields([])), LIST);
    const { pdfBytes } = await exportPdf({ originalBytes: bytes, fields: reopened.fields, systemFields: LIST });
    expect(stackOf(await PDFDocument.load(pdfBytes))).toEqual([
      'FIRST',
      'SECOND',
      'THIRD',
      'FORM_MESSAGE',
      'DNA_REQ',
    ]);
  });
});

describe('where a message box goes', () => {
  const rects = layoutSystemFields(LIST, LETTER);

  it('puts the strip on the centre line, at the width the forms use', () => {
    const box = rects.get('FORM_MESSAGE');
    expect(box.width).toBeCloseTo(586, 0);
    expect(box.y + box.height / 2).toBeCloseTo(396, 5);
    expect(box.x).toBeCloseTo((612 - box.width) / 2, 5);
  });

  it('gives the strip two lines, since the eSign failure names members', () => {
    expect(rects.get('FORM_MESSAGE').height).toBe(34);
  });

  it('covers most of the page with DNA_REQ', () => {
    const box = rects.get('DNA_REQ');
    expect(box.height).toBeGreaterThan(792 * 0.8);
    expect(box.x).toBeCloseTo((612 - box.width) / 2, 5);
  });

  it('still stacks any other wide field in the middle', () => {
    const list = normalizeSystemFields([{ identifier: 'SOME_NOTICE', placement: 'wide' }]);
    const box = layoutSystemFields(list, LETTER).get('SOME_NOTICE');
    expect(box.width).toBeCloseTo(612 * 0.8, 5);
    expect(box.height).toBe(18);
  });
});
