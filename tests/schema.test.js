import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  DEFAULT_FONT,
  FONT_FAMILIES,
  createField,
  reconcileField,
  reconcileFields,
  unifyNameValues,
  adoptNameValues,
  nameTakenByType,
  serializeDocument,
  parseDocument,
  isLoadAttempted,
  fieldIssues,
  nextRadioExportValue,
  normalizeOptions,
  parseOptionLines,
  formatOptionLines,
  createConfig,
  parseProductCodes,
  DEFAULT_CONFIG,
  SchemaError,
} from '../src/core/schema.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';

const dbIndex = buildDbIndex(
  normalizeDbFields([
    { identifier: 'CUSTNAME', label: 'Customer Name' },
    { identifier: 'POLICYNUM', label: 'Policy Number' },
  ])
);

describe('the two validation flags', () => {
  it('ties Load Validation to a name in the DB list', () => {
    const matched = createField({
      name: 'CUSTNAME',
      customerFacingName: 'Account Holder',
      loadValidated: true,
    });
    expect(isLoadAttempted(matched.name, dbIndex)).toBe(true);
    expect(reconcileField(matched, dbIndex).loadValidated).toBe(true);
  });

  it('clears Load Validation when the name stops matching', () => {
    const renamed = createField({ name: 'NOT_A_COLUMN', loadValidated: true });
    expect(reconcileField(renamed, dbIndex).loadValidated).toBe(false);
  });

  it('leaves Save Validation alone whatever the name is', () => {
    // Save Validation is independent, any field can carry it.
    const custom = createField({ name: 'NOT_A_COLUMN', saveValidated: true });
    expect(reconcileField(custom, dbIndex).saveValidated).toBe(true);

    const unnamed = createField({ name: '', saveValidated: true });
    expect(reconcileField(unnamed, dbIndex).saveValidated).toBe(true);
  });

  it('clears only Load Validation when both are set on a custom name', () => {
    const both = createField({ name: 'NOT_A_COLUMN', loadValidated: true, saveValidated: true });
    const after = reconcileField(both, dbIndex);
    expect(after.loadValidated).toBe(false);
    expect(after.saveValidated).toBe(true);
  });

  it('defaults both to false', () => {
    const plain = createField({ name: 'CUSTNAME' });
    expect(plain.loadValidated).toBe(false);
    expect(plain.saveValidated).toBe(false);
  });

  it('reconciles a whole set without touching Save Validation', () => {
    const fields = reconcileFields(
      [
        createField({
          name: 'CUSTNAME',
          customerFacingName: 'Account Holder',
          loadValidated: true,
          saveValidated: true,
        }),
        createField({
          name: 'GONE_FROM_DB',
          customerFacingName: 'Account Holder',
          loadValidated: true,
          saveValidated: true,
        }),
      ],
      dbIndex
    );
    expect(fields.map((f) => f.loadValidated)).toEqual([true, false]);
    expect(fields.map((f) => f.saveValidated)).toEqual([true, true]);
  });
});

describe('customer-facing name', () => {
  const validated = (extra) =>
    createField({ name: 'CUSTNAME', loadValidated: true, ...extra });

  it('defaults to empty', () => {
    expect(createField({ name: 'CUSTNAME' }).customerFacingName).toBe('');
  });

  it('is required for Load Validation', () => {
    // A DB match alone is not enough, the label on the form is part of the claim.
    expect(reconcileField(validated(), dbIndex).loadValidated).toBe(false);
    expect(
      reconcileField(validated({ customerFacingName: 'Account Holder' }), dbIndex).loadValidated
    ).toBe(true);
  });

  it('treats whitespace as absent', () => {
    expect(reconcileField(validated({ customerFacingName: '   ' }), dbIndex).loadValidated).toBe(
      false
    );
  });

  it('clears Load Validation when the label is removed later', () => {
    const named = reconcileField(validated({ customerFacingName: 'Name' }), dbIndex);
    expect(named.loadValidated).toBe(true);
    const erased = reconcileField({ ...named, customerFacingName: '' }, dbIndex);
    expect(erased.loadValidated).toBe(false);
  });

  it('lets one DB field carry a different label on each placement', () => {
    // CUSTNAME is "Name" on one form and "Account Holder" on another, so the
    // label belongs to the placement rather than to the DB list.
    const a = reconcileField(validated({ customerFacingName: 'Name' }), dbIndex);
    const b = reconcileField(validated({ customerFacingName: 'Account Holder' }), dbIndex);
    expect([a.customerFacingName, b.customerFacingName]).toEqual(['Name', 'Account Holder']);
    expect([a.loadValidated, b.loadValidated]).toEqual([true, true]);
  });

  it('does not gate the save flags', () => {
    const field = reconcileField(
      createField({ name: 'CUSTNAME', saveValidated: true }),
      dbIndex
    );
    expect(field.saveValidated).toBe(true);
  });

  it('round trips through the document', () => {
    const doc = serializeDocument([
      createField({ name: 'CUSTNAME', customerFacingName: 'Account Holder', loadValidated: true }),
    ]);
    expect(doc.fields[0].customerFacingName).toBe('Account Holder');
    const { fields } = parseDocument(JSON.stringify(doc), dbIndex);
    expect(fields[0].customerFacingName).toBe('Account Holder');
    expect(fields[0].loadValidated).toBe(true);
  });
});

