// Generating the config block and writing the two document-level scripts into
// the exported PDF.
//
// The config block is executed here rather than matched against strings, so
// these check what Main will actually see when the form is opened.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFHexString, PDFRawStream } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import {
  buildConfigBlock,
  buildMainScript,
  buildDocumentScripts,
  extractCustomSaveValidation,
  findCustomSaveValidation,
  findFormHooks,
  replacedFunctions,
  OWNED_SCRIPTS,
} from '../src/starter/buildScripts.js';
import { installDocumentScripts, readDocumentScripts } from '../src/core/pdfScripts.js';
import { helperScript } from '../src/starter/index.js';
import { exportPdf } from '../src/core/pdfExport.js';
import { createField, createConfig } from '../src/core/schema.js';
import { addSignerRow, addSpecialField, addEsignFields } from '../src/core/specialFields.js';
import { signingButtons, addButton } from '../src/core/signingButtons.js';

const LETTER = [0, 0, 612, 792];
const BUTTONS = signingButtons();

// Runs the emitted block and hands back what Main would see. This is both the
// value check and the syntax check, since a bad block will not run.
const CONFIG_NAMES = [
  'HAS_ESIGN_FIELDS', 'FILEOPTICS_BUTTON_FIELDS',
  'SIGNER_ROWS', 'MAX_SIGNERS_ON_FORM', 'MAX_JOINT_LINES', 'HAS_COMBINED_JOINT',
  'JOINT_ROW_HAS_MEMBER_NUMBER', 'POPULATE_JOINT_DATA', 'MAX_DNA_SIGNERS',
  'MEMBERSHIP_TYPE', 'CODE_TYPES', 'PRODUCT_CODES', 'LOAD_VALIDATION_FIELDS',
  'SAVE_VALIDATION_FIELDS',
];

function runConfig(state) {
  const block = buildConfigBlock(state);
  return new Function(`${block}\nreturn { ${CONFIG_NAMES.join(', ')} };`)();
}

async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  return doc.save();
}

describe('the generated config', () => {
  it('runs, which is the only syntax check that matters', () => {
    const cfg = runConfig({});
    expect(cfg.MAX_DNA_SIGNERS).toBe(6);
    expect(cfg.SIGNER_ROWS).toEqual([]);
    expect(cfg.MAX_SIGNERS_ON_FORM).toBe(0);
  });

  it('stays in the Acrobat dialect', () => {
    const block = buildConfigBlock({}).replace(/^\s*\/\/.*$/gm, '');
    expect(block).not.toMatch(/\b(let|const)\s/);
    expect(block).not.toMatch(/=>/);
  });

  it('reads the signer rows off what was placed', () => {
    let fields = addSignerRow([], LETTER);
    fields = addSignerRow(fields, LETTER);
    fields = fields.filter((f) => f.name !== 'Member2SignDate');

    const cfg = runConfig({ fields });
    expect(cfg.SIGNER_ROWS).toEqual([
      { name: true, signature: true, signDate: true },
      { name: true, signature: true, signDate: false },
    ]);
    expect(cfg.MAX_SIGNERS_ON_FORM).toBe(2);
  });

  it('reads both joint shapes, independently', () => {
    const rows = addSpecialField([], 'JointMember1Name', LETTER);
    expect(runConfig({ fields: rows })).toMatchObject({
      MAX_JOINT_LINES: 1, HAS_COMBINED_JOINT: false, POPULATE_JOINT_DATA: true,
      JOINT_ROW_HAS_MEMBER_NUMBER: false,
    });

    const both = addSpecialField(
      addSpecialField(rows, 'JointMember1Number', LETTER),
      'JointMembers',
      LETTER
    );
    expect(runConfig({ fields: both })).toMatchObject({
      MAX_JOINT_LINES: 1, HAS_COMBINED_JOINT: true, JOINT_ROW_HAS_MEMBER_NUMBER: true,
    });

    expect(runConfig({}).POPULATE_JOINT_DATA).toBe(false);
  });

  it('lists only the FileOptics buttons that are placed', () => {
    let fields = addButton([], BUTTONS[0], BUTTONS, LETTER);
    fields = addButton(fields, BUTTONS[3], BUTTONS, LETTER);
    // Phone Auth and Print. Print never goes to FileOptics, so it is left out.
    expect(runConfig({ fields, buttons: BUTTONS }).FILEOPTICS_BUTTON_FIELDS).toEqual([
      'PhoneAuthButton',
    ]);
  });

  it('says whether the eSign pair is there', () => {
    expect(runConfig({}).HAS_ESIGN_FIELDS).toBe(false);
    const withPair = addEsignFields([], { x: 100, y: 700, width: 80, height: 18 });
    expect(runConfig({ fields: withPair }).HAS_ESIGN_FIELDS).toBe(true);
  });

  it('pairs each load validated field with its customer facing name', () => {
    const fields = [
      createField({ name: 'REQUESTUSER', loadValidated: true, customerFacingName: 'Staff Name' }),
      createField({ name: 'CUSTNAME', loadValidated: true, customerFacingName: 'Account Holder' }),
      createField({ name: 'OTHER' }),
    ];
    expect(runConfig({ fields }).LOAD_VALIDATION_FIELDS).toEqual([
      ['REQUESTUSER', 'Staff Name'],
      ['CUSTNAME', 'Account Holder'],
    ]);
  });

  it('lists save validated fields, and leaves the custom ones to the bespoke pass', () => {
    const fields = [
      createField({ name: 'A', saveValidated: true }),
      createField({ name: 'B', customSaveValidated: true, note: 'only when C is ticked' }),
      createField({ name: 'C' }),
    ];
    expect(runConfig({ fields }).SAVE_VALIDATION_FIELDS).toEqual(['A']);
  });

  it('counts a name placed twice once', () => {
    const twice = [
      createField({ name: 'CUSTNAME', saveValidated: true }),
      createField({ name: 'CUSTNAME', saveValidated: true, page: 1 }),
    ];
    expect(runConfig({ fields: twice }).SAVE_VALIDATION_FIELDS).toEqual(['CUSTNAME']);
  });

  it('carries the form type and product codes', () => {
    const config = createConfig({
      formType: 'combined', productCodes: ['M101', 'RSP'],
    });
    expect(runConfig({ config })).toMatchObject({
      MEMBERSHIP_TYPE: 'combined',
      PRODUCT_CODES: ['M101', 'RSP'],
      CODE_TYPES: ['PROD_CODE'],
    });
  });

  it('escapes a name rather than pasting it between quotes', () => {
    const fields = [createField({ name: 'od"d', saveValidated: true })];
    expect(runConfig({ fields }).SAVE_VALIDATION_FIELDS).toEqual(['od"d']);
  });
});

