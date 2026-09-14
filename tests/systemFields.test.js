import { describe, it, expect } from 'vitest';
import {
  normalizeSystemFields,
  buildSystemIndex,
  isSystemField,
  isLastSystemPlacement,
  layoutSystemFields,
  ensureSystemFields,
  reconcileSystemTypes,
  canonicalSystemIds,
} from '../src/core/systemFields.js';
import { createField, fieldIssues } from '../src/core/schema.js';
import { buildDbIndex, normalizeDbFields } from '../src/core/dbFields.js';

const LIST = normalizeSystemFields([
  { identifier: 'FORM_ID', placement: 'compact' },
  { identifier: 'PRIMARY_MEMBER_NUMBER', placement: 'compact' },
  { identifier: 'DNA_REQ', placement: 'wide', multiline: true },
  { identifier: 'SIGNER1_FULL_LEGAL_NAME', placement: 'signer', column: 1 },
  { identifier: 'SIGNER1_ACCTROLE', placement: 'signer', column: 1 },
  { identifier: 'SIGNER2_FULL_LEGAL_NAME', placement: 'signer', column: 2 },
]);
const systemIndex = buildSystemIndex(LIST);
const LETTER = [0, 0, 612, 792];

describe('the system field list', () => {
  it('defaults every entry to a text field', () => {
    expect(LIST.every((f) => f.type === 'text')).toBe(true);
  });

  it('drops blanks and repeats', () => {
    const list = normalizeSystemFields([
      { identifier: 'FORM_ID' },
      { identifier: '  ' },
      { identifier: 'FORM_ID' },
    ]);
    expect(list.map((f) => f.identifier)).toEqual(['FORM_ID']);
  });

  it('recognises a system name and nothing else', () => {
    expect(isSystemField('FORM_ID', systemIndex)).toBe(true);
    expect(isSystemField('CUSTNAME', systemIndex)).toBe(false);
    expect(isSystemField('', systemIndex)).toBe(false);
  });

  it('is independent of the DB field list', () => {
    // A name can be both. The two derivations answer different questions.
    const dbIndex = buildDbIndex(
      normalizeDbFields([{ identifier: 'PRIMARY_MEMBER_NUMBER', label: 'Member Number' }])
    );
    expect(isSystemField('PRIMARY_MEMBER_NUMBER', systemIndex)).toBe(true);
    expect(dbIndex.has('PRIMARY_MEMBER_NUMBER')).toBe(true);
  });
});

describe('the last placement rule', () => {
  it('protects the only placement of a system name', () => {
    const fields = [createField({ name: 'FORM_ID' })];
    expect(isLastSystemPlacement(fields[0], fields, systemIndex)).toBe(true);
  });

  it('leaves extra placements free', () => {
    // A member number wanted on the form as well as in the code: one value,
    // several placements, and only the last one is protected.
    const fields = [
      createField({ name: 'PRIMARY_MEMBER_NUMBER' }),
      createField({ name: 'PRIMARY_MEMBER_NUMBER' }),
    ];
    expect(fields.every((f) => isLastSystemPlacement(f, fields, systemIndex))).toBe(false);
  });

  it('protects nothing that is not a system name', () => {
    const fields = [createField({ name: 'CUSTNAME' })];
    expect(isLastSystemPlacement(fields[0], fields, systemIndex)).toBe(false);
  });
});

