// The form hooks, executed rather than matched against strings.
//
// Everything else that checks the starter code either compiles it or runs a
// single helper. This runs the whole thing the way Acrobat does: every document
// script run in name order in one shared scope, then Main() called at the
// bottom of its own script. That is the only way to prove a hook actually
// fires.
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { helperScript, mainScript } from '../src/starter/index.js';
import { buildMainScript, ownScripts, FORM_HOOKS } from '../src/starter/buildScripts.js';
import { fieldScripts } from '../src/starter/fieldScripts.js';

// Enough of Acrobat to get through Main.
//
// Each document script is run as its own program in one shared global, which is
// what Acrobat does. Concatenating them instead would hoist every declaration
// into a single scope, and which copy of a function wins would no longer depend
// on the order the scripts run in.
//
// getSafeField reaches the document as this.getField and is called as a plain
// function, so "this" is the global object at that point. In Acrobat the
// document is the global object for a document script, which is why that code
// works there, so the stub goes on the context global.
function makeDocument(values = {}) {
  const fields = {};
  const alerts = [];

  const field = (name) => {
    if (!fields[name]) {
      fields[name] = {
        name,
        value: values[name] ?? '',
        valueAsString: values[name] ?? '',
        display: 'visible',
        readonly: false,
        required: false,
        clearItems() {},
        setItems() {},
        insertItemAt() {},
      };
    }
    return fields[name];
  };

  return {
    fields,
    alerts,
    context: {
      app: { alert: (m) => alerts.push(m) },
      display: { visible: 'visible', hidden: 'hidden' },
      util: { scand: () => new Date(2026, 0, 1), printd: () => '20260101' },
      getField: field,
      numFields: 0,
      getNthFieldName: () => '',
      print() {},
      getTemplate: () => null,
    },
  };
}

