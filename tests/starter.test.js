// The starter code is never run by the designer, so a syntax error in it would
// only turn up in Acrobat. These compile it, and run the parts that are pure
// enough to run, so a bad edit fails here instead.
import { describe, it, expect } from 'vitest';
import { helperScript, mainScript, MAX_SIGNER_ROWS } from '../src/starter/index.js';
import { SIGNER_PARTS, SIGNER_PREFIX } from '../src/core/specialFields.js';

// new Function compiles the body without running it, which is the syntax check.
const compiles = (source) => {
  new Function(source);
  return true;
};

// The top level of helpers.js is one var and a pile of function declarations,
// so running it has no side effects and hands back the functions to call.
function loadHelpers(globals = {}) {
  const names = Object.keys(globals);
  const exported = [
    'buildOrgESignerList',
    'rowHas',
    'anyRowHas',
    'ESIGN_SLOT_COUNT',
  ];
  const factory = new Function(
    ...names,
    `${helperScript()}\nreturn { ${exported.map((n) => `${n}: ${n}`).join(', ')} };`
  );
  return factory(...names.map((n) => globals[n]));
}

describe('the scripts themselves', () => {
  it('are both there and are valid JavaScript', () => {
    expect(helperScript().length).toBeGreaterThan(1000);
    expect(mainScript().length).toBeGreaterThan(500);
    expect(compiles(helperScript())).toBe(true);
    expect(compiles(mainScript())).toBe(true);
  });

  it('stay in the Acrobat dialect, no let, const or arrow functions', () => {
    // Acrobat's JavaScript is ES3 era. Anything newer parses here and fails
    // there, which is the worst place to find out.
    for (const source of [helperScript(), mainScript()]) {
      const code = source.replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/\b(let|const)\s/);
      expect(code).not.toMatch(/=>/);
    }
  });

  it('carry the generated config region in Main only', () => {
    expect(mainScript()).toContain('//<CONFIG>');
    expect(mainScript()).toContain('//</CONFIG>');
    expect(helperScript()).not.toContain('//<CONFIG>');
  });

  it('define CustomSaveValidation, since the base pass calls it', () => {
    // It lives with the generated config because it is per form, so an empty
    // one has to ship or every save validation throws.
    expect(helperScript()).toContain('CustomSaveValidation()');
    expect(mainScript()).toMatch(/function CustomSaveValidation\(\)/);
  });
});

describe('the signer row cap', () => {
  it('matches the slot count the starter code writes', () => {
    // The designer's cap and the FileOptics slot width are the same number.
    // If they drift, forms get built that silently truncate on submit.
    expect(loadHelpers().ESIGN_SLOT_COUNT).toBe(MAX_SIGNER_ROWS);
  });

  it('names the three parts a row can carry', () => {
    expect(SIGNER_PARTS.map((p) => `${SIGNER_PREFIX}1${p.suffix}`)).toEqual([
      'Member1Name',
      'Member1Signature',
      'Member1SignDate',
    ]);
    // Only the name is a dropdown, and its options are built at run time.
    expect(SIGNER_PARTS.filter((p) => p.type === 'dropdown')).toHaveLength(1);
  });
});

describe('the Org eSigner list', () => {
  const build = (n) => loadHelpers().buildOrgESignerList(n);

  it('reproduces the three cases that were written by hand', () => {
    expect(build(1)).toBe('1,,,,,');
    expect(build(2)).toBe('1,2,,,,');
    expect(build(3)).toBe('1,2,3,,,');
  });

  it('extends past three, which the old code could not', () => {
    expect(build(4)).toBe('1,2,3,4,,');
    expect(build(5)).toBe('1,2,3,4,5,');
    expect(build(6)).toBe('1,2,3,4,5,6');
  });

  it('is always the same width, whoever signs', () => {
    for (let n = 1; n <= MAX_SIGNER_ROWS; n += 1) {
      expect(build(n).split(',')).toHaveLength(MAX_SIGNER_ROWS);
    }
  });

  it('stays empty when nobody signs, as before', () => {
    expect(build(0)).toBe('');
  });

  it('cannot overflow the slots', () => {
    expect(build(99).split(',')).toHaveLength(MAX_SIGNER_ROWS);
  });
});

