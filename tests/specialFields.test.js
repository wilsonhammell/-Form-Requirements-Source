// Special fields: signer rows, joint rows and the combined joint line.
//
// The point of this module is that illegal states are unreachable, so most of
// these check what the picker will not offer rather than what it reports.
import { describe, it, expect } from 'vitest';
import {
  parseSpecialName,
  isSpecialField,
  specialFieldType,
  reconcileSpecialTypes,
  deriveSignerRows,
  deriveJointRows,
  hasCombinedJoint,
  availableSpecialNames,
  removeSpecialField,
  addSignerRow,
  addSpecialField,
  signerRowRects,
  jointRowRects,
  combinedJointRect,
  specialFieldIssues,
  isEsignField,
  esignClusterRects,
  addEsignFields,
  completeEsignPair,
  removeEsignFields,
  moveEsignCluster,
  ESIGN_ANCHOR,
  MAX_SIGNER_ROWS,
  MAX_JOINT_ROWS,
  COMBINED_JOINT_NAME,
} from '../src/core/specialFields.js';
import { createField } from '../src/core/schema.js';
import { signingButtons, buttonSlotRect } from '../src/core/signingButtons.js';

// The row height the layout uses, for asserting a row stays on the page.
const LAYOUT_HEIGHT = 18;

const LETTER = [0, 0, 612, 792];
const place = (...names) => names.map((name) => createField({ name, type: specialFieldType(name) ?? 'text' }));
const offered = (fields) => availableSpecialNames(fields).map((o) => o.name);

describe('reading a name', () => {
  it('picks apart a signer field', () => {
    expect(parseSpecialName('Member2Signature')).toEqual({
      family: 'signer',
      index: 2,
      part: 'signature',
      type: 'text',
    });
  });

  it('knows the signer name is a dropdown and the rest are text', () => {
    expect(specialFieldType('Member1Name')).toBe('dropdown');
    expect(specialFieldType('Member1Signature')).toBe('text');
    expect(specialFieldType('Member1SignDate')).toBe('text');
  });

  it('keeps the joint family apart from the signer one', () => {
    // JointMember1Name starts with Joint, so it must not read as a signer row.
    expect(parseSpecialName('JointMember1Name').family).toBe('joint');
    expect(parseSpecialName('JointMember1Name').type).toBe('text');
    expect(parseSpecialName(COMBINED_JOINT_NAME).family).toBe('combinedJoint');
  });

  it('says no to anything else', () => {
    for (const name of ['CUSTNAME', 'Member', 'MemberName', 'Member1', 'Member1Email', 'Members', '']) {
      expect(isSpecialField(name)).toBe(false);
    }
  });

  it('corrects a wrong type from an imported PDF', () => {
    const wrong = [createField({ name: 'Member1Name', type: 'text' })];
    expect(reconcileSpecialTypes(wrong)[0].type).toBe('dropdown');
  });
});

describe('deriving rows from what is placed', () => {
  it('reads a row shape off the fields', () => {
    expect(deriveSignerRows(place('Member1Name', 'Member1Signature'))).toEqual([
      { name: true, signature: true, signDate: false },
    ]);
  });

  it('supports rows of different shapes on one form', () => {
    const rows = deriveSignerRows(
      place('Member1Name', 'Member1Signature', 'Member1SignDate', 'Member2Name')
    );
    expect(rows).toEqual([
      { name: true, signature: true, signDate: true },
      { name: true, signature: false, signDate: false },
    ]);
  });

  it('counts a name placed twice as one field', () => {
    const twice = [...place('Member1Name'), ...place('Member1Name')];
    expect(deriveSignerRows(twice)).toHaveLength(1);
  });

  it('is empty for a form with none', () => {
    expect(deriveSignerRows(place('CUSTNAME'))).toEqual([]);
    expect(deriveJointRows([])).toEqual([]);
    expect(hasCombinedJoint([])).toBe(false);
  });

  it('tracks the two joint shapes independently, including both at once', () => {
    const rows = (f) => deriveJointRows(f).length;
    expect(rows(place('JointMember1Name'))).toBe(1);
    expect(hasCombinedJoint(place('JointMember1Name'))).toBe(false);
    expect(rows(place(COMBINED_JOINT_NAME))).toBe(0);
    expect(hasCombinedJoint(place(COMBINED_JOINT_NAME))).toBe(true);
    const both = place('JointMember1Name', COMBINED_JOINT_NAME);
    expect(rows(both)).toBe(1);
    expect(hasCombinedJoint(both)).toBe(true);
  });
});

