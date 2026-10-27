// End to end checks on the part that has to be right: place fields, export,
// reopen the exported bytes, get the same field set back, and have the result be
// a real AcroForm that an independent parser agrees with.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFBool,
  PDFNumber,
  PDFString,
  PDFHexString,
  StandardFonts,
  decodePDFRawStream,
  rgb,
} from 'pdf-lib';
import { exportPdf } from '../src/core/pdfExport.js';
import { importPdf, SOURCE } from '../src/core/pdfImport.js';
import { createField, SCHEMA_VERSION } from '../src/core/schema.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';
import { extractRequirements, CATALOG_KEY } from '../src/core/pdfEmbed.js';
import { formatsFromPdf, lengthsFromPdf } from '../src/core/pdfImport.js';
import { parseDocument } from '../src/core/schema.js';
import { esignCodeKeystroke } from '../src/starter/fieldScripts.js';

const DB = normalizeDbFields([
  { identifier: 'CUSTNAME', label: 'Customer Name' },
  { identifier: 'POLICYNUM', label: 'Policy Number' },
  { identifier: 'CLAIMSFLAG', label: 'Prior Claims Indicator' },
  { identifier: 'SIGNDATE', label: 'Signature Date' },
]);
const dbIndex = buildDbIndex(DB);

let pdfjs;
beforeAll(async () => {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).href;
});

// A stand in for a real flat form: three pages, one rotated, one with a CropBox
// that is not the MediaBox, and some printed text so it is not blank.
async function buildFlatForm() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const p1 = doc.addPage([612, 792]);
  p1.drawText('Application, page 1', { x: 72, y: 720, size: 14, font, color: rgb(0, 0, 0) });

  const p2 = doc.addPage([612, 792]);
  p2.setRotation({ type: 'degrees', angle: 90 });
  p2.drawText('Landscape schedule', { x: 72, y: 700, size: 12, font });

  const p3 = doc.addPage([612, 792]);
  p3.setCropBox(18, 24, 576, 744);
  p3.drawText('Signature page', { x: 72, y: 200, size: 12, font });

  return doc.save();
}

function sampleFields() {
  return [
    createField({
      name: 'CUSTNAME',
      type: 'text',
      editable: true,
      page: 0,
      rect: { x: 100, y: 650, width: 220, height: 18 },
      font: { family: 'Times-Roman', size: 12 },
      // A note with no flag attached, notes stand on their own.
      note: 'Legal name, must match the policy exactly.',
      // Load Validation needs the label this field carries on the form.
      customerFacingName: 'Account Holder',
      loadValidated: true,
    }),
    createField({
      name: 'POLICYNUM',
      type: 'text',
      editable: false,
      page: 0,
      rect: { x: 380, y: 650, width: 140, height: 18 },
      loadValidated: false,
      saveValidated: true,
    }),
    createField({
      name: 'CLAIMSFLAG',
      type: 'checkbox',
      editable: true,
      page: 1,
      rect: { x: 90.5, y: 430.25, width: 13.5, height: 13.5 },
      customerFacingName: 'Prior claims',
      loadValidated: true,
    }),
    createField({
      name: 'BROKER_REF_CUSTOM',
      type: 'text',
      editable: true,
      page: 1,
      rect: { x: 200, y: 300, width: 180, height: 20 },
      // Not in the DB list, so Load Validation must come back false while Save
      // Validation, which does not depend on the name, survives.
      customerFacingName: 'Broker reference',
      loadValidated: true,
      saveValidated: true,
    }),
    createField({
      name: 'SIGNDATE',
      type: 'text',
      editable: true,
      page: 2,
      rect: { x: 300, y: 150, width: 120, height: 18 },
      loadValidated: false,
      // Custom Save Validation, with the note that makes it legal.
      note: 'Stamped by the signing service after export.',
      customSaveValidated: true,
    }),
  ];
}

// Compare only what the model promises to persist.
function persisted(fields) {
  return fields
    .map((f) => ({
      name: f.name,
      type: f.type,
      editable: f.editable,
      page: f.page,
      customerFacingName: f.customerFacingName,
      hidden: f.hidden,
      alignment: f.alignment,
      multiline: f.multiline,
      loadValidated: f.loadValidated,
      saveValidated: f.saveValidated,
      customSaveValidated: f.customSaveValidated,
      note: f.note,
      font: { ...f.font },
      exportValue: f.exportValue,
      options: [...f.options],
      x: round(f.rect.x),
      y: round(f.rect.y),
      width: round(f.rect.width),
      height: round(f.rect.height),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const round = (n) => Math.round(n * 10000) / 10000;

// A widget's normal appearance as the content stream text, which is what a
// viewer shows until the value changes.
function appearanceOf(doc, widget) {
  const ap = widget.dict.lookup(PDFName.of('AP'), PDFDict);
  const stream = doc.context.lookup(ap.get(PDFName.of('N')));
  return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
}

// pdf-lib shows text with a standard font as a hex string.
const shown = (text) => `<${Buffer.from(text, 'latin1').toString('hex').toUpperCase()}>`;

async function annotationsByName(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false })
    .promise;
  const found = new Map();
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Widget') continue;
      found.set(a.fieldName, { ...a, pageIndex: i - 1 });
    }
  }
  return found;
}

describe('export then reopen', () => {
  it('returns the same field set from the embedded JSON', async () => {
    const originalBytes = await buildFlatForm();
    const fields = sampleFields();

    const { pdfBytes, warnings } = await exportPdf({
      originalBytes,
      fields,
      meta: { sourceFileName: 'application.pdf' },
    });
    expect(warnings).toEqual([]);

    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.source).toBe(SOURCE.EMBEDDED);

    const expected = persisted(fields).map((f) =>
      // BROKER_REF_CUSTOM is not in the DB list, so Load Validation cannot survive.
      f.name === 'BROKER_REF_CUSTOM' ? { ...f, loadValidated: false } : f
    );
    expect(persisted(reopened.fields)).toEqual(expected);

    // Save Validation does not depend on the name, so it survives on both.
    const byName = new Map(reopened.fields.map((f) => [f.name, f]));
    expect(byName.get('BROKER_REF_CUSTOM').saveValidated).toBe(true);
    expect(byName.get('POLICYNUM').saveValidated).toBe(true);
    expect(byName.get('CUSTNAME').saveValidated).toBe(false);
  });

  it('keeps the internal ids stable across the round trip', async () => {
    const originalBytes = await buildFlatForm();
    const fields = sampleFields();
    const { pdfBytes } = await exportPdf({ originalBytes, fields });
    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.fields.map((f) => f.id).sort()).toEqual(fields.map((f) => f.id).sort());
  });

  it('survives being exported a second time from the reopened file', async () => {
    const originalBytes = await buildFlatForm();
    const fields = sampleFields();

    const first = await exportPdf({ originalBytes, fields });
    const reopened = await importPdf(first.pdfBytes, dbIndex);
    // Export again, this time treating the exported file as the source.
    const second = await exportPdf({ originalBytes: first.pdfBytes, fields: reopened.fields });
    const again = await importPdf(second.pdfBytes, dbIndex);

    expect(persisted(again.fields)).toEqual(persisted(reopened.fields));
    expect(again.source).toBe(SOURCE.EMBEDDED);
  });

  it('replaces the attachment on a second export rather than adding another', async () => {
    const originalBytes = await buildFlatForm();
    const first = await exportPdf({ originalBytes, fields: sampleFields() });
    const reopened = await importPdf(first.pdfBytes, dbIndex);
    const second = await exportPdf({ originalBytes: first.pdfBytes, fields: reopened.fields });

    const pdfDoc = await PDFDocument.load(second.pdfBytes);
    const list = pdfDoc.catalog
      .lookup(PDFName.of('Names'), PDFDict)
      .lookup(PDFName.of('EmbeddedFiles'), PDFDict)
      .lookup(PDFName.of('Names'), PDFArray);
    expect(list.size()).toBe(2);
    expect(pdfDoc.catalog.lookup(PDFName.of('AF'), PDFArray).size()).toBe(1);
  });

  it('writes a sidecar JSON document at the current schema version', async () => {
    const originalBytes = await buildFlatForm();
    const { doc, jsonBytes } = await exportPdf({ originalBytes, fields: sampleFields() });
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    const parsed = JSON.parse(new TextDecoder().decode(jsonBytes));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.fields).toHaveLength(5);
    // The label is never persisted, only the identifier.
    expect(JSON.stringify(parsed)).not.toContain('Customer Name');
  });

  // The embedded JSON is the only place the config lives. It is not recoverable
  // from the PDF's own field data, and the //<CONFIG> block in the document
  // script is never read back, so if this path breaks the config is simply gone.
  it('brings the config back, not just the fields', async () => {
    const originalBytes = await buildFlatForm();
    const config = {
      formMenuGroups: 'Consents',
      formId: 'K_CON',
      formDescription: 'Consent to share information',
      formName: 'Consent Form',
      foCabinet: 'Lending',
      postProcessing: true,
      adminQueue: true,
      supportServices: false,
      formType: 'org',
      productCodes: ['K_CON001', 'K_CON002'],
    };
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: sampleFields(),
      meta: { config },
    });

    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.config).toEqual(config);
  });

  it('keeps the config through a second export from the reopened file', async () => {
    const originalBytes = await buildFlatForm();
    const config = {
      formMenuGroups: 'Payments',
      formId: 'K_PADQR',
      formDescription: 'Claim for a reimbursement of a PAD',
      formName: 'PAD Questionnaire & Reimbursemant Claim',
      foCabinet: 'Member Services',
      postProcessing: false,
      adminQueue: false,
      supportServices: true,
      formType: 'combined',
      productCodes: ['K_PADQR'],
    };

    const first = await exportPdf({ originalBytes, fields: sampleFields(), meta: { config } });
    const reopened = await importPdf(first.pdfBytes, dbIndex);
    const second = await exportPdf({
      originalBytes: first.pdfBytes,
      fields: reopened.fields,
      meta: { config: reopened.config },
    });

    expect((await importPdf(second.pdfBytes, dbIndex)).config).toEqual(config);
  });

  it('falls back to defaults rather than trusting a bad config', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: sampleFields(),
      meta: {
        config: { formType: 'nonsense', productCodes: 'K_ONE', formId: 7 },
      },
    });

    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.config.formType).toBe('person');
    expect(reopened.config.productCodes).toEqual(['K_ONE']);
    expect(reopened.config.formId).toBe('');
  });
});

