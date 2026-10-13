import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readFormTable, defaultSheet, prefillFromRow } from '../src/core/formTable.js';
import { createConfig } from '../src/core/schema.js';

async function workbookBytes(sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    rows.forEach((row) => sheet.addRow(row));
  }
  return workbook.xlsx.writeBuffer();
}

const HEADERS = [
  'Remote eSign',
  'Membership "Type"',
  'NEW FORM NAME',
  'doc_sys',
  'Form Description\n(FileOptics)',
  'TAG ELEMENT\n(Form ID in FileOptics)',
  'FORMID',
  'Cabinet',
  'Forms Menu Group Name',
  'Print Only',
  'Phone Auth',
  'In-Branch eSign',
  'Post \nProcessing \nQueue',
  'ADMIN\nQUEUE',
  'Support Services',
];

describe('the forms workbook', () => {
  it('finds columns by header, whatever their order', async () => {
    const bytes = await workbookBytes({
      Notes: [['nothing here']],
      'Confirmed Forms(76)': [
        HEADERS,
        [
          { formula: 'IF(1=1,"YES","NO")', result: 'YES' },
          'Organization (Business)',
          'Bill Payment Trace',
          'M, T',
          'Bill Payment Trace',
          'L_BPT',
          'YES',
          'Member Records',
          'Member Servicing',
          'NO',
          'NO',
          'YES',
          'N/A',
          'YES',
          '',
        ],
        [],
      ],
    });
    const sheets = await readFormTable(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Confirmed Forms(76)']);
    const sheet = defaultSheet(sheets);
    expect(sheet.rows).toHaveLength(1);

    const { config, buttons, notes } = prefillFromRow(sheet.rows[0], sheet.titles);
    expect(createConfig(config)).toMatchObject({
      formName: 'Bill Payment Trace',
      formId: 'L_BPT',
      formDescription: 'Bill Payment Trace',
      foCabinet: 'Member Records',
      formMenuGroups: 'Member Servicing',
      formType: 'org',
      productCodes: ['M', 'T'],
      postProcessing: false,
      adminQueue: true,
      supportServices: false,
    });
    expect(buttons).toEqual({
      RemoteESignButton: true,
      PhoneAuthButton: false,
      DigitalSignatureButton: true,
    });
    expect(notes).toEqual([]);
  });

  it('leaves blanks, N/A text and unreadable values alone', () => {
    const { config, buttons, notes } = prefillFromRow(
      {
        row: 9,
        values: {
          formName: 'Wire Instructions USD',
          formId: 'N/A',
          foCabinet: '',
          formType: 'YES',
          PrintButton: 'YES',
          PhoneAuthButton: '',
          supportServices: '45000',
        },
      },
      { formType: 'Membership "Type"', supportServices: 'Support Services' }
    );
    expect(config).toEqual({ formName: 'Wire Instructions USD' });
    expect(buttons).toEqual({ PrintButton: true });
    expect(notes).toEqual([
      'Membership "Type" "YES" not recognised.',
      'Support Services "45000" not recognised.',
    ]);
  });

  it('does not take a print button away for Print Only NO', () => {
    const { buttons } = prefillFromRow({ row: 2, values: { formName: 'x', PrintButton: 'No' } });
    expect(buttons).toEqual({});
  });
});
