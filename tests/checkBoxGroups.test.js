// Dotted check boxes as groups: what counts as one, and how Save Validation
// moves across one.
import { describe, it, expect } from 'vitest';
import {
  checkBoxParent,
  checkBoxGroups,
  spreadGroupSave,
  adoptGroupSave,
} from '../src/core/checkBoxGroups.js';
import { createField } from '../src/core/schema.js';
import { fieldListOrder } from '../src/components/FieldList.jsx';

const box = (name, extra) => createField({ name, type: 'checkbox', ...extra });

describe('what makes a group', () => {
  it('takes the part before the last dot of a check box name', () => {
    expect(checkBoxParent(box('Trace Reason.A'))).toBe('Trace Reason');
    expect(checkBoxParent(box('a.b.c'))).toBe('a.b');
    expect(checkBoxParent(box('Undotted'))).toBe(null);
    expect(checkBoxParent(box('.A'))).toBe(null);
    expect(checkBoxParent(box('Reason.'))).toBe(null);
    expect(checkBoxParent(createField({ name: 'Addr.Line1' }))).toBe(null);
  });

  it('needs two names, however many placements', () => {
    const groups = checkBoxGroups([
      box('R.A'),
      box('R.A', { page: 1 }),
      box('Alone.A'),
      box('R.B'),
    ]);
    expect([...groups]).toEqual([['R', ['R.A', 'R.B']]]);
  });
});

describe('Save Validation across a group', () => {
  const fields = [
    box('R.A'),
    box('R.B', { customSaveValidated: true, note: 'x' }),
    box('Alone.A'),
    box('Other'),
  ];

  it('goes to every box when set on one, clearing Custom', () => {
    const out = spreadGroupSave(fields, new Set(['R.A']), { saveValidated: true });
    expect(out.map((f) => [f.name, f.saveValidated, f.customSaveValidated])).toEqual([
      ['R.A', true, false],
      ['R.B', true, false],
      ['Alone.A', false, false],
      ['Other', false, false],
    ]);
  });

  it('comes off every box when cleared on one', () => {
    const on = fields.map((f) => (f.name.startsWith('R.') ? { ...f, saveValidated: true } : f));
    const out = spreadGroupSave(on, new Set(['R.B']), { saveValidated: false });
    expect(out.filter((f) => f.saveValidated)).toEqual([]);
  });

  it('leaves everything alone for any other change, or outside a group', () => {
    expect(spreadGroupSave(fields, new Set(['R.A']), { note: 'y' })).toBe(fields);
    expect(spreadGroupSave(fields, new Set(['Alone.A']), { saveValidated: true })).toBe(fields);
  });

  it('is taken by a box named into the group', () => {
    const group = [box('R.A', { saveValidated: true }), box('R.B', { saveValidated: true })];
    const joined = adoptGroupSave(box('R.C'), group);
    expect(joined.saveValidated).toBe(true);
    expect(adoptGroupSave(box('Q.C'), group).saveValidated).toBe(false);
  });
});

describe('the field list', () => {
  it('walks a group together, where its first box sits', () => {
    const fields = [box('R.A'), createField({ name: 'MID' }), box('R.B'), box('Alone.A')];
    const ids = fields.map((f) => f.id);
    expect(fieldListOrder(fields)).toEqual([ids[0], ids[2], ids[1], ids[3]]);
  });
});