describe('notes and Custom Save Validation', () => {
  it('defaults to an empty note and an unset flag', () => {
    const field = createField({ name: 'CUSTNAME' });
    expect(field.note).toBe('');
    expect(field.customSaveValidated).toBe(false);
  });

  it('lets any field carry a note on its own', () => {
    // A note is just documentation, it does not require any flag.
    const field = reconcileField(
      createField({ name: 'ANYTHING', note: 'Filled by hand at branch.' }),
      dbIndex
    );
    expect(field.note).toBe('Filled by hand at branch.');
    expect(field.customSaveValidated).toBe(false);
  });

  it('keeps Custom Save Validation when a note explains it', () => {
    const field = reconcileField(
      createField({ name: 'ANYTHING', note: 'Saved to the ledger system instead.', customSaveValidated: true }),
      dbIndex
    );
    expect(field.customSaveValidated).toBe(true);
  });

  it('clears Custom Save Validation when the note is empty', () => {
    const blank = createField({ name: 'ANYTHING', customSaveValidated: true });
    expect(reconcileField(blank, dbIndex).customSaveValidated).toBe(false);

    // Whitespace is not a description.
    const spaces = createField({ name: 'ANYTHING', note: '   ', customSaveValidated: true });
    expect(reconcileField(spaces, dbIndex).customSaveValidated).toBe(false);
  });

  it('clears Custom Save Validation when the note is removed later', () => {
    const described = reconcileField(
      createField({ name: 'ANYTHING', note: 'Custom situation.', customSaveValidated: true }),
      dbIndex
    );
    expect(described.customSaveValidated).toBe(true);

    const erased = reconcileField({ ...described, note: '' }, dbIndex);
    expect(erased.customSaveValidated).toBe(false);
    // The note itself is not resurrected, only the flag is dropped.
    expect(erased.note).toBe('');
  });

  it('never lets both save flags stand at once', () => {
    const both = createField({
      name: 'ANYTHING',
      note: 'Custom situation.',
      saveValidated: true,
      customSaveValidated: true,
    });
    const after = reconcileField(both, dbIndex);
    expect(after.saveValidated).toBe(true);
    expect(after.customSaveValidated).toBe(false);
  });

  it('leaves Load Validation out of it', () => {
    // The save flags and the load flag answer different questions.
    const field = reconcileField(
      createField({
        name: 'CUSTNAME',
        customerFacingName: 'Account Holder',
        note: 'Custom situation.',
        loadValidated: true,
        customSaveValidated: true,
      }),
      dbIndex
    );
    expect(field.loadValidated).toBe(true);
    expect(field.customSaveValidated).toBe(true);
  });

  it('returns the same object when nothing needs fixing', () => {
    // reconcileFields relies on this to avoid pointless re-renders.
    const clean = createField({
      name: 'CUSTNAME',
      customerFacingName: 'Account Holder',
      note: 'Fine.',
      loadValidated: true,
    });
    expect(reconcileField(clean, dbIndex)).toBe(clean);
  });
});

