// The requirements workbook. Read back through ExcelJS rather than asserted as
// strings, so these check what someone opening the file would see.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { requirementRows, requirementsWorkbookBytes } from '../src/core/excelExport.js';
import { testColumns } from '../src/core/requirementsTemplate.js';
import { serializeDocument, createField, createConfig } from '../src/core/schema.js';
import { buildSystemIndex } from '../src/core/systemFields.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';
import { TONE_HEX } from '../src/core/fieldTone.js';
import { signingButtons, buildButtonIndex } from '../src/core/signingButtons.js';

const BUTTONS = signingButtons();
const buttonIndex = buildButtonIndex(BUTTONS);
const systemIndex = buildSystemIndex([
  { identifier: 'ERRORS_FOUND', type: 'text' },
  { identifier: 'KCU_FO_DATA_LINE', type: 'text' },
]);

const at = (x, y, page = 0) => ({ page, rect: { x, y, width: 100, height: 18 } });

function doc(fields, config = {}) {
  return serializeDocument(fields, { config: createConfig(config) });
}

async function read(bytes) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.worksheets[0];
  const cells = (row) => {
    const out = {};
    sheet.getRow(row).eachCell({ includeEmpty: false }, (cell, col) => {
      out[col] = typeof cell.value === 'object' && cell.value ? cell.value.richText?.map((r) => r.text).join('') ?? '' : cell.value;
    });
    return out;
  };
  const column = (col) => {
    const out = [];
    sheet.eachRow((row, n) => {
      const v = row.getCell(col).value;
      if (v !== null && v !== undefined && String(v).trim()) out.push([n, String(v)]);
    });
    return out;
  };
  return { book, sheet, cells, column };
}

describe('which fields reach the table', () => {
  it('keeps the ordinary fields and the signer rows, drops the plumbing', () => {
    const fields = [
      createField({ name: 'CUSTNAME', ...at(50, 700) }),
      createField({ name: 'Member1Name', type: 'dropdown', ...at(50, 400) }),
      createField({ name: 'ERRORS_FOUND', ...at(50, 300) }),
      createField({ name: 'PhoneAuthButton', type: 'button', ...at(50, 200) }),
    ];
    const rows = requirementRows(doc(fields), { systemIndex, buttonIndex });
    expect(rows.map((r) => r.name)).toEqual(['CUSTNAME', 'Member1Name']);
  });

  it('keeps a signer row together even though its boxes are not level', () => {
    // Real geometry from K_ITAOB. Name, signature and date sit on one line but
    // their tops differ by nearly a point and their heights by four, so sorting
    // on the top edge alone interleaves the three columns.
    const box = (name, x, y, height) => createField({ name, page: 0, rect: { x, y, width: 100, height } });
    const fields = [
      box('Member1Name', 47.6, 373.76, 17),
      box('Member1SignDate', 468.3, 373.58, 12.9),
      box('Member1Signature', 251.5, 372.87, 15.2),
      box('Member2SignDate', 468.1, 336.12, 12.9),
      box('Member2Name', 47.6, 335.94, 17),
      box('Member2Signature', 251.5, 335.04, 15.2),
    ];
    const rows = requirementRows(doc(fields), { systemIndex, buttonIndex });
    expect(rows.map((r) => r.name)).toEqual([
      'Member1Name',
      'Member1Signature',
      'Member1SignDate',
      'Member2Name',
      'Member2Signature',
      'Member2SignDate',
    ]);
  });

  it('still separates lines that are genuinely apart', () => {
    const box = (name, x, y) => createField({ name, page: 0, rect: { x, y, width: 100, height: 18 } });
    const rows = requirementRows(doc([box('LOWER_LEFT', 50, 300), box('UPPER_RIGHT', 400, 700)]), {
      systemIndex,
      buttonIndex,
    });
    expect(rows.map((r) => r.name)).toEqual(['UPPER_RIGHT', 'LOWER_LEFT']);
  });

  it('reads down the page, then across', () => {
    // PDF user space counts up from the bottom, so the higher y comes first.
    const fields = [
      createField({ name: 'THIRD', ...at(50, 300) }),
      createField({ name: 'SECOND_RIGHT', ...at(400, 700) }),
      createField({ name: 'FIRST', ...at(50, 700) }),
      createField({ name: 'FOURTH', ...at(50, 700, 1) }),
    ];
    const rows = requirementRows(doc(fields), { systemIndex, buttonIndex });
    expect(rows.map((r) => r.name)).toEqual(['FIRST', 'SECOND_RIGHT', 'THIRD', 'FOURTH']);
  });

  it('gives a repeated name one row, listing where it appears', () => {
    // One field, one value, so one thing to test. Two rows could be ticked Pass
    // and Fail with nothing to resolve the contradiction.
    const fields = [
      createField({ name: 'CUSTNAME', ...at(50, 700) }),
      createField({ name: 'CUSTNAME', ...at(50, 700, 2) }),
    ];
    const rows = requirementRows(doc(fields), { systemIndex, buttonIndex });
    expect(rows).toHaveLength(1);
    expect(rows[0].pages).toEqual([0, 2]);
  });

  it('counts a flag set on any placement of a name', () => {
    const fields = [
      createField({ name: 'CUSTNAME', ...at(50, 700) }),
      createField({ name: 'CUSTNAME', ...at(50, 700, 1), saveValidated: true }),
    ];
    expect(requirementRows(doc(fields), { systemIndex, buttonIndex })[0].saveValidated).toBe(true);
  });

  it('ignores a field with no name', () => {
    const fields = [createField({ name: '', ...at(50, 700) })];
    expect(requirementRows(doc(fields), { systemIndex, buttonIndex })).toEqual([]);
  });
});