describe('the generated Main', () => {
  it('keeps the markers so the region can be found again', () => {
    const main = buildMainScript({});
    expect(main).toContain('//<CONFIG>');
    expect(main).toContain('//</CONFIG>');
    expect(main.match(/\/\/<CONFIG>/g)).toHaveLength(1);
  });

  it('keeps Main itself, and still calls it', () => {
    const main = buildMainScript({});
    expect(main).toMatch(/function Main\(\)/);
    expect(main.trimEnd().endsWith('Main();')).toBe(true);
  });

  it('drives the helpers, which is the whole point', () => {
    // Config plus helpers, run together, then ask the helpers what shape the
    // form is. This is what Acrobat does when the form opens.
    let fields = addSignerRow([], LETTER);
    fields = fields.filter((f) => f.name !== 'Member1SignDate');
    const block = buildConfigBlock({ fields });
    const probe = new Function(
      `${block}\n${helperScript()}\nreturn {
         rows: MAX_SIGNERS_ON_FORM,
         sig: rowHas(1, "signature"),
         date: rowHas(1, "signDate"),
         anyName: anyRowHas("name")
       };`
    )();
    expect(probe).toEqual({ rows: 1, sig: true, date: false, anyName: true });
  });
});

describe('writing them into a PDF', () => {
  it('installs both, under the names Acrobat uses', async () => {
    const doc = await PDFDocument.load(await blankPdf());
    installDocumentScripts(doc, buildDocumentScripts({}));
    const scripts = readDocumentScripts(doc);
    expect([...scripts.keys()]).toEqual(['Helper_Functions', 'Main']);
    expect(scripts.get('Helper_Functions')).toContain('function getSafeField');
    expect(scripts.get('Main')).toContain('Main();');
  });

  it('sorts them, which is what makes the helpers load first', async () => {
    const doc = await PDFDocument.load(await blankPdf());
    // Installed Main first on purpose. The tree has to come back sorted.
    installDocumentScripts(doc, [
      { name: 'Main', source: 'Main();' },
      { name: 'Helper_Functions', source: 'function a() {}' },
    ]);
    expect([...readDocumentScripts(doc).keys()]).toEqual(['Helper_Functions', 'Main']);
  });

  it('replaces rather than duplicating, however many times it runs', async () => {
    const doc = await PDFDocument.load(await blankPdf());
    installDocumentScripts(doc, [{ name: 'Main', source: 'first();' }]);
    installDocumentScripts(doc, [{ name: 'Main', source: 'second();' }]);
    installDocumentScripts(doc, [{ name: 'Main', source: 'third();' }]);
    const scripts = readDocumentScripts(doc);
    expect([...scripts.keys()]).toEqual(['Main']);
    expect(scripts.get('Main')).toBe('third();');
  });

  it('leaves scripts it does not own alone', async () => {
    const doc = await PDFDocument.load(await blankPdf());
    installDocumentScripts(doc, [{ name: 'SomeoneElse', source: 'theirs();' }]);
    installDocumentScripts(doc, buildDocumentScripts({}));
    const scripts = readDocumentScripts(doc);
    expect([...scripts.keys()]).toEqual(['Helper_Functions', 'Main', 'SomeoneElse']);
    expect(scripts.get('SomeoneElse')).toBe('theirs();');
  });

  it('finds entries held in a Kids tree, not just a flat list', async () => {
    // A name tree may be split across Kids. Appending to the flat array without
    // looking, which is what pdf-lib does, would leave the old copy behind.
    const doc = await PDFDocument.load(await blankPdf());
    const { context, catalog } = doc;
    const action = context.register(
      context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('stale();') })
    );
    const leaf = context.obj({});
    leaf.set(PDFName.of('Names'), context.obj([PDFHexString.fromText('Main'), action]));
    const root = context.obj({});
    root.set(PDFName.of('Kids'), context.obj([context.register(leaf)]));
    const names = context.obj({});
    names.set(PDFName.of('JavaScript'), root);
    catalog.set(PDFName.of('Names'), names);

    installDocumentScripts(doc, [{ name: 'Main', source: 'fresh();' }]);
    const scripts = readDocumentScripts(doc);
    expect([...scripts.keys()]).toEqual(['Main']);
    expect(scripts.get('Main')).toBe('fresh();');
  });
});

