// The requirements workbook, in the shape the business already writes by hand.
//
// Its own module, reading the serialized document and nothing else. No live
// field array, no pdf-lib, no reaching into the export path, so nothing it does
// can affect the PDF.
//
// One direction only. This is a testing document, not a format to read back.
//
// Layout comes from the existing workbooks rather than being invented.

import ExcelJS from 'exceljs';
import { isSystemField } from './systemFields.js';
import { isSubmissionButton } from './signingButtons.js';
import { fieldScope, fieldTone, TONE_HEX, TONE_TITLE } from './fieldTone.js';
import {
  METADATA_ROWS,
  CHANNEL_STEPS,
  CHANNEL_ORDER,
  SUBMIT_FOR_PROCESSING,
  STANDARD_REQUIREMENTS,
  SIGNING_ROLES,
  POST_PRODUCTION,
  FINAL_SIGN_OFF,
  testColumns,
} from './requirementsTemplate.js';

// The picture band, then the table.
const COL = { section: 6, label: 7, load: 8, save: 9, logic: 10, comment: 12, test: 13 };

// A picture wider than the band covers the table, which is what happened when
// it was sized in points.
const BAND_COLUMNS = 5;
const BAND_COLUMN_WIDTH = 16;
// Excel's column width is roughly in characters and its conversion is not
// exactly this, so the picture is held a little inside the band. Flush to the
// edge it clipped the Field column underneath.
const BAND_MARGIN_PX = 16;
// Excel's default row is 15 points, 20 pixels at the usual scale.
const ROW_HEIGHT_PX = 20;
const BAND_WIDTH_PX =
  BAND_COLUMNS * (BAND_COLUMN_WIDTH * 7 + 5) - BAND_MARGIN_PX;

const ACCESS = { true: 'Editable', false: 'Read Only' };

// Light tints of the Office accents, which is what the originals use.
const INK = {
  header: 'FF44546A',
  headerText: 'FFFFFFFF',
  section: 'FFD6DCE4',
  subSection: 'FFEDF0F4',
  tableHeader: 'FF44546A',
  band: 'FFF2F5F8',
  rule: 'FFBFBFBF',
};

const fill = (cell, color) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
};

const edged = (cell) => {
  cell.border = {
    top: { style: 'hair', color: { argb: INK.rule } },
    bottom: { style: 'hair', color: { argb: INK.rule } },
    left: { style: 'hair', color: { argb: INK.rule } },
    right: { style: 'hair', color: { argb: INK.rule } },
  };
};

// Only the fields a person interacts with. System fields are plumbing and the
// buttons drive the signing sections, which is why neither appears in the
// documents this is modelled on.
//
// One row per name. A repeated name is one field carrying one value, so there
// is one thing to test, and two rows could be ticked Pass and Fail with nothing
// to resolve the contradiction.
export function requirementRows(
  doc,
  { systemIndex = new Map(), buttonIndex = new Map(), dbIndex = null } = {}
) {
  const wanted = ['standard', 'signers'];
  const byName = new Map();

  for (const field of doc.fields ?? []) {
    const name = (field.name ?? '').trim();
    if (!name) continue;

    const system = isSystemField(name, systemIndex);
    const scope = fieldScope(field, {
      system,
      submissionButton: isSubmissionButton(name, buttonIndex),
    });
    if (!wanted.includes(scope)) continue;

    // The same rule the canvas and the field list use, so a name reads the same
    // colour here as on screen.
    const tone = fieldTone(field, { system, attempted: dbIndex?.has(name) ?? false });

    const existing = byName.get(name);
    if (existing) {
      existing.pages.add(field.page);
      // A flag set on any placement counts: they describe the field, not the box.
      existing.loadValidated ||= !!field.loadValidated;
      existing.saveValidated ||= !!field.saveValidated;
      existing.customSaveValidated ||= !!field.customSaveValidated;
      continue;
    }

    byName.set(name, {
      name,
      tone,
      customerFacingName: field.customerFacingName ?? '',
      editable: !!field.editable,
      loadValidated: !!field.loadValidated,
      saveValidated: !!field.saveValidated,
      customSaveValidated: !!field.customSaveValidated,
      note: field.note ?? '',
      pages: new Set([field.page]),
      // Reading order, from where the field sits rather than from the array.
      page: field.page,
      top: field.rect?.y ?? 0,
      left: field.rect?.x ?? 0,
      height: field.rect?.height ?? 0,
    });
  }

  return readingOrder(
    [...byName.values()].map((row) => ({ ...row, pages: [...row.pages].sort((a, b) => a - b) }))
  );
}