describe('row shape', () => {
  const rows = [
    { name: true, signature: true, signDate: true },
    { name: true, signature: false, signDate: false },
    { name: false, signature: true, signDate: true },
  ];
  const helpers = () => loadHelpers({ SIGNER_ROWS: rows, MAX_SIGNERS_ON_FORM: rows.length });

  it('reads each row on its own, so a row can drop parts', () => {
    const { rowHas } = helpers();
    expect(rowHas(1, 'signature')).toBe(true);
    expect(rowHas(2, 'signature')).toBe(false);
    expect(rowHas(3, 'name')).toBe(false);
  });

  it('is false past the last row rather than throwing', () => {
    const { rowHas } = helpers();
    expect(rowHas(9, 'name')).toBe(false);
  });

  it('answers whether any row carries a part at all', () => {
    const { anyRowHas } = helpers();
    expect(anyRowHas('name')).toBe(true);
    const noNames = loadHelpers({
      SIGNER_ROWS: [{ name: false, signature: true, signDate: false }],
      MAX_SIGNERS_ON_FORM: 1,
    });
    expect(noNames.anyRowHas('name')).toBe(false);
  });

  it('behaves exactly like the old form wide flags when rows are uniform', () => {
    // The swap has to be a no-op on every form built before it, so all rows
    // true must read the same as SIGNER_ROW_HAS_* all true.
    const uniform = [1, 2, 3].map(() => ({ name: true, signature: true, signDate: true }));
    const { rowHas, anyRowHas } = loadHelpers({
      SIGNER_ROWS: uniform,
      MAX_SIGNERS_ON_FORM: uniform.length,
    });
    for (const part of ['name', 'signature', 'signDate']) {
      expect(anyRowHas(part)).toBe(true);
      for (let i = 1; i <= uniform.length; i += 1) expect(rowHas(i, part)).toBe(true);
    }
  });
});

describe('flow ids', () => {
  // The filler writes ENVIRONMENT, so this stubs the field read.
  const flowsFor = (environment) =>
    new Function(
      '__environment',
      `${helperScript()}
       getSafeValue = function (n) { return n === "ENVIRONMENT" ? __environment : ""; };
       return [getFlowId("PHONE"), getFlowId("ESIGN"), getFlowId("DIGITAL"), getFlowId("SUBMIT")];`
    )(environment);

  it('switch on the environment the filler wrote', () => {
    // Submit for Processing goes to the Phone Auth flow, as K_DCR does.
    expect(flowsFor('PROD')).toEqual(['FO', 'ES', 'DS', 'FO']);
    expect(flowsFor('TEST')).toEqual(['TFO', 'TES', 'TDS', 'TFO']);
  });

  it('treat anything but PROD as test, so an unfilled form stays off the live flows', () => {
    for (const value of ['', 'STAGING']) {
      expect(flowsFor(value)).toEqual(['TFO', 'TES', 'TDS', 'TFO']);
    }
  });
});

describe('product validation', () => {
  const passes = (values, codes) =>
    new Function(
      '__values',
      '__codes',
      `${helperScript()}
       getSafeValue = function (n) { return __values[n] === undefined ? "" : __values[n]; };
       return ProductValidation(["PROD_CODE"], __codes);`
    )(values, codes);

  it('matches PROD_CODE against the codes', () => {
    expect(passes({ PROD_CODE: 'S1', IN_ACCTNBR: '123' }, ['S1'])).toBe(true);
    expect(passes({ PROD_CODE: 'S2', IN_ACCTNBR: '123' }, ['S1'])).toBe(false);
  });

  it('skips the check when the form has no product codes', () => {
    expect(passes({ PROD_CODE: 'S2', IN_ACCTNBR: '0' }, [])).toBe(true);
    expect(passes({ PROD_CODE: '', IN_ACCTNBR: '0' }, [''])).toBe(true);
  });

  it('skips Member in any case, so Member alone means no check', () => {
    expect(passes({ PROD_CODE: 'S2' }, ['Member'])).toBe(true);
    expect(passes({ PROD_CODE: 'S2' }, [' MEMBER '])).toBe(true);
    expect(passes({ PROD_CODE: 'S2' }, ['member', 'M101'])).toBe(false);
    expect(passes({ PROD_CODE: 'M101' }, ['member', 'M101'])).toBe(true);
    expect(passes({ PROD_CODE: 'S2' }, ['Members'])).toBe(false);
  });

  it('does not treat an account number of 0 specially', () => {
    expect(passes({ PROD_CODE: 'S2', IN_ACCTNBR: '0' }, ['M'])).toBe(false);
  });
});

