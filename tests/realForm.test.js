// The real forms, round tripped.
//
// The synthetic fixtures elsewhere cover each behaviour in isolation. This one
// asks a blunter question: take the forms the business actually uses, import
// them, export them, and check nothing was quietly changed on the way through.
// That is the workflow, fields are drawn and formatted in Acrobat and then
// brought here for their requirements, so anything lost here is lost on every
// form.
//
// Widgets are compared as a set per field name rather than in order. Placement
// order is not meaningful, and comparing by position reports a field as moved
// when two of its boxes merely swapped places in the array.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { exportPdf } from '../src/core/pdfExport.js';
import { importPdf, inherited } from '../src/core/pdfImport.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';
import { readDocumentScripts } from '../src/core/pdfScripts.js';
import { OWNED_SCRIPTS } from '../src/starter/buildScripts.js';

// The forms are real production documents and are kept out of the repository,
// so a fresh clone has none. Overridable so the empty case can be exercised.
const DIR = process.env.EXAMPLE_FORMS_DIR ?? 'example forms';

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort()
  : [];

// With no forms present this file has nothing to say. It reports that as a
// skipped suite rather than passing quietly, so a clone cannot look covered
// when it is not.
const describeForm = files.length > 0 ? describe.each(files) : describe.skip.each(['no example forms present']);

const decode = (obj) => (obj && obj.decodeText ? obj.decodeText() : null);

// One row per widget, keyed by field name. Sorted, so the comparison is by set.
function snapshot(doc) {
  const ctx = doc.context;
  const out = new Map();

  for (const field of doc.getForm().getFields()) {
    const rows = field.acroField.getWidgets().map((widget) => {
      const dict = widget.dict;

      const aa = ctx.lookupMaybe(dict.get(PDFName.of('AA')), PDFDict);
      const actions = {};
      if (aa) {
        for (const key of aa.keys()) {
          const action = ctx.lookupMaybe(aa.get(key), PDFDict);
          const js = action && ctx.lookup(action.get(PDFName.of('JS')));
          actions[key.toString()] = js ? decode(js) : '(non-js)';
        }
      }

      const ap = ctx.lookupMaybe(dict.get(PDFName.of('AP')), PDFDict);
      // /N holds the on-states for a checkbox or radio, a stream otherwise.
      const normal = ap && ctx.lookup(ap.get(PDFName.of('N')));
      const mk = ctx.lookupMaybe(dict.get(PDFName.of('MK')), PDFDict);
      const bs = ctx.lookupMaybe(dict.get(PDFName.of('BS')), PDFDict);
      const opt = ctx.lookupMaybe(inherited(ctx, dict, 'Opt'), PDFArray);
      const r = widget.getRectangle();

      return {
        type: String(inherited(ctx, dict, 'FT') ?? ''),
        fieldFlags: Number(inherited(ctx, dict, 'Ff') ?? 0),
        annotFlags: Number(dict.get(PDFName.of('F')) ?? 0),
        defaultAppearance: decode(inherited(ctx, dict, 'DA')),
        maxLen: String(inherited(ctx, dict, 'MaxLen') ?? ''),
        value: decode(inherited(ctx, dict, 'V')),
        format: actions['/F'] ?? null,
        keystroke: actions['/K'] ?? null,
        onStates:
          normal instanceof PDFDict
            ? normal.keys().map((k) => k.toString()).sort().join(',')
            : '',
        appearanceCharacteristics: mk ? mk.toString() : '',
        borderStyle: bs ? bs.toString() : '',
        options: opt ? opt.toString() : '',
        // Normalised, because several forms carry rects written corner first,
        // which reads back as a negative width or height. Export writes the same
        // box the right way round, so comparing raw would report a fix as a loss.
        rect: [
          Math.min(r.x, r.x + r.width),
          Math.min(r.y, r.y + r.height),
          Math.abs(r.width),
          Math.abs(r.height),
        ]
          .map((n) => Math.round(n * 100) / 100)
          .join(','),
      };
    });

    out.set(
      field.getName(),
      rows.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))
    );
  }
  return out;
}

// Properties whose value belongs to the widget and must come back untouched.
const PRESERVED = [
  'type',
  'fieldFlags',
  'annotFlags',
  'maxLen',
  'value',
  'onStates',
  'appearanceCharacteristics',
  'borderStyle',
  'options',
  'rect',
  'defaultAppearance',
];

