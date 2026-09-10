// What a built form says about its own validation, read and reported.
//
// Reported, never applied. Filling the requirements in from the form they are
// meant to specify would leave a tester ticking Pass against inherited values.
import { describe, it, expect } from 'vitest';
import { declaredValidation, declaredValidationNotes } from '../src/core/declaredValidation.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';

const scripts = (main, helpers = '') =>
  new Map([
    ['Main', main],
    ['Helper_Functions', helpers],
  ]);

const dbWith = (...names) =>
  buildDbIndex(normalizeDbFields(names.map((identifier) => ({ identifier, label: identifier }))));

const LOAD = `var LOAD_VALIDATION_FIELDS = [
    ["ACCOUNT_NUMBER", "Account Number"],
    ["PRIMARY_SIGN_DATE", "Date"]
];`;

describe('reading what the form declares', () => {
  it('takes the name and the label from each pair', () => {
    expect(declaredValidation(scripts(LOAD)).load).toEqual([
      { name: 'ACCOUNT_NUMBER', label: 'Account Number' },
      { name: 'PRIMARY_SIGN_DATE', label: 'Date' },
    ]);
  });

  it('reads the save list, which is bare names', () => {
    const main = 'var SAVE_VALIDATION_FIELDS = ["txtAcct1", "Member1Name"];';
    expect(declaredValidation(scripts(main)).save).toEqual(['txtAcct1', 'Member1Name']);
  });

  it('reads the whole array, not just the first pair', () => {
    // Counting brackets rather than matching to the first close, which would
    // stop inside the first entry and take one name.
    const { load } = declaredValidation(scripts(LOAD));
    expect(load).toHaveLength(2);
  });

  it('survives a trailing comma, which two real forms have', () => {
    const main = 'var LOAD_VALIDATION_FIELDS = [["A", "Ay"], ["B", "Bee"], ];';
    expect(declaredValidation(scripts(main)).load.map((f) => f.name)).toEqual(['A', 'B']);
  });

  it('ignores a commented out entry rather than reading it as live', () => {
    const main = `var LOAD_VALIDATION_FIELDS = [
      ["A", "Ay"],
      // ["GONE", "Removed"],
      ["B", "Bee"]
    ];`;
    expect(declaredValidation(scripts(main)).load.map((f) => f.name)).toEqual(['A', 'B']);
  });

  it('takes a name with no label', () => {
    const main = 'var LOAD_VALIDATION_FIELDS = [["A"]];';
    expect(declaredValidation(scripts(main)).load).toEqual([{ name: 'A', label: '' }]);
  });

  it('finds nothing in a form that declares nothing', () => {
    expect(declaredValidation(scripts('function Main() {}'))).toEqual({ load: [], save: [] });
    expect(declaredValidation()).toEqual({ load: [], save: [] });
  });

  it('looks only in the scripts this tool owns', () => {
    const elsewhere = new Map([['SomeoneElse', LOAD]]);
    expect(declaredValidation(elsewhere).load).toEqual([]);
  });

  it('reads nothing rather than running anything', () => {
    // Not a literal array, so there is nothing to take. It is never executed.
    const main = 'var LOAD_VALIDATION_FIELDS = buildTheList();';
    expect(declaredValidation(scripts(main)).load).toEqual([]);
  });
});

describe('what it says', () => {
  it('names the fields and says nothing was applied', () => {
    const [first] = declaredValidationNotes(declaredValidation(scripts(LOAD)), dbWith('ACCOUNT_NUMBER', 'PRIMARY_SIGN_DATE'));
    expect(first).toContain('ACCOUNT_NUMBER (Account Number)');
    expect(first).toContain('nothing was applied');
  });

  it('names the ones missing from the DB list when only some are', () => {
    const notes = declaredValidationNotes(declaredValidation(scripts(LOAD)), dbWith('ACCOUNT_NUMBER'));
    const missing = notes.find((n) => n.includes('not in the DB field list'));
    expect(missing).toContain('PRIMARY_SIGN_DATE');
    expect(missing).not.toContain('ACCOUNT_NUMBER');
  });

  it('says it once when none of them are, rather than listing every name', () => {
    // With a placeholder field list that is every form, and naming five fields
    // on every import is noise nobody reads.
    const notes = declaredValidationNotes(declaredValidation(scripts(LOAD)), dbWith('SOMETHING_ELSE'));
    const missing = notes.filter((n) => n.includes('DB field list'));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('None of those names');
    expect(missing[0]).not.toContain('ACCOUNT_NUMBER');
  });

  it('says nothing about the DB list when they are all in it', () => {
    const notes = declaredValidationNotes(
      declaredValidation(scripts(LOAD)),
      dbWith('ACCOUNT_NUMBER', 'PRIMARY_SIGN_DATE')
    );
    expect(notes.some((n) => n.includes('DB field list'))).toBe(false);
  });

  it('does not check the save list against the DB list', () => {
    // Save Validation stands on any field, so there is nothing to check.
    const main = 'var SAVE_VALIDATION_FIELDS = ["NOT_IN_ANY_LIST"];';
    const notes = declaredValidationNotes(declaredValidation(scripts(main)), dbWith('OTHER'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Save Validated');
    expect(notes.some((n) => n.includes('DB field list'))).toBe(false);
  });

  it('says nothing at all for a form that declares nothing', () => {
    expect(declaredValidationNotes({ load: [], save: [] }, dbWith('A'))).toEqual([]);
  });
});