// Config owns two system field values. The box and the field must never
// disagree, and a form that already carries them must not lose them.
describe('the config values in FORM_ID and FORM_NAME', () => {
  const systemBoxes = () => [
    createField({ name: 'FORM_ID', page: 0, rect: { x: 10, y: 10, width: 54, height: 10 } }),
    createField({ name: 'FORM_NAME', page: 0, rect: { x: 70, y: 10, width: 54, height: 10 } }),
  ];
  const textOf = async (bytes, name) =>
    (await PDFDocument.load(bytes)).getForm().getTextField(name).getText() ?? '';

  it('writes them from the config, trimmed', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [...sampleFields(), ...systemBoxes()],
      meta: {
        config: {
          formId: ' K_COV ',
          formName: 'Coverdraft Protection',
          // A different thing from the name, and it goes nowhere near the field.
          formDescription: 'Overdraft protection agreement',
        },
      },
    });
    expect(await textOf(pdfBytes, 'FORM_ID')).toBe('K_COV');
    expect(await textOf(pdfBytes, 'FORM_NAME')).toBe('Coverdraft Protection');
  });

  it('always writes and draws 1of1 in PACK', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [createField({ name: 'PACK', page: 0, rect: { x: 10, y: 30, width: 54, height: 10 } })],
      meta: { config: {} },
    });
    expect(await textOf(pdfBytes, 'PACK')).toBe('1of1');
    const out = await PDFDocument.load(pdfBytes);
    expect(appearanceOf(out, out.getForm().getTextField('PACK').acroField.getWidgets()[0]))
      .toContain(shown('1of1'));
  });

  it('clears one when its box is emptied, and it stays cleared', async () => {
    const first = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: systemBoxes(),
      meta: { config: { formId: 'K_COV', formName: 'Coverdraft Protection' } },
    });
    const reopened = await importPdf(first.pdfBytes, dbIndex);
    const second = await exportPdf({
      originalBytes: first.pdfBytes,
      fields: reopened.fields,
      meta: { config: { ...reopened.config, formId: '' } },
    });
    expect(await textOf(second.pdfBytes, 'FORM_ID')).toBe('');
    expect(await textOf(second.pdfBytes, 'FORM_NAME')).toBe('Coverdraft Protection');
    expect((await importPdf(second.pdfBytes, dbIndex)).config.formId).toBe('');
  });

  it('fills a blank box from a form that already carries them', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([612, 792]);
    const id = source.getForm().createTextField('FORM_ID');
    id.setText('K_COV');
    id.addToPage(page, { x: 10, y: 10, width: 54, height: 10 });
    const bytes = await source.save();

    const opened = await importPdf(bytes, dbIndex);
    expect(opened.source).toBe(SOURCE.ACROFORM);
    expect(opened.config.formId).toBe('K_COV');
    // FORM_NAME is not on this form, so its box stays blank.
    expect(opened.config.formName).toBe('');

    // So exporting it straight back does not wipe the value.
    const { pdfBytes } = await exportPdf({
      originalBytes: bytes,
      fields: opened.fields,
      meta: { config: opened.config },
    });
    expect(await textOf(pdfBytes, 'FORM_ID')).toBe('K_COV');
  });

  // Some forms show them, and with no NeedAppearances nothing but the export
  // draws the value.
  const drawnOn = (doc, name) =>
    appearanceOf(doc, doc.getForm().getTextField(name).acroField.getWidgets()[0]);

  it('draws the value it writes', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: systemBoxes(),
      meta: { config: { formId: 'K_COV', formName: 'Coverdraft Protection' } },
    });
    const out = await PDFDocument.load(pdfBytes);
    expect(drawnOn(out, 'FORM_ID')).toContain(shown('K_COV'));
    expect(drawnOn(out, 'FORM_NAME')).toContain(shown('Coverdraft Protection'));
  });

  it('stops drawing a value it clears', async () => {
    const first = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: systemBoxes(),
      meta: { config: { formId: 'K_COV', formName: 'Coverdraft Protection' } },
    });
    const reopened = await importPdf(first.pdfBytes, dbIndex);
    const second = await exportPdf({
      originalBytes: first.pdfBytes,
      fields: reopened.fields,
      meta: { config: { ...reopened.config, formId: '' } },
    });
    const out = await PDFDocument.load(second.pdfBytes);
    expect(drawnOn(out, 'FORM_ID')).not.toContain(shown('K_COV'));
    expect(drawnOn(out, 'FORM_NAME')).toContain(shown('Coverdraft Protection'));
  });

  it('keeps the /DA a form arrived with while it draws', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([612, 792]);
    const name = source.getForm().createTextField('FORM_NAME');
    name.addToPage(page, { x: 70, y: 10, width: 120, height: 12 });
    name.acroField.getWidgets()[0].dict.set(PDFName.of('DA'), PDFString.of('/Helv 10 Tf 0 0 1 rg'));
    const originalBytes = await source.save();

    const opened = await importPdf(originalBytes, dbIndex);
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: opened.fields,
      meta: { config: { ...opened.config, formName: 'Coverdraft Protection' } },
    });
    const out = await PDFDocument.load(pdfBytes);
    const widget = out.getForm().getTextField('FORM_NAME').acroField.getWidgets()[0];
    expect(widget.dict.get(PDFName.of('DA')).decodeText()).toBe('/Helv 10 Tf 0 0 1 rg');
    expect(appearanceOf(out, widget)).toContain(shown('Coverdraft Protection'));
  });
});

describe('the exported PDF as an AcroForm', () => {
  it('is readable by pdf.js with the right names, types, pages and flags', async () => {
    const originalBytes = await buildFlatForm();
    const fields = sampleFields();
    const { pdfBytes } = await exportPdf({ originalBytes, fields });

    const annots = await annotationsByName(pdfBytes);
    expect([...annots.keys()].sort()).toEqual(
      ['BROKER_REF_CUSTOM', 'CLAIMSFLAG', 'CUSTNAME', 'POLICYNUM', 'SIGNDATE'].sort()
    );

    const custName = annots.get('CUSTNAME');
    expect(custName.fieldType).toBe('Tx');
    expect(custName.pageIndex).toBe(0);
    expect(custName.readOnly).toBe(false);
    // pdf.js reports the rect in PDF user space, which is what we stored.
    expect(custName.rect.map(round)).toEqual([100, 650, 320, 668]);

    expect(annots.get('POLICYNUM').readOnly).toBe(true);
    expect(annots.get('CLAIMSFLAG').fieldType).toBe('Btn');
    expect(annots.get('CLAIMSFLAG').pageIndex).toBe(1);
    expect(annots.get('SIGNDATE').pageIndex).toBe(2);
  });

  // With it on, Acrobat runs the Format of a field placed twice before the
  // fields exist, and Main alerts on every lookup.
  it('never sets NeedAppearances', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({ originalBytes, fields: sampleFields() });
    const doc = await PDFDocument.load(pdfBytes);
    const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
    expect(acro.get(PDFName.of('NeedAppearances'))).toBeUndefined();
  });

  it('takes NeedAppearances off a form exported while it was set', async () => {
    const first = await exportPdf({ originalBytes: await buildFlatForm(), fields: sampleFields() });
    const flagged = await PDFDocument.load(first.pdfBytes);
    flagged.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
    const originalBytes = await flagged.save();

    const { fields } = await importPdf(originalBytes, dbIndex);
    const { pdfBytes } = await exportPdf({ originalBytes, fields });
    const acro = (await PDFDocument.load(pdfBytes)).catalog.lookup(PDFName.of('AcroForm'));
    expect(acro.get(PDFName.of('NeedAppearances'))).toBeUndefined();
  });

  it('leaves the appearance of a field it does not write alone', async () => {
    const source = await PDFDocument.create();
    const page = source.addPage([612, 792]);
    const field = source.getForm().createTextField('CUSTNAME');
    field.setText('Acme Industrial Supply');
    field.addToPage(page, { x: 100, y: 650, width: 220, height: 18 });
    const originalBytes = await source.save();
    const before = await PDFDocument.load(originalBytes);
    const drawn = appearanceOf(before, before.getForm().getTextField('CUSTNAME').acroField.getWidgets()[0]);

    const { fields } = await importPdf(originalBytes, dbIndex);
    const { pdfBytes } = await exportPdf({ originalBytes, fields });
    const out = await PDFDocument.load(pdfBytes);
    expect(appearanceOf(out, out.getForm().getTextField('CUSTNAME').acroField.getWidgets()[0])).toBe(drawn);
  });

  it('fills by name and reads the value back', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({ originalBytes, fields: sampleFields() });

    // This is what the downstream filler does: look the field up by name and set it.
    const doc = await PDFDocument.load(pdfBytes);
    const form = doc.getForm();
    form.getTextField('CUSTNAME').setText('Acme Industrial Supply');
    form.getCheckBox('CLAIMSFLAG').check();
    const filled = await doc.save({ updateFieldAppearances: false });

    const reread = await PDFDocument.load(filled);
    expect(reread.getForm().getTextField('CUSTNAME').getText()).toBe('Acme Industrial Supply');
    expect(reread.getForm().getCheckBox('CLAIMSFLAG').isChecked()).toBe(true);

    // The field definitions still round trip after a fill.
    const after = await importPdf(filled, dbIndex);
    expect(after.source).toBe(SOURCE.EMBEDDED);
    expect(after.fields).toHaveLength(5);
  });

  it('rotates widgets on a rotated page to match', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({ originalBytes, fields: sampleFields() });
    const annots = await annotationsByName(pdfBytes);
    // Page 2 is rotated 90, so its widgets carry a matching MK rotation.
    expect(annots.get('BROKER_REF_CUSTOM').rotation).toBe(90);
    // Page 1 is upright and must not gain one.
    expect(annots.get('CUSTNAME').rotation ?? 0).toBe(0);
  });
});

