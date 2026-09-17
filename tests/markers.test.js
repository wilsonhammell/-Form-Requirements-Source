// Initials markers. The promise worth testing is a negative one: a marker
// changes the requirements and changes nothing at all about the PDF, so most of
// what is here exports a form twice and asserts the two are the same.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts, rgb } from 'pdf-lib';
import ExcelJS from 'exceljs';
import {
  createMarker,
  serializeMarkers,
  parseMarkers,
  markerIssues,
  DEFAULT_MARKER_SIZE,
  MARKER_LABEL,
  DRAW_MARKER,
} from '../src/core/markers.js';
import {
  createField,
  createConfig,
  serializeDocument,
  parseDocument,
  SCHEMA_VERSION,
} from '../src/core/schema.js';
import { requirementRows, requirementsWorkbookBytes } from '../src/core/excelExport.js';
import { TONE_HEX, TONE_TITLE, MARKER_TONE, FIELD_TONES } from '../src/core/fieldTone.js';
import { exportPdf } from '../src/core/pdfExport.js';
import { importPdf, SOURCE } from '../src/core/pdfImport.js';
import { readDocumentScripts } from '../src/core/pdfScripts.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';
import { buildSystemIndex } from '../src/core/systemFields.js';
import { signingButtons, buildButtonIndex } from '../src/core/signingButtons.js';

const dbIndex = buildDbIndex(
  normalizeDbFields([{ identifier: 'CUSTNAME', label: 'Customer Name' }])
);
const systemIndex = buildSystemIndex([{ identifier: 'ERRORS_FOUND', type: 'text' }]);
const buttonIndex = buildButtonIndex(signingButtons());

const at = (x, y, page = 0) => ({ page, rect: { x, y, width: 100, height: 18 } });

describe('the marker model', () => {
  it('defaults to an initials sized box at the origin with nobody named', () => {
    const marker = createMarker();
    expect(marker.rect.width).toBe(DEFAULT_MARKER_SIZE.width);
    expect(marker.rect.height).toBe(DEFAULT_MARKER_SIZE.height);
    expect(marker.page).toBe(0);
    expect(marker.role).toBe('');
    expect(marker.note).toBe('');
    expect(marker.id).toBeTruthy();
  });

  it('gives every marker its own id', () => {
    expect(createMarker().id).not.toBe(createMarker().id);
  });

  it('keeps an id it was given, so a round trip is not a new marker', () => {
    expect(createMarker({ id: 'keep-me' }).id).toBe('keep-me');
  });

  it('takes the role exactly as typed, whoever it names', () => {
    for (const role of ['Branch manager', 'guarantor', 'Overseer', 'Member 2', 'Witness / notary']) {
      expect(createMarker({ role }).role).toBe(role);
    }
  });

  it('refuses a zero or negative size, the way a field rect does', () => {
    const marker = createMarker({ rect: { x: 10, y: 20, width: 0, height: -5 } });
    expect(marker.rect.width).toBe(1);
    expect(marker.rect.height).toBe(1);
  });

  it('falls back rather than throwing on a rubbish rect', () => {
    const marker = createMarker({ rect: { x: 'left', y: null } });
    expect(marker.rect.x).toBe(0);
    expect(marker.rect.y).toBe(0);
    expect(marker.rect.width).toBe(DEFAULT_MARKER_SIZE.width);
  });

  it('is not a field type, so nothing can draw one by naming a type', () => {
    expect(createField({ type: DRAW_MARKER }).type).toBe('text');
  });
});