describe('what may be placed next', () => {
  it('offers the first signer row and both joint shapes on an empty form', () => {
    const names = offered([]);
    expect(names).toContain('Member1Name');
    expect(names).toContain('Member1Signature');
    expect(names).toContain('JointMember1Name');
    expect(names).toContain(COMBINED_JOINT_NAME);
  });

  it('never offers a row that would leave a gap', () => {
    const names = offered(place('Member1Name'));
    expect(names).toContain('Member2Name');
    expect(names).not.toContain('Member3Name');
  });

  it('offers the parts a row is still missing', () => {
    const names = offered(place('Member1Name'));
    expect(names).toContain('Member1Signature');
    expect(names).toContain('Member1SignDate');
    expect(names).not.toContain('Member1Name');
  });

  it('stops offering rows at the cap', () => {
    const full = place(...Array.from({ length: MAX_SIGNER_ROWS }, (_, i) => `Member${i + 1}Name`));
    expect(offered(full)).not.toContain(`Member${MAX_SIGNER_ROWS + 1}Name`);
    expect(offered(full)).toContain(`Member${MAX_SIGNER_ROWS}Signature`);
  });

  it('still offers the combined line alongside numbered rows', () => {
    // Not alternatives. PopulateJointData fills each on its own, so a summary
    // line beside a detail block is a shape a form may want.
    expect(offered(place('JointMember1Name'))).toContain(COMBINED_JOINT_NAME);
  });

  it('still offers numbered rows alongside the combined line', () => {
    expect(offered(place(COMBINED_JOINT_NAME))).toContain('JointMember1Name');
  });

  it('offers the combined line only while it is not placed', () => {
    expect(offered(place(COMBINED_JOINT_NAME))).not.toContain(COMBINED_JOINT_NAME);
  });

  it('offers a joint number only once its row has a name', () => {
    expect(offered([])).not.toContain('JointMember1Number');
    expect(offered(place('JointMember1Name'))).toContain('JointMember1Number');
  });

  it('caps joint rows one below signer rows', () => {
    expect(MAX_JOINT_ROWS).toBe(MAX_SIGNER_ROWS - 1);
    const full = place(...Array.from({ length: MAX_JOINT_ROWS }, (_, i) => `JointMember${i + 1}Name`));
    expect(offered(full)).not.toContain(`JointMember${MAX_JOINT_ROWS + 1}Name`);
  });

  it('carries a readable label for each', () => {
    const found = availableSpecialNames([]).find((o) => o.name === 'Member1SignDate');
    expect(found.label).toBe('Signer 1 Sign date');
    expect(found.type).toBe('text');
  });
});