describe('values shared by name', () => {
  it('brings every placement of a name into line', () => {
    const fields = [
      createField({ name: 'Test', note: '' }),
      createField({ name: 'Test', saveValidated: true, note: 'Required.' }),
      createField({ name: 'Other' }),
    ];
    const [a, b, other] = unifyNameValues(fields);
    expect(a.saveValidated).toBe(true);
    expect(a.note).toBe('Required.');
    expect(b.saveValidated).toBe(true);
    expect(other).toBe(fields[2]);
  });

  it('returns the same array when the placements already agree', () => {
    const fields = [createField({ name: 'Test' }), createField({ name: 'Test' })];
    expect(unifyNameValues(fields)).toBe(fields);
  });

  it('leaves blank names alone', () => {
    const fields = [createField({ name: '' }), createField({ name: '', saveValidated: true })];
    expect(unifyNameValues(fields)).toBe(fields);
  });

  it('shares the format, since a field has one Format and one Keystroke', () => {
    const number = { category: 'number', decimals: 0 };
    const fields = [
      createField({ name: 'AMOUNT' }),
      createField({ name: 'AMOUNT', format: number }),
    ];
    const [a, b] = unifyNameValues(fields);
    expect(a.format).toMatchObject(number);
    expect(b.format).toMatchObject(number);
    // Equal by value is agreement, whatever object each one holds.
    const agreed = [createField({ name: 'X', format: number }), createField({ name: 'X', format: number })];
    expect(unifyNameValues(agreed)).toBe(agreed);
  });

  it('formats text only, so a box renamed into another type loses it', () => {
    const field = { ...createField({ name: 'Member1Name', format: { category: 'date' } }), type: 'dropdown' };
    expect(reconcileField(field, dbIndex).format).toEqual({ category: 'none' });
    expect(createField({ type: 'checkbox', format: { category: 'date' } }).format).toEqual({ category: 'none' });
  });

  it('writes the format to the JSON and reads it back', () => {
    const doc = serializeDocument([createField({ name: 'DOB', format: { category: 'date' } })]);
    expect(doc.fields[0].format).toEqual({ category: 'date' });
    const { fields, predatesFormat } = parseDocument(doc, dbIndex);
    expect(fields[0].format).toEqual({ category: 'date' });
    expect(predatesFormat.size).toBe(0);
  });

  it('runs on load, so an older document opens consistent', () => {
    const doc = serializeDocument([
      createField({ name: 'Test', saveValidated: true }),
      createField({ name: 'Test' }),
    ]);
    const { fields } = parseDocument(doc, dbIndex);
    expect(fields.every((f) => f.saveValidated)).toBe(true);
  });

  it('a box named after an existing field takes its values', () => {
    const existing = createField({ name: 'Test', saveValidated: true, note: 'Required.' });
    const fresh = createField({ name: 'Test' });
    const adopted = adoptNameValues(fresh, [existing, fresh]);
    expect(adopted.saveValidated).toBe(true);
    expect(adopted.note).toBe('Required.');
    expect(adoptNameValues(createField({ name: 'New' }), [existing]).saveValidated).toBe(false);
  });
});

describe('one type per name', () => {
  const radio = createField({ name: 'Other', type: 'radio', exportValue: 'Other' });

  it('says which type already holds the name', () => {
    const text = createField({ name: 'Other', type: 'text' });
    expect(nameTakenByType(text, [radio, text])).toBe('radio');
  });

  it('leaves another placement of the same type free to join', () => {
    const option = createField({ name: 'Other', type: 'radio', exportValue: 'Yes' });
    expect(nameTakenByType(option, [radio, option])).toBeNull();
  });

  it('matches exactly, the way the PDF does', () => {
    const text = createField({ name: 'other', type: 'text' });
    expect(nameTakenByType(text, [radio, text])).toBeNull();
  });

  it('is an error naming every placement of a name that arrived with two types', () => {
    const text = createField({ name: 'Other', type: 'text' });
    const unrelated = createField({ name: 'CUSTNAME', type: 'text' });
    const issue = fieldIssues([radio, text, unrelated], dbIndex).find((i) =>
      i.text.includes('more than one type')
    );
    expect(issue.level).toBe('error');
    expect(issue.ids.sort()).toEqual([radio.id, text.id].sort());
  });
});