// Down the page then across, banded by vertical centre rather than top edge.
// Boxes meant to sit on one line rarely share a top. A signer row on a real
// form has its three tops within a point of each other and their heights
// differing by four, so sorting on the top alone interleaves the columns.
export function readingOrder(rows) {
  const centre = (r) => r.top + (r.height ?? 0) / 2;

  const byPage = new Map();
  for (const row of rows) {
    if (!byPage.has(row.page)) byPage.set(row.page, []);
    byPage.get(row.page).push(row);
  }

  const out = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    // PDF user space counts up from the bottom, so a larger centre is higher up.
    const down = byPage.get(page).sort((a, b) => centre(b) - centre(a));

    let band = [];
    let tolerance = 0;
    const flush = () => {
      out.push(...band.sort((a, b) => a.left - b.left));
      band = [];
    };

    for (const row of down) {
      const joins = band.length > 0 && Math.abs(centre(band[0]) - centre(row)) <= tolerance;
      if (!joins) {
        flush();
        band = [row];
        tolerance = Math.max(row.height ?? 0, 6) / 2;
        continue;
      }
      band.push(row);
      tolerance = Math.max(tolerance, Math.max(row.height ?? 0, 6) / 2);
    }
    flush();
  }

  return out;
}

// Their own convention. The star means it depends on something explained
// alongside, and Custom Save Validation already forces a note.
const saveMark = (row) => (row.customSaveValidated ? 'Yes*' : row.saveValidated ? 'Yes' : '');