describe('radio groups', () => {
  const RADIO_FLAG = 1 << 15;
  const NO_TOGGLE_TO_OFF = 1 << 14;

  function radioFields() {
    return ['BASIC', 'PREMIUM', 'DELUXE'].map((value, i) =>
      createField({
        name: 'COVERAGE',
        type: 'radio',
        exportValue: value,
        page: 0,
        rect: { x: 50, y: 600 - i * 25, width: 14, height: 14 },
      })
    );
  }

  it('becomes one field whose options are its widgets', async () => {
    const { pdfBytes, warnings } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: radioFields(),
    });
    expect(warnings).toEqual([]);

    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['COVERAGE']);
    expect(out.getForm().getRadioGroup('COVERAGE').acroField.getWidgets()).toHaveLength(3);
  });

  it('names each on-state after its export value, as Acrobat does', async () => {
    // pdf-lib names them by position and keeps the labels in /Opt. A filler
    // reads the state name, so the real value has to be the state name.
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: radioFields(),
    });

    const out = await PDFDocument.load(pdfBytes);
    const group = out.getForm().getRadioGroup('COVERAGE');
    const states = group.acroField.getWidgets().map((w) => {
      const ap = out.context.lookup(w.dict.get(PDFName.of('AP')));
      const normal = out.context.lookup(ap.get(PDFName.of('N')));
      return normal
        .keys()
        .map((k) => k.asString())
        .filter((k) => k !== '/Off');
    });
    expect(states).toEqual([['/BASIC'], ['/PREMIUM'], ['/DELUXE']]);
    // The positional map would contradict the named states, so it must be gone.
    expect(group.acroField.dict.get(PDFName.of('Opt'))).toBeUndefined();
    expect(group.getOptions()).toEqual(['BASIC', 'PREMIUM', 'DELUXE']);
  });

  it('sets the radio and no-toggle-to-off flags Acrobat uses', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: radioFields(),
    });
    const out = await PDFDocument.load(pdfBytes);
    const ff = out.getForm().getRadioGroup('COVERAGE').acroField.dict.get(PDFName.of('Ff'))
      .asNumber();
    expect(ff & RADIO_FLAG).toBeTruthy();
    expect(ff & NO_TOGGLE_TO_OFF).toBeTruthy();
  });

  it('selects by export value and reads it back', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: radioFields(),
    });
    const out = await PDFDocument.load(pdfBytes);
    out.getForm().getRadioGroup('COVERAGE').select('PREMIUM');
    const filled = await out.save({ updateFieldAppearances: false });
    const back = await PDFDocument.load(filled);
    expect(back.getForm().getRadioGroup('COVERAGE').getSelected()).toBe('PREMIUM');
  });

  it('starts with nothing selected', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: radioFields(),
    });
    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getRadioGroup('COVERAGE').getSelected()).toBeUndefined();
  });

  it('lets two options share a value and selects them in unison', async () => {
    // The same choice offered in two places. Acrobat allows this, and the
    // RadiosInUnison flag is what tells a viewer to treat clicks that way,
    // rather than only the drawn appearance agreeing.
    const fields = [
      createField({ name: 'PRIORCLAIM', type: 'radio', exportValue: 'YES', page: 0, rect: { x: 50, y: 700, width: 14, height: 14 } }),
      createField({ name: 'PRIORCLAIM', type: 'radio', exportValue: 'NO', page: 0, rect: { x: 50, y: 670, width: 14, height: 14 } }),
      createField({ name: 'PRIORCLAIM', type: 'radio', exportValue: 'YES', page: 1, rect: { x: 50, y: 700, width: 14, height: 14 } }),
    ];
    const { pdfBytes, warnings } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields,
    });
    expect(warnings).toEqual([]);

    const out = await PDFDocument.load(pdfBytes);
    const group = out.getForm().getRadioGroup('PRIORCLAIM');
    const ff = group.acroField.dict.get(PDFName.of('Ff')).asNumber();
    expect(ff & (1 << 25)).toBeTruthy();
    expect(group.isMutuallyExclusive()).toBe(false);

    // Choosing YES lights both of its widgets and leaves NO alone.
    group.select('YES');
    const states = group.acroField
      .getWidgets()
      .map((w) => w.dict.get(PDFName.of('AS'))?.asString());
    expect(states).toEqual(['/YES', '/Off', '/YES']);
  });

  it('leaves the unison flag off when every option is distinct', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: radioFields(),
    });
    const out = await PDFDocument.load(pdfBytes);
    const group = out.getForm().getRadioGroup('COVERAGE');
    expect(group.acroField.dict.get(PDFName.of('Ff')).asNumber() & (1 << 25)).toBeFalsy();
    expect(group.isMutuallyExclusive()).toBe(true);
  });

  it('round trips every option back into its own placement', async () => {
    const fields = radioFields();
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields });

    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.source).toBe(SOURCE.EMBEDDED);
    expect(reopened.fields.map((f) => f.exportValue)).toEqual(['BASIC', 'PREMIUM', 'DELUXE']);
    expect(reopened.fields.every((f) => f.type === 'radio')).toBe(true);
  });

  it('reads the options back out of an AcroForm with no JSON', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: radioFields(),
    });
    const stripped = await PDFDocument.load(pdfBytes);
    stripped.catalog.delete(PDFName.of(CATALOG_KEY));
    stripped.catalog.delete(PDFName.of('Names'));

    const rebuilt = await importPdf(
      await stripped.save({ updateFieldAppearances: false }),
      dbIndex
    );
    expect(rebuilt.source).toBe(SOURCE.ACROFORM);
    expect(rebuilt.fields.map((f) => `${f.type}:${f.exportValue}`)).toEqual([
      'radio:BASIC',
      'radio:PREMIUM',
      'radio:DELUXE',
    ]);
  });
});

describe('dropdowns', () => {
  const COMBO_FLAG = 1 << 17;

  const dropdownField = () =>
    createField({
      name: 'BUSTYPE',
      type: 'dropdown',
      options: ['SOLE', 'PARTNER', { value: 'CORP', label: 'Corporation' }],
      font: { family: 'Times-Roman', size: 11 },
      page: 0,
      rect: { x: 50, y: 650, width: 160, height: 20 },
    });

  it('writes its options and marks itself a combo box', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [dropdownField()],
    });
    const out = await PDFDocument.load(pdfBytes);
    const dropdown = out.getForm().getDropdown('BUSTYPE');
    // pdf-lib reports the display text, which is the label where one is given.
    expect(dropdown.getOptions()).toEqual(['SOLE', 'PARTNER', 'Corporation']);
    const ff = dropdown.acroField.dict.get(PDFName.of('Ff'))?.asNumber() ?? 0;
    expect(ff & COMBO_FLAG).toBeTruthy();
  });

  it('takes a font, since its value is drawn as text', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [dropdownField()],
    });
    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getDropdown('BUSTYPE').acroField.getDefaultAppearance()).toBe(
      '0 g\n/Times-Roman 11 Tf'
    );
  });

  it('round trips its options, keeping value and label apart', async () => {
    const expected = [
      { value: 'SOLE', label: 'SOLE' },
      { value: 'PARTNER', label: 'PARTNER' },
      { value: 'CORP', label: 'Corporation' },
    ];
    const fields = [dropdownField()];
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields });
    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.fields[0].options).toEqual(expected);

    const stripped = await PDFDocument.load(pdfBytes);
    stripped.catalog.delete(PDFName.of(CATALOG_KEY));
    stripped.catalog.delete(PDFName.of('Names'));
    const rebuilt = await importPdf(
      await stripped.save({ updateFieldAppearances: false }),
      dbIndex
    );
    expect(rebuilt.fields[0].type).toBe('dropdown');
    expect(rebuilt.fields[0].options).toEqual(expected);
  });

  it('writes the short form for an option whose value is its label', async () => {
    // Acrobat writes a bare string when the two are the same, and a pair only
    // where they differ. Same here, so a simple list stays simple.
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [dropdownField()],
    });
    const out = await PDFDocument.load(pdfBytes);
    const opt = out.context.lookup(
      out.getForm().getDropdown('BUSTYPE').acroField.dict.get(PDFName.of('Opt'))
    );
    expect(opt.lookup(0)).toBeInstanceOf(PDFHexString);
    expect(opt.lookup(2)).toBeInstanceOf(PDFArray);
    expect(opt.lookup(2).size()).toBe(2);
  });
});

describe('checkbox export values', () => {
  it('writes the value the user chose, not the library default', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [
        createField({
          name: 'CLAIMSFLAG',
          type: 'checkbox',
          exportValue: 'Y',
          page: 0,
          rect: { x: 50, y: 650, width: 14, height: 14 },
        }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const widget = out.getForm().getCheckBox('CLAIMSFLAG').acroField.getWidgets()[0];
    const ap = out.context.lookup(widget.dict.get(PDFName.of('AP')));
    const normal = out.context.lookup(ap.get(PDFName.of('N')));
    expect(
      normal
        .keys()
        .map((k) => k.asString())
        .sort()
    ).toEqual(['/Off', '/Y']);

    // And it round trips.
    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.fields[0].exportValue).toBe('Y');
  });
});