describe('removing one', () => {
  it('leaves the row alone while it still has a part', () => {
    const fields = place('Member1Name', 'Member1Signature');
    const { fields: left, renumbered } = removeSpecialField(fields, fields[1].id);
    expect(deriveSignerRows(left)).toEqual([{ name: true, signature: false, signDate: false }]);
    expect(renumbered).toEqual([]);
  });

  it('closes the gap when a middle row empties, and says what moved', () => {
    const fields = place('Member1Name', 'Member2Name', 'Member3Signature');
    const { fields: left, renumbered } = removeSpecialField(fields, fields[1].id);
    expect(left.map((f) => f.name)).toEqual(['Member1Name', 'Member2Signature']);
    expect(renumbered).toEqual([{ from: 'Member3Signature', to: 'Member2Signature' }]);
    expect(deriveSignerRows(left)).toEqual([
      { name: true, signature: false, signDate: false },
      { name: false, signature: true, signDate: false },
    ]);
  });

  it('keeps positions, only names move up', () => {
    const fields = place('Member1Name', 'Member2Name');
    fields[1].rect = { x: 111, y: 222, width: 90, height: 18 };
    const { fields: left } = removeSpecialField(fields, fields[0].id);
    expect(left[0].name).toBe('Member1Name');
    expect(left[0].rect).toEqual({ x: 111, y: 222, width: 90, height: 18 });
  });

  it('renumbers joint rows the same way', () => {
    const fields = place('JointMember1Name', 'JointMember2Name');
    const { fields: left } = removeSpecialField(fields, fields[0].id);
    expect(left.map((f) => f.name)).toEqual(['JointMember1Name']);
  });

  it('does not touch the other family', () => {
    const fields = place('Member1Name', 'Member2Name', 'JointMember1Name');
    const { fields: left } = removeSpecialField(fields, fields[0].id);
    expect(left.map((f) => f.name)).toEqual(['Member1Name', 'JointMember1Name']);
  });

  it('leaves an ordinary field alone', () => {
    const fields = place('CUSTNAME', 'Member1Name');
    const { fields: left, renumbered } = removeSpecialField(fields, fields[0].id);
    expect(left.map((f) => f.name)).toEqual(['Member1Name']);
    expect(renumbered).toEqual([]);
  });

  it('never produces a gap, however the rows are taken apart', () => {
    let fields = place(
      'Member1Name', 'Member2Name', 'Member3Name', 'Member4Name', 'Member5Name'
    );
    while (fields.length > 0) {
      fields = removeSpecialField(fields, fields[Math.floor(fields.length / 2)].id).fields;
      expect(specialFieldIssues(fields)).toEqual([]);
    }
  });
});

describe('adding a whole row', () => {
  it('places all three parts, correctly typed', () => {
    const fields = addSignerRow([], LETTER);
    expect(fields.map((f) => f.name)).toEqual(['Member1Name', 'Member1Signature', 'Member1SignDate']);
    expect(fields.map((f) => f.type)).toEqual(['dropdown', 'text', 'text']);
  });

  it('appends the next row and never a duplicate', () => {
    let fields = addSignerRow([], LETTER);
    fields = addSignerRow(fields, LETTER);
    expect(deriveSignerRows(fields)).toHaveLength(2);
    expect(new Set(fields.map((f) => f.name)).size).toBe(6);
  });

  it('stops at the cap and returns the same array', () => {
    let fields = [];
    for (let i = 0; i < MAX_SIGNER_ROWS; i += 1) fields = addSignerRow(fields, LETTER);
    expect(addSignerRow(fields, LETTER)).toBe(fields);
  });

  it('lays a row out left to right, on the page', () => {
    for (const box of [LETTER, [0, 0, 595.28, 841.89], [20, 30, 632, 822]]) {
      for (let i = 1; i <= MAX_SIGNER_ROWS; i += 1) {
        const rects = signerRowRects(i, box);
        expect(rects.map((r) => r.rect.x)).toEqual([...rects.map((r) => r.rect.x)].sort((a, b) => a - b));
        for (const { rect } of rects) {
          expect(rect.x).toBeGreaterThanOrEqual(box[0]);
          expect(rect.y).toBeGreaterThanOrEqual(box[1]);
          expect(rect.x + rect.width).toBeLessThanOrEqual(box[2] + 0.001);
          expect(rect.width).toBeGreaterThan(0);
        }
      }
    }
  });

  it('stacks rows down the page without overlapping', () => {
    const ys = [1, 2, 3, 4].map((i) => signerRowRects(i, LETTER)[0].rect.y);
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1] - ys[2]).toBeGreaterThan(18);
  });
});