describe('the role is required and reported, not enforced', () => {
  it('says nothing when every marker names someone', () => {
    expect(markerIssues([createMarker({ role: 'Guarantor' })])).toEqual([]);
  });

  it('says nothing about a document with no markers at all', () => {
    expect(markerIssues([])).toEqual([]);
    expect(markerIssues(undefined)).toEqual([]);
  });

  it('reports an empty role as an error', () => {
    const [issue] = markerIssues([createMarker()]);
    expect(issue.level).toBe('error');
    expect(issue.text).toBe('1 initials marker does not say whose initials go there.');
  });

  it('counts whitespace as no answer', () => {
    expect(markerIssues([createMarker({ role: '   ' })])).toHaveLength(1);
  });

  it('reads as English for more than one', () => {
    const [issue] = markerIssues([createMarker(), createMarker()]);
    expect(issue.text).toBe('2 initials markers do not say whose initials go there.');
  });

  it('carries the ids, so clicking the issue can filter to exactly those boxes', () => {
    const named = createMarker({ role: 'Branch manager' });
    const blank = createMarker();
    const [issue] = markerIssues([named, blank]);
    expect(issue.ids).toEqual([blank.id]);
  });

  // The rule cannot clear itself the way Custom Save Validation's flag does:
  // there is no flag, and a marker is drawn before it is labelled.
  it('leaves the marker alone rather than deleting it, so the work is not lost', () => {
    const blank = createMarker();
    expect(parseMarkers(serializeMarkers([blank]))).toHaveLength(1);
  });
});

describe('the JSON', () => {
  const markers = [
    createMarker({ id: 'm1', page: 1, rect: { x: 100, y: 200, width: 40, height: 18 }, role: 'Branch manager', note: 'Both copies.' }),
    createMarker({ id: 'm2', role: 'Guarantor' }),
  ];

  it('round trips every marker unchanged', () => {
    const doc = serializeDocument([], { config: createConfig(), markers });
    const back = parseDocument(JSON.stringify(doc), dbIndex);
    expect(back.markers).toEqual(markers);
  });

  it('writes the key even when a form has none, so it is discoverable', () => {
    const doc = serializeDocument([createField({ name: 'CUSTNAME' })], {});
    expect(doc.markers).toEqual([]);
  });

  it('reads a document written before markers existed as having none', () => {
    const doc = serializeDocument([createField({ name: 'CUSTNAME' })], {});
    delete doc.markers;
    expect(parseDocument(JSON.stringify(doc), dbIndex).markers).toEqual([]);
  });

  it('survives a markers key that is not an array rather than throwing', () => {
    const doc = serializeDocument([], {});
    doc.markers = 'nonsense';
    expect(parseDocument(JSON.stringify(doc), dbIndex).markers).toEqual([]);
  });

  it('did not need a schema version bump, so files already written still open', () => {
    const doc = serializeDocument([], { markers });
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('rounds a rect the way a field rect is rounded', () => {
    const [written] = serializeMarkers([
      createMarker({ rect: { x: 1.123456789, y: 2, width: 3, height: 4 } }),
    ]);
    expect(written.rect.x).toBe(1.1235);
  });
});

describe('a marker never reaches the PDF', () => {
  async function flatForm() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    page.drawText('Agreement', { x: 72, y: 720, size: 14, font, color: rgb(0, 0, 0) });
    return doc.save();
  }

  const fields = () => [
    createField({ id: 'f1', name: 'CUSTNAME', ...at(50, 700) }),
    createField({ id: 'f2', name: 'Member1Signature', ...at(50, 300) }),
  ];

  const markers = () => [
    createMarker({ id: 'm1', page: 0, rect: { x: 400, y: 690, width: 40, height: 18 }, role: 'Branch manager' }),
    createMarker({ id: 'm2', page: 0, rect: { x: 400, y: 290, width: 40, height: 18 }, role: 'Guarantor' }),
  ];

  // Every annotation on every page, as the shape a reader downstream would see.
  async function shape(pdfBytes) {
    const doc = await PDFDocument.load(pdfBytes);
    const pages = [];
    for (const page of doc.getPages()) {
      const annots = doc.context.lookupMaybe(page.node.get(PDFName.of('Annots')), PDFArray);
      const on = [];
      for (let i = 0; i < (annots?.size() ?? 0); i += 1) {
        const annot = doc.context.lookupMaybe(annots.get(i), PDFDict);
        on.push({
          subtype: String(annot?.get(PDFName.of('Subtype')) ?? ''),
          name: String(annot?.get(PDFName.of('T')) ?? ''),
          rect: String(annot?.get(PDFName.of('Rect')) ?? ''),
        });
      }
      pages.push(on);
    }
    return pages;
  }

  it('leaves the annotations identical whether or not markers were placed', async () => {
    const originalBytes = await flatForm();
    const without = await exportPdf({ originalBytes, fields: fields(), meta: {} });
    const with_ = await exportPdf({ originalBytes, fields: fields(), meta: { markers: markers() } });
    expect(await shape(with_.pdfBytes)).toEqual(await shape(without.pdfBytes));
  });

  it('leaves the AcroForm field list identical', async () => {
    const originalBytes = await flatForm();
    const names = async (meta) => {
      const { pdfBytes } = await exportPdf({ originalBytes, fields: fields(), meta });
      const doc = await PDFDocument.load(pdfBytes);
      return doc.getForm().getFields().map((f) => f.getName()).sort();
    };
    expect(await names({ markers: markers() })).toEqual(await names({}));
  });

  // The requirements JSON is embedded in the PDF, so the file does grow. What
  // must not change is the form: its annotations, its AcroForm and its scripts.
  // Those three are the whole of what a reader downstream sees.
  it('leaves the document scripts identical, so nothing reaches the config block', async () => {
    const originalBytes = await flatForm();
    const scriptsOf = async (meta) => {
      const { pdfBytes } = await exportPdf({ originalBytes, fields: fields(), meta });
      return readDocumentScripts(await PDFDocument.load(pdfBytes));
    };
    expect(await scriptsOf({ markers: markers() })).toEqual(await scriptsOf({}));
  });

  it('puts them in the sidecar, which is the only place the export grows', async () => {
    const originalBytes = await flatForm();
    const { jsonBytes } = await exportPdf({
      originalBytes,
      fields: fields(),
      meta: { markers: markers() },
    });
    const sidecar = JSON.parse(new TextDecoder().decode(jsonBytes));
    expect(sidecar.markers.map((m) => m.role)).toEqual(['Branch manager', 'Guarantor']);
  });

  it('comes back on the next open, from the embedded JSON', async () => {
    const originalBytes = await flatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: fields(),
      meta: { markers: markers() },
    });
    const reopened = await importPdf(pdfBytes, dbIndex, [], signingButtons());
    expect(reopened.source).toBe(SOURCE.EMBEDDED);
    expect(reopened.markers.map((m) => m.role)).toEqual(['Branch manager', 'Guarantor']);
  });

  it('has nothing to rebuild from on a form with no embedded JSON', async () => {
    const originalBytes = await flatForm();
    const reopened = await importPdf(originalBytes, dbIndex, [], signingButtons());
    expect(reopened.source).toBe(SOURCE.FLAT);
    expect(reopened.markers).toEqual([]);
  });
});