describe('export end to end', () => {
  it('ships the scripts and a config that matches the form', async () => {
    let fields = addSignerRow([], LETTER);
    fields = addButton(fields, BUTTONS[2], BUTTONS, LETTER);
    fields = addEsignFields(fields, fields.at(-1).rect);
    fields.push(createField({ name: 'CUSTNAME', saveValidated: true }));

    const { pdfBytes, warnings } = await exportPdf({
      originalBytes: await blankPdf(),
      fields,
      buttons: BUTTONS,
      meta: { config: createConfig({ formType: 'org' }) },
    });
    expect(warnings).toEqual([]);

    const out = await PDFDocument.load(pdfBytes);
    const scripts = readDocumentScripts(out);
    expect([...scripts.keys()]).toEqual(['Helper_Functions', 'Main']);

    const cfg = new Function(
      `${scripts.get('Main').split('//</CONFIG>')[0]}\nreturn { ${CONFIG_NAMES.join(', ')} };`
    )();
    expect(cfg).toMatchObject({
      MEMBERSHIP_TYPE: 'org',
      MAX_SIGNERS_ON_FORM: 1,
      HAS_ESIGN_FIELDS: true,
      FILEOPTICS_BUTTON_FIELDS: ['RemoteESignButton'],
      SAVE_VALIDATION_FIELDS: ['CUSTNAME'],
    });
  });

  it('gives the buttons their actions, on mouse up', async () => {
    const fields = BUTTONS.reduce((acc, b) => addButton(acc, b, BUTTONS, LETTER), []);
    const { pdfBytes } = await exportPdf({
      originalBytes: await blankPdf(), fields, buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    const scripts = new Map(
      out.getForm().getFields().map((f) => {
        const a = out.context.lookupMaybe(f.acroField.dict.get(PDFName.of('A')), PDFDict);
        return [f.getName(), a ? out.context.lookup(a.get(PDFName.of('JS'))).decodeText() : ''];
      })
    );
    expect(scripts.get('PhoneAuthButton')).toBe('submitPhoneAuth();');
    expect(scripts.get('DigitalSignatureButton')).toBe('submitDigitalSignature();');
    expect(scripts.get('RemoteESignButton')).toBe('submitRemoteESign();');
    expect(scripts.get('PrintButton')).toBe('submitPrintOnly();');
    expect(scripts.get('SubmitForProcessingButton')).toBe('submitForProcessing();');
  });

  it('does not accumulate scripts across repeated exports', async () => {
    const fields = [createField({ name: 'CUSTNAME' })];
    let bytes = await blankPdf();
    for (let i = 0; i < 3; i += 1) {
      bytes = (await exportPdf({ originalBytes: bytes, fields, buttons: BUTTONS })).pdfBytes;
    }
    const out = await PDFDocument.load(bytes);
    expect([...readDocumentScripts(out).keys()]).toEqual(['Helper_Functions', 'Main']);
  });
});

describe('carrying CustomSaveValidation across', () => {
  const wrap = (body) => `var X = 1;\nfunction CustomSaveValidation() {\n${body}\n}\nMain();`;

  it('takes the body out', () => {
    expect(extractCustomSaveValidation(wrap('    flagError("A");'))).toBe('    flagError("A");\n');
  });

  it('keeps nested braces, which every real one has', () => {
    const body = [
      '    if (getSafeValue("Check Box6") === "Yes") {',
      '        if (getSafeValue("Text5") === "") {',
      '            flagError("Text5");',
      '        }',
      '    }',
    ].join('\n');
    expect(extractCustomSaveValidation(wrap(body))).toBe(`${body}\n`);
  });

  it('is not fooled by a brace inside a string', () => {
    const body = '    var msg = "} not the end {";\n    flagError("A");';
    expect(extractCustomSaveValidation(wrap(body))).toBe(`${body}\n`);
  });

  it('is not fooled by a brace inside a comment', () => {
    const body = '    // } neither is this\n    /* nor } this */\n    flagError("A");';
    expect(extractCustomSaveValidation(wrap(body))).toBe(`${body}\n`);
  });

  it('handles an escaped quote inside a string', () => {
    const body = '    var m = "say \\" } ";\n    flagError("A");';
    expect(extractCustomSaveValidation(wrap(body))).toBe(`${body}\n`);
  });

  it('gives nothing back for an empty one, a missing one, or a broken one', () => {
    expect(extractCustomSaveValidation(wrap(''))).toBe('');
    expect(extractCustomSaveValidation(wrap('   \n  '))).toBe('');
    expect(extractCustomSaveValidation('function Other() { }')).toBe('');
    expect(extractCustomSaveValidation('')).toBe('');
    // Unbalanced, so better empty than truncated at the wrong place.
    expect(extractCustomSaveValidation('function CustomSaveValidation() { if (a) {')).toBe('');
  });

  it('survives an export, while everything around it is replaced', async () => {
    const body = '    if (getSafeValue("A") === "") {\n        flagError("A");\n    }';
    const base = await PDFDocument.load(await blankPdf());
    installDocumentScripts(base, [
      { name: 'Main', source: `var MEMBERSHIP_TYPE = "stale";\nfunction CustomSaveValidation() {\n${body}\n}` },
      { name: 'Helper_Functions', source: 'function stale() {}' },
    ]);

    const { pdfBytes } = await exportPdf({
      originalBytes: await base.save(),
      fields: [createField({ name: 'CUSTNAME' })],
      buttons: BUTTONS,
      meta: { config: createConfig({ formType: 'org' }) },
    });

    const scripts = readDocumentScripts(await PDFDocument.load(pdfBytes));
    // The bespoke block is there, and the stale config around it is gone.
    expect(scripts.get('Main')).toContain('flagError("A");');
    expect(scripts.get('Main')).toContain('var MEMBERSHIP_TYPE = "org"');
    expect(scripts.get('Main')).not.toContain('"stale"');
    expect(scripts.get('Helper_Functions')).not.toContain('function stale');
    expect(scripts.get('Helper_Functions')).toContain('function getSafeField');
  });

  it('still runs after the round trip', async () => {
    const body = '    flagError("A");';
    const base = await PDFDocument.load(await blankPdf());
    installDocumentScripts(base, [
      { name: 'Main', source: `function CustomSaveValidation() {\n${body}\n}` },
    ]);
    const { pdfBytes } = await exportPdf({
      originalBytes: await base.save(), fields: [], buttons: BUTTONS,
    });
    const main = readDocumentScripts(await PDFDocument.load(pdfBytes)).get('Main');

    const flagged = [];
    new Function('flagError', `${main.split('//</CONFIG>')[0]}\nCustomSaveValidation();`)(
      (n) => flagged.push(n)
    );
    expect(flagged).toEqual(['A']);
  });

  it('does not drift across repeated exports', async () => {
    const body = '    flagError("A");';
    const base = await PDFDocument.load(await blankPdf());
    installDocumentScripts(base, [
      { name: 'Main', source: `function CustomSaveValidation() {\n${body}\n}` },
    ]);
    let bytes = await base.save();
    for (let i = 0; i < 3; i += 1) {
      bytes = (await exportPdf({ originalBytes: bytes, fields: [], buttons: BUTTONS })).pdfBytes;
    }
    const main = readDocumentScripts(await PDFDocument.load(bytes)).get('Main');
    expect(main.match(/flagError\("A"\);/g)).toHaveLength(1);
    expect(main.match(/function CustomSaveValidation/g)).toHaveLength(1);
  });
});

describe('scripts stored as streams', () => {
  // Acrobat writes a long script as a compressed stream, not a string, which is
  // how both example forms store theirs. Reading only strings returned nothing
  // for exactly the forms with code worth keeping.
  const streamed = async (name, source, compress) => {
    const doc = await PDFDocument.load(await blankPdf());
    const { context, catalog } = doc;
    const raw = new TextEncoder().encode(source);
    const bytes = compress ? deflateSync(raw) : raw;
    const dict = context.obj(compress ? { Length: bytes.length, Filter: 'FlateDecode' } : { Length: bytes.length });
    const stream = context.register(PDFRawStream.of(dict, bytes));
    const action = context.register(context.obj({ S: 'JavaScript', JS: stream }));
    const tree = context.obj({});
    tree.set(PDFName.of('Names'), context.obj([PDFHexString.fromText(name), action]));
    const names = context.obj({});
    names.set(PDFName.of('JavaScript'), tree);
    catalog.set(PDFName.of('Names'), names);
    return doc;
  };

  it('reads an uncompressed stream', async () => {
    const doc = await streamed('Main', 'var a = 1;', false);
    expect(readDocumentScripts(doc).get('Main')).toBe('var a = 1;');
  });

  it('reads a flate compressed stream, which is what Acrobat writes', async () => {
    const doc = await streamed('Main', 'var a = 1;', true);
    expect(readDocumentScripts(doc).get('Main')).toBe('var a = 1;');
  });

  it('carries the bespoke block out of a compressed script', async () => {
    const body = '    if (getSafeValue("Date2") !== "") {\n        flagError("Payee2");\n    }';
    const doc = await streamed(
      'Helper_Functions',
      `function CustomSaveValidation() {\n${body}\n}`,
      true
    );
    const { pdfBytes } = await exportPdf({
      originalBytes: await doc.save(), fields: [], buttons: BUTTONS,
    });
    const scripts = readDocumentScripts(await PDFDocument.load(pdfBytes));
    expect(findCustomSaveValidation(scripts)).toBe(`${body}\n`);
  });
});

describe('where the bespoke block lives', () => {
  it('is found in Helper_Functions, where the existing forms keep it', () => {
    const scripts = new Map([
      ['Main', 'var MEMBERSHIP_TYPE = "org";'],
      ['Helper_Functions', 'function CustomSaveValidation() {\n    flagError("A");\n}'],
    ]);
    expect(findCustomSaveValidation(scripts)).toBe('    flagError("A");\n');
  });

  it('prefers Main, where this tool writes it', () => {
    const scripts = new Map([
      ['Main', 'function CustomSaveValidation() {\n    flagError("new");\n}'],
      ['Helper_Functions', 'function CustomSaveValidation() {\n    flagError("old");\n}'],
    ]);
    expect(findCustomSaveValidation(scripts)).toBe('    flagError("new");\n');
  });

  it('looks anywhere else before giving up', () => {
    const scripts = new Map([['Somewhere', 'function CustomSaveValidation() {\n    flagError("A");\n}']]);
    expect(findCustomSaveValidation(scripts)).toBe('    flagError("A");\n');
  });

  it('moves it from Helper_Functions into Main on export', async () => {
    const doc = await PDFDocument.load(await blankPdf());
    installDocumentScripts(doc, [
      { name: 'Helper_Functions', source: 'function CustomSaveValidation() {\n    flagError("A");\n}' },
    ]);
    const { pdfBytes } = await exportPdf({
      originalBytes: await doc.save(), fields: [], buttons: BUTTONS,
    });
    const scripts = readDocumentScripts(await PDFDocument.load(pdfBytes));
    expect(scripts.get('Main')).toContain('flagError("A");');
    // Only one copy, in the file this tool owns it in.
    expect(scripts.get('Helper_Functions')).not.toContain('flagError("A");');
  });
});

describe('carrying the form hooks across', () => {
  const exportWith = async (scripts) => {
    const doc = await PDFDocument.load(await blankPdf());
    installDocumentScripts(doc, scripts);
    const { pdfBytes } = await exportPdf({
      originalBytes: await doc.save(), fields: [], buttons: BUTTONS,
    });
    return readDocumentScripts(await PDFDocument.load(pdfBytes));
  };

  it('moves all three from Helper_Functions into Main', async () => {
    const scripts = await exportWith([
      {
        name: 'Helper_Functions',
        source: [
          'function CustomAfterValidation() {\n    a();\n}',
          'function CustomAfterLoad() {\n    if (x) { b(); }\n}',
          'function CustomBeforeSubmit() {\n    c();\n}',
        ].join('\n'),
      },
    ]);
    const main = scripts.get('Main');
    expect(main).toContain('function CustomAfterValidation() {\n    a();\n}');
    expect(main).toContain('function CustomAfterLoad() {\n    if (x) { b(); }\n}');
    expect(main).toContain('function CustomBeforeSubmit() {\n    c();\n}');
    expect(scripts.get('Helper_Functions')).not.toContain('a();');
  });

  it('prefers Main, where this tool writes them', () => {
    const hooks = findFormHooks(
      new Map([
        ['Main', 'function CustomAfterLoad() {\n    fresh();\n}'],
        ['Helper_Functions', 'function CustomAfterLoad() {\n    stale();\n}'],
      ])
    );
    expect(hooks).toEqual({ CustomAfterLoad: '    fresh();\n' });
  });

  it('leaves one in a form script alone, rather than copying it into Main', async () => {
    // A copy in Main would load after the original and win, so later edits to
    // the original would do nothing.
    const scripts = await exportWith([
      { name: 'Form_Custom', source: 'function CustomAfterLoad() {\n    mine();\n}' },
    ]);
    expect(scripts.get('Main')).not.toContain('CustomAfterLoad() {');
    expect(scripts.get('Form_Custom')).toContain('mine();');
  });

  it('emits nothing for a form without them, or with an empty one', async () => {
    const scripts = await exportWith([
      { name: 'Main', source: 'function CustomAfterLoad() {\n}' },
    ]);
    for (const name of ['CustomAfterValidation', 'CustomAfterLoad', 'CustomBeforeSubmit']) {
      expect(scripts.get('Main')).not.toContain(`function ${name}`);
    }
  });

  it('does not drift across repeated exports', async () => {
    const doc = await PDFDocument.load(await blankPdf());
    installDocumentScripts(doc, [
      { name: 'Main', source: 'function CustomBeforeSubmit() {\n    c();\n}' },
    ]);
    let bytes = await doc.save();
    for (let i = 0; i < 3; i += 1) {
      bytes = (await exportPdf({ originalBytes: bytes, fields: [], buttons: BUTTONS })).pdfBytes;
    }
    const main = readDocumentScripts(await PDFDocument.load(bytes)).get('Main');
    expect(main.match(/function CustomBeforeSubmit/g)).toHaveLength(1);
    expect(main.match(/c\(\);/g)).toHaveLength(1);
  });
});

// Per field scripts, written on export. This replaces the load time pass the
// old forms ran, which could only run once safely.
async function exportedOnBlur(fields, systemFields = []) {
  const { pdfBytes } = await exportPdf({
    originalBytes: await blankPdf(), fields, buttons: BUTTONS, systemFields,
  });
  const out = await PDFDocument.load(pdfBytes);
  const scripts = new Map();
  for (const field of out.getForm().getFields()) {
    const aa = out.context.lookupMaybe(field.acroField.dict.get(PDFName.of('AA')), PDFDict);
    const entry = aa && out.context.lookupMaybe(aa.get(PDFName.of('Bl')), PDFDict);
    scripts.set(
      field.getName(),
      entry ? out.context.lookup(entry.get(PDFName.of('JS'))).decodeText() : null
    );
  }
  return scripts;
}

describe('per field scripts', () => {
  it('clears the required flag once an ordinary field has a value', async () => {
    const scripts = await exportedOnBlur([createField({ name: 'CUSTNAME' })]);
    expect(scripts.get('CUSTNAME')).toContain('this.getField("CUSTNAME").required = false');
    expect(scripts.get('CUSTNAME')).toContain('!== "Off"');
  });

  it('covers checkboxes and dropdowns, not buttons', async () => {
    const fields = [
      createField({ name: 'A', type: 'checkbox' }),
      createField({ name: 'B', type: 'dropdown' }),
      ...BUTTONS.reduce((acc, b) => addButton(acc, b, BUTTONS, LETTER), []),
    ];
    const scripts = await exportedOnBlur(fields);
    expect(scripts.get('A')).toContain('required = false');
    expect(scripts.get('B')).toContain('required = false');
    // A pushbutton has no value, so there is nothing to clear.
    expect(scripts.get('PhoneAuthButton')).toBeNull();
  });

  it('leaves system fields alone, they are never flagged', async () => {
    const scripts = await exportedOnBlur(
      [createField({ name: 'DNA_REQ' }), createField({ name: 'CUSTNAME' })],
      [{ identifier: 'DNA_REQ' }]
    );
    expect(scripts.get('DNA_REQ')).toBeNull();
    expect(scripts.get('CUSTNAME')).not.toBeNull();
  });

  it('gives the signer dropdown its own script, not the generic one', async () => {
    let fields = addSignerRow([], LETTER);
    fields = fields.filter((f) => f.name !== 'Member1SignDate');
    const scripts = await exportedOnBlur(fields);

    const dropdown = scripts.get('Member1Name');
    expect(dropdown).toContain('getSelectedText("Member1Name")');
    expect(dropdown).toContain('this.getField("Member1Signature").display = display.visible');
    // The row has no date, so nothing about one is written.
    expect(dropdown).not.toContain('SignDate');
    // And it is not the generic line, which is what the old load time pass
    // flattened it to whenever it ran again.
    expect(dropdown).not.toContain('!== "Off"');

    // The signature itself still gets the generic one.
    expect(scripts.get('Member1Signature')).toContain('required = false');
  });

  it('writes one script per signer row', async () => {
    let fields = addSignerRow([], LETTER);
    fields = addSignerRow(fields, LETTER);
    const scripts = await exportedOnBlur(fields);
    expect(scripts.get('Member1Name')).toContain('Member1Signature');
    expect(scripts.get('Member2Name')).toContain('Member2Signature');
    expect(scripts.get('Member2Name')).not.toContain('Member1');
  });

  it('is regenerated, so a stale script goes', async () => {
    // CUSTNAME scripted, then reclassified as a system field. The script it had
    // must not survive, since an export replaces every line of code in the form.
    const fields = [createField({ name: 'CUSTNAME' })];
    const first = await exportPdf({
      originalBytes: await blankPdf(), fields, buttons: BUTTONS,
    });
    const second = await exportPdf({
      originalBytes: first.pdfBytes,
      fields,
      buttons: BUTTONS,
      systemFields: [{ identifier: 'CUSTNAME' }],
    });
    const out = await PDFDocument.load(second.pdfBytes);
    const field = out.getForm().getField('CUSTNAME');
    expect(out.context.lookupMaybe(field.acroField.dict.get(PDFName.of('AA')), PDFDict)).toBeUndefined();
  });

  it('writes one per widget when a name is placed twice', async () => {
    // A name placed twice is one field with two widgets, and OnBlur is an
    // annotation entry, so each widget carries it. That is what the existing
    // forms do, where one name shows up as Annot1 and Annot2.
    const fields = [
      createField({ name: 'AGREE', type: 'checkbox', page: 0 }),
      createField({ name: 'AGREE', type: 'checkbox', page: 0, rect: { x: 200, y: 200, width: 14, height: 14 } }),
    ];
    const { pdfBytes } = await exportPdf({
      originalBytes: await blankPdf(), fields, buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    const widgets = out.getForm().getField('AGREE').acroField.getWidgets();
    expect(widgets).toHaveLength(2);
    for (const widget of widgets) {
      const aa = out.context.lookupMaybe(widget.dict.get(PDFName.of('AA')), PDFDict);
      const entry = out.context.lookupMaybe(aa.get(PDFName.of('Bl')), PDFDict);
      expect(out.context.lookup(entry.get(PDFName.of('JS'))).decodeText()).toContain(
        'this.getField("AGREE").required = false'
      );
    }
  });

  it('leaves a Custom format alone and clears one the model says is None', async () => {
    const base = await PDFDocument.load(await blankPdf());
    const form = base.getForm();
    const text = form.createTextField('Date1');
    text.addToPage(base.getPage(0), { x: 10, y: 10, width: 100, height: 20 });
    const aa = base.context.obj({});
    aa.set(PDFName.of('F'), base.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText('event.value = event.value.toUpperCase();') }));
    text.acroField.getWidgets()[0].dict.set(PDFName.of('AA'), aa);
    const originalBytes = await base.save();

    const exported = async (format) => {
      const { pdfBytes } = await exportPdf({
        originalBytes,
        fields: [createField({ name: 'Date1', rect: { x: 10, y: 10, width: 100, height: 20 }, format })],
        buttons: BUTTONS,
      });
      const out = await PDFDocument.load(pdfBytes);
      const dict = out.getForm().getField('Date1').acroField.dict;
      return { out, after: out.context.lookupMaybe(dict.get(PDFName.of('AA')), PDFDict) };
    };

    const custom = await exported({ category: 'custom' });
    const script = custom.out.context.lookupMaybe(custom.after.get(PDFName.of('F')), PDFDict);
    expect(custom.out.context.lookup(script.get(PDFName.of('JS'))).decodeText()).toContain('toUpperCase');
    // And ours went in beside it.
    expect(custom.after.get(PDFName.of('Bl'))).toBeDefined();

    const none = await exported({ category: 'none' });
    expect(none.after.get(PDFName.of('F'))).toBeUndefined();
    expect(none.after.get(PDFName.of('Bl'))).toBeDefined();
  });
});

describe('code the form has and the starter does not', () => {
  // Export rewrites Helper_Functions and Main whole, and every call site on the
  // example forms sits in regenerated code, so keeping a body would leave it
  // orphaned. Naming what is about to go is the point.
  const form = (main, helpers = '') =>
    new Map([
      ['Main', main],
      ['Helper_Functions', helpers],
    ]);

  it('names a function the starter has no equivalent for', () => {
    expect(replacedFunctions(form('function buildFormID() { return 1; }'))).toEqual(['buildFormID']);
  });

  it('says nothing about a form that only uses the starter', () => {
    expect(replacedFunctions(form('function Main() { validateOnLoad(); }'))).toEqual([]);
  });

  it('ignores CustomSaveValidation, which is carried across by name', () => {
    expect(replacedFunctions(form('function CustomSaveValidation() { var a = 1; }'))).toEqual([]);
  });

  it('ignores the form hooks, which are carried across by name', () => {
    expect(
      replacedFunctions(form('function CustomAfterLoad() { var a = 1; }\nfunction CustomBeforeSubmit() {}'))
    ).toEqual([]);
  });

  it('ignores a pass that was dropped on purpose', () => {
    // injectErrorFlagClearing set every field's OnBlur at load time. Those are
    // generated at export now, so every form still carries it and warning about
    // it each time would be noise.
    expect(replacedFunctions(form('function injectErrorFlagClearing() {}'))).toEqual([]);
  });

  it('looks in both scripts and reports each name once', () => {
    const scripts = form(
      ['function alpha() {}', 'function beta() {}'].join('\n'),
      'function alpha() {}'
    );
    expect(replacedFunctions(scripts)).toEqual(['alpha', 'beta']);
  });

  it('leaves alone a script this tool does not write', () => {
    // installDocumentScripts only replaces the names it owns, so a function in
    // any other entry survives and is not at risk.
    expect(replacedFunctions(new Map([['SomeOtherScript', 'function gamma() {}']]))).toEqual([]);
  });

  it('takes a plain object or nothing at all', () => {
    expect(replacedFunctions({ Main: 'function delta() {}' })).toEqual(['delta']);
    expect(replacedFunctions()).toEqual([]);
  });
});

describe('the scripts this tool owns', () => {
  it('is exactly the two it writes', () => {
    // Anything else in the name tree survives an export, which is what makes a
    // form's own document script a safe place for its code.
    expect(OWNED_SCRIPTS).toEqual(['Helper_Functions', 'Main']);
  });
});