describe('what an imported PDF can still be wrong about', () => {
  it('reports a gap this tool would never create', () => {
    expect(specialFieldIssues(place('Member1Name', 'Member3Name'))).toEqual([
      'Signer row 2 is missing, so later rows are unreachable.',
    ]);
  });

  it('says nothing about both joint shapes together, which is allowed', () => {
    expect(specialFieldIssues(place(COMBINED_JOINT_NAME, 'JointMember1Name'))).toEqual([]);
  });

  it('is quiet on anything this tool built', () => {
    let fields = addSignerRow([], LETTER);
    fields = addSignerRow(fields, LETTER);
    expect(specialFieldIssues([...fields, ...place('JointMember1Name')])).toEqual([]);
  });
});

describe('placing one field from the panel', () => {
  it('puts back a part deleted from a row', () => {
    let fields = addSignerRow([], LETTER);
    const sig = fields.find((f) => f.name === 'Member1Signature');
    fields = removeSpecialField(fields, sig.id).fields;
    expect(deriveSignerRows(fields)).toEqual([{ name: true, signature: false, signDate: true }]);

    fields = addSpecialField(fields, 'Member1Signature', LETTER);
    expect(deriveSignerRows(fields)).toEqual([{ name: true, signature: true, signDate: true }]);
  });

  it('puts it back where the row lays it out', () => {
    let fields = addSignerRow([], LETTER);
    const original = fields.find((f) => f.name === 'Member1Signature').rect;
    fields = removeSpecialField(fields, fields[1].id).fields;
    fields = addSpecialField(fields, 'Member1Signature', LETTER);
    expect(fields.at(-1).rect).toEqual(original);
  });

  it('starts either joint shape, and both together', () => {
    const rowsOnly = addSpecialField([], 'JointMember1Name', LETTER);
    expect(deriveJointRows(rowsOnly)).toHaveLength(1);
    expect(hasCombinedJoint(rowsOnly)).toBe(false);

    const combinedOnly = addSpecialField([], COMBINED_JOINT_NAME, LETTER);
    expect(deriveJointRows(combinedOnly)).toEqual([]);
    expect(hasCombinedJoint(combinedOnly)).toBe(true);

    const both = addSpecialField(rowsOnly, COMBINED_JOINT_NAME, LETTER);
    expect(deriveJointRows(both)).toHaveLength(1);
    expect(hasCombinedJoint(both)).toBe(true);
  });

  it('refuses anything the picker would not have offered', () => {
    // One rule, in one place. A gap cannot be made this way either.
    const empty = [];
    expect(addSpecialField(empty, 'Member2Name', LETTER)).toBe(empty);
    expect(addSpecialField(empty, 'JointMember1Number', LETTER)).toBe(empty);
    expect(addSpecialField(empty, 'CUSTNAME', LETTER)).toBe(empty);

    // The one thing still refused is a second copy of the combined line.
    const combined = addSpecialField([], COMBINED_JOINT_NAME, LETTER);
    expect(addSpecialField(combined, COMBINED_JOINT_NAME, LETTER)).toBe(combined);
  });

  it('types the field from its name', () => {
    const fields = addSpecialField([], 'Member1Name', LETTER);
    expect(fields[0].type).toBe('dropdown');
    expect(addSpecialField([], 'JointMember1Name', LETTER)[0].type).toBe('text');
  });

  it('lays joint rows and the combined line out on the page', () => {
    for (const box of [LETTER, [0, 0, 595.28, 841.89], [20, 30, 632, 822]]) {
      const wide = combinedJointRect(box);
      expect(wide.x).toBeGreaterThanOrEqual(box[0]);
      expect(wide.x + wide.width).toBeLessThanOrEqual(box[2] + 0.001);
      expect(wide.y + LAYOUT_HEIGHT).toBeLessThanOrEqual(box[3] + 0.001);
      for (let i = 1; i <= MAX_JOINT_ROWS; i += 1) {
        for (const { rect } of jointRowRects(i, box)) {
          expect(rect.x).toBeGreaterThanOrEqual(box[0]);
          expect(rect.y).toBeGreaterThanOrEqual(box[1]);
          expect(rect.x + rect.width).toBeLessThanOrEqual(box[2] + 0.001);
          // Top anchored now, so running off that edge is the new way to be wrong.
          expect(rect.y + rect.height).toBeLessThanOrEqual(box[3] + 0.001);
        }
      }
    }
  });

  it('keeps joint rows clear of the signer block', () => {
    const jointY = jointRowRects(MAX_JOINT_ROWS, LETTER)[0].rect.y;
    const signerY = signerRowRects(1, LETTER)[0].rect.y;
    expect(jointY).toBeGreaterThan(signerY);
  });

  it('puts the joint block at the top, under the signing buttons', () => {
    const buttons = signingButtons();
    const buttonY = buttonSlotRect(buttons[0], buttons, LETTER).y;
    const first = jointRowRects(1, LETTER)[0].rect;
    // Below the button row, not overlapping it.
    expect(first.y + first.height).toBeLessThanOrEqual(buttonY);
    // And in the top half, which is the whole point of the move.
    expect(first.y).toBeGreaterThan((LETTER[3] - LETTER[1]) / 2);
    expect(combinedJointRect(LETTER).y).toBe(first.y);
  });
});