describe('submission buttons', () => {
  const BUTTONS = [
    { identifier: 'PrintButton', caption: 'Print Form', width: 120, height: 24, script: '' },
    { identifier: 'PhoneAuthButton', caption: 'Phone Auth', width: 120, height: 24, script: '' },
  ];
  const placed = () => [
    createField({ name: 'PrintButton', type: 'button', page: 0, rect: { x: 50, y: 60, width: 120, height: 24 } }),
  ];

  it('exports as a real pushbutton with its caption', async () => {
    const { pdfBytes, warnings } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: BUTTONS,
    });
    expect(warnings).toEqual([]);

    const out = await PDFDocument.load(pdfBytes);
    const field = out.getForm().getFields()[0];
    const ff = field.acroField.dict.get(PDFName.of('Ff')).asNumber();
    // Pushbutton is bit 17, and it must not read as a checkbox.
    expect(ff & (1 << 16)).toBeTruthy();
    const captions = field.acroField.getWidgets()[0].getAppearanceCharacteristics()?.getCaptions();
    expect(captions?.normal).toBe('Print Form');
  });

  it('is black bordered, green faced, thin and beveled', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    const widget = out.getForm().getFields()[0].acroField.getWidgets()[0];

    const look = widget.getAppearanceCharacteristics();
    expect(look.getBorderColor()).toEqual([0, 0, 0]);
    expect(look.getBackgroundColor()).toEqual([0, 1, 0]);

    const bs = widget.dict.lookup(PDFName.of('BS'), PDFDict);
    expect(bs.lookup(PDFName.of('W'), PDFNumber).asNumber()).toBe(1);
    expect(bs.get(PDFName.of('S')).asString()).toBe('/B');
  });

  it('draws its caption at size 10, in a font the viewer can resolve', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    const form = out.getForm();
    const da = form.getFields()[0].acroField.getDefaultAppearance();
    expect(da).toMatch(/\/(\S+)\s+10\s+Tf/);

    // The /DA names a font, so /DR has to carry it or the caption renders in
    // whatever the viewer falls back to.
    const named = da.match(/\/(\S+)\s+10\s+Tf/)[1];
    const dr = form.acroForm.dict.lookup(PDFName.of('DR'), PDFDict);
    expect(dr.lookup(PDFName.of('Font'), PDFDict).get(PDFName.of(named))).toBeDefined();
  });

  // The viewer shows what is drawn. pdf-lib draws a new button grey, and only
  // NeedAppearances used to have Acrobat redraw it from /MK.
  it('is drawn green with its caption at size 10', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    const drawn = appearanceOf(out, out.getForm().getFields()[0].acroField.getWidgets()[0]);
    expect(drawn).toContain('0 1 0 rg');
    expect(drawn).not.toContain('0.75 0.75 0.75 rg');
    expect(drawn).toContain(shown('Print Form'));
    expect(drawn).toMatch(/\/\S+ 10 Tf/);
  });

  it('stays hidden once drawn, for Main to show', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [{ ...placed()[0], hidden: true }],
      buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    const widget = out.getForm().getFields()[0].acroField.getWidgets()[0];
    expect(widget.dict.get(PDFName.of('F')).asNumber() & 2).toBe(2);
    expect(appearanceOf(out, widget)).toContain('0 1 0 rg');
  });

  it('redraws a button kept from an earlier export', async () => {
    const first = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: BUTTONS,
    });
    const reopened = await importPdf(first.pdfBytes, dbIndex, [], BUTTONS);
    const renamed = [{ ...BUTTONS[0], caption: 'Print' }, BUTTONS[1]];
    const { pdfBytes } = await exportPdf({
      originalBytes: first.pdfBytes,
      fields: reopened.fields,
      buttons: renamed,
    });
    const out = await PDFDocument.load(pdfBytes);
    const drawn = appearanceOf(out, out.getForm().getFields()[0].acroField.getWidgets()[0]);
    expect(drawn).toContain(shown('Print'));
    expect(drawn).not.toContain(shown('Print Form'));
  });

  it('writes no action while the list carries no script', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields()[0].acroField.dict.get(PDFName.of('A'))).toBeUndefined();
  });

  it('writes the action once the list carries one', async () => {
    const withScript = [{ ...BUTTONS[0], script: 'this.print();' }, BUTTONS[1]];
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: withScript,
    });
    const out = await PDFDocument.load(pdfBytes);
    const action = out.context.lookup(
      out.getForm().getFields()[0].acroField.dict.get(PDFName.of('A'))
    );
    expect(action.get(PDFName.of('S')).asString()).toBe('/JavaScript');
    expect(action.get(PDFName.of('JS')).decodeText()).toBe('this.print();');
    // /A is the activation action, which for a widget is the mouse released
    // inside it. Writing /AA /U as well would run the script twice.
    expect(out.getForm().getFields()[0].acroField.dict.get(PDFName.of('AA'))).toBeUndefined();
  });

  it('round trips back as a button', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: placed(),
      buttons: BUTTONS,
    });
    const reopened = await importPdf(pdfBytes, dbIndex, [], BUTTONS);
    expect(reopened.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['PrintButton:button']);
  });

  it('leaves a pushbutton it does not know about alone', async () => {
    // Until generic buttons are actually asked for, anything else stays
    // unmodelled and survives export untouched.
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const other = base.getForm().createButton('SomeOtherButton');
    other.addToPage('Press', page, { x: 50, y: 500, width: 80, height: 20 });
    const originalBytes = await base.save();

    const imported = await importPdf(originalBytes, dbIndex, [], BUTTONS);
    expect(imported.fields.some((f) => f.name === 'SomeOtherButton')).toBe(false);

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: imported.fields,
      buttons: BUTTONS,
    });
    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toContain('SomeOtherButton');
  });
});

describe('character limit', () => {
  const limited = () => [
    createField({ name: 'AccountNumber', maxLength: 12, page: 0, rect: { x: 50, y: 700, width: 200, height: 18 } }),
    createField({ name: 'Free', page: 0, rect: { x: 50, y: 650, width: 200, height: 18 } }),
  ];
  const maxLen = (form, n) => form.getTextField(n).acroField.dict.get(PDFName.of('MaxLen'))?.asNumber();

  it('writes MaxLen only where a limit is set', async () => {
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields: limited() });
    const form = (await PDFDocument.load(pdfBytes)).getForm();
    expect([maxLen(form, 'AccountNumber'), maxLen(form, 'Free')]).toEqual([12, undefined]);
  });

  it('round trips, from the requirements and out of an AcroForm with no JSON', async () => {
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields: limited() });
    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.fields.map((f) => f.maxLength)).toEqual([12, 0]);
    const stripped = await PDFDocument.load(pdfBytes);
    stripped.catalog.delete(PDFName.of(CATALOG_KEY));
    stripped.catalog.delete(PDFName.of('Names'));
    const rebuilt = await importPdf(await stripped.save({ updateFieldAppearances: false }), dbIndex);
    expect(rebuilt.fields.map((f) => f.maxLength)).toEqual([12, 0]);
  });

  it('takes the PDF limit where the requirements were written before limits were', async () => {
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields: limited() });
    const doc = structuredClone(extractRequirements(await PDFDocument.load(pdfBytes)));
    for (const f of doc.fields) delete f.maxLength;
    const { fields, predatesMaxLength } = parseDocument(doc, dbIndex);
    expect(fields.map((f) => f.maxLength)).toEqual([0, 0]);
    const filled = lengthsFromPdf(fields, await PDFDocument.load(pdfBytes), predatesMaxLength);
    expect(filled.map((f) => f.maxLength)).toEqual([12, 0]);
  });

  it('removes a limit unset, and writes one shorter than the value already there', async () => {
    const originalBytes = await buildFlatForm();
    const first = await exportPdf({ originalBytes, fields: limited() });
    const off = limited().map((f) => ({ ...f, maxLength: 0 }));
    const second = await exportPdf({ originalBytes: first.pdfBytes, fields: off });
    expect(maxLen((await PDFDocument.load(second.pdfBytes)).getForm(), 'AccountNumber')).toBe(undefined);
    const filled = await PDFDocument.load(first.pdfBytes);
    filled.getForm().getTextField('Free').setText('a long value already typed');
    const shorter = limited().map((f) => (f.name === 'Free' ? { ...f, maxLength: 4 } : f));
    const third = await exportPdf({ originalBytes: await filled.save(), fields: shorter });
    expect(maxLen((await PDFDocument.load(third.pdfBytes)).getForm(), 'Free')).toBe(4);
  });

  it('combs only where asked, and round trips the comb with and without the JSON', async () => {
    const fields = limited().map((f, i) => (i === 0 ? { ...f, comb: true } : f));
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields });
    const form = (await PDFDocument.load(pdfBytes)).getForm();
    expect(['AccountNumber', 'Free'].map((n) => form.getTextField(n).isCombed())).toEqual([true, false]);
    expect((await importPdf(pdfBytes, dbIndex)).fields.map((f) => f.comb)).toEqual([true, false]);
    const stripped = await PDFDocument.load(pdfBytes);
    stripped.catalog.delete(PDFName.of(CATALOG_KEY));
    stripped.catalog.delete(PDFName.of('Names'));
    const rebuilt = await importPdf(await stripped.save({ updateFieldAppearances: false }), dbIndex);
    expect(rebuilt.fields.map((f) => f.comb)).toEqual([true, false]);
    const off = rebuilt.fields.map((f) => ({ ...f, comb: false }));
    const second = await exportPdf({ originalBytes: pdfBytes, fields: off });
    expect((await PDFDocument.load(second.pdfBytes)).getForm().getTextField('AccountNumber').isCombed()).toBe(false);
  });

  it('takes the PDF comb where the requirements were written before combs were', async () => {
    const fields = limited().map((f, i) => (i === 0 ? { ...f, comb: true } : f));
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields });
    const doc = structuredClone(extractRequirements(await PDFDocument.load(pdfBytes)));
    for (const f of doc.fields) delete f.comb;
    const parsed = parseDocument(doc, dbIndex);
    expect(parsed.predatesMaxLength.size).toBe(0);
    const filled = lengthsFromPdf(parsed.fields, await PDFDocument.load(pdfBytes), parsed.predatesMaxLength, parsed.predatesComb);
    expect(filled.map((f) => [f.maxLength, f.comb])).toEqual([[12, true], [0, false]]);
  });

  it('needs a limit to comb, and a comb does not wrap', () => {
    expect(createField({ name: 'X', comb: true }).comb).toBe(false);
    expect(createField({ name: 'X', maxLength: 9, comb: true, multiline: true })).toMatchObject({ comb: true, multiline: false });
    expect(createField({ name: 'X', type: 'checkbox', maxLength: 9, comb: true }).comb).toBe(false);
  });

  it('belongs to text only', () => {
    expect(createField({ name: 'X', type: 'checkbox', maxLength: 5 }).maxLength).toBe(0);
    expect(createField({ name: 'X', maxLength: '12.7' }).maxLength).toBe(12);
    expect(createField({ name: 'X', maxLength: -3 }).maxLength).toBe(0);
  });
});

