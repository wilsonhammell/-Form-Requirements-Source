// The size the printed form is set in, read off the page text.
//
// The suggestion exists because the font size box starts empty, and the person
// filling it is looking at a form somebody else drew. Anything wrong here shows
// up as a number that does not match what is on the page.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {
  sizeOfItem,
  weightedMedian,
  collectTextSizes,
  suggestedFontSize,
} from '../src/core/pageText.js';

let pdfjs;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).href;
});

const open = (bytes) =>
  pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;

// A text item the way pdf.js reports one: the size lives in the matrix.
const item = (str, size, angled = false) => ({
  str,
  transform: angled ? [0, size, -size, 0, 0, 0] : [size, 0, 0, size, 0, 0],
});

describe('the size of one text item', () => {
  it('is the vertical scale of its matrix', () => {
    expect(sizeOfItem(item('Applicant name', 9))).toBe(9);
  });

  it('rounds to the half point the toolbar box steps in', () => {
    // Text set in 10pt and placed at a 0.996 scale, which is what the real
    // forms do. Three spellings of one size have to count as one size.
    expect(sizeOfItem(item('a', 9.96))).toBe(10);
    expect(sizeOfItem(item('b', 10.02))).toBe(10);
    expect(sizeOfItem(item('c', 6.49))).toBe(6.5);
  });

  it('reads text on an angle as the size it was set in', () => {
    expect(sizeOfItem(item('sideways', 11, true))).toBe(11);
  });

  it('ignores whitespace, which has no size worth counting', () => {
    expect(sizeOfItem(item('   ', 9))).toBeNull();
    expect(sizeOfItem(item('', 9))).toBeNull();
  });

  it('ignores sizes the box could not take anyway', () => {
    expect(sizeOfItem(item('printer mark', 2))).toBeNull();
    expect(sizeOfItem(item('WATERMARK', 96))).toBeNull();
  });

  it('ignores an item with no usable matrix', () => {
    expect(sizeOfItem({ str: 'x' })).toBeNull();
    expect(sizeOfItem(null)).toBeNull();
  });
});

describe('the median', () => {
  it('is the size the middle character is set in', () => {
    expect(weightedMedian(new Map([[9, 100]]))).toBe(9);
    expect(
      weightedMedian(
        new Map([
          [7, 20],
          [9, 100],
          [24, 12],
        ])
      )
    ).toBe(9);
  });

  it('counts characters, not text items, so headings cannot outvote the body', () => {
    // Six headings against one paragraph. By item the headings win, and the
    // form gets told to set every field in 24pt.
    const byCharacter = new Map([
      [24, 6 * 8],
      [9, 400],
    ]);
    expect(weightedMedian(byCharacter)).toBe(9);
  });

  it('is null when there is nothing to go on', () => {
    expect(weightedMedian(new Map())).toBeNull();
    expect(weightedMedian(new Map([[9, 0]]))).toBeNull();
  });
});

describe('reading a document', () => {
  async function form(lines) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    let y = 720;
    for (const [text, size] of lines) {
      page.drawText(text, { x: 40, y, size, font, color: rgb(0, 0, 0) });
      y -= size + 6;
    }
    return doc.save();
  }

  it('suggests the size most of the printed text is set in', async () => {
    const doc = await open(
      await form([
        ['ACCOUNT APPLICATION', 24],
        ['Please complete every section of this form in ink', 9],
        ['Name of the primary applicant and any joint applicant', 9],
        ['Branch use only, do not write below this line', 9],
        ['Form K-000-P revised 2026', 6],
      ])
    );
    expect(await suggestedFontSize(doc)).toBe(9);
    await doc.destroy();
  });

  it('counts every page, not just the first', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const cover = doc.addPage([612, 792]);
    cover.drawText('COVER', { x: 40, y: 700, size: 30, font });
    const body = doc.addPage([612, 792]);
    body.drawText('The terms and conditions set out on this page', {
      x: 40,
      y: 700,
      size: 7,
      font,
    });
    body.drawText('apply to the account opened by this form', { x: 40, y: 680, size: 7, font });

    const loaded = await open(await doc.save());
    expect(loaded.numPages).toBe(2);
    expect(await suggestedFontSize(loaded)).toBe(7);
    await loaded.destroy();
  });

  it('has no suggestion for a page with no text', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const loaded = await open(await doc.save());
    expect(await suggestedFontSize(loaded)).toBeNull();
    await loaded.destroy();
  });

  it('has no suggestion with no document', async () => {
    expect(await suggestedFontSize(null)).toBeNull();
  });
});

// The forms are real production documents and are kept out of the repository,
// so a fresh clone has none. Same arrangement as realForm.test.js.
const DIR = process.env.EXAMPLE_FORMS_DIR ?? 'example forms';
const files = fs.existsSync(DIR)
  ? fs
      .readdirSync(DIR)
      .filter((f) => f.toLowerCase().endsWith('.pdf'))
      .sort()
  : [];
const describeForm =
  files.length > 0 ? describe.each(files) : describe.skip.each(['no example forms present']);

describeForm('%s', (file) => {
  it('suggests a size the toolbar box would accept', async () => {
    const doc = await open(fs.readFileSync(path.join(DIR, file)));
    const size = await suggestedFontSize(doc);

    // Every real form is printed text, so every one of them has a suggestion.
    expect(size).not.toBeNull();
    expect(size).toBeGreaterThanOrEqual(4);
    expect(size).toBeLessThanOrEqual(72);
    expect(size * 2).toBe(Math.round(size * 2));
    await doc.destroy();
  });

  it('suggests a size that most of the page agrees with', async () => {
    // Not a spot check of one number, which would only pin today's forms. The
    // claim is that the answer is representative: the body text of a form is
    // the bulk of its characters, so the suggestion has to come from a size
    // that a real share of the page is set in, not from a stray line.
    const doc = await open(fs.readFileSync(path.join(DIR, file)));
    const weights = await collectTextSizes(doc);
    const size = weightedMedian(weights);

    const total = [...weights.values()].reduce((sum, count) => sum + count, 0);
    expect(weights.get(size) / total).toBeGreaterThan(0.2);
    await doc.destroy();
  });
});