// preparePersonESigners writes one slot per row, so its alignment is what tells
// FileOptics which member signed where. These stub the field access and run it.
function personESigners({ rows, values = {}, selected = {}, emails = 'e1~e2~e3' }) {
  const fields = {
    FO_DATA_LINE: { value: `a#b#c#${emails}` },
    ERRORS_FOUND: { value: 0 },
  };
  const factory = new Function(
    'SIGNER_ROWS',
    'MAX_SIGNERS_ON_FORM',
    '__fields',
    '__values',
    '__selected',
    `${helperScript()}
     getSafeField = function (n) { return __fields[n] || null; };
     getSafeValue = function (n) { return __values[n] === undefined ? '' : __values[n]; };
     getSelectedText = function (n) { return __selected[n] === undefined ? '' : __selected[n]; };
     isTestEnvironment = function () { return false; };
     setFO_TAG = function () {};
     MISSING_EMAIL_SIGNERS = [];
     var __list = preparePersonESigners();
     return {
       list: __list,
       errors: Number(__fields.ERRORS_FOUND.value),
       missing: MISSING_EMAIL_SIGNERS,
       message: eSignFailureMessage(),
     };`
  );
  return factory(rows, rows.length, fields, values, selected);
}

const named = (n) => Array.from({ length: n }, () => ({ name: true, signature: true, signDate: true }));

describe('the Person eSigner list', () => {
  it('writes one slot per row, in row order', () => {
    const { list } = personESigners({
      rows: named(2),
      values: { Member1Name: '0', Member2Name: '1' },
      selected: { Member1Name: 'Ann', Member2Name: 'Bob' },
    });
    expect(list).toBe('0,1');
  });

  it('leaves an empty slot for a row with nobody picked', () => {
    const { list } = personESigners({
      rows: named(2),
      values: { Member1Name: '0' },
      selected: { Member1Name: 'Ann' },
    });
    expect(list).toBe('0,');
  });

  it('stays aligned when the row without a name dropdown is the first one', () => {
    // Appending commas made row 1 a special case, so a nameless row 1 shifted
    // every slot after it by one and the wrong member got sent for signing.
    const { list } = personESigners({
      rows: [
        { name: false, signature: true, signDate: true },
        { name: true, signature: true, signDate: true },
      ],
      values: { Member2Name: '1' },
      selected: { Member2Name: 'Bob' },
    });
    expect(list.split(',')).toHaveLength(2);
    expect(list).toBe(',1');
  });

  it('keeps the slot count equal to the row count, whatever the shapes', () => {
    for (const rows of [
      named(1),
      named(4),
      [{ name: false }, { name: true }, { name: false }],
      [{ name: true }, { name: false }, { name: true }],
    ]) {
      const { list } = personESigners({
        rows,
        values: { Member1Name: '0', Member2Name: '1', Member3Name: '2', Member4Name: '0' },
        selected: { Member1Name: 'A', Member2Name: 'B', Member3Name: 'C', Member4Name: 'D' },
      });
      expect(list.split(',')).toHaveLength(rows.length);
    }
  });

  it('flags a missing email and still keeps the slots lined up', () => {
    const { list, errors } = personESigners({
      rows: named(2),
      values: { Member1Name: '0', Member2Name: '9' },
      selected: { Member1Name: 'Ann', Member2Name: 'Bob' },
    });
    expect(errors).toBe(1);
    expect(list.split(',')).toHaveLength(2);
  });

  // The names used to be appended to eSIGN_FAILED a line at a time. They are
  // collected instead, so the one strip can join them onto one line.
  it('collects the members missing an email rather than writing them out', () => {
    const { missing, message } = personESigners({
      rows: named(3),
      values: { Member1Name: '0', Member2Name: '9', Member3Name: '8' },
      selected: { Member1Name: 'Ann', Member2Name: 'Bob', Member3Name: 'Cat' },
    });
    expect(missing).toEqual(['Bob', 'Cat']);
    expect(message).toContain('2 member(s) missing an email address: Bob, Cat');
    expect(message).not.toContain('\n');
  });

  it('says only that the submit failed when nobody is missing an email', () => {
    const { missing, message } = personESigners({
      rows: named(2),
      values: { Member1Name: '0', Member2Name: '1' },
      selected: { Member1Name: 'Ann', Member2Name: 'Bob' },
    });
    expect(missing).toEqual([]);
    expect(message).toBe('Error: Your form did not get submitted to FileOptics for eSign.');
  });
});

// validateManualSignatures is the only manual check on the Phone Auth path.
function manualSignatureErrors({ rows, selected = {}, values = {}, includeDates = true }) {
  const factory = new Function(
    'SIGNER_ROWS',
    'MAX_SIGNERS_ON_FORM',
    '__selected',
    '__values',
    '__flagged',
    '__includeDates',
    `${helperScript()}
     getSelectedText = function (n) { return __selected[n] === undefined ? '' : __selected[n]; };
     getSafeValue = function (n) { return __values[n] === undefined ? '' : __values[n]; };
     flagError = function (n) { __flagged.push(n); };
     validateManualSignatures(MAX_SIGNERS_ON_FORM, __includeDates);
     return __flagged;`
  );
  return factory(rows, rows.length, selected, values, [], includeDates);
}