describe('font', () => {
  it('defaults to Arial 10', () => {
    const field = createField({ name: 'CUSTNAME' });
    expect(field.font).toEqual(DEFAULT_FONT);
    expect(field.font).toEqual({ family: 'Helvetica', size: 10 });
  });

  it('accepts any listed family', () => {
    for (const { value } of FONT_FAMILIES) {
      expect(createField({ font: { family: value, size: 11 } }).font.family).toBe(value);
    }
  });

  it('falls back to the default family rather than storing an unknown one', () => {
    const field = createField({ font: { family: 'Comic Sans', size: 10 } });
    expect(field.font.family).toBe(DEFAULT_FONT.family);
  });

  it('clamps size to a sane range instead of storing zero, negative, or huge values', () => {
    expect(createField({ font: { family: 'Helvetica', size: 0 } }).font.size).toBeGreaterThan(0);
    expect(createField({ font: { family: 'Helvetica', size: -5 } }).font.size).toBeGreaterThan(0);
    expect(createField({ font: { family: 'Helvetica', size: 500 } }).font.size).toBeLessThanOrEqual(72);
  });

  it('is independent of Load and Save Validation', () => {
    // Changing the font must never touch either validation flag.
    const field = createField({
      name: 'CUSTNAME',
      loadValidated: true,
      saveValidated: true,
      font: { family: 'Courier', size: 14 },
    });
    expect(field.loadValidated).toBe(true);
    expect(field.saveValidated).toBe(true);
  });
});

describe('export values and options', () => {
  it('defaults a checkbox to Yes, as Acrobat does', () => {
    expect(createField({ type: 'checkbox' }).exportValue).toBe('Yes');
  });

  it('hands each new radio option the next Acrobat style placeholder', () => {
    // Acrobat pre-fills Choice1, Choice2 and so on, so a group works as soon as
    // it is drawn.
    const radio = (exportValue) => createField({ type: 'radio', exportValue });
    expect(nextRadioExportValue([])).toBe('Choice1');
    expect(nextRadioExportValue([radio('Choice1'), radio('Choice2')])).toBe('Choice3');
  });

  it('fills a gap rather than colliding with an existing option', () => {
    const radio = (exportValue) => createField({ type: 'radio', exportValue });
    expect(nextRadioExportValue([radio('Choice1'), radio('Choice3')])).toBe('Choice2');
  });

  it('ignores non-radio fields when numbering', () => {
    const fields = [
      createField({ type: 'checkbox', exportValue: 'Choice1' }),
      createField({ type: 'text' }),
    ];
    expect(nextRadioExportValue(fields)).toBe('Choice1');
  });

  it('flags a missing export value as an error', () => {
    const issues = fieldIssues([createField({ name: 'COVERAGE', type: 'radio' })], dbIndex);
    expect(issues.some((i) => i.level === 'error' && i.text.includes('no export value'))).toBe(true);
  });

  it('rejects characters that would be escaped inside a PDF name', () => {
    // "A B" is stored as A#20B, so the filler would compare against that and
    // never match the database value.
    const issues = fieldIssues(
      [createField({ name: 'FLAG', type: 'checkbox', exportValue: 'A B' })],
      dbIndex
    );
    expect(issues.some((i) => i.level === 'error' && i.text.includes('Export value'))).toBe(true);
  });

  it('accepts the characters that survive encoding untouched', () => {
    for (const value of ['Y', 'YES', 'opt_1', 'a-b', 'v1.2']) {
      const issues = fieldIssues(
        [createField({ name: 'FLAG', type: 'checkbox', exportValue: value })],
        dbIndex
      );
      expect(issues.some((i) => i.text.includes('Export value'))).toBe(false);
    }
  });

  it('allows two options of one group to share a value', () => {
    // Acrobat's radios in unison: the same choice offered in more than one
    // place, selected together. Legitimate, so it is not reported.
    const issues = fieldIssues(
      [
        createField({ name: 'COVERAGE', type: 'radio', exportValue: 'YES' }),
        createField({ name: 'COVERAGE', type: 'radio', exportValue: 'YES' }),
      ],
      dbIndex
    );
    expect(issues.some((i) => i.level === 'error')).toBe(false);
  });

  it('names the fields it counted, so the panel can filter to them', () => {
    const named = createField({ name: 'CUSTNAME', type: 'text' });
    const blank = createField({ name: '', type: 'text' });
    const alsoBlank = createField({ name: '', type: 'text' });

    const issues = fieldIssues([named, blank, alsoBlank], dbIndex);
    const unnamed = issues.find((i) => i.text.includes('no name'));
    expect(unnamed.text).toContain('2 fields');
    expect(unnamed.ids.sort()).toEqual([blank.id, alsoBlank.id].sort());
  });

  it('gives a single field issue that one field', () => {
    const bad = createField({ name: 'FLAG', type: 'checkbox', exportValue: 'A B' });
    const issues = fieldIssues([bad], dbIndex);
    expect(issues.find((i) => i.text.includes('Export value')).ids).toEqual([bad.id]);
  });

  it('says nothing about a name outside the DB list', () => {
    // Plenty of fields are typed into by hand and never filled, so a custom name
    // is an ordinary state. Counting them put a number on the panel that was
    // healthy on every form.
    const issues = fieldIssues([createField({ name: 'NOT_IN_THE_LIST', type: 'text' })], dbIndex);
    expect(issues).toEqual([]);
  });

  it('warns about a dropdown with no options', () => {
    const issues = fieldIssues([createField({ name: 'BUSTYPE', type: 'dropdown' })], dbIndex);
    expect(issues.some((i) => i.level === 'warn' && i.text.includes('no options'))).toBe(true);
  });

  it('drops blank option lines', () => {
    const field = createField({ type: 'dropdown', options: ['A', '', 'B'] });
    expect(field.options).toEqual([
      { value: 'A', label: 'A' },
      { value: 'B', label: 'B' },
    ]);
  });

  it('takes a bare string as both halves of an option', () => {
    // What an older document, or a hand written one, carries.
    expect(normalizeOptions(['SOLE'])).toEqual([{ value: 'SOLE', label: 'SOLE' }]);
  });

  it('keeps the stored value and the shown label apart', () => {
    expect(parseOptionLines('ON = Ontario')).toEqual([{ value: 'ON', label: 'Ontario' }]);
  });

  it('takes a tab as the separator, for a two column paste', () => {
    const tab = String.fromCharCode(9);
    expect(parseOptionLines(`ON${tab}Ontario`)).toEqual([{ value: 'ON', label: 'Ontario' }]);
  });

  it('falls back to the value when no label is given', () => {
    expect(parseOptionLines('SOLE')).toEqual([{ value: 'SOLE', label: 'SOLE' }]);
    expect(parseOptionLines('SOLE =')).toEqual([{ value: 'SOLE', label: 'SOLE' }]);
  });

  it('drops a repeat of the same stored value', () => {
    // Two options writing the same value would be ambiguous.
    const nl = String.fromCharCode(10);
    expect(parseOptionLines(`A${nl}A = Other`)).toEqual([{ value: 'A', label: 'A' }]);
  });

  it('writes the pair form back only where the two differ', () => {
    const nl = String.fromCharCode(10);
    const options = parseOptionLines(`SOLE${nl}ON = Ontario`);
    expect(formatOptionLines(options)).toBe(`SOLE${nl}ON = Ontario`);
  });

  it('keeps an unknown type out of the model', () => {
    expect(createField({ type: 'signature' }).type).toBe('text');
  });
});