describe('alignment and wrapping', () => {
  const laidOut = () => [
    createField({ name: 'CUSTNAME', alignment: 'center', multiline: true, page: 0, rect: { x: 50, y: 700, width: 300, height: 40 } }),
    createField({ name: 'POLICYNUM', alignment: 'right', page: 0, rect: { x: 50, y: 650, width: 120, height: 18 } }),
    createField({ name: 'SIGNDATE', page: 0, rect: { x: 50, y: 600, width: 120, height: 18 } }),
  ];

  it('writes quadding as the /Q entry', async () => {
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields: laidOut() });
    const form = (await PDFDocument.load(pdfBytes)).getForm();
    const q = (n) => form.getTextField(n).acroField.dict.get(PDFName.of('Q'))?.asNumber();
    expect([q('CUSTNAME'), q('POLICYNUM'), q('SIGNDATE')]).toEqual([1, 2, 0]);
  });

  it('sets the multiline flag only where asked', async () => {
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields: laidOut() });
    const form = (await PDFDocument.load(pdfBytes)).getForm();
    expect(form.getTextField('CUSTNAME').isMultiline()).toBe(true);
    expect(form.getTextField('POLICYNUM').isMultiline()).toBe(false);
  });

  it('aligns a dropdown too, since it also draws text', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [
        createField({ name: 'BUSTYPE', type: 'dropdown', alignment: 'center', options: ['A'], page: 0, rect: { x: 50, y: 650, width: 120, height: 20 } }),
      ],
    });
    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getDropdown('BUSTYPE').acroField.dict.get(PDFName.of('Q')).asNumber()).toBe(1);
  });

  it('round trips both, including out of an AcroForm with no JSON', async () => {
    const fields = laidOut();
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields });

    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.fields.map((f) => f.alignment)).toEqual(['center', 'right', 'left']);
    expect(reopened.fields.map((f) => f.multiline)).toEqual([true, false, false]);

    const stripped = await PDFDocument.load(pdfBytes);
    stripped.catalog.delete(PDFName.of(CATALOG_KEY));
    stripped.catalog.delete(PDFName.of('Names'));
    const rebuilt = await importPdf(await stripped.save({ updateFieldAppearances: false }), dbIndex);
    expect(rebuilt.fields.map((f) => f.alignment)).toEqual(['center', 'right', 'left']);
    expect(rebuilt.fields.map((f) => f.multiline)).toEqual([true, false, false]);
  });

  it('turns wrapping back off when it is unset', async () => {
    const originalBytes = await buildFlatForm();
    const on = [createField({ name: 'CUSTNAME', multiline: true, page: 0, rect: { x: 50, y: 700, width: 200, height: 40 } })];
    const first = await exportPdf({ originalBytes, fields: on });

    const off = (await importPdf(first.pdfBytes, dbIndex)).fields.map((f) => ({ ...f, multiline: false }));
    const second = await exportPdf({ originalBytes: first.pdfBytes, fields: off });
    const out = await PDFDocument.load(second.pdfBytes);
    expect(out.getForm().getTextField('CUSTNAME').isMultiline()).toBe(false);
  });
});

describe('field and widget merging', () => {
  // Acrobat merges a single-widget field into one dictionary. Readers commonly
  // take /T and /FT straight off the annotation, so the split shape pdf-lib
  // produces by default is invisible to them.
  function widgetsOnPages(doc) {
    const found = [];
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i += 1) {
        const w = doc.context.lookup(annots.get(i));
        found.push({
          name: w.get(PDFName.of('T'))?.decodeText?.() ?? null,
          type: w.get(PDFName.of('FT'))?.asString?.() ?? null,
          hasParent: w.get(PDFName.of('Parent')) !== undefined,
        });
      }
    }
    return found;
  }

  it('puts the name and type on the annotation itself for a single placement', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 50, y: 700, width: 200, height: 18 } }),
        createField({
          name: 'CLAIMSFLAG',
          type: 'checkbox',
          page: 0,
          rect: { x: 50, y: 650, width: 14, height: 14 },
        }),
      ],
    });

    const widgets = widgetsOnPages(await PDFDocument.load(pdfBytes));
    expect(widgets).toHaveLength(2);
    for (const w of widgets) {
      expect(w.name).not.toBeNull();
      expect(w.type).not.toBeNull();
      expect(w.hasParent).toBe(false);
    }
    expect(widgets.map((w) => w.type).sort()).toEqual(['/Btn', '/Tx']);
  });

  it('still reads back through pdf-lib after merging', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({
          name: 'POLICYNUM',
          editable: false,
          page: 0,
          rect: { x: 50, y: 700, width: 200, height: 18 },
          font: { family: 'Courier', size: 11 },
        }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const field = out.getForm().getTextField('POLICYNUM');
    expect(field.isReadOnly()).toBe(true);
    expect(field.acroField.getDefaultAppearance()).toBe('0 g\n/Courier 11 Tf');
    field.setText('POL-1');
    expect(field.getText()).toBe('POL-1');
  });

  it('leaves a multi-widget field split, since it cannot be merged', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 50, y: 700, width: 200, height: 18 } }),
        createField({ name: 'CUSTNAME', page: 1, rect: { x: 50, y: 600, width: 200, height: 18 } }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['CUSTNAME']);
    expect(out.getForm().getTextField('CUSTNAME').acroField.getWidgets()).toHaveLength(2);
    // The widgets stay as kids, so the name is only reachable via the parent.
    for (const w of widgetsOnPages(out)) {
      expect(w.name).toBeNull();
      expect(w.hasParent).toBe(true);
    }
  });

  it('round trips a merged export back into the same field set', async () => {
    const originalBytes = await buildFlatForm();
    const fields = sampleFields();
    const { pdfBytes } = await exportPdf({ originalBytes, fields });

    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.source).toBe(SOURCE.EMBEDDED);
    expect(persisted(reopened.fields)).toHaveLength(fields.length);

    // And the AcroForm reconstruction path reads merged widgets too.
    const stripped = await PDFDocument.load(pdfBytes);
    stripped.catalog.delete(PDFName.of(CATALOG_KEY));
    stripped.catalog.delete(PDFName.of('Names'));
    const rebuilt = await importPdf(
      await stripped.save({ updateFieldAppearances: false }),
      dbIndex
    );
    expect(rebuilt.source).toBe(SOURCE.ACROFORM);
    expect(rebuilt.fields.map((f) => f.name).sort()).toEqual(fields.map((f) => f.name).sort());
  });
});

describe('font handling', () => {
  // Reading the AcroForm structure directly with pdf-lib, since this is
  // exactly what a compliant reader resolves a redrawn field against: the
  // font named in a field's /DA has to exist as a resource in the form's /DR.
  function fontDict(doc) {
    const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
    const dr = acro.lookup(PDFName.of('DR'), PDFDict);
    return dr.lookup(PDFName.of('Font'), PDFDict);
  }

  it('writes each field font into its /DA and registers it in the form /DR', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({ originalBytes, fields: sampleFields() });

    const out = await PDFDocument.load(pdfBytes);
    const dr = fontDict(out);

    // CUSTNAME was drawn at Times-Roman 12, everything else defaults to
    // Helvetica 10, so both families have to be embedded and registered.
    const custDa = out.getForm().getTextField('CUSTNAME').acroField.getDefaultAppearance();
    expect(custDa).toBe('0 g\n/Times-Roman 12 Tf');

    const policyDa = out.getForm().getTextField('POLICYNUM').acroField.getDefaultAppearance();
    expect(policyDa).toBe('0 g\n/Helvetica 10 Tf');

    expect(dr.get(PDFName.of('Times-Roman'))).toBeDefined();
    expect(dr.get(PDFName.of('Helvetica'))).toBeDefined();

    // Each DR entry actually resolves to a font program, not a dangling ref.
    const timesFont = out.context.lookup(dr.get(PDFName.of('Times-Roman')), PDFDict);
    expect(timesFont.get(PDFName.of('BaseFont')).toString()).toBe('/Times-Roman');
  });

  it('leaves a checkbox field untouched and does not embed any font when there are none', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({
          name: 'CLAIMSFLAG',
          type: 'checkbox',
          page: 0,
          rect: { x: 90, y: 430, width: 14, height: 14 },
        }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const acro = out.catalog.lookup(PDFName.of('AcroForm'));
    // No text field means nothing to embed, /DR/Font should not even exist.
    const dr = acro.lookupMaybe(PDFName.of('DR'), PDFDict);
    expect(dr?.lookupMaybe(PDFName.of('Font'), PDFDict)).toBeUndefined();
  });

  it('does not clobber an already-registered DR font when reusing a moved field', async () => {
    // Export once, then export again from the result with a different size.
    // The DR entry for Helvetica must still resolve after the second pass.
    const originalBytes = await buildFlatForm();
    const first = await exportPdf({
      originalBytes,
      fields: [createField({ name: 'CUSTNAME', page: 0, rect: { x: 10, y: 10, width: 100, height: 20 } })],
    });
    const second = await exportPdf({
      originalBytes: first.pdfBytes,
      fields: [
        createField({
          name: 'CUSTNAME',
          page: 0,
          rect: { x: 20, y: 20, width: 100, height: 20 },
          font: { family: 'Helvetica', size: 14 },
        }),
      ],
    });

    const out = await PDFDocument.load(second.pdfBytes);
    expect(out.getForm().getTextField('CUSTNAME').acroField.getDefaultAppearance()).toBe(
      '0 g\n/Helvetica 14 Tf'
    );
    expect(fontDict(out).get(PDFName.of('Helvetica'))).toBeDefined();
  });
});

describe('reopening a PDF with no embedded JSON', () => {
  // Strip the tool's own markers so the file looks like one Acrobat produced.
  async function stripRequirements(bytes) {
    const doc = await PDFDocument.load(bytes);
    doc.catalog.delete(PDFName.of(CATALOG_KEY));
    doc.catalog.delete(PDFName.of('Names'));
    return doc.save({ updateFieldAppearances: false });
  }

  it('rebuilds the field set from the AcroForm and marks it imported', async () => {
    const originalBytes = await buildFlatForm();
    const fields = sampleFields();
    const { pdfBytes } = await exportPdf({ originalBytes, fields });
    const stripped = await stripRequirements(pdfBytes);

    const result = await importPdf(stripped, dbIndex);
    expect(result.source).toBe(SOURCE.ACROFORM);
    expect(extractRequirements(await PDFDocument.load(stripped))).toBeNull();
    expect(result.fields.every((f) => f.imported)).toBe(true);

    // Names, types, pages, rects and the read-only flag all survive inference.
    const rebuilt = persisted(result.fields);
    const expected = persisted(fields).map((f) => ({
      ...f,
      // None of this lives in the PDF itself, only in the JSON we stripped.
      loadValidated: false,
      saveValidated: false,
      customSaveValidated: false,
      note: '',
      customerFacingName: '',
    }));
    expect(rebuilt).toEqual(expected);
  });

  it('never trusts a validation flag it did not write', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({ originalBytes, fields: sampleFields() });
    const stripped = await stripRequirements(pdfBytes);
    const result = await importPdf(stripped, dbIndex);
    expect(result.fields.some((f) => f.loadValidated)).toBe(false);
    expect(result.fields.some((f) => f.saveValidated)).toBe(false);
    expect(result.fields.some((f) => f.customSaveValidated)).toBe(false);
    expect(result.fields.some((f) => f.note)).toBe(false);
  });
});