describeForm('%s', (file) => {
  let before;
  let after;
  let imported;
  let hasOwnedScripts;

  beforeAll(async () => {
    const originalBytes = fs.readFileSync(path.join(DIR, file));
    const source = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    before = snapshot(source);
    const scripts = readDocumentScripts(source);
    hasOwnedScripts = OWNED_SCRIPTS.some((name) => scripts.has(name));

    const dbIndex = buildDbIndex(
      normalizeDbFields(
        source.getForm().getFields().map((f) => ({ identifier: f.getName(), label: f.getName() }))
      )
    );

    imported = await importPdf(originalBytes, dbIndex);
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: imported.fields,
      meta: { config: imported.config },
    });
    after = snapshot(await PDFDocument.load(pdfBytes));
  }, 120000);

  it('reads back and keeps every field', () => {
    // Production forms arrive as a bare AcroForm. One fixture in this folder was
    // written by this tool and carries the embedded JSON, which is the better
    // path; either way the round trip is what is being checked.
    expect(['acroform', 'embedded']).toContain(imported.source);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });

  it('keeps the same number of widgets on each field', () => {
    const changed = [...before.entries()]
      .filter(([name, rows]) => after.get(name)?.length !== rows.length)
      .map(([name, rows]) => `${name}: ${rows.length} -> ${after.get(name)?.length}`);
    expect(changed).toEqual([]);
  });

  for (const property of PRESERVED) {
    it(`keeps ${property} on every widget`, () => {
      const changed = [];
      for (const [name, rows] of before) {
        const other = after.get(name) ?? [];
        const mine = rows.map((r) => r[property]).sort();
        const theirs = other.map((r) => r[property]).sort();
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
          changed.push(`${name}: ${JSON.stringify(mine)} -> ${JSON.stringify(theirs)}`);
        }
      }
      expect(changed).toEqual([]);
    });
  }

  it('warns plainly that the two scripts are replaced', () => {
    // Blunt on purpose. Telling which lines are bespoke and which are an older
    // version of the same flow needs guesswork, and a detector that guesses
    // wrong is worse than one that states the plain fact.
    const note = (imported.notes ?? []).find((n) => n.includes('replaced on export'));
    // K_DCR predates Helper_Functions and Main, so there is nothing of its own
    // for export to replace.
    if (!hasOwnedScripts) {
      expect(note).toBeUndefined();
      return;
    }
    expect(note).toBeDefined();
    expect(note).toContain('CustomSaveValidation');

    // Saying the code will be lost without saying where it can live instead is
    // half a warning, so the sockets are named.
    for (const hook of ['CustomAfterValidation', 'CustomAfterLoad', 'CustomBeforeSubmit']) {
      expect(note).toContain(hook);
    }
  });

  it('says which functions export will replace', () => {
    // Five of the eight forms carry helpers the starter code has no equivalent
    // for. Losing them silently is the thing this warning exists to stop, so
    // the expected set is written down rather than merely counted.
    const expected = {
      'K_CRADD_P - CRA Personal Direct Deposit - Libro.pdf': [
        'DistributeNames',
        'populateApplicantDropdown',
      ],
      'K_CSRF_P - CUMIS Service Request - Libro (2).pdf': [
        'populateDobFromSignerDropdown',
        'updatePhoneAuthButtonState',
      ],
      'K_PADQR_P - PAD Questionnaire and Reimbursemant Claim - Libro.pdf': ['wipeStaffSignature'],
      'K_PTC_P - Personal Trust Contract Application - Libro.pdf': [
        'buildFormID',
        'setCreditConsentPageVisibility',
      ],
      'K_SDBI_P - Safe Deposit Box - Inventory - Libro (1).pdf': ['formatToDDMMMYYYY'],
    };

    const note = (imported.notes ?? []).find((n) => n.includes('the starter code does not'));
    const wanted = expected[file];

    if (!wanted) {
      // injectErrorFlagClearing is on every form and is retired on purpose, so
      // a form with nothing else bespoke must stay quiet.
      expect(note).toBeUndefined();
      return;
    }
    for (const name of wanted) expect(note).toContain(name);
  });

  it('keeps Format and Keystroke as Acrobat wrote them', () => {
    // Formatting is set in Acrobat by whoever draws the field. The one exception
    // is eSign_Code, which this tool places and so also formats.
    const changed = [];
    for (const [name, rows] of before) {
      const other = after.get(name) ?? [];
      for (const key of ['format', 'keystroke']) {
        const mine = rows.map((r) => r[key]).sort();
        const theirs = other.map((r) => r[key]).sort();
        if (JSON.stringify(mine) !== JSON.stringify(theirs)) changed.push(name);
      }
    }
    expect([...new Set(changed)]).toEqual(before.has('eSign_Code') ? ['eSign_Code'] : []);
  });

  it('exports after one field is renamed and another deleted', async () => {
    // Most widgets on these forms carry no appearance stream, and pdf-lib's own
    // removeField throws on those. Renaming and deleting both go through
    // removal, and renaming is the main thing this tool is used for.
    const originalBytes = fs.readFileSync(path.join(DIR, file));
    const names = [...new Set(imported.fields.map((f) => f.name))];
    expect(names.length).toBeGreaterThan(1);
    const [dropped, renamed] = names;

    const fields = imported.fields
      .filter((f) => f.name !== dropped)
      .map((f) => (f.name === renamed ? { ...f, name: `${renamed}_RENAMED` } : f));

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields,
      meta: { config: imported.config },
    });

    const out = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const outNames = out.getForm().getFields().map((f) => f.getName());
    expect(outNames).not.toContain(dropped);
    expect(outNames).not.toContain(renamed);
    expect(outNames).toContain(`${renamed}_RENAMED`);
  }, 120000);
});

it('has a readable forms directory when one is present', () => {
  // An empty directory is a mistake worth catching: it means someone put the
  // forms somewhere else and the round trip coverage silently went away.
  if (!fs.existsSync(DIR)) return;
  expect(files.length).toBeGreaterThan(0);
});