describe('the workbook', () => {
  it('writes the header the existing documents use', async () => {
    const { cells } = await read(await requirementsWorkbookBytes({ doc: doc([]), buttons: BUTTONS }));
    const header = cells(1);
    expect(header[1]).toBe('Future Enhancement Notes');
    expect(header[6]).toBe('Field');
    expect(header[7]).toBe('Form Field');
    expect(header[8]).toBe('Load Validation');
    expect(header[9]).toBe('Save Validation');
    expect(header[10]).toBe('Logic');
    // The PDF field name, whether or not it matches the DB list, so the header
    // states the fact rather than the intent.
    expect(header[12]).toBe('Field Name');
  });

  it('carries the field name, which their documents never did', async () => {
    const fields = [
      createField({
        name: 'CUSTNAME',
        customerFacingName: 'Customer Name',
        loadValidated: true,
        editable: false,
        ...at(50, 700),
      }),
    ];
    const { column } = await read(
      await requirementsWorkbookBytes({ doc: doc(fields), buttons: BUTTONS, systemIndex, buttonIndex })
    );
    const [[row, name]] = column(12).filter(([, v]) => v === 'CUSTNAME');
    expect(name).toBe('CUSTNAME');

    const { cells } = await read(
      await requirementsWorkbookBytes({ doc: doc(fields), buttons: BUTTONS, systemIndex, buttonIndex })
    );
    expect(cells(row)[6]).toBe('Read Only');
    expect(cells(row)[8]).toBe('Yes');
    // Form Field stays empty even though the field carries a customer facing
    // name. That column is the label a member reads beside the box, which only
    // someone looking at the form can fill in.
    expect(cells(row)[7]).toBeUndefined();
  });

  it('marks conditional save validation the way they already write it', async () => {
    // Yes* means it depends on something, explained alongside. That is exactly
    // Custom Save Validation, which already insists on a note.
    const fields = [
      createField({ name: 'A', saveValidated: true, ...at(50, 700) }),
      createField({ name: 'B', customSaveValidated: true, note: 'only when C is ticked', ...at(50, 600) }),
    ];
    const { sheet, column } = await read(
      await requirementsWorkbookBytes({ doc: doc(fields), buttons: BUTTONS, systemIndex, buttonIndex })
    );
    const rowOf = (n) => column(12).find(([, v]) => v === n)[0];
    expect(sheet.getRow(rowOf('A')).getCell(9).value).toBe('Yes');
    expect(sheet.getRow(rowOf('B')).getCell(9).value).toBe('Yes*');
    expect(sheet.getRow(rowOf('B')).getCell(10).value).toBe('only when C is ticked');
  });
});