describe('reopening a flat PDF', () => {
  it('starts with an empty field set', async () => {
    const result = await importPdf(await buildFlatForm(), dbIndex);
    expect(result.source).toBe(SOURCE.FLAT);
    expect(result.fields).toEqual([]);
  });
});

describe('preserving what the tool does not model', () => {
  it('leaves an unmodelled field type alone', async () => {
    // A list box is /Ch without the Combo flag. Dropdowns are modelled and list
    // boxes are not, so this one must survive export untouched rather than
    // being converted into a dropdown.
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const listBox = base.getForm().createOptionList('LEGACY_CHOICE');
    listBox.addOptions(['A', 'B']);
    listBox.addToPage(page, { x: 50, y: 500, width: 120, height: 40 });
    const originalBytes = await base.save();

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({
          name: 'CUSTNAME',
          page: 0,
          rect: { x: 100, y: 650, width: 200, height: 18 },
        }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const names = out.getForm().getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(['CUSTNAME', 'LEGACY_CHOICE']);
    expect(out.getForm().getOptionList('LEGACY_CHOICE').getOptions()).toEqual(['A', 'B']);
  });

  it('keeps Format and Keystroke set in Acrobat on a field it did not generate', async () => {
    // The workflow is Acrobat first: fields are drawn and formatted there, then
    // imported here for their requirements. If export stripped either of these,
    // every form would lose its formatting on the way through.
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const dob = base.getForm().createTextField('DOB');
    dob.addToPage(page, { x: 50, y: 500, width: 120, height: 18 });

    const js = (src) => base.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(src) });
    const widget = dob.acroField.getWidgets()[0];
    widget.dict.set(
      PDFName.of('AA'),
      base.context.obj({
        F: js('AFDate_FormatEx("dd-mmm-yyyy");'),
        K: js('AFDate_KeystrokeEx("dd-mmm-yyyy");'),
      })
    );
    const originalBytes = await base.save();

    const imported = await importPdf(originalBytes, dbIndex);
    const { pdfBytes } = await exportPdf({ originalBytes, fields: imported.fields });

    const out = await PDFDocument.load(pdfBytes);
    const field = out.getForm().getField('DOB');
    const aa = field.acroField.getWidgets()[0].dict.lookup(PDFName.of('AA'), PDFDict);
    const read = (key) =>
      aa.lookup(PDFName.of(key), PDFDict).lookup(PDFName.of('JS')).decodeText();

    expect(read('F')).toBe('AFDate_FormatEx("dd-mmm-yyyy");');
    expect(read('K')).toBe('AFDate_KeystrokeEx("dd-mmm-yyyy");');
    // And ours went on beside them rather than replacing the dict.
    expect(read('Bl')).toContain('required = false');
  });

  it('writes the keystroke script on eSign_Code, the one field it formats', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'eSign_Code', page: 0, rect: { x: 50, y: 500, width: 86, height: 14 } }),
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 50, y: 460, width: 200, height: 18 } }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const actions = (name) => {
      const aa = out.getForm().getField(name).acroField.getWidgets()[0].dict
        .lookupMaybe(PDFName.of('AA'), PDFDict);
      return aa ? aa.keys().map((k) => k.toString()).sort() : [];
    };

    expect(actions('eSign_Code')).toEqual(['/Bl', '/D', '/K']);
    // eSign_Code is placed by this tool, so Acrobat never saw it. Every other
    // field was drawn by a person and is formatted there.
    expect(actions('CUSTNAME')).toEqual(['/Bl', '/D']);
  });

  it('overwrites a pre-existing default appearance with the managed font, even on a field it only moves', async () => {
    // Font is one of the attributes the tool manages, so unlike border style
    // below, a field's existing DA is not preserved. This is deliberate: an
    // internal rule requires every field to render at a specific font and
    // size, and that has to win even over an appearance no one asked us to
    // touch, or "enforce font standards" would have nothing left to fix.
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const text = base.getForm().createTextField('CUSTNAME');
    text.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    text.acroField.setDefaultAppearance('/Helv 9 Tf 0 0 1 rg');
    const originalBytes = await base.save();

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({
          name: 'CUSTNAME',
          page: 0,
          rect: { x: 200, y: 400, width: 150, height: 22 },
          font: { family: 'Times-Roman', size: 12 },
        }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const field = out.getForm().getTextField('CUSTNAME');
    expect(field.acroField.getDefaultAppearance()).toBe('/Times-Roman 12 Tf 0 0 1 rg');
    const rect = field.acroField.getWidgets()[0].getRectangle();
    expect([rect.x, rect.y, rect.width, rect.height].map(round)).toEqual([200, 400, 150, 22]);
  });

  it('leaves the default appearance alone when the font was not changed', async () => {
    // The form's own resource name and colour both survive, which is what stops
    // an Arial form coming back as Helvetica.
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const text = base.getForm().createTextField('CUSTNAME');
    text.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    text.acroField.setDefaultAppearance('/Arial 10 Tf 0.898 0.133 0.215 rg');
    const originalBytes = await base.save();

    const imported = await importPdf(originalBytes, dbIndex);
    // Arial is not a family the tool offers, so it reads back as the default.
    // Nobody chose that, so it must not be written back out as one.
    expect(imported.fields[0].font).toEqual({ family: 'Helvetica', size: 10 });

    const { pdfBytes } = await exportPdf({ originalBytes, fields: imported.fields });
    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getTextField('CUSTNAME').acroField.getDefaultAppearance()).toBe(
      '/Arial 10 Tf 0.898 0.133 0.215 rg'
    );
  });

  it('keeps a custom border style on a field it only moves', async () => {
    // Border and background are not modelled, so unlike font above, an
    // existing style survives a move.
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const text = base.getForm().createTextField('CUSTNAME');
    text.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    const widget = text.acroField.getWidgets()[0];
    widget.getOrCreateBorderStyle().setWidth(2);
    widget.getOrCreateAppearanceCharacteristics().setBorderColor([1, 0, 0]);
    const originalBytes = await base.save();

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 200, y: 400, width: 150, height: 22 } }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const field = out.getForm().getTextField('CUSTNAME');
    const outWidget = field.acroField.getWidgets()[0];
    expect(outWidget.getOrCreateBorderStyle().getWidth()).toBe(2);
    expect(outWidget.getOrCreateAppearanceCharacteristics().getBorderColor()).toEqual([1, 0, 0]);
  });

  it('removes a modelled field the user deleted', async () => {
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const keep = base.getForm().createTextField('CUSTNAME');
    keep.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    const drop = base.getForm().createTextField('POLICYNUM');
    drop.addToPage(page, { x: 10, y: 50, width: 100, height: 20 });
    const originalBytes = await base.save();

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 10, y: 10, width: 100, height: 20 } }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['CUSTNAME']);
  });

  // Most real forms leave appearances to the viewer, so a widget often has no
  // /AP at all. pdf-lib's removeField finds each annotation through that
  // appearance and throws "Unexpected N type: undefined" when it is missing.
  async function withoutAppearances(build) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    build(doc.getForm(), page);
    for (const field of doc.getForm().getFields()) {
      for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
    }
    // Saving with appearance updates on would quietly put them all back.
    const bytes = await doc.save({ updateFieldAppearances: false });

    const check = await PDFDocument.load(bytes);
    for (const field of check.getForm().getFields()) {
      for (const widget of field.acroField.getWidgets()) {
        expect(widget.dict.get(PDFName.of('AP'))).toBeUndefined();
      }
    }
    return bytes;
  }

  it('removes a field that has no appearance stream', async () => {
    const originalBytes = await withoutAppearances((form, page) => {
      form.createTextField('CUSTNAME').addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
      form.createTextField('POLICYNUM').addToPage(page, { x: 10, y: 50, width: 100, height: 20 });
    });

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'CUSTNAME', page: 0, rect: { x: 10, y: 10, width: 100, height: 20 } }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['CUSTNAME']);
    // Off the page as well as the field list, or a viewer still draws the box.
    expect(out.getPage(0).node.Annots().size()).toBe(1);
  });

  it('renames a field that has no appearance stream', async () => {
    // A rename is a removal and a creation, and it is the most common thing done
    // to an imported form.
    const originalBytes = await withoutAppearances((form, page) => {
      form.createTextField('Text1').addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
    });
    const imported = await importPdf(originalBytes, dbIndex);
    const renamed = imported.fields.map((f) => ({ ...f, name: 'CUSTNAME' }));

    const { pdfBytes } = await exportPdf({ originalBytes, fields: renamed });

    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['CUSTNAME']);
    expect(out.getPage(0).node.Annots().size()).toBe(1);
  });

  it('rebuilds a field that has no appearance stream when its type changes', async () => {
    const originalBytes = await withoutAppearances((form, page) => {
      form.createTextField('CLAIMSFLAG').addToPage(page, { x: 10, y: 10, width: 20, height: 20 });
    });

    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({
          name: 'CLAIMSFLAG',
          type: 'checkbox',
          page: 0,
          rect: { x: 10, y: 10, width: 20, height: 20 },
        }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getCheckBox('CLAIMSFLAG')).toBeTruthy();
    expect(out.getPage(0).node.Annots().size()).toBe(1);
  });
});