describe('form config', () => {
  it('defaults to a person form with no product codes', () => {
    expect(createConfig()).toEqual(DEFAULT_CONFIG);
    expect(createConfig().productCodes).toEqual([]);
  });

  it('keeps a known form type and rejects an unknown one', () => {
    expect(createConfig({ formType: 'org' }).formType).toBe('org');
    expect(createConfig({ formType: 'combined' }).formType).toBe('combined');
    expect(createConfig({ formType: 'alien' }).formType).toBe(DEFAULT_CONFIG.formType);
  });

  it('splits pasted codes on commas and trims the whitespace', () => {
    expect(parseProductCodes('M101,RSP,C101, LMNOP')).toEqual(['M101', 'RSP', 'C101', 'LMNOP']);
    expect(parseProductCodes('  M101 ,  RSP  ')).toEqual(['M101', 'RSP']);
  });

  it('accepts what a spreadsheet paste actually looks like', () => {
    // A pasted column arrives with newlines, not commas.
    const newline = String.fromCharCode(10);
    const tab = String.fromCharCode(9);
    expect(parseProductCodes(`M101${newline}RSP${newline}C101`)).toEqual(['M101', 'RSP', 'C101']);
    expect(parseProductCodes(`M101${tab}RSP;C101`)).toEqual(['M101', 'RSP', 'C101']);
  });

  it('drops blanks and repeats but keeps the order', () => {
    expect(parseProductCodes('M101,,RSP, ,M101,C101')).toEqual(['M101', 'RSP', 'C101']);
  });

  it('keeps codes exactly as typed rather than upper casing them', () => {
    // Something downstream matches on these, so their case is not ours to change.
    expect(parseProductCodes('m101, Rsp')).toEqual(['m101', 'Rsp']);
  });

  it('takes codes as an array as well as a string', () => {
    expect(createConfig({ productCodes: ['M101', ' RSP ', 'M101'] }).productCodes).toEqual([
      'M101',
      'RSP',
    ]);
  });

  it('keeps the form id and description exactly as typed', () => {
    // The panel rebuilds the config on every keystroke, so trimming here would
    // eat a space the moment it was typed.
    expect(createConfig({ formDescription: 'Coverdraft ' }).formDescription).toBe('Coverdraft ');
    expect(createConfig({ formId: 42 }).formId).toBe('');
    expect(createConfig().formId).toBe('');
  });

  it('round trips through the document', () => {
    const config = {
      formMenuGroups: 'Deposits',
      formId: 'K_COV',
      formDescription: 'Overdraft protection agreement',
      formName: 'Coverdraft Protection',
      foCabinet: 'Member Services',
      postProcessing: true,
      adminQueue: false,
      supportServices: true,
      formType: 'combined',
      productCodes: ['M101', 'RSP'],
    };
    const doc = serializeDocument([createField({ name: 'CUSTNAME' })], { config });
    expect(doc.config).toEqual(config);

    const parsed = parseDocument(JSON.stringify(doc), dbIndex);
    expect(parsed.config).toEqual(config);
  });

  it('gives a document with no config the defaults', () => {
    const parsed = parseDocument({ schemaVersion: SCHEMA_VERSION, fields: [] }, dbIndex);
    expect(parsed.config).toEqual(DEFAULT_CONFIG);
  });
});