describe('laying them out', () => {
  it('runs compact fields left to right along the top', () => {
    const rects = layoutSystemFields(LIST, LETTER);
    const a = rects.get('FORM_ID');
    const b = rects.get('PRIMARY_MEMBER_NUMBER');
    // Same row, moving right, rather than stacked down one column.
    expect(b.y).toBe(a.y);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  });

  it('wraps onto the next row when the width runs out', () => {
    const many = normalizeSystemFields(
      Array.from({ length: 24 }, (_, i) => ({ identifier: `F${i}`, placement: 'compact' }))
    );
    const rects = layoutSystemFields(many, LETTER);
    const rows = new Set([...rects.values()].map((r) => r.y));
    expect(rows.size).toBeGreaterThan(1);

    // Every row starts back at the left margin, and nothing runs off the page.
    const firstX = Math.min(...[...rects.values()].map((r) => r.x));
    for (const y of rows) {
      const row = [...rects.values()].filter((r) => r.y === y);
      expect(Math.min(...row.map((r) => r.x))).toBe(firstX);
      expect(Math.max(...row.map((r) => r.x + r.width))).toBeLessThanOrEqual(612);
    }
  });

  it('drops to one per row on a page too narrow for more', () => {
    const narrow = [0, 0, 60, 400];
    const rects = layoutSystemFields(LIST, narrow);
    for (const r of rects.values()) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(60.001);
    }
  });

  it('makes DNA_REQ cover the page, as every example form has it', () => {
    const wide = layoutSystemFields(LIST, LETTER).get('DNA_REQ');
    expect(wide.width).toBeCloseTo(612 * 0.92, 5);
    expect(wide.height).toBeGreaterThan(792 * 0.8);
    // Centred, so the margins either side match.
    expect(wide.x).toBeCloseTo((612 - wide.width) / 2, 5);
  });

  it('works against a page that is not Letter', () => {
    const a4 = [0, 0, 595.28, 841.89];
    const rects = layoutSystemFields(LIST, a4);
    expect(rects.get('DNA_REQ').width).toBeCloseTo(595.28 * 0.92, 5);
    // Everything lands inside the page.
    for (const r of rects.values()) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(595.28);
      expect(r.y + r.height).toBeLessThanOrEqual(841.89);
    }
  });

  it('respects a CropBox that does not start at the origin', () => {
    const inset = [20, 30, 632, 822];
    for (const r of layoutSystemFields(LIST, inset).values()) {
      expect(r.x).toBeGreaterThanOrEqual(20);
      expect(r.y).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('adding the missing ones', () => {
  it('places every system field on an empty form', () => {
    const fields = ensureSystemFields([], LIST, LETTER);
    expect(fields.map((f) => f.name).sort()).toEqual(
      LIST.map((f) => f.identifier).sort()
    );
  });

  it('turns wrapping on only for the long message fields', () => {
    // A one line box would clip a long error, and DNA_REQ often carries one.
    const fields = ensureSystemFields([], LIST, LETTER);
    const byName = new Map(fields.map((f) => [f.name, f]));
    expect(byName.get('DNA_REQ').multiline).toBe(true);
    expect(byName.get('FORM_ID').multiline).toBe(false);
  });

  it('leaves every one of them left aligned', () => {
    const fields = ensureSystemFields([], LIST, LETTER);
    expect(fields.every((f) => f.alignment === 'left')).toBe(true);
  });

  it('defaults them to hidden and read-only', () => {
    const fields = ensureSystemFields([], LIST, LETTER);
    expect(fields.every((f) => f.hidden)).toBe(true);
    expect(fields.every((f) => !f.editable)).toBe(true);
    expect(fields.every((f) => f.type === 'text')).toBe(true);
  });

  it('leaves an already placed one exactly where it is', () => {
    const placed = createField({
      name: 'FORM_ID',
      page: 2,
      rect: { x: 300, y: 400, width: 90, height: 12 },
      hidden: false,
      editable: true,
    });
    const fields = ensureSystemFields([placed], LIST, LETTER);
    const kept = fields.find((f) => f.name === 'FORM_ID');
    expect(kept).toBe(placed);
    expect(fields).toHaveLength(LIST.length);
  });

  it('does not add a second copy of a name already placed twice', () => {
    const twice = [
      createField({ name: 'PRIMARY_MEMBER_NUMBER' }),
      createField({ name: 'PRIMARY_MEMBER_NUMBER' }),
    ];
    const fields = ensureSystemFields(twice, LIST, LETTER);
    expect(fields.filter((f) => f.name === 'PRIMARY_MEMBER_NUMBER')).toHaveLength(2);
  });

  it('returns the same array when nothing is missing', () => {
    const full = ensureSystemFields([], LIST, LETTER);
    expect(ensureSystemFields(full, LIST, LETTER)).toBe(full);
  });

  it('keeps the fields that were already there', () => {
    const own = createField({ name: 'CUSTNAME' });
    const fields = ensureSystemFields([own], LIST, LETTER);
    expect(fields[0]).toBe(own);
    expect(fields).toHaveLength(LIST.length + 1);
  });
});

describe('signer columns', () => {
  it('gives each signer its own column', () => {
    const rects = layoutSystemFields(LIST, LETTER);
    const one = rects.get('SIGNER1_FULL_LEGAL_NAME');
    const two = rects.get('SIGNER2_FULL_LEGAL_NAME');
    expect(two.x).toBeGreaterThan(one.x + one.width);
  });

  it('stacks a signer down its own column', () => {
    const rects = layoutSystemFields(LIST, LETTER);
    const first = rects.get('SIGNER1_FULL_LEGAL_NAME');
    const second = rects.get('SIGNER1_ACCTROLE');
    expect(second.x).toBe(first.x);
    // Listed first means higher up the page, so a lower y for the next.
    expect(second.y).toBeLessThan(first.y);
  });

  it('puts them along the bottom, clear of the compact column', () => {
    const rects = layoutSystemFields(LIST, LETTER);
    const signer = rects.get('SIGNER1_FULL_LEGAL_NAME');
    const compact = rects.get('FORM_ID');
    // y counts up from the bottom, so the signers sit far below the others.
    expect(signer.y).toBeLessThan(100);
    expect(compact.y).toBeGreaterThan(700);
    expect(signer.y).toBeLessThan(compact.y);
  });

  it('splits the width evenly whatever the page', () => {
    for (const box of [LETTER, [0, 0, 595.28, 841.89], [20, 30, 632, 822]]) {
      const rects = layoutSystemFields(LIST, box);
      for (const r of rects.values()) {
        expect(r.x).toBeGreaterThanOrEqual(box[0]);
        expect(r.y).toBeGreaterThanOrEqual(box[1]);
        expect(r.x + r.width).toBeLessThanOrEqual(box[2] + 0.001);
      }
    }
  });
});

describe('which placement counts as the system one', () => {
  it('picks the first placement of a name', () => {
    const first = createField({ name: 'PRIMARY_MEMBER_NUMBER' });
    const copy = createField({ name: 'PRIMARY_MEMBER_NUMBER' });
    const ids = canonicalSystemIds([first, copy], systemIndex);
    expect(ids.has(first.id)).toBe(true);
    // The extra one is a copy put on the form, so it reads as ordinary.
    expect(ids.has(copy.id)).toBe(false);
  });

  it('ignores names that are not system fields', () => {
    const own = createField({ name: 'CUSTNAME' });
    expect(canonicalSystemIds([own], systemIndex).size).toBe(0);
  });

  it('marks one per name, not one overall', () => {
    const fields = [
      createField({ name: 'FORM_ID' }),
      createField({ name: 'DNA_REQ' }),
      createField({ name: 'DNA_REQ' }),
    ];
    expect(canonicalSystemIds(fields, systemIndex).size).toBe(2);
  });
});

describe('correcting a wrong type', () => {
  it('retypes a system field the document had as something else', () => {
    // Otherwise this is a dead end: the last placement of a system name cannot
    // be deleted or renamed, and type is fixed once drawn, so nothing could fix
    // it.
    const { fields, corrected } = reconcileSystemTypes(
      [createField({ name: 'DNA_REQ', type: 'checkbox', exportValue: 'Yes' })],
      systemIndex
    );
    expect(fields[0].type).toBe('text');
    expect(corrected).toEqual(['DNA_REQ']);
  });

  it('keeps where it was, only the type changes', () => {
    const rect = { x: 120, y: 340, width: 40, height: 16 };
    const { fields } = reconcileSystemTypes(
      [createField({ name: 'DNA_REQ', type: 'checkbox', page: 2, rect, hidden: false })],
      systemIndex
    );
    expect(fields[0].rect).toEqual(rect);
    expect(fields[0].page).toBe(2);
    expect(fields[0].hidden).toBe(false);
  });

  it('drops the export value, which means nothing on a text field', () => {
    const { fields } = reconcileSystemTypes(
      [createField({ name: 'DNA_REQ', type: 'checkbox', exportValue: 'Yes' })],
      systemIndex
    );
    expect(fields[0].exportValue).toBe('');
  });

  it('leaves fields that are not system names alone', () => {
    const own = createField({ name: 'CUSTNAME', type: 'checkbox', exportValue: 'Y' });
    const { fields, corrected } = reconcileSystemTypes([own], systemIndex);
    expect(fields[0]).toBe(own);
    expect(corrected).toEqual([]);
  });

  it('returns the same array when every type already matches', () => {
    const input = [createField({ name: 'DNA_REQ' }), createField({ name: 'CUSTNAME' })];
    expect(reconcileSystemTypes(input, systemIndex).fields).toBe(input);
  });
});

describe('type mismatches', () => {
  it('reports a system name drawn as the wrong type', () => {
    // The starter code reads these as text, so a checkbox would break it.
    const issues = fieldIssues(
      [createField({ name: 'FORM_ID', type: 'checkbox', exportValue: 'Yes' })],
      new Map(),
      systemIndex
    );
    expect(
      issues.some((i) => i.level === 'error' && i.text.includes('must be text'))
    ).toBe(true);
  });

  it('says nothing when the type matches', () => {
    const issues = fieldIssues([createField({ name: 'FORM_ID' })], new Map(), systemIndex);
    expect(issues.some((i) => i.text.includes('must be'))).toBe(false);
  });
});