describe('one name used on more than one page', () => {
  it('becomes a single field with a widget on each page', async () => {
    const originalBytes = await buildFlatForm();
    const fields = [
      createField({ name: 'CUSTNAME', page: 0, rect: { x: 100, y: 650, width: 200, height: 18 } }),
      createField({ name: 'CUSTNAME', page: 2, rect: { x: 100, y: 600, width: 200, height: 18 } }),
    ];
    const { pdfBytes, warnings } = await exportPdf({ originalBytes, fields });
    expect(warnings).toEqual([]);

    const out = await PDFDocument.load(pdfBytes);
    const all = out.getForm().getFields();
    expect(all.map((f) => f.getName())).toEqual(['CUSTNAME']);
    expect(all[0].acroField.getWidgets()).toHaveLength(2);

    // Filling once shows the value in both places.
    out.getForm().getTextField('CUSTNAME').setText('Acme');
    const filled = await out.save({ updateFieldAppearances: false });
    const reread = await PDFDocument.load(filled);
    expect(reread.getForm().getTextField('CUSTNAME').getText()).toBe('Acme');
  });

  // An Acrobat form with one name placed twice, no embedded JSON of ours.
  async function acrobatStyleMultiWidget() {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([612, 792]);
    const p2 = doc.addPage([612, 792]);
    const field = doc.getForm().createTextField('CUSTNAME');
    field.addToPage(p1, { x: 100, y: 700, width: 200, height: 18 });
    field.addToPage(p2, { x: 100, y: 500, width: 200, height: 18 });
    // Acrobat can hide one placement and show the other. Hidden is bit 2 of /F,
    // an annotation flag, so it is per widget rather than per field.
    field.acroField.getWidgets()[1].dict.set(PDFName.of('F'), PDFNumber.of(2));
    return doc.save();
  }

  it('imports one entry per placement rather than only the first', async () => {
    const result = await importPdf(await acrobatStyleMultiWidget(), dbIndex);
    expect(result.source).toBe(SOURCE.ACROFORM);
    expect(result.fields).toHaveLength(2);
    expect(result.fields.map((f) => f.name)).toEqual(['CUSTNAME', 'CUSTNAME']);
    expect(result.fields.map((f) => f.page)).toEqual([0, 1]);
  });

  it('does not drop a placement when reopening and re-exporting an Acrobat form', async () => {
    // Regression: the second widget used to be silently deleted, because the
    // field was rebuilt from a single imported rect.
    const originalBytes = await acrobatStyleMultiWidget();
    const imported = await importPdf(originalBytes, dbIndex);
    const { pdfBytes } = await exportPdf({ originalBytes, fields: imported.fields });

    const out = await PDFDocument.load(pdfBytes);
    const widgets = out.getForm().getTextField('CUSTNAME').acroField.getWidgets();
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['CUSTNAME']);
    expect(widgets).toHaveLength(2);
  });

  it('reads visibility back per placement and writes it out again', async () => {
    // Hidden is modelled now, so this is a round trip rather than a passenger.
    // It still has to stay per placement: the flag is on the widget, so one
    // placement can be hidden while another shows.
    const originalBytes = await acrobatStyleMultiWidget();
    const imported = await importPdf(originalBytes, dbIndex);
    expect(imported.fields.map((f) => f.hidden)).toEqual([false, true]);

    const { pdfBytes } = await exportPdf({ originalBytes, fields: imported.fields });
    const out = await PDFDocument.load(pdfBytes);
    const widgets = out.getForm().getTextField('CUSTNAME').acroField.getWidgets();
    expect(widgets[1].dict.get(PDFName.of('F')).asNumber() & 2).toBeTruthy();
    expect(widgets[0].dict.get(PDFName.of('F'))?.asNumber() & 2).toBeFalsy();
  });

  it('hides and unhides a placement on demand', async () => {
    const originalBytes = await acrobatStyleMultiWidget();
    const imported = await importPdf(originalBytes, dbIndex);

    // Flip both: show the hidden one, hide the visible one.
    const flipped = imported.fields.map((f) => ({ ...f, hidden: !f.hidden }));
    const { pdfBytes } = await exportPdf({ originalBytes, fields: flipped });

    const out = await PDFDocument.load(pdfBytes);
    const widgets = out.getForm().getTextField('CUSTNAME').acroField.getWidgets();
    expect(widgets[0].dict.get(PDFName.of('F')).asNumber() & 2).toBeTruthy();
    expect(widgets[1].dict.get(PDFName.of('F')).asNumber() & 2).toBeFalsy();

    const reopened = await importPdf(pdfBytes, dbIndex);
    expect(reopened.fields.map((f) => f.hidden)).toEqual([true, false]);
  });

  it('hides a freshly drawn field too, not only an imported one', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(),
      fields: [
        createField({ name: 'CUSTNAME', hidden: true, page: 0, rect: { x: 50, y: 700, width: 200, height: 18 } }),
        createField({ name: 'POLICYNUM', page: 0, rect: { x: 50, y: 650, width: 200, height: 18 } }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const form = out.getForm();
    const hiddenF = form.getTextField('CUSTNAME').acroField.getWidgets()[0].dict.get(PDFName.of('F'));
    const shownF = form.getTextField('POLICYNUM').acroField.getWidgets()[0].dict.get(PDFName.of('F'));
    expect(hiddenF.asNumber() & 2).toBeTruthy();
    expect(shownF.asNumber() & 2).toBeFalsy();
    // Print stays set on both, hiding is not the same as never printing.
    expect(shownF.asNumber() & 4).toBeTruthy();

    const reopened = await importPdf(pdfBytes, dbIndex);
    const byName = new Map(reopened.fields.map((f) => [f.name, f]));
    expect(byName.get('CUSTNAME').hidden).toBe(true);
    expect(byName.get('POLICYNUM').hidden).toBe(false);
  });

  it('rebuilds rather than mismatching when a placement is added', async () => {
    const originalBytes = await acrobatStyleMultiWidget();
    const imported = await importPdf(originalBytes, dbIndex);
    // A third placement of the same name means the count no longer lines up.
    const fields = [
      ...imported.fields,
      createField({ name: 'CUSTNAME', page: 0, rect: { x: 300, y: 300, width: 120, height: 18 } }),
    ];
    const { pdfBytes, warnings } = await exportPdf({ originalBytes, fields });
    expect(warnings).toEqual([]);

    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields().map((f) => f.getName())).toEqual(['CUSTNAME']);
    expect(out.getForm().getTextField('CUSTNAME').acroField.getWidgets()).toHaveLength(3);
  });
});

describe('export warnings', () => {
  it('skips a field with no name and says so', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes, warnings } = await exportPdf({
      originalBytes,
      fields: [createField({ name: '  ', page: 0, rect: { x: 1, y: 1, width: 10, height: 10 } })],
    });
    expect(warnings).toEqual(['Skipped a field with no name.']);
    const out = await PDFDocument.load(pdfBytes);
    expect(out.getForm().getFields()).toHaveLength(0);
  });

  it('skips a field pointing at a page the PDF does not have', async () => {
    const originalBytes = await buildFlatForm();
    const { warnings } = await exportPdf({
      originalBytes,
      fields: [createField({ name: 'CUSTNAME', page: 9, rect: { x: 1, y: 1, width: 10, height: 10 } })],
    });
    expect(warnings).toEqual(['Skipped "CUSTNAME", page 10 is not in this PDF.']);
  });
});

describe('a checkbox placed more than once', () => {
  const onStates = (doc, name) => {
    const field = doc.getForm().getFields().find((f) => f.getName() === name);
    return field.acroField.getWidgets().map((w) => {
      const ap = doc.context.lookupMaybe(w.dict.get(PDFName.of('AP')), PDFDict);
      const normal = ap && doc.context.lookupMaybe(ap.get(PDFName.of('N')), PDFDict);
      return (normal ? normal.keys().map((k) => k.asString()) : []).filter((k) => k !== '/Off').join('|');
    });
  };
  const pair = (a, b) => [
    createField({ name: 'Q', type: 'checkbox', exportValue: a, page: 0, rect: { x: 50, y: 700, width: 14, height: 14 } }),
    createField({ name: 'Q', type: 'checkbox', exportValue: b, page: 0, rect: { x: 200, y: 700, width: 14, height: 14 } }),
  ];

  it('gives each placement its own on-state, which is a Yes/No pair', async () => {
    // One field, two boxes, one answer. The on-state lives on the widget, so
    // renaming only the first left the second on pdf-lib's default: asking for
    // Yes/No got /Yes on both and the question could only ever answer yes.
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(), fields: pair('Yes', 'No'), buttons: [],
    });
    expect(onStates(await PDFDocument.load(pdfBytes), 'Q')).toEqual(['/Yes', '/No']);
  });

  it('works whatever the values are, not just the ones pdf-lib defaults to', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(), fields: pair('A', 'B'), buttons: [],
    });
    expect(onStates(await PDFDocument.load(pdfBytes), 'Q')).toEqual(['/A', '/B']);
  });

  it('still lets two placements share a value, which ticks them together', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(), fields: pair('Yes', 'Yes'), buttons: [],
    });
    expect(onStates(await PDFDocument.load(pdfBytes), 'Q')).toEqual(['/Yes', '/Yes']);
  });

  it('round trips both values back into the model', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(), fields: pair('Yes', 'No'), buttons: [],
    });
    const reopened = await importPdf(pdfBytes, dbIndex, [], []);
    const placements = reopened.fields.filter((f) => f.name === 'Q');
    expect(placements.map((f) => f.exportValue)).toEqual(['Yes', 'No']);

    // And exporting what came back keeps them, rather than collapsing to one.
    const again = await exportPdf({
      originalBytes: pdfBytes, fields: reopened.fields, buttons: [],
    });
    expect(onStates(await PDFDocument.load(again.pdfBytes), 'Q')).toEqual(['/Yes', '/No']);
  });
});