describe('the signing sections', () => {
  const withButtons = (names) =>
    names.map((name) => createField({ name, type: 'button', ...at(50, 100) }));

  it('expands only the channels the form offers', async () => {
    const { column } = await read(
      await requirementsWorkbookBytes({
        doc: doc(withButtons(['DigitalSignatureButton'])),
        buttons: BUTTONS,
        systemIndex,
        buttonIndex,
      })
    );
    const labels = column(7).map(([, v]) => v);
    expect(labels).toContain('In-Branch eSign Button on Form');
    expect(labels).not.toContain('Phone Auth Button on Form');
    expect(labels).not.toContain('Remote eSign Button on Form');
  });

  it('still lists a channel it does not offer, as a bare heading', async () => {
    // So a reader can see it was considered rather than forgotten, which is
    // what the trust form does.
    const { column } = await read(
      await requirementsWorkbookBytes({
        doc: doc(withButtons(['DigitalSignatureButton'])),
        buttons: BUTTONS,
        systemIndex,
        buttonIndex,
      })
    );
    const sections = column(6).map(([, v]) => v);
    for (const title of ['Phone Auth', 'In-Branch eSign', 'Remote eSign', 'Print Only']) {
      expect(sections).toContain(title);
    }
  });

  it('leaves Submit for Processing a bare heading, since no form has that button', async () => {
    const { column } = await read(
      await requirementsWorkbookBytes({
        doc: doc(withButtons(BUTTONS.map((b) => b.identifier))),
        buttons: BUTTONS,
        systemIndex,
        buttonIndex,
      })
    );
    expect(column(6).map(([, v]) => v)).toContain('Submit for Processing');
    expect(column(7).map(([, v]) => v)).not.toContain('Submit for Processing Button on Form');
  });

  it('expands every channel on a form that offers them all', async () => {
    const { column } = await read(
      await requirementsWorkbookBytes({
        doc: doc(withButtons(BUTTONS.map((b) => b.identifier))),
        buttons: BUTTONS,
        systemIndex,
        buttonIndex,
      })
    );
    const labels = column(7).map(([, v]) => v);
    for (const label of [
      'Phone Auth Button on Form',
      'In-Branch eSign Button on Form',
      'Remote eSign Button on Form',
      'Print Only Button on Form',
    ]) {
      expect(labels).toContain(label);
    }
  });
});

describe('the test columns', () => {
  it('follows the membership type', () => {
    expect(testColumns('person')).toEqual(['MEM#']);
    expect(testColumns('org')).toEqual(['Org#']);
    expect(testColumns('combined')).toEqual(['MEM#', 'Org#']);
  });

  it('gives a combined form two of each and a person form one', async () => {
    const combined = await read(
      await requirementsWorkbookBytes({ doc: doc([], { formType: 'combined' }), buttons: BUTTONS })
    );
    expect(combined.cells(1)[13]).toBe('Development Test: MEM#');
    expect(combined.cells(1)[14]).toBe('Development Test: Org#');
    expect(combined.cells(1)[15]).toBe('BA Testing: MEM#');
    expect(combined.cells(1)[16]).toBe('BA Testing: Org#');

    const person = await read(
      await requirementsWorkbookBytes({ doc: doc([], { formType: 'person' }), buttons: BUTTONS })
    );
    expect(person.cells(1)[13]).toBe('Development Test: MEM#');
    expect(person.cells(1)[14]).toBe('BA Testing: MEM#');
    expect(person.cells(1)[15]).toBeUndefined();
  });
});

describe('the metadata block', () => {
  it('leaves the values empty, apart from the one this tool knows', async () => {
    // A filled in guess would be read as a checked fact.
    const { column, sheet } = await read(
      await requirementsWorkbookBytes({ doc: doc([], { formType: 'combined' }), buttons: BUTTONS })
    );
    const rowOf = (label) => column(6).find(([, v]) => v === label)?.[0];

    expect(sheet.getRow(rowOf('Membership Type')).getCell(7).value).toBe('combined');
    for (const label of ['FO Cabinet', 'Form Name', 'Welcome Tree Folder(s)', 'Data Line Info']) {
      const row = rowOf(label);
      expect(row).toBeDefined();
      expect(sheet.getRow(row).getCell(7).value ?? '').toBe('');
    }
  });
});