describe('manual signature validation', () => {
  it('requires the signature and date of a row that has both', () => {
    expect(manualSignatureErrors({ rows: named(1) })).toEqual([
      'Member1Signature',
      'Member1SignDate',
    ]);
  });

  it('asks for nothing once they are filled', () => {
    const flagged = manualSignatureErrors({
      rows: named(1),
      values: { Member1Signature: 'Ann', Member1SignDate: '2026-09-04' },
    });
    expect(flagged).toEqual([]);
  });

  it('skips a row with a date but no signature, deliberately', () => {
    // The date is auto filled from PRIMARY_SIGN_DATE by enableSignerRows, so it
    // is not something a person types. A row with no signature field has
    // nothing manual to check, and the date goes with it. Intentional.
    const flagged = manualSignatureErrors({
      rows: [{ name: true, signature: false, signDate: true }],
    });
    expect(flagged).toEqual([]);
  });

  it('checks a row with no name dropdown, since nothing says it is unused', () => {
    const flagged = manualSignatureErrors({
      rows: [{ name: false, signature: true, signDate: false }],
    });
    expect(flagged).toEqual(['Member1Signature']);
  });

  it('leaves later rows alone until a name is picked, but never row 1', () => {
    const flagged = manualSignatureErrors({
      rows: named(3),
      selected: { Member2Name: 'Bob' },
    });
    expect(flagged).toEqual([
      'Member1Signature',
      'Member1SignDate',
      'Member2Signature',
      'Member2SignDate',
    ]);
  });

  it('drops the date check when the caller does not want it', () => {
    expect(manualSignatureErrors({ rows: named(1), includeDates: false })).toEqual([
      'Member1Signature',
    ]);
  });
});

// Phone Auth runs end to end here with its collaborators stubbed, so what it
// does and does not demand is checked rather than read.
function runPhoneAuth(rows, selected = {}, values = {}) {
  const factory = new Function(
    'SIGNER_ROWS',
    'MAX_SIGNERS_ON_FORM',
    '__flagged',
    '__selected',
    '__values',
    `${helperScript()}
     hideESignFields = function () {};
     runBaseSaveValidationOnly = function () {};
     showValidationResult = function () { return true; };
     commonSubmitTags = function () {};
     sendToFileOptics = function () {};
     getFlowId = function () { return "FO"; };
     getSafeValue = function (n) { return __values[n] === undefined ? "" : __values[n]; };
     getSelectedText = function (n) { return __selected[n] === undefined ? "" : __selected[n]; };
     flagError = function (n) { __flagged.push(n); };
     CustomBeforeSubmit = function () {};
     submitPhoneAuth();
     return __flagged;`
  );
  return factory(rows, rows.length, [], selected, values);
}

describe('Phone Auth', () => {
  it('requires row 1 to be signed and dated, whoever is picked', () => {
    // The one path where nobody signs electronically. Remote eSign and Digital
    // Signature wipe the manual signature, Print never looks at it.
    expect(runPhoneAuth(named(1))).toEqual(['Member1Signature', 'Member1SignDate']);
  });

  it('leaves a later row alone until a name is picked', () => {
    expect(runPhoneAuth(named(2))).toEqual(['Member1Signature', 'Member1SignDate']);
  });

  it('requires a later row once its name is picked', () => {
    expect(runPhoneAuth(named(2), { Member2Name: 'Bob' })).toEqual([
      'Member1Signature',
      'Member1SignDate',
      'Member2Signature',
      'Member2SignDate',
    ]);
  });

  it('asks for nothing once they are filled', () => {
    const values = { Member1Signature: 'Ann', Member1SignDate: '2026-09-04' };
    expect(runPhoneAuth(named(1), {}, values)).toEqual([]);
  });

  it('skips a row with no signature field, date included', () => {
    expect(runPhoneAuth([{ name: true, signature: false, signDate: true }])).toEqual([]);
  });
});