describe('the workbook', () => {
  const doc = (fields, markers, config = {}) =>
    serializeDocument(fields, { config: createConfig(config), markers });

  async function read(bytes) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    const sheet = book.worksheets[0];
    const rows = [];
    sheet.eachRow((row, n) => rows.push([n, row]));
    return { sheet, rows };
  }

  it('gives each marker a row, in reading order among the fields on its page', () => {
    const fields = [
      createField({ name: 'CUSTNAME', ...at(50, 700) }),
      createField({ name: 'ACCOUNT', ...at(50, 300) }),
    ];
    const markers = [
      createMarker({ page: 0, rect: { x: 400, y: 500, width: 40, height: 18 }, role: 'Branch manager' }),
    ];
    const rows = requirementRows(doc(fields, markers), { systemIndex, buttonIndex, dbIndex });
    expect(rows.map((r) => r.name ?? `marker:${r.role}`)).toEqual([
      'CUSTNAME',
      'marker:Branch manager',
      'ACCOUNT',
    ]);
  });

  it('gives two initials boxes two rows, since they are two places to initial', () => {
    const markers = [
      createMarker({ page: 0, rect: { x: 50, y: 700, width: 40, height: 18 }, role: 'Guarantor' }),
      createMarker({ page: 0, rect: { x: 50, y: 400, width: 40, height: 18 }, role: 'Guarantor' }),
    ];
    const rows = requirementRows(doc([], markers), { systemIndex, buttonIndex, dbIndex });
    expect(rows.filter((r) => r.marker)).toHaveLength(2);
  });

  it('writes the kind, the person and the note, and nothing in the validation columns', async () => {
    const markers = [
      createMarker({
        page: 0,
        rect: { x: 50, y: 700, width: 40, height: 18 },
        role: 'Branch manager',
        note: 'Second page too.',
      }),
    ];
    const bytes = await requirementsWorkbookBytes({
      doc: doc([], markers),
      buttons: signingButtons(),
      systemIndex,
      buttonIndex,
      dbIndex,
    });
    const { rows } = await read(bytes);
    const row = rows.find(([, r]) => r.getCell(6).value === MARKER_LABEL)?.[1];
    expect(row).toBeTruthy();
    expect(row.getCell(7).value).toBe('Branch manager');
    // Load Validation and Save Validation. Nothing loads into an initials box
    // and nothing saves out of one.
    expect(row.getCell(8).value ?? '').toBe('');
    expect(row.getCell(9).value ?? '').toBe('');
    expect(row.getCell(10).value).toBe('Second page too.');
    // Field Name. A marker has no identifier for the filler to match on.
    expect(row.getCell(12).value ?? '').toBe('');
  });

  it('says so plainly when nobody was named, rather than leaving a blank cell', async () => {
    const bytes = await requirementsWorkbookBytes({
      doc: doc([], [createMarker({ page: 0, rect: { x: 50, y: 700, width: 40, height: 18 } })]),
      buttons: signingButtons(),
      systemIndex,
      buttonIndex,
      dbIndex,
    });
    const { rows } = await read(bytes);
    const row = rows.find(([, r]) => r.getCell(6).value === MARKER_LABEL)?.[1];
    expect(row.getCell(7).value).toBe('(not specified)');
  });

  it('colours the person in the marker tone, so the sheet reads as the screen does', async () => {
    const bytes = await requirementsWorkbookBytes({
      doc: doc([], [createMarker({ page: 0, rect: { x: 50, y: 700, width: 40, height: 18 }, role: 'Guarantor' })]),
      buttons: signingButtons(),
      systemIndex,
      buttonIndex,
      dbIndex,
    });
    const { rows } = await read(bytes);
    const row = rows.find(([, r]) => r.getCell(6).value === MARKER_LABEL)?.[1];
    expect(row.getCell(7).font.color.argb).toBe(TONE_HEX[MARKER_TONE]);
  });

  it('adds the marker to the colour key, so nothing on the sheet is unexplained', async () => {
    const bytes = await requirementsWorkbookBytes({
      doc: doc([], []),
      buttons: signingButtons(),
      systemIndex,
      buttonIndex,
      dbIndex,
    });
    const { rows } = await read(bytes);
    const key = rows.find(([, r]) => r.getCell(6).value === 'Field Name colours')?.[1];
    const swatches = [7, 8, 9, 10].map((c) => key.getCell(c).value);
    expect(swatches).toContain(TONE_TITLE[MARKER_TONE]);
  });

  it('leaves a form with no markers exactly as it was', async () => {
    const fields = [createField({ name: 'CUSTNAME', ...at(50, 700) })];
    const before = requirementRows(doc(fields, []), { systemIndex, buttonIndex, dbIndex });
    const after = requirementRows(doc(fields, undefined), { systemIndex, buttonIndex, dbIndex });
    expect(after).toEqual(before);
    expect(before.every((r) => !r.marker)).toBe(true);
  });
});

describe('the tone tables', () => {
  it('keeps the marker out of FIELD_TONES, because it is not a field', () => {
    expect(FIELD_TONES).not.toContain(MARKER_TONE);
  });

  it('gives it a colour and a title like every other tone', () => {
    expect(TONE_HEX[MARKER_TONE]).toMatch(/^FF[0-9A-F]{6}$/);
    expect(TONE_TITLE[MARKER_TONE]).toBeTruthy();
  });

  it('uses a colour no field tone uses, so a marker cannot be read as one', () => {
    const fieldColours = FIELD_TONES.map((t) => TONE_HEX[t]);
    expect(fieldColours).not.toContain(TONE_HEX[MARKER_TONE]);
  });

  // pageImages draws on a canvas and cannot import the ARGB table, so it keeps
  // its own copy. This is what stops the two drifting.
  it('agrees with the ink the page pictures are drawn in', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/core/pageImages.js', import.meta.url), 'utf8')
    );
    const ink = /const MARKER_INK = '#([0-9a-f]{6})'/.exec(source)?.[1];
    expect(ink).toBeTruthy();
    expect(`FF${ink.toUpperCase()}`).toBe(TONE_HEX[MARKER_TONE]);
  });
});