// pageImages is optional, one PNG per page as { page, data, width, height },
// rendered by the caller because rasterising needs pdf.js and a canvas.
export function buildRequirementsWorkbook({
  doc,
  buttons = [],
  systemIndex = new Map(),
  buttonIndex = new Map(),
  dbIndex = null,
  pageImages = [],
  sheetName = 'Form',
} = {}) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName.slice(0, 31) || 'Form');

  const tests = testColumns(doc?.config?.formType);
  // A column per tester per account type, Development first then BA.
  const testHeaders = [
    ...tests.map((t) => `Development Test: ${t}`),
    ...tests.map((t) => `BA Testing: ${t}`),
  ];

  sheet.columns = [
    ...Array.from({ length: BAND_COLUMNS }, () => ({ width: BAND_COLUMN_WIDTH })),
    { width: 26 },
    { width: 34 },
    { width: 15 },
    { width: 15 },
    { width: 46 },
    { width: 3 },
    { width: 30 },
    ...testHeaders.map(() => ({ width: 20 })),
  ];

  // Follows you down, as the originals do and as a table this long needs.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const bold = (row, cols) => cols.forEach((c) => (row.getCell(c).font = { bold: true }));

  const header = sheet.getRow(1);
  header.getCell(1).value = 'Future Enhancement Notes';
  sheet.mergeCells(1, 1, 1, 5);
  header.getCell(COL.section).value = 'Field';
  header.getCell(COL.label).value = 'Form Field';
  header.getCell(COL.load).value = 'Load Validation';
  header.getCell(COL.save).value = 'Save Validation';
  header.getCell(COL.logic).value = 'Logic';
  header.getCell(COL.comment).value = 'Field Name';
  testHeaders.forEach((text, i) => (header.getCell(COL.test + i).value = text));
  for (const col of [1, COL.section, COL.label, COL.load, COL.save, COL.logic, COL.comment,
    ...testHeaders.map((_, i) => COL.test + i)]) {
    const cell = header.getCell(col);
    cell.font = { bold: true, color: { argb: INK.headerText } };
    fill(cell, INK.header);
    cell.alignment = { vertical: 'middle', wrapText: true };
    edged(cell);
  }
  header.height = 26;

  let at = 2;
  const write = (section, label, load, save, logic) => {
    const row = sheet.getRow(at);
    if (section) row.getCell(COL.section).value = section;
    if (label) row.getCell(COL.label).value = label;
    if (load) row.getCell(COL.load).value = load;
    if (save) row.getCell(COL.save).value = save;
    if (logic) row.getCell(COL.logic).value = logic;
    at += 1;
    return row;
  };
  const LAST = () => COL.test + testHeaders.length - 1;

  // Banded across the table so the eye finds it.
  const heading = (text) => {
    const row = write(text);
    for (let col = COL.section; col <= LAST(); col += 1) {
      const cell = row.getCell(col);
      cell.font = { bold: true };
      fill(cell, INK.section);
      edged(cell);
    }
    return row;
  };

  const subHeading = (row) => {
    for (let col = COL.section; col <= LAST(); col += 1) {
      const cell = row.getCell(col);
      cell.font = { bold: true };
      fill(cell, INK.subSection);
      edged(cell);
    }
    return row;
  };
  const blank = () => {
    at += 1;
  };

  // Rules across the table columns only, so the picture band stays clean.
  const edgedRow = (row, shade) => {
    for (let col = COL.section; col <= LAST(); col += 1) {
      const cell = row.getCell(col);
      edged(cell);
      if (shade) fill(cell, shade);
      cell.alignment = { vertical: 'top', wrapText: true };
    }
    return row;
  };

  heading('FO Processing');
  for (const label of METADATA_ROWS) {
    // The one value in this block the tool knows. The rest describe how
    // FileOptics files and routes the document, which it has no way to know,
    // and a filled in guess would be read as a checked fact.
    const value = label === 'Membership Type' ? (doc?.config?.formType ?? '') : '';
    edgedRow(write(label, value, '', '', label === 'Membership Type' ? 'Person, Organization or Combined' : ''));
  }

  blank();
  heading('Signing Authorization');
  const placed = new Set((doc?.fields ?? []).map((f) => (f.name ?? '').trim()));
  const offered = new Set(
    buttons.filter((b) => placed.has(b.identifier)).map((b) => b.identifier)
  );

  const writeSteps = (steps) => {
    for (const [label, note] of steps) {
      // A double underscore marks a sub heading, which sits in the Field column
      // with its block indented under it.
      if (label.startsWith('__')) subHeading(write(label.slice(2), note ?? '', '', '', ''));
      else edgedRow(write('', label, '', '', note ?? ''));
    }
  };

  for (const identifier of CHANNEL_ORDER) {
    const channel = CHANNEL_STEPS[identifier];
    subHeading(write(channel.title));
    // A channel not offered stays a bare heading, so a reader sees it was
    // considered rather than missed. The trust form does this.
    if (offered.has(identifier)) writeSteps(channel.steps);
  }
  subHeading(write(SUBMIT_FOR_PROCESSING.title));
  writeSteps(SUBMIT_FOR_PROCESSING.steps);

  blank();
  heading('Standard Requirements');
  for (const [label, value, note] of STANDARD_REQUIREMENTS) edgedRow(write(label, value ?? '', '', '', note ?? ''));

  blank();
  heading('Signing Requirements');
  subHeading(write('Applicable Roles for Signing'));
  for (const role of SIGNING_ROLES) edgedRow(write('', role));
  edgedRow(write('FileOptics Optional Signer', 'if applicable', '', '', 'Update required on Optional Signing Label'));

  blank();
  heading('Post Production Testing');
  for (const [label, value, note] of POST_PRODUCTION) edgedRow(write(label, value ?? '', '', '', note ?? ''));

  blank();
  heading('Final Overview Sign Off');
  for (const [label, value] of FINAL_SIGN_OFF) edgedRow(write(label, value));

  blank();

  // Nothing else on the sheet says what the colours mean.
  const key = write('Field Name colours');
  key.getCell(COL.section).font = { bold: true };
  let keyAt = COL.label;
  for (const tone of ['standard', 'attempted', 'special']) {
    const cell = key.getCell(keyAt);
    cell.value = TONE_TITLE[tone];
    cell.font = { name: 'Consolas', size: 10, color: { argb: TONE_HEX[tone] } };
    keyAt += 1;
  }

  const tableTop = at;
  const rows = requirementRows(doc, { systemIndex, buttonIndex, dbIndex });
  const pageStart = new Map();

  // Grouped by page so each page's block can be lined up against its picture.
  const byPage = new Map();
  for (const row of rows) {
    if (!byPage.has(row.page)) byPage.set(row.page, []);
    byPage.get(row.page).push(row);
  }
  const imageByPage = new Map(pageImages.map((image) => [image.page, image]));
  let index = 0;

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const start = at;
    pageStart.set(page, start);
    const image = imageByPage.get(page);
    // Without a picture there is nothing to line up against, so the rows follow
    // each other.
    const scale = image ? BAND_WIDTH_PX / image.width : 0;

    for (const row of byPage.get(page)) {
      if (image) {
        // PDF user space counts up from the bottom, so this measures down from
        // the page top.
        const fromTop = (image.height - (row.top + (row.height ?? 0))) * scale;
        const target = start + Math.round(fromTop / ROW_HEIGHT_PX);
        // Never backwards, so two fields close together take consecutive rows
        // rather than landing on top of each other.
        if (target > at) at = target;
      }
      writeFieldRow(row, index);
      index += 1;
    }
  }

  function writeFieldRow(row, index) {
    const written = write(
      ACCESS[row.editable],
      // Form Field is left empty on purpose. It is the label a member reads
      // beside the box, which only someone looking at the form can say. The
      // customer facing name is not the same thing, since it names a field in
      // an error message and only load validated fields carry one, so filling
      // from it would populate a few rows and leave the rest blank while
      // looking authoritative.
      '',
      row.loadValidated ? 'Yes' : '',
      saveMark(row),
      row.note
    );
    // The identifier the filler matches on, the one column their documents
    // never carried.
    written.getCell(COL.comment).value = row.name;
    written.getCell(COL.comment).font = {
      name: 'Consolas',
      size: 10,
      color: { argb: TONE_HEX[row.tone] ?? TONE_HEX.standard },
    };
    written.getCell(COL.comment).note = TONE_TITLE[row.tone];
    if (row.pages.length > 1) {
      written.getCell(COL.logic).value = [row.note, `Appears on pages ${row.pages.map((p) => p + 1).join(', ')}`]
        .filter(Boolean)
        .join(' — ');
    }
    // Banded, since this is the part someone reads across to a Pass column.
    edgedRow(written, index % 2 ? INK.band : undefined);
  }
  sheet.getCell(1, COL.comment).value = 'Field Name';
  sheet.getCell(1, COL.comment).font = { bold: true };

  for (const image of pageImages) {
    const id = book.addImage({ buffer: image.data, extension: 'png' });
    const top = pageStart.get(image.page) ?? tableTop;
    // Sized in points it was wider than the five columns and covered the table.
    const scale = BAND_WIDTH_PX / image.width;
    sheet.addImage(id, {
      tl: { col: 0, row: top - 1 },
      ext: { width: BAND_WIDTH_PX, height: Math.round(image.height * scale) },
    });
  }

  return book;
}

export async function requirementsWorkbookBytes(options) {
  const book = buildRequirementsWorkbook(options);
  return new Uint8Array(await book.xlsx.writeBuffer());
}
