// The form hooks, executed rather than matched against strings.
//
// Everything else that checks the starter code either compiles it or runs a
// single helper. This runs the whole thing the way Acrobat does: every document
// script concatenated in name order into one shared scope, then Main() called at
// the bottom of its own script. That is the only way to prove a hook actually
// fires, and the only way to prove the ordering rule is real.
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { helperScript, mainScript } from '../src/starter/index.js';
import { buildMainScript, runsBeforeMain, lateScripts, ownScripts } from '../src/starter/buildScripts.js';

// Enough of Acrobat to get through Main.
//
// Each document script is run as its own program in one shared global, which is
// what Acrobat does. Concatenating them instead would hoist every declaration
// into a single scope and the ordering rule would be untestable: a script named
// to sort after Main would still appear to define its functions in time.
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

// Name order, the order Acrobat runs them in. Main() is called at the bottom of
// the Main script, so anything defining a hook has to have run by then.
function runDocument(scripts, tail, values) {
  const doc = makeDocument(values);
  const sandbox = vm.createContext(doc.context);
  for (const [, source] of [...scripts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    vm.runInContext(source, sandbox);
  }
  const result = tail ? vm.runInContext(tail, sandbox) : undefined;
  return { result, alerts: doc.alerts, fields: doc.fields };
}

// A form with nothing placed on it. IN_PERSNBR is set because the default
// config is a person membership, and Main returns early on a mismatch: without
// it the run would stop before reaching anything worth checking.
function generated(extra = {}) {
  const scripts = new Map([
    ['Helper_Functions', helperScript()],
    ['Main', buildMainScript({})],
  ]);
  for (const [name, src] of Object.entries(extra)) scripts.set(name, src);
  return scripts;
}

const PERSON = { IN_PERSNBR: '123456' };

describe('the whole document, run the way Acrobat runs it', () => {
  const HOOKS = `
      var __ran = [];
      function CustomAfterValidation() { __ran.push("afterValidation"); }
      function CustomAfterLoad() { __ran.push("afterLoad"); }
  `;

  it('gets all the way through Main on a form with nothing placed', () => {
    // No signer rows, no buttons, no validation fields, no hooks. The smallest
    // real form, and the case nothing else covers: a form offering no signing
    // channel at all. Reaching the end is asserted through a hook rather than
    // by not throwing, because Main returns early on several paths and a test
    // that only checks for an exception would pass on every one of them.
    const { result } = runDocument(generated({ Form_Custom: HOOKS }), '__ran', PERSON);
    expect(result).toEqual(['afterValidation', 'afterLoad']);
  });

  it('fires both Main hooks, in order, from a script sorting before Main', () => {
    const { result } = runDocument(generated({ Form_Custom: HOOKS }), '__ran', PERSON);
    expect(result).toEqual(['afterValidation', 'afterLoad']);
  });

  it('fires neither when the script sorts after Main', () => {
    // The whole point of the naming rule. Same code, later name, silently dead:
    // no error, nothing logged, the hook simply never runs.
    const { result } = runDocument(
      generated({ ZZ_Custom: HOOKS }),
      'typeof __ran === "undefined" ? "never loaded" : __ran',
      PERSON
    );
    expect(result).toEqual([]);
  });

  it('runs afterValidation before the signers are set up', () => {
    // Position, not just presence. disableAllSigners runs after the hook, so a
    // signer field touched by the hook must still be untouched at that point.
    const custom = `
      var __signerAtHookTime = null;
      function CustomAfterValidation() {
        __signerAtHookTime = this.getField("Member1Signature").readonly;
      }
    `;
    const { result } = runDocument(
      generated({ Form_Custom: custom }),
      '__signerAtHookTime',
      PERSON
    );
    expect(result).toBe(false);
  });

  it('does not mind a form defining only one of them', () => {
    const custom = `
      var __ran = [];
      function CustomAfterLoad() { __ran.push("afterLoad"); }
    `;
    const { result } = runDocument(generated({ Form_Custom: custom }), '__ran', PERSON);
    expect(result).toEqual(['afterLoad']);
  });

  it('does not mind a hook name that is not a function', () => {
    const custom = 'var CustomAfterLoad = "not a function";';
    expect(() => runDocument(generated({ Form_Custom: custom }), '1', PERSON)).not.toThrow();
  });

  it('does not mind a form declaring no hooks at all', () => {
    // The common case. A bare reference to an undeclared name is a
    // ReferenceError, so this is what the typeof guards are for.
    expect(() => runDocument(generated(), '1', PERSON)).not.toThrow();
  });

  it('lets a hook read what Main worked out, which is why they take no arguments', () => {
    const custom = `
      var __seen = null;
      function CustomAfterLoad() {
        __seen = {
          isPerson: IS_PERSON,
          personNumber: PERSON_NUMBER,
          signers: SIGNER_COUNT,
          joint: JOINT_POPULATED,
          membership: MEMBERSHIP_TYPE
        };
      }
    `;
    const { result } = runDocument(generated({ Form_Custom: custom }), '__seen', PERSON);
    expect(result).toMatchObject({
      isPerson: true,
      personNumber: '123456',
      membership: 'person',
    });
    expect(typeof result.signers).toBe('number');
  });

  it('raises no Acrobat alert on the way through', () => {
    // getSafeField alerts on a missing field, so an alert means the generated
    // code asked a bare form for something it does not have.
    const { alerts } = runDocument(generated(), '1', PERSON);
    expect(alerts).toEqual([]);
  });

  it('fires beforeSubmit on the print channel', () => {
    const custom = `
      var __submits = [];
      function CustomBeforeSubmit() { __submits.push(CURRENT_AUTH_TYPE); }
    `;
    const { result } = runDocument(
      generated({ Form_Custom: custom }),
      'submitPrintOnly(); __submits',
      PERSON
    );
    expect(result).toEqual(['PRINT']);
  });
});

describe('the naming rule', () => {
  it('is a plain comparison against the name Main', () => {
    expect(runsBeforeMain('Form_Custom')).toBe(true);
    expect(runsBeforeMain('Helper_Functions')).toBe(true);
    expect(runsBeforeMain('Custom')).toBe(true);
    expect(runsBeforeMain('ZZ_Custom')).toBe(false);
    expect(runsBeforeMain('Zebra')).toBe(false);
    // Main itself is not before Main.
    expect(runsBeforeMain('Main')).toBe(false);
  });

  it('reports a script that loads too late, and stays quiet about ones that do not', () => {
    const scripts = new Map([
      ['Helper_Functions', ''],
      ['Main', ''],
      ['Form_Custom', ''],
      ['ZZ_Custom', ''],
    ]);
    expect(lateScripts(scripts)).toEqual(['ZZ_Custom']);
    expect(ownScripts(scripts)).toEqual(['Form_Custom', 'ZZ_Custom']);
  });

  it('never calls the two scripts this tool writes late or its own', () => {
    const scripts = new Map([['Helper_Functions', ''], ['Main', '']]);
    expect(lateScripts(scripts)).toEqual([]);
    expect(ownScripts(scripts)).toEqual([]);
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

  it('guards every hook call with typeof', () => {
    // A bare reference to a name nothing declared is a ReferenceError, so an
    // unguarded call would break every form that defines no hooks, which is
    // most of them.
    for (const hook of ['CustomAfterValidation', 'CustomAfterLoad', 'CustomBeforeSubmit']) {
      const text = hook === 'CustomBeforeSubmit' ? helpers : main;
      const calls = text.split(hook + '();').length - 1;
      const guards = text.split('typeof ' + hook + ' === "function"').length - 1;
      expect(calls).toBeGreaterThan(0);
      expect(guards).toBe(calls);
    }
  });

  it('calls beforeSubmit on all four channels', () => {
    expect(helpers.split('CustomBeforeSubmit();').length - 1).toBe(4);
  });

});