describe('document versions', () => {
  it('writes the current version and both flags', () => {
    const doc = serializeDocument([
      createField({ name: 'CUSTNAME', loadValidated: true, saveValidated: true }),
    ]);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.fields[0]).toMatchObject({ loadValidated: true, saveValidated: true });
  });

  it('never writes the runtime only imported flag', () => {
    const doc = serializeDocument([createField({ name: 'CUSTNAME', imported: true })]);
    expect(doc.fields[0]).not.toHaveProperty('imported');
  });

  it('reads a document at the current version', () => {
    const doc = serializeDocument([
      createField({ name: 'POLICYNUM', saveValidated: true, font: { family: 'Courier', size: 14 } }),
    ]);
    const { fields } = parseDocument(JSON.stringify(doc), dbIndex);
    expect(fields[0].saveValidated).toBe(true);
    expect(fields[0].font).toEqual({ family: 'Courier', size: 14 });
  });

  it('round trips a note and Custom Save Validation', () => {
    const doc = serializeDocument([
      createField({
        name: 'POLICYNUM',
        note: 'Written by the nightly job, not the form.',
        customSaveValidated: true,
      }),
    ]);
    expect(doc.fields[0].note).toBe('Written by the nightly job, not the form.');
    expect(doc.fields[0].customSaveValidated).toBe(true);

    const { fields } = parseDocument(JSON.stringify(doc), dbIndex);
    expect(fields[0].note).toBe('Written by the nightly job, not the form.');
    expect(fields[0].customSaveValidated).toBe(true);
  });

  it('drops a Custom Save Validation flag that arrives without its note', () => {
    // A hand edited file cannot smuggle in an unexplained flag.
    const { fields } = parseDocument(
      {
        schemaVersion: SCHEMA_VERSION,
        fields: [{ name: 'POLICYNUM', type: 'text', page: 0, customSaveValidated: true }],
      },
      dbIndex
    );
    expect(fields[0].customSaveValidated).toBe(false);
  });

  it('rejects a version it does not know', () => {
    expect(() => parseDocument({ schemaVersion: 99, fields: [] }, dbIndex)).toThrow(SchemaError);
  });

  it('rejects junk rather than guessing', () => {
    expect(() => parseDocument('not json', dbIndex)).toThrow(SchemaError);
    expect(() => parseDocument({ schemaVersion: SCHEMA_VERSION }, dbIndex)).toThrow(SchemaError);
  });
});
