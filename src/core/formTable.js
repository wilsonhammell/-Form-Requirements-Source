// Reads the business's forms workbook, one row per form, and turns a row into
// Config answers and signing buttons.
//
// Columns are found by header text rather than position, since the business
// reorders them and adds new ones. A column this file does not know is ignored.

import ExcelJS from 'exceljs';

const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// First header that matches wins, so a later column that happens to share
// words cannot take it over.
const COLUMNS = [
  { key: 'formName', match: (h) => h.startsWith('new form name') },
  { key: 'formId', match: (h) => h.startsWith('tag element') || h.includes('form id in fileoptics') },
  { key: 'formDescription', match: (h) => h.startsWith('form description') },
  { key: 'foCabinet', match: (h) => h.startsWith('cabinet') },
  { key: 'formMenuGroups', match: (h) => /^forms? menu group/.test(h) },
  { key: 'formType', match: (h) => h.startsWith('membership') },
  { key: 'productCodes', match: (h) => h === 'doc sys' },
  { key: 'postProcessing', match: (h) => h.startsWith('post processing') },
  { key: 'adminQueue', match: (h) => h.startsWith('admin queue') },
  { key: 'supportServices', match: (h) => h.startsWith('support services') },
  { key: 'PhoneAuthButton', match: (h) => h.startsWith('phone auth') },
  { key: 'DigitalSignatureButton', match: (h) => h.startsWith('in branch esign') },
  { key: 'RemoteESignButton', match: (h) => h.startsWith('remote esign') },
  { key: 'PrintButton', match: (h) => h.startsWith('print only') },
  { key: 'SubmitForProcessingButton', match: (h) => h.startsWith('submit for processing') },
];

const TEXT_KEYS = ['formName', 'formId', 'formDescription', 'foCabinet', 'formMenuGroups'];
const FLAG_KEYS = ['postProcessing', 'adminQueue', 'supportServices'];
const BUTTON_KEYS = [
  'PhoneAuthButton',
  'DigitalSignatureButton',
  'RemoteESignButton',
  'PrintButton',
  'SubmitForProcessingButton',
];
// Print Only NO means the form is signed, not that it has no print button.
const ADD_ONLY = new Set(['PrintButton']);

// Far enough down to get past a title row or two.
const HEADER_SEARCH_ROWS = 10;

// A formula reads as what Excel last calculated. One Excel never calculated has
// no value, the same as an empty cell.
function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return cellText(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join('');
    if ('text' in value) return cellText(value.text);
    if ('error' in value) return '';
    return '';
  }
  return String(value).trim();
}

function findHeader(sheet) {
  const last = Math.min(sheet.rowCount, HEADER_SEARCH_ROWS);
  for (let r = 1; r <= last; r++) {
    const headers = new Map();
    sheet.getRow(r).eachCell((cell, col) => headers.set(col, cellText(cell.value)));
    const columns = {};
    const titles = {};
    for (const { key, match } of COLUMNS) {
      for (const [col, title] of headers) {
        if (Object.values(columns).includes(col)) continue;
        if (match(normalize(title))) {
          columns[key] = col;
          titles[key] = title.replace(/\s+/g, ' ').trim();
          break;
        }
      }
    }
    if (columns.formName) return { row: r, columns, titles };
  }
  return null;
}

// Every sheet with a NEW FORM NAME column, each with its named rows.
export async function readFormTable(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheets = [];
  for (const sheet of workbook.worksheets) {
    const header = findHeader(sheet);
    if (!header) continue;
    const rows = [];
    for (let r = header.row + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const values = {};
      for (const [key, col] of Object.entries(header.columns)) {
        values[key] = cellText(row.getCell(col).value);
      }
      if (values.formName) rows.push({ row: r, values });
    }
    if (rows.length > 0) sheets.push({ name: sheet.name, titles: header.titles, rows });
  }
  return sheets;
}

// The sheet to open on, the confirmed list when there is one.
export function defaultSheet(sheets) {
  return sheets.find((s) => /confirmed/i.test(s.name)) ?? sheets[0] ?? null;
}

function yesNo(text) {
  if (!text) return null;
  if (/^(yes|y|true)$/i.test(text)) return true;
  if (/^(no|n|false|n\/?a)$/i.test(text)) return false;
  return undefined;
}

function formType(text) {
  if (/combined/i.test(text)) return 'combined';
  if (/org|business/i.test(text)) return 'org';
  if (/person|retail/i.test(text)) return 'person';
  return undefined;
}

// A blank cell, or N/A in a text column, leaves the answer already there.
// A value that cannot be read is left alone too and named in the notes.
export function prefillFromRow(row, titles = {}) {
  const config = {};
  const buttons = {};
  const notes = [];
  const skip = (key, text) => notes.push(`${titles[key] ?? key} "${text}" not recognised.`);

  for (const key of TEXT_KEYS) {
    const text = row.values[key];
    if (text && !/^n\/?a$/i.test(text)) config[key] = text;
  }

  const type = row.values.formType;
  if (type) {
    const value = formType(type);
    if (value) config.formType = value;
    else skip('formType', type);
  }

  const codes = row.values.productCodes;
  if (codes && !/^n\/?a$/i.test(codes)) config.productCodes = codes;

  for (const key of FLAG_KEYS) {
    const text = row.values[key];
    const value = yesNo(text);
    if (value === undefined) skip(key, text);
    else if (value !== null) config[key] = value;
  }

  for (const key of BUTTON_KEYS) {
    const text = row.values[key];
    const value = yesNo(text);
    if (value === undefined) skip(key, text);
    else if (value === true || (value === false && !ADD_ONLY.has(key))) buttons[key] = value;
  }

  return { config, buttons, notes };
}