// The checks above read on-states in getWidgets order, which a permutation
// survives as long as it permutes both. That is how the /Annots against /Kids
// ordering bug hid, so these key the on-state to the widget's own rect instead.
describe('an on-state stays on the widget it was drawn for', () => {
  const byRect = async (bytes, name) => {
    const doc = await PDFDocument.load(bytes);
    const field = doc.getForm().getFields().find((f) => f.getName() === name);
    const out = {};
    for (const w of field.acroField.getWidgets()) {
      const ap = doc.context.lookupMaybe(w.dict.get(PDFName.of('AP')), PDFDict);
      const normal = ap && doc.context.lookupMaybe(ap.get(PDFName.of('N')), PDFDict);
      const on = (normal ? normal.keys().map((k) => k.asString()) : []).filter((k) => k !== '/Off');
      const r = w.getRectangle();
      out[Math.round(Math.min(r.x, r.x + r.width))] = on.join('|');
    }
    return out;
  };
  const box = (v, x) =>
    createField({ name: 'Q', type: 'checkbox', exportValue: v, page: 0, rect: { x, y: 700, width: 14, height: 14 } });
  const opt = (v, x) =>
    createField({ name: 'R', type: 'radio', exportValue: v, page: 0, rect: { x, y: 600, width: 14, height: 14 } });
  const drawn = () => [box('Yes', 50), box('No', 200), opt('Choice1', 50), opt('Choice2', 200)];

  it('on the path that creates the field', async () => {
    const { pdfBytes } = await exportPdf({
      originalBytes: await buildFlatForm(), fields: drawn(), buttons: [],
    });
    expect(await byRect(pdfBytes, 'Q')).toEqual({ 50: '/Yes', 200: '/No' });
    expect(await byRect(pdfBytes, 'R')).toEqual({ 50: '/Choice1', 200: '/Choice2' });
  });

  it('on the path that reuses the widgets already there', async () => {
    const first = await exportPdf({
      originalBytes: await buildFlatForm(), fields: drawn(), buttons: [],
    });
    const reopened = await importPdf(first.pdfBytes, dbIndex, [], []);
    const again = await exportPdf({
      originalBytes: first.pdfBytes, fields: reopened.fields, buttons: [],
    });
    expect(await byRect(again.pdfBytes, 'Q')).toEqual({ 50: '/Yes', 200: '/No' });
    expect(await byRect(again.pdfBytes, 'R')).toEqual({ 50: '/Choice1', 200: '/Choice2' });
  });

  it('and after a move, which is what makes that path realign them', async () => {
    const first = await exportPdf({
      originalBytes: await buildFlatForm(), fields: [box('Yes', 50), box('No', 200)], buttons: [],
    });
    const reopened = await importPdf(first.pdfBytes, dbIndex, [], []);
    const moved = reopened.fields.map((f) =>
      Math.round(f.rect.x) === 50 ? { ...f, rect: { ...f.rect, x: 400 } } : f
    );
    const third = await exportPdf({
      originalBytes: first.pdfBytes, fields: moved, buttons: [],
    });
    expect(await byRect(third.pdfBytes, 'Q')).toEqual({ 200: '/No', 400: '/Yes' });
  });
});

describe('formats', () => {
  const js = (doc, src) => doc.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(src) });
  const script = (doc, dict, key) => {
    const aa = doc.context.lookupMaybe(dict.get(PDFName.of('AA')), PDFDict);
    const action = aa && doc.context.lookupMaybe(aa.get(PDFName.of(key)), PDFDict);
    return action ? doc.context.lookup(action.get(PDFName.of('JS'))).decodeText() : null;
  };

  // pdf-lib draws a field the way Acrobat stores some of the real ones, a
  // field with one widget kid, and Acrobat puts Format and Keystroke on the
  // field rather than the kid.
  async function splitDateField(pattern) {
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const field = base.getForm().createTextField('DOB');
    field.addToPage(page, { x: 50, y: 500, width: 120, height: 18 });
    field.acroField.dict.set(
      PDFName.of('AA'),
      base.context.obj({
        F: js(base, `AFDate_FormatEx("${pattern}");`),
        K: js(base, `AFDate_KeystrokeEx("${pattern}");`),
      })
    );
    return base.save();
  }

  it('keeps the pair Acrobat stored on the field when the field and its widget merge', async () => {
    // Export used to keep only the widget's /AA, which carries the OnBlur, and
    // so dropped the formatting of seven fields on four of the example forms.
    const originalBytes = await splitDateField('dd-mmm-yyyy');
    const imported = await importPdf(originalBytes, dbIndex);
    expect(imported.fields[0].format).toEqual({ category: 'date' });

    const { pdfBytes } = await exportPdf({ originalBytes, fields: imported.fields });
    const out = await PDFDocument.load(pdfBytes);
    const dict = out.getForm().getField('DOB').acroField.dict;
    expect(script(out, dict, 'F')).toBe('AFDate_FormatEx("dd-mmm-yyyy");');
    expect(script(out, dict, 'K')).toBe('AFDate_KeystrokeEx("dd-mmm-yyyy");');
    expect(script(out, dict, 'Bl')).toContain('required = false');
  });

  it('brings a date in another pattern into line, and says so', async () => {
    const originalBytes = await splitDateField('mm/dd/yyyy');
    const imported = await importPdf(originalBytes, dbIndex);
    expect(imported.notes).toContain('Set 1 date field to dd-mmm-yyyy: DOB (was mm/dd/yyyy).');

    const { pdfBytes } = await exportPdf({ originalBytes, fields: imported.fields });
    const out = await PDFDocument.load(pdfBytes);
    expect(script(out, out.getForm().getField('DOB').acroField.dict, 'F')).toBe(
      'AFDate_FormatEx("dd-mmm-yyyy");'
    );
  });

  it('writes a format picked here once, on the field, for every placement', async () => {
    const originalBytes = await buildFlatForm();
    const format = { category: 'number', decimals: 2, currency: 'dollar', parentheses: true };
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({ name: 'POLICYNUM', page: 0, rect: { x: 50, y: 500, width: 120, height: 18 }, format }),
        createField({ name: 'POLICYNUM', page: 2, rect: { x: 50, y: 300, width: 120, height: 18 }, format }),
      ],
    });

    const out = await PDFDocument.load(pdfBytes);
    const field = out.getForm().getField('POLICYNUM');
    expect(script(out, field.acroField.dict, 'F')).toBe('AFNumber_Format(2, 0, 2, 0, "$", true);');
    expect(script(out, field.acroField.dict, 'K')).toBe('AFNumber_Keystroke(2, 0, 2, 0, "$", true);');
    for (const widget of field.acroField.getWidgets()) {
      expect(script(out, widget.dict, 'F')).toBeNull();
      expect(script(out, widget.dict, 'Bl')).toContain('required = false');
    }

    // And the JSON says the same, so it comes back without reading the scripts.
    const back = await importPdf(pdfBytes, dbIndex);
    expect(back.source).toBe(SOURCE.EMBEDDED);
    const placements = back.fields.filter((f) => f.name === 'POLICYNUM');
    expect(placements).toHaveLength(2);
    for (const f of placements) expect(f.format).toMatchObject({ ...format, separator: 'comma' });
  });

  // LIF Spousal Consent's shape, two dated boxes on the page that opens. It
  // alerted on open while NeedAppearances was set, and the fix is the flag, not
  // where the scripts sit.
  it('keeps a date on a field placed twice on the first page, with the flag off', async () => {
    const date = (y) =>
      createField({ name: 'Member1SignDate', page: 0, rect: { x: 400, y, width: 100, height: 18 }, format: { category: 'date' } });
    const { pdfBytes } = await exportPdf({ originalBytes: await buildFlatForm(), fields: [date(200), date(150)] });

    const out = await PDFDocument.load(pdfBytes);
    const field = out.getForm().getField('Member1SignDate');
    expect(field.acroField.getWidgets()).toHaveLength(2);
    expect(script(out, field.acroField.dict, 'F')).toBe('AFDate_FormatEx("dd-mmm-yyyy");');
    expect(script(out, field.acroField.dict, 'K')).toBe('AFDate_KeystrokeEx("dd-mmm-yyyy");');
    for (const widget of field.acroField.getWidgets()) expect(script(out, widget.dict, 'F')).toBeNull();
    expect(out.getForm().acroForm.dict.get(PDFName.of('NeedAppearances'))).toBeUndefined();
  });

  it('reads the format off the PDF for JSON written before there was one', async () => {
    // Otherwise every field would read as None and export would strip what the
    // form carries.
    const originalBytes = await splitDateField('dd-mmm-yyyy');
    const pdfDoc = await PDFDocument.load(originalBytes);
    const old = {
      schemaVersion: SCHEMA_VERSION,
      fields: [{ id: 'a', name: 'DOB', type: 'text', page: 0, rect: { x: 50, y: 500, width: 120, height: 18 } }],
    };
    const parsed = parseDocument(old, dbIndex);
    expect([...parsed.predatesFormat]).toEqual(['a']);
    const { fields } = formatsFromPdf(parsed.fields, pdfDoc, parsed.predatesFormat);
    expect(fields[0].format).toEqual({ category: 'date' });

    // One written since is taken at its word.
    const current = parseDocument(
      { ...old, fields: [{ ...old.fields[0], format: { category: 'none' } }] },
      dbIndex
    );
    expect(current.predatesFormat.size).toBe(0);
  });

  it('keeps the code field plain text', async () => {
    const base = await PDFDocument.create();
    const page = base.addPage([612, 792]);
    const field = base.getForm().createTextField('PROD_CODE');
    field.addToPage(page, { x: 50, y: 500, width: 120, height: 18 });
    field.acroField.dict.set(
      PDFName.of('AA'),
      base.context.obj({
        F: js(base, 'AFDate_FormatEx("mm/dd/yyyy");'),
        K: js(base, 'AFDate_KeystrokeEx("mm/dd/yyyy");'),
      })
    );
    const originalBytes = await base.save();
    const imported = await importPdf(originalBytes, dbIndex);
    expect(imported.fields.find((f) => f.name === 'PROD_CODE').format).toEqual({ category: 'none' });
    expect(imported.notes).toContain('Removed the format on PROD_CODE, plain text only.');

    const { pdfBytes } = await exportPdf({ originalBytes, fields: imported.fields });
    const out = await PDFDocument.load(pdfBytes);
    const dict = out.getForm().getField('PROD_CODE').acroField.dict;
    expect(script(out, dict, 'F')).toBeNull();
    expect(script(out, dict, 'K')).toBeNull();
  });

  it('never puts a format over the eSign_Code keystroke', async () => {
    const originalBytes = await buildFlatForm();
    const { pdfBytes } = await exportPdf({
      originalBytes,
      fields: [
        createField({
          name: 'eSign_Code',
          page: 0,
          rect: { x: 50, y: 500, width: 86, height: 14 },
          format: { category: 'number' },
        }),
      ],
    });
    const out = await PDFDocument.load(pdfBytes);
    const dict = out.getForm().getField('eSign_Code').acroField.dict;
    expect(script(out, dict, 'K')).toBe(esignCodeKeystroke());
    expect(script(out, dict, 'F')).toBeNull();
  });
});