describe('the Remote eSign cluster', () => {
  const BUTTON = { x: 322.87, y: 771.22, width: 80, height: 18 };

  it('reads its two names', () => {
    expect(isEsignField('eSignLBL')).toBe(true);
    expect(isEsignField('eSign_Code')).toBe(true);
    expect(isEsignField('Member1Name')).toBe(false);
    expect(parseSpecialName('eSign_Code')).toEqual({
      family: 'esign', index: 0, part: 'code', type: 'text',
    });
  });

  it('sits flush to the right of the button, in order', () => {
    // Measured off a real form: the button ends at 402.12 and the label starts
    // at 402.95, the label ends at 495.93 and the code starts at 495.95.
    const [label, code] = esignClusterRects(BUTTON);
    expect(label.name).toBe('eSignLBL');
    expect(label.rect.x).toBe(BUTTON.x + BUTTON.width);
    expect(code.rect.x).toBe(label.rect.x + label.rect.width);
  });

  it('is vertically centred on the button', () => {
    const centre = (r) => r.y + r.height / 2;
    for (const { rect } of esignClusterRects(BUTTON)) {
      expect(centre(rect)).toBeCloseTo(centre(BUTTON), 6);
    }
  });

  it('keeps the measured sizes', () => {
    expect(esignClusterRects(BUTTON).map((r) => `${r.rect.width}x${r.rect.height}`)).toEqual([
      '93x14',
      '86x14',
    ]);
  });

  it('places both, on the button page, and never twice', () => {
    const placed = addEsignFields([], BUTTON, 2);
    expect(placed.map((f) => f.name)).toEqual(['eSignLBL', 'eSign_Code']);
    expect(placed.every((f) => f.page === 2 && f.type === 'text')).toBe(true);
    expect(addEsignFields(placed, BUTTON)).toBe(placed);
  });

  it('ships hidden, like the button it belongs to', () => {
    // showESignFields reveals them. Left visible they would sit on the page
    // whether or not the form offers Remote eSign.
    expect(addEsignFields([], BUTTON).every((f) => f.hidden)).toBe(true);
  });

  it('lets only the code box be typed into', () => {
    const byName = Object.fromEntries(addEsignFields([], BUTTON).map((f) => [f.name, f]));
    expect(byName.eSignLBL.editable).toBe(false);
    expect(byName.eSign_Code.editable).toBe(true);
  });

  it('moves with the button, by the same delta', () => {
    const placed = addEsignFields([], BUTTON);
    const before = placed.map((f) => ({ ...f.rect }));
    const after = moveEsignCluster(placed, 40, -25);
    after.forEach((f, i) => {
      expect(f.rect.x).toBe(before[i].x + 40);
      expect(f.rect.y).toBe(before[i].y - 25);
    });
  });

  it('keeps a nudge, since it moves by delta rather than relaying out', () => {
    let placed = addEsignFields([], BUTTON);
    placed = placed.map((f) =>
      f.name === 'eSign_Code' ? { ...f, rect: { ...f.rect, y: f.rect.y + 7 } } : f
    );
    const nudged = placed.find((f) => f.name === 'eSign_Code').rect.y;
    const after = moveEsignCluster(placed, 10, 0);
    expect(after.find((f) => f.name === 'eSign_Code').rect.y).toBe(nudged);
  });

  it('moves the button and the other part when one part is dragged', () => {
    const placed = [...place(ESIGN_ANCHOR), ...addEsignFields([], BUTTON)];
    const label = placed.find((f) => f.name === 'eSignLBL');
    const before = placed.map((f) => ({ ...f.rect }));
    const after = moveEsignCluster(placed, 15, 5, label.id);
    after.forEach((f, i) => {
      const shift = f.id === label.id ? 0 : 1;
      expect(f.rect.x).toBe(before[i].x + 15 * shift);
      expect(f.rect.y).toBe(before[i].y + 5 * shift);
    });
  });

  it('leaves everything else where it is', () => {
    const others = place('CUSTNAME', 'Member1Name');
    const moved = moveEsignCluster([...others, ...addEsignFields([], BUTTON)], 30, 30);
    expect(moved.slice(0, 2).map((f) => f.rect)).toEqual(others.map((f) => f.rect));
  });

  it('goes away together', () => {
    const placed = addEsignFields(place('CUSTNAME'), BUTTON);
    expect(removeEsignFields(placed).map((f) => f.name)).toEqual(['CUSTNAME']);
  });

  it('completes half a pair rather than reporting it', () => {
    // hideESignFields runs on every submission path, so one without the other
    // means the starter code asks for a field that is not there. Where the
    // missing one goes is fully determined, so there is nothing to report.
    const { fields, added } = completeEsignPair(place('eSignLBL'));
    expect(added).toEqual(['eSign_Code']);
    expect(fields.map((f) => f.name).sort()).toEqual(['eSignLBL', 'eSign_Code']);
    expect(specialFieldIssues(fields)).toEqual([]);
  });

  it('puts the replacement back hidden, and editable only if it is the code box', () => {
    const { fields } = completeEsignPair(place('eSignLBL'));
    const code = fields.find((f) => f.name === 'eSign_Code');
    expect(code.hidden).toBe(true);
    expect(code.editable).toBe(true);

    const { fields: other } = completeEsignPair(place('eSign_Code'));
    const label = other.find((f) => f.name === 'eSignLBL');
    expect(label.hidden).toBe(true);
    expect(label.editable).toBe(false);
  });

  it('puts it against the button when the button is there', () => {
    const half = addEsignFields([], BUTTON).filter((f) => f.name !== 'eSign_Code');
    const withButton = [{ ...createField({ name: 'RemoteESignButton', type: 'button' }), rect: BUTTON }, ...half];
    const { fields } = completeEsignPair(withButton);
    const rebuilt = fields.find((f) => f.name === 'eSign_Code');
    const wanted = esignClusterRects(BUTTON).find((r) => r.name === 'eSign_Code').rect;
    expect(rebuilt.rect).toEqual(wanted);
  });

  it('leaves a whole pair and an empty form alone', () => {
    const whole = addEsignFields([], BUTTON);
    expect(completeEsignPair(whole)).toEqual({ fields: whole, added: [] });
    expect(completeEsignPair([])).toEqual({ fields: [], added: [] });
    expect(specialFieldIssues(whole)).toEqual([]);
    expect(specialFieldIssues([])).toEqual([]);
  });

  it('is offered until placed, then not', () => {
    expect(offered([])).toContain('eSignLBL');
    expect(offered(addEsignFields([], BUTTON))).not.toContain('eSignLBL');
  });

  it('lands beside the button when placed from the panel', () => {
    const withButton = [createField({ name: 'RemoteESignButton', type: 'button', rect: BUTTON })];
    const out = addSpecialField(withButton, 'eSignLBL', LETTER, 0, BUTTON);
    expect(out.at(-1).rect.x).toBe(BUTTON.x + BUTTON.width);
  });
});