describe('the page pictures', () => {
  it('adds one per page given to it', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
    const fields = [
      createField({ name: 'ONE', ...at(50, 700, 0) }),
      createField({ name: 'TWO', ...at(50, 700, 1) }),
    ];
    const bytes = await requirementsWorkbookBytes({
      doc: doc(fields),
      buttons: BUTTONS,
      systemIndex,
      buttonIndex,
      pageImages: [
        { page: 0, data: png, width: 300, height: 400 },
        { page: 1, data: png, width: 300, height: 400 },
      ],
    });
    const { sheet } = await read(bytes);
    expect(sheet.getImages()).toHaveLength(2);
  });

  it('is fine with none, which is what node has', async () => {
    const bytes = await requirementsWorkbookBytes({ doc: doc([]), buttons: BUTTONS });
    const { sheet } = await read(bytes);
    expect(sheet.getImages()).toHaveLength(0);
  });
});

describe('how it reads', () => {
  it('freezes the header so it follows you down', async () => {
    // The table runs to a hundred and forty rows. The originals freeze row one
    // for the same reason.
    const { sheet } = await read(await requirementsWorkbookBytes({ doc: doc([]), buttons: BUTTONS }));
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('fits the picture inside the band rather than over the table', async () => {
    // Sized in points it was wider than the five columns it sits in and covered
    // the Field and Form Field columns underneath.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
    const { sheet } = await read(
      await requirementsWorkbookBytes({
        doc: doc([createField({ name: 'ONE', ...at(50, 700) })]),
        buttons: BUTTONS,
        systemIndex,
        buttonIndex,
        pageImages: [{ page: 0, data: png, width: 612, height: 792 }],
      })
    );
    const [image] = sheet.getImages();
    const bandWidth = sheet.columns.slice(0, 5).reduce((sum, c) => sum + c.width * 7 + 5, 0);
    // Strictly inside, not flush. Excel's own width conversion is not exactly
    // this one, and flush to the edge clipped the column underneath.
    expect(image.range.ext.width).toBeLessThan(bandWidth);
    // Still the right shape, not squashed.
    expect(image.range.ext.height / image.range.ext.width).toBeCloseTo(792 / 612, 1);
  });

  it('gives the header and the section rows a fill', async () => {
    const { sheet } = await read(await requirementsWorkbookBytes({ doc: doc([]), buttons: BUTTONS }));
    expect(sheet.getRow(1).getCell(6).fill?.fgColor?.argb).toBeTruthy();
    expect(sheet.getRow(1).getCell(6).font?.bold).toBe(true);

    let sectionRow = null;
    sheet.eachRow((row, n) => {
      if (row.getCell(6).value === 'Standard Requirements') sectionRow = n;
    });
    expect(sectionRow).toBeTruthy();
    expect(sheet.getRow(sectionRow).getCell(6).fill?.fgColor?.argb).toBeTruthy();
  });

  it('rules the field rows so a long list stays readable', async () => {
    const fields = [
      createField({ name: 'ONE', ...at(50, 700) }),
      createField({ name: 'TWO', ...at(50, 600) }),
    ];
    const { sheet, column } = await read(
      await requirementsWorkbookBytes({ doc: doc(fields), buttons: BUTTONS, systemIndex, buttonIndex })
    );
    const rowOf = (n) => column(12).find(([, v]) => v === n)[0];
    expect(sheet.getRow(rowOf('ONE')).getCell(6).border?.bottom).toBeTruthy();
    // Alternating, so the second one carries the band.
    expect(sheet.getRow(rowOf('TWO')).getCell(6).fill?.fgColor?.argb).toBeTruthy();
  });
});

describe('lining the rows up with the picture', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  const page = { page: 0, data: png, width: 612, height: 792 };

  const build = (fields, pageImages) =>
    requirementsWorkbookBytes({
      doc: doc(fields),
      buttons: BUTTONS,
      systemIndex,
      buttonIndex,
      pageImages,
    });

  it('puts a field near the top of the page near the top of its block', async () => {
    // Two fields far apart on the page should be far apart in the sheet, or the
    // table and the picture beside it drift out of step.
    const fields = [
      createField({ name: 'TOP', page: 0, rect: { x: 50, y: 740, width: 100, height: 18 } }),
      createField({ name: 'BOTTOM', page: 0, rect: { x: 50, y: 100, width: 100, height: 18 } }),
    ];
    const { column } = await read(await build(fields, [page]));
    const rowOf = (n) => column(12).find(([, v]) => v === n)[0];
    // Roughly the height of the page in rows, not two consecutive lines.
    expect(rowOf('BOTTOM') - rowOf('TOP')).toBeGreaterThan(20);
  });

  it('keeps two fields on one line together rather than stacking them apart', async () => {
    const fields = [
      createField({ name: 'LEFT', page: 0, rect: { x: 50, y: 400, width: 100, height: 18 } }),
      createField({ name: 'RIGHT', page: 0, rect: { x: 400, y: 400, width: 100, height: 18 } }),
    ];
    const { column } = await read(await build(fields, [page]));
    const rowOf = (n) => column(12).find(([, v]) => v === n)[0];
    expect(rowOf('RIGHT') - rowOf('LEFT')).toBe(1);
  });

  it('never runs a row backwards', async () => {
    const fields = Array.from({ length: 6 }, (_, i) =>
      createField({ name: 'F' + i, page: 0, rect: { x: 50, y: 700 - i * 4, width: 100, height: 18 } })
    );
    const { column } = await read(await build(fields, [page]));
    const rowsOut = fields.map((f) => column(12).find(([, v]) => v === f.name)[0]);
    for (let i = 1; i < rowsOut.length; i += 1) {
      expect(rowsOut[i]).toBeGreaterThan(rowsOut[i - 1]);
    }
  });

  it('falls back to consecutive rows with no picture to line up against', async () => {
    const fields = [
      createField({ name: 'TOP', page: 0, rect: { x: 50, y: 740, width: 100, height: 18 } }),
      createField({ name: 'BOTTOM', page: 0, rect: { x: 50, y: 100, width: 100, height: 18 } }),
    ];
    const { column } = await read(await build(fields, []));
    const rowOf = (n) => column(12).find(([, v]) => v === n)[0];
    expect(rowOf('BOTTOM') - rowOf('TOP')).toBe(1);
  });
});

describe('colouring the field name', () => {
  // The same rule the canvas and the field list use, so a name reads the same
  // colour in the workbook as it does on screen.
  const dbIndex = buildDbIndex(normalizeDbFields([{ identifier: 'CUSTNAME', label: 'Customer Name' }]));

  const colourOf = async (name, fields) => {
    const { sheet, column } = await read(
      await requirementsWorkbookBytes({
        doc: doc(fields),
        buttons: BUTTONS,
        systemIndex,
        buttonIndex,
        dbIndex,
      })
    );
    const row = column(12).find(([, v]) => v === name)[0];
    return sheet.getRow(row).getCell(12).font?.color?.argb;
  };

  it('marks a name the DB list knows', async () => {
    const fields = [createField({ name: 'CUSTNAME', ...at(50, 700) })];
    expect(await colourOf('CUSTNAME', fields)).toBe(TONE_HEX.attempted);
  });

  it('marks a signer field as its own family', async () => {
    const fields = [createField({ name: 'Member1Name', type: 'dropdown', ...at(50, 700) })];
    expect(await colourOf('Member1Name', fields)).toBe(TONE_HEX.special);
  });

  it('marks a name the DB list does not have', async () => {
    const fields = [createField({ name: 'SOMETHING_CUSTOM', ...at(50, 700) })];
    expect(await colourOf('SOMETHING_CUSTOM', fields)).toBe(TONE_HEX.standard);
  });

  it('writes a key, since nothing else on the sheet says what the colours mean', async () => {
    const { column } = await read(
      await requirementsWorkbookBytes({ doc: doc([]), buttons: BUTTONS, dbIndex })
    );
    expect(column(6).map(([, v]) => v)).toContain('Field Name colours');
  });
});