// PopulateJointData used to branch on one flag, filling the numbered rows or
// the combined line but never both. These run it for real.
function populateJoint({ signers, maxJointLines = 0, hasCombined = false, withNumbers = false }) {
  const fields = { JointMembers: { value: '' } };
  for (let i = 1; i <= 5; i += 1) {
    fields[`JointMember${i}Name`] = { value: '' };
    fields[`JointMember${i}Number`] = { value: '' };
  }
  const values = {};
  signers.forEach((s, i) => {
    values[`SIGNER${i + 1}_FULL_LEGAL_NAME`] = s.name;
    values[`SIGNER${i + 1}_ACCTROLE`] = s.role ?? 'JOINT';
    values[`SIGNER${i + 1}_MEMBER_NUMBER`] = s.number ?? '';
  });

  const factory = new Function(
    'MAX_DNA_SIGNERS',
    'MAX_JOINT_LINES',
    'JOINT_ROW_HAS_MEMBER_NUMBER',
    'HAS_COMBINED_JOINT',
    '__fields',
    '__values',
    `${helperScript()}
     getSafeField = function (n) { return __fields[n] || null; };
     getSafeValue = function (n) { return __values[n] === undefined ? "" : __values[n]; };
     PopulateJointData();
     return __fields;`
  );
  factory(6, maxJointLines, withNumbers, hasCombined, fields, values);
  return {
    rows: [1, 2, 3, 4, 5].map((i) => fields[`JointMember${i}Name`].value),
    numbers: [1, 2, 3, 4, 5].map((i) => fields[`JointMember${i}Number`].value),
    combined: fields.JointMembers.value,
  };
}

const THREE = [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cara' }];

describe('joint data', () => {
  it('fills numbered rows and leaves the combined line alone', () => {
    const out = populateJoint({ signers: THREE, maxJointLines: 2 });
    expect(out.rows.slice(0, 2)).toEqual(['Ann', 'Bob']);
    expect(out.combined).toBe('');
  });

  it('fills the combined line with no numbered rows', () => {
    const out = populateJoint({ signers: THREE, hasCombined: true });
    expect(out.combined).toBe('Ann, Bob, Cara');
    expect(out.rows.every((v) => v === '')).toBe(true);
  });

  it('fills both at once, which the old branch could not', () => {
    // The rows stop at MAX_JOINT_LINES, the combined line takes everyone, so a
    // form carrying both shows a detail block beside a full summary.
    const out = populateJoint({ signers: THREE, maxJointLines: 2, hasCombined: true });
    expect(out.rows.slice(0, 2)).toEqual(['Ann', 'Bob']);
    expect(out.rows[2]).toBe('');
    expect(out.combined).toBe('Ann, Bob, Cara');
  });

  it('touches nothing when the form carries neither', () => {
    const out = populateJoint({ signers: THREE });
    expect(out.rows.every((v) => v === '')).toBe(true);
    expect(out.combined).toBe('');
  });

  it('skips an ITF signer in both shapes', () => {
    const signers = [{ name: 'Ann' }, { name: 'Trust', role: 'ITF' }, { name: 'Cara' }];
    const out = populateJoint({ signers, maxJointLines: 3, hasCombined: true });
    expect(out.rows.slice(0, 2)).toEqual(['Ann', 'Cara']);
    expect(out.combined).toBe('Ann, Cara');
  });

  it('carries member numbers only when the rows have them', () => {
    const signers = [{ name: 'Ann', number: '111' }, { name: 'Bob', number: '222' }];
    expect(populateJoint({ signers, maxJointLines: 2 }).numbers.slice(0, 2)).toEqual(['', '']);
    const withNums = populateJoint({ signers, maxJointLines: 2, withNumbers: true });
    expect(withNums.numbers.slice(0, 2)).toEqual(['111', '222']);
  });
});

describe('printing', () => {
  const helpers = helperScript();
  const printOnly = helpers.slice(
    helpers.indexOf('function submitPrintOnly'),
    helpers.indexOf('function submitPrintOnly') + 1200
  );

  it('hides the print button before printing, not after', () => {
    // setFileOpticsButtonsState walks FILEOPTICS_BUTTON_FIELDS, which excludes
    // PrintButton on purpose, so nothing else hides it. Left visible it prints
    // onto the paper copy. Every form predating this code hid it first.
    const hide = printOnly.indexOf('setFieldState("PrintButton", false, true)');
    expect(hide).toBeGreaterThan(-1);
    expect(hide).toBeLessThan(printOnly.indexOf('this.print()'));
  });

  it('still hides the signing buttons too', () => {
    expect(printOnly).toContain('setFileOpticsButtonsState(false, true)');
  });

  it('locks every field before printing', () => {
    expect(printOnly.indexOf('readonly = true')).toBeLessThan(printOnly.indexOf('this.print()'));
  });
});