// Name order, the order Acrobat runs them in.
function runDocument(scripts, tail, values) {
  const doc = makeDocument(values);
  const sandbox = vm.createContext(doc.context);
  for (const [, source] of [...scripts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    vm.runInContext(source, sandbox);
  }
  const result = tail ? vm.runInContext(tail, sandbox) : undefined;
  return { result, alerts: doc.alerts, fields: doc.fields };
}

// A form with nothing placed on it and the given hook bodies filled in, the way
// export writes them into Main. A_Setup sorts first, so anything a hook records
// into exists before Main() runs.
//
// PRIMARY_MEMBERSHIP_TYPE is P because the default config is a person
// membership, and Main returns early on a mismatch: without it the run would
// stop before reaching anything worth checking.
function generated(hooks = {}, setup = '') {
  const scripts = new Map([
    ['Helper_Functions', helperScript()],
    ['Main', buildMainScript({ hooks })],
  ]);
  if (setup) scripts.set('A_Setup', setup);
  return scripts;
}

const PERSON = { PRIMARY_MEMBERSHIP_TYPE: 'P' };

describe('the whole document, run the way Acrobat runs it', () => {
  const BOTH = {
    CustomAfterValidation: '    __ran.push("afterValidation");\n',
    CustomAfterLoad: '    __ran.push("afterLoad");\n',
  };

  it('gets all the way through Main on a form with nothing placed', () => {
    // No signer rows, no buttons, no validation fields. The smallest real form,
    // and the case nothing else covers: a form offering no signing channel at
    // all. Reaching the end is asserted through a hook rather than by not
    // throwing, because Main returns early on several paths and a test that
    // only checks for an exception would pass on every one of them.
    const { result } = runDocument(generated(BOTH, 'var __ran = [];'), '__ran', PERSON);
    expect(result).toEqual(['afterValidation', 'afterLoad']);
  });

  it('runs afterValidation before the signers are set up', () => {
    // Position, not just presence. disableAllSigners runs after the hook, so a
    // signer field touched by the hook must still be untouched at that point.
    const { result } = runDocument(
      generated(
        { CustomAfterValidation: '    __signerAtHookTime = this.getField("Member1Signature").readonly;\n' },
        'var __signerAtHookTime = null;'
      ),
      '__signerAtHookTime',
      PERSON
    );
    expect(result).toBe(false);
  });

  it('runs with only one of them filled in', () => {
    const { result } = runDocument(
      generated({ CustomAfterLoad: BOTH.CustomAfterLoad }, 'var __ran = [];'),
      '__ran',
      PERSON
    );
    expect(result).toEqual(['afterLoad']);
  });

  it('runs with every one of them empty', () => {
    // The common case. Each is called bare, so this is what the stubs are for.
    expect(() => runDocument(generated(), '1', PERSON)).not.toThrow();
  });

  it('lets a hook read what Main worked out, which is why they take no arguments', () => {
    const { result } = runDocument(
      generated(
        {
          CustomAfterLoad: [
            '    __seen = {',
            '        isPerson: IS_PERSON,',
            '        signers: SIGNER_COUNT,',
            '        joint: JOINT_POPULATED,',
            '        membership: MEMBERSHIP_TYPE',
            '    };',
            '',
          ].join('\n'),
        },
        'var __seen = null;'
      ),
      '__seen',
      PERSON
    );
    expect(result).toMatchObject({
      isPerson: true,
      membership: 'person',
    });
    expect(typeof result.signers).toBe('number');
  });

  it('reads P as a person membership and anything else as an organization', () => {
    const isPerson = (type) =>
      runDocument(generated(), 'IS_PERSON', { PRIMARY_MEMBERSHIP_TYPE: type }).result;
    expect(isPerson('P')).toBe(true);
    expect(isPerson(' p ')).toBe(true);
    expect(isPerson('B')).toBe(false);
    expect(isPerson('')).toBe(false);
  });

  it('raises no Acrobat alert on the way through', () => {
    // getSafeField alerts on a missing field, so an alert means the generated
    // code asked a bare form for something it does not have.
    const { alerts } = runDocument(generated(), '1', PERSON);
    expect(alerts).toEqual([]);
  });

  it('fires beforeSubmit on the print channel', () => {
    const { result } = runDocument(
      generated({ CustomBeforeSubmit: '    __submits.push(CURRENT_AUTH_TYPE);\n' }, 'var __submits = [];'),
      'submitPrintOnly(); __submits',
      PERSON
    );
    expect(result).toEqual(['PRINT']);
  });
});

describe('the field hooks, run the way Acrobat runs them', () => {
  // Bill Payment Trace: ticking a different reason clears what the last one
  // asked for. Acrobat sets event.target to the field whose script is running.
  const CLEARING = {
    CustomFieldMouseUp: [
      '    if (event.target.name !== "TraceReason") return;',
      '    if (this.getField("TraceReason").value !== "IncorrectAmount") {',
      '        this.getField("AmountPaid").value = "";',
      '    }',
      '',
    ].join('\n'),
  };
  const mouseUp = (name) => fieldScripts({ fieldNames: [name] }).get(name).MouseUp;
  // Read back through getField, since the stub only creates a field once asked.
  const click = (name) =>
    `var event = { target: getField(${JSON.stringify(name)}) }; ${mouseUp(name)}\ngetField("AmountPaid").value`;

  it('fires from the field\'s own Mouse Up, with event.target naming the field', () => {
    const values = { ...PERSON, TraceReason: 'IncorrectVendor', AmountPaid: '12.00' };
    const { result } = runDocument(generated(CLEARING), click('TraceReason'), values);
    expect(result).toBe('');
  });

  it('leaves the values alone for the reason that asked for them', () => {
    const values = { ...PERSON, TraceReason: 'IncorrectAmount', AmountPaid: '12.00' };
    const { result } = runDocument(generated(CLEARING), click('TraceReason'), values);
    expect(result).toBe('12.00');
  });

  it('does nothing on a form that leaves them empty', () => {
    expect(() => runDocument(generated(), click('TraceReason'), PERSON)).not.toThrow();
  });
});

describe('the scripts a form keeps', () => {
  it('names any script other than the two this tool writes', () => {
    const scripts = new Map([
      ['Helper_Functions', ''],
      ['Main', ''],
      ['Form_Custom', ''],
    ]);
    expect(ownScripts(scripts)).toEqual(['Form_Custom']);
    expect(ownScripts(new Map([['Helper_Functions', ''], ['Main', '']]))).toEqual([]);
  });
});

describe('the generated text', () => {
  // Comments name the hooks too, so they are stripped before counting.
  const code = (text) =>
    text
      .split(String.fromCharCode(10))
      .filter((l) => !l.trim().startsWith('//'))
      .join(String.fromCharCode(10));

  const main = code(mainScript());
  const helpers = code(helperScript());

  it('declares every hook in Main, since each is called bare', () => {
    for (const hook of FORM_HOOKS) {
      expect(main).toContain(`function ${hook}() {`);
    }
  });

  it('matches what export writes, so the template cannot drift from it', () => {
    const region = (text) => text.slice(text.indexOf('function CustomAfterValidation'), text.indexOf('//</CONFIG>'));
    expect(region(mainScript())).toBe(region(buildMainScript({})));
  });

  it('calls beforeSubmit on all five channels', () => {
    expect(helpers.split('CustomBeforeSubmit();').length - 1).toBe(5);
  });
});
