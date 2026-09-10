// The generated field scripts. The signer dropdown one is taken from a form the
// business confirmed is correct, so these pin its shape.
import { describe, it, expect } from 'vitest';
import {
  clearRequiredOnBlur,
  signerNameOnBlur,
  esignCodeKeystroke,
  fieldScripts,
} from '../src/starter/fieldScripts.js';

const compiles = (src) => {
  new Function(src);
  return true;
};

const full = { name: true, signature: true, signDate: true };

describe('the generic OnBlur', () => {
  it('clears required once the field has a value', () => {
    const src = clearRequiredOnBlur('CUSTNAME');
    expect(src).toContain('this.getField("CUSTNAME").required = false');
    expect(src).toContain('!== "Off"');
    expect(compiles(src)).toBe(true);
  });

  it('quotes a name with a space or a quote in it', () => {
    expect(compiles(clearRequiredOnBlur('Check Box6'))).toBe(true);
    expect(compiles(clearRequiredOnBlur('od"d'))).toBe(true);
  });
});

describe('the signer dropdown OnBlur', () => {
  it('reveals the row when a name is picked and hides it when cleared', () => {
    const src = signerNameOnBlur(1, full);
    expect(src).toContain('getSelectedText("Member1Name") !== ""');
    expect(src).toContain('this.getField("Member1Signature").display = display.visible');
    expect(src).toContain('this.getField("Member1SignDate").display = display.visible');
    expect(src).toContain('this.getField("Member1Signature").display = display.hidden');
    expect(src).toContain('this.getField("Member1Signature").required = false');
    expect(compiles(src)).toBe(true);
  });

  it('writes only the parts the row carries', () => {
    // The row shape is known when this runs, so nothing checks a flag later.
    const src = signerNameOnBlur(2, { name: true, signature: true, signDate: false });
    expect(src).toContain('Member2Signature');
    expect(src).not.toContain('SignDate');
    expect(src).not.toContain('SIGNER_ROW_HAS');
    expect(compiles(src)).toBe(true);
  });

  it('drops the else when there is nothing to reveal', () => {
    const src = signerNameOnBlur(1, { name: true, signature: false, signDate: false });
    expect(src).toContain('required = false');
    expect(src).not.toContain('else');
    expect(compiles(src)).toBe(true);
  });

  it('writes nothing for a row with no dropdown', () => {
    expect(signerNameOnBlur(1, { name: false, signature: true, signDate: true })).toBeNull();
  });

  it('numbers each row to its own fields', () => {
    const src = signerNameOnBlur(3, full);
    expect(src).toContain('Member3Signature');
    expect(src).not.toMatch(/Member[124]/);
  });

  it('stays in the Acrobat dialect', () => {
    const src = signerNameOnBlur(1, full);
    expect(src).not.toMatch(/\b(let|const)\s/);
    expect(src).not.toMatch(/=>/);
  });
});

describe('the whole set for a form', () => {
  it('gives the dropdown its own script, not the generic one', () => {
    const set = fieldScripts({
      fieldNames: ['CUSTNAME', 'Member1Name'],
      signerRows: [full],
    });
    expect(set.get('CUSTNAME').OnBlur).toContain('!== "Off"');
    expect(set.get('Member1Name').OnBlur).toContain('getSelectedText');
    // This is what the old load time pass got wrong, flattening the dropdown
    // back to the generic line whenever it ran again.
    expect(set.get('Member1Name').OnBlur).not.toContain('!== "Off"');
  });

  it('covers every row on the form', () => {
    const set = fieldScripts({ signerRows: [full, full] });
    expect([...set.keys()]).toEqual(['Member1Name', 'Member2Name']);
  });

  it('is empty for a form with nothing on it', () => {
    expect(fieldScripts().size).toBe(0);
  });
});

describe('the eSign code keystroke', () => {
  it('is the script both example forms carry, verbatim', () => {
    expect(esignCodeKeystroke()).toBe(
      [
        'event.change = event.change.toLowerCase();',
        'event.rc = /^[A-Za-z0-9]*$/.test(event.change);',
      ].join('\n')
    );
    expect(compiles(esignCodeKeystroke())).toBe(true);
  });

  it('lets an empty change through, so a character can be deleted', () => {
    // event.change is empty on a backspace and on the willCommit firing. A plus
    // instead of a star here would make the field impossible to edit.
    const test = (change) => {
      const event = { change };
      new Function('event', esignCodeKeystroke())(event);
      return { change: event.change, rc: event.rc };
    };

    expect(test('')).toEqual({ change: '', rc: true });
    expect(test('A')).toEqual({ change: 'a', rc: true });
    expect(test('7')).toEqual({ change: '7', rc: true });
    expect(test('-')).toEqual({ change: '-', rc: false });
    // A paste arrives whole, so one bad character rejects all of it.
    expect(test('AB3')).toEqual({ change: 'ab3', rc: true });
    expect(test('AB 3')).toEqual({ change: 'ab 3', rc: false });
  });

  it('rides alongside the OnBlur the field already gets', () => {
    const set = fieldScripts({ fieldNames: ['CUSTNAME', 'eSign_Code'] });
    expect(set.get('eSign_Code').Keystroke).toBe(esignCodeKeystroke());
    expect(set.get('eSign_Code').OnBlur).toContain('required = false');
    // It is the only field that gets one.
    expect(set.get('CUSTNAME').Keystroke).toBeUndefined();
  });

  it('is not invented for a form without the eSign pair', () => {
    const set = fieldScripts({ fieldNames: ['CUSTNAME'] });
    expect([...set.values()].some((s) => s.Keystroke)).toBe(false);
  });
});
