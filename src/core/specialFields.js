// Signer rows, joint rows and the combined joint line, whose names come from a
// pattern and an index rather than from a list.
//
// Legal states are the only reachable ones. The picker offers a name only while
// placing it would be valid, so nothing here reports a gap as an error because
// nothing here can produce one.
//
// The two joint shapes are independent, not alternatives. Filling one used to
// branch away from the other, so a form could not carry both.

import { createField } from './schema.js';
import { MAX_SIGNER_ROWS, MAX_JOINT_ROWS } from '../starter/index.js';

export const SIGNER_PREFIX = 'Member';
export const JOINT_PREFIX = 'JointMember';
export const COMBINED_JOINT_NAME = 'JointMembers';

// Parts in the order they read on a form, left to right.
export const SIGNER_PARTS = [
  { key: 'name', suffix: 'Name', type: 'dropdown', label: 'Name' },
  { key: 'signature', suffix: 'Signature', type: 'text', label: 'Signature' },
  { key: 'signDate', suffix: 'SignDate', type: 'text', label: 'Sign date' },
];

export const JOINT_PARTS = [
  { key: 'name', suffix: 'Name', type: 'text', label: 'Name' },
  { key: 'number', suffix: 'Number', type: 'text', label: 'Member number' },
];

// The Remote eSign pair. Fixed names, fixed size, and they sit flush to the
// right of RemoteESignButton, vertically centred on it. Measured off a real
// form: label 92.98 x 13.56, code 86.22 x 13.56, both butted against the
// button's right edge. Rounded here, the same way the button was.
export const ESIGN_ANCHOR = 'RemoteESignButton';

// Both ship hidden, like the button they belong to, and showESignFields reveals
// them. Only the code box takes typing, the label is a caption.
export const ESIGN_PARTS = [
  { key: 'label', name: 'eSignLBL', width: 93, height: 14, label: 'eSign label', editable: false },
  { key: 'code', name: 'eSign_Code', width: 86, height: 14, label: 'eSign code', editable: true },
];

const SIGNER_RE = new RegExp(`^${SIGNER_PREFIX}(\\d+)(Name|Signature|SignDate)$`);
const JOINT_RE = new RegExp(`^${JOINT_PREFIX}(\\d+)(Name|Number)$`);

const bySuffix = (parts, suffix) => parts.find((p) => p.suffix === suffix);

// Derived, never stored, exactly like isSystemField and isSubmissionButton.
export function parseSpecialName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;

  if (trimmed === COMBINED_JOINT_NAME) {
    return { family: 'combinedJoint', index: 0, part: 'combined', type: 'text' };
  }

  const esign = ESIGN_PARTS.find((p) => p.name === trimmed);
  if (esign) return { family: 'esign', index: 0, part: esign.key, type: 'text' };

  const signer = SIGNER_RE.exec(trimmed);
  if (signer) {
    const part = bySuffix(SIGNER_PARTS, signer[2]);
    return { family: 'signer', index: Number(signer[1]), part: part.key, type: part.type };
  }

  const joint = JOINT_RE.exec(trimmed);
  if (joint) {
    const part = bySuffix(JOINT_PARTS, joint[2]);
    return { family: 'joint', index: Number(joint[1]), part: part.key, type: part.type };
  }

  return null;
}

// The starter code clears and rebuilds these menus from DNA on load, so options
// set here would be wiped. Having none is correct rather than an omission.
export function isRuntimeFilledDropdown(name) {
  const parsed = parseSpecialName(name);
  return parsed?.family === 'signer' && parsed.part === 'name';
}

export function isSpecialField(name) {
  return parseSpecialName(name) !== null;
}

// The eSign pair belongs with its button rather than with the signer rows, so
// the whole cluster sits in one scope.
export function isEsignField(name) {
  return parseSpecialName(name)?.family === 'esign';
}

// Corrected on import the way system field types are, since type is fixed once
// a field is drawn and a wrong one would otherwise be an unfixable dead end.
export function specialFieldType(name) {
  return parseSpecialName(name)?.type ?? null;
}

export function reconcileSpecialTypes(fields) {
  return fields.map((field) => {
    const type = specialFieldType(field.name);
    return type && field.type !== type ? { ...field, type } : field;
  });
}

const signerName = (index, key) =>
  `${SIGNER_PREFIX}${index}${SIGNER_PARTS.find((p) => p.key === key).suffix}`;
const jointName = (index, key) =>
  `${JOINT_PREFIX}${index}${JOINT_PARTS.find((p) => p.key === key).suffix}`;

// Placements of one name collapse to one entry, since a name placed twice is
// still one field.
function partsByIndex(fields, family) {
  const rows = new Map();
  for (const field of fields) {
    const parsed = parseSpecialName(field.name);
    if (!parsed || parsed.family !== family) continue;
    if (!rows.has(parsed.index)) rows.set(parsed.index, {});
    rows.get(parsed.index)[parsed.part] = true;
  }
  return rows;
}

// Contiguous, 1 to N. This is what the config block and the dropdown scripts are
// both built from, so the two cannot disagree.
function toRows(byIndex, parts) {
  const highest = byIndex.size === 0 ? 0 : Math.max(...byIndex.keys());
  const rows = [];
  for (let i = 1; i <= highest; i += 1) {
    const found = byIndex.get(i) ?? {};
    rows.push(Object.fromEntries(parts.map((p) => [p.key, !!found[p.key]])));
  }
  return rows;
}

export function deriveSignerRows(fields) {
  return toRows(partsByIndex(fields, 'signer'), SIGNER_PARTS);
}

export function deriveJointRows(fields) {
  return toRows(partsByIndex(fields, 'joint'), JOINT_PARTS);
}

export function hasCombinedJoint(fields) {
  return fields.some((f) => f.name.trim() === COMBINED_JOINT_NAME);
}

const rowIsEmpty = (row) => Object.values(row).every((v) => !v);

// Names that may be placed right now. The picker shows these and nothing else,
// which is what keeps rows contiguous without a single validation rule.
export function availableSpecialNames(fields) {
  const out = [];
  const push = (name, family, label) => out.push({ name, family, label, type: specialFieldType(name) });

  const signerRows = deriveSignerRows(fields);
  signerRows.forEach((row, i) => {
    for (const part of SIGNER_PARTS) {
      if (!row[part.key]) push(signerName(i + 1, part.key), 'signer', `Signer ${i + 1} ${part.label}`);
    }
  });
  if (signerRows.length < MAX_SIGNER_ROWS) {
    const next = signerRows.length + 1;
    for (const part of SIGNER_PARTS) {
      push(signerName(next, part.key), 'signer', `Signer ${next} ${part.label}`);
    }
  }

  const jointRows = deriveJointRows(fields);
  // A joint row is a name with an optional number, so the number is offered
  // only once its row has a name. Signer rows genuinely vary, these do not.
  jointRows.forEach((row, i) => {
    if (!row.name) push(jointName(i + 1, 'name'), 'joint', `Joint ${i + 1} Name`);
    else if (!row.number) push(jointName(i + 1, 'number'), 'joint', `Joint ${i + 1} Member number`);
  });
  if (jointRows.length < MAX_JOINT_ROWS) {
    push(jointName(jointRows.length + 1, 'name'), 'joint', `Joint ${jointRows.length + 1} Name`);
  }
  if (!hasCombinedJoint(fields)) {
    push(COMBINED_JOINT_NAME, 'combinedJoint', 'Joint members, combined into one line');
  }

  for (const part of ESIGN_PARTS) {
    if (!fields.some((f) => f.name.trim() === part.name)) {
      push(part.name, 'esign', `Remote eSign, ${part.label}`);
    }
  }

  return out;
}

// Both, or the starter code asks for a field that is not there. They are placed
// and removed together with the button, so only an import can split them.
export function hasEsignFields(fields) {
  return ESIGN_PARTS.every((p) => fields.some((f) => f.name.trim() === p.name));
}

// Flush to the button's right edge, running on from it, each vertically centred
// against it. Given the button's rect so the cluster follows wherever it goes.
export function esignClusterRects(buttonRect) {
  let x = buttonRect.x + buttonRect.width;
  return ESIGN_PARTS.map((part) => {
    const rect = {
      x,
      y: buttonRect.y + (buttonRect.height - part.height) / 2,
      width: part.width,
      height: part.height,
    };
    x += part.width;
    return { name: part.name, rect, editable: part.editable };
  });
}

// Placed with the button, so turning the channel on gives the whole cluster.
export function addEsignFields(fields, buttonRect, page = 0) {
  const missing = esignClusterRects(buttonRect).filter(
    ({ name }) => !fields.some((f) => f.name.trim() === name)
  );
  if (missing.length === 0) return fields;
  return [
    ...fields,
    ...missing.map(({ name, rect, editable }) =>
      createField({ name, type: 'text', page, rect, hidden: true, editable })
    ),
  ];
}

export function removeEsignFields(fields) {
  const names = ESIGN_PARTS.map((p) => p.name);
  return fields.filter((f) => !names.includes(f.name.trim()));
}

// Dragging the button drags the pair. A delta rather than a re-layout, so a
// nudge to either one survives the button being moved afterwards.
export function moveEsignCluster(fields, dx, dy) {
  if (dx === 0 && dy === 0) return fields;
  const names = ESIGN_PARTS.map((p) => p.name);
  return fields.map((f) =>
    names.includes(f.name.trim())
      ? { ...f, rect: { ...f.rect, x: f.rect.x + dx, y: f.rect.y + dy } }
      : f
  );
}

// Removing a field can empty its row, and an empty row in the middle is a gap
// the loops would walk straight into. Rows after it shift down to close it.
// Positions stay where they are, only the names move up.
export function removeSpecialField(fields, id) {
  const target = fields.find((f) => f.id === id);
  const parsed = target && parseSpecialName(target.name);
  const remaining = fields.filter((f) => f.id !== id);
  if (!parsed || parsed.family === 'combinedJoint') return { fields: remaining, renumbered: [] };

  const parts = parsed.family === 'signer' ? SIGNER_PARTS : JOINT_PARTS;
  const rows = toRows(partsByIndex(remaining, parsed.family), parts);
  if (!rows[parsed.index - 1] || !rowIsEmpty(rows[parsed.index - 1])) {
    return { fields: remaining, renumbered: [] };
  }

  const prefix = parsed.family === 'signer' ? SIGNER_PREFIX : JOINT_PREFIX;
  const renumbered = [];
  const shifted = remaining.map((field) => {
    const p = parseSpecialName(field.name);
    if (!p || p.family !== parsed.family || p.index <= parsed.index) return field;
    const name = `${prefix}${p.index - 1}${parts.find((x) => x.key === p.part).suffix}`;
    renumbered.push({ from: field.name, to: name });
    return { ...field, name };
  });

  return { fields: shifted, renumbered };
}

// Placed out of the way rather than in the right spot, since only the artwork
// knows where that is. Joint lines start higher so they clear the signer block.
const LAYOUT = { height: 18, gap: 10, margin: 40, column: 8 };
const SIGNER_TOP = 260;
const JOINT_TOP = 420;

// The band a row's parts divide up: where it starts and how wide it is.
function rowBand(cropBox) {
  const [x0, , x1] = cropBox;
  return { left: x0 + LAYOUT.margin, usable: Math.max(60, x1 - x0 - LAYOUT.margin * 2) };
}

// Row index counts down from top, and never off the bottom of the page.
function rowY(cropBox, top, index) {
  const y0 = cropBox[1];
  return Math.max(y0 + 4, y0 + top - (index - 1) * (LAYOUT.height + LAYOUT.gap));
}

// Parts laid left to right, each taking its share of the band.
function rowRects(parts, share, cropBox, top, index) {
  const { left, usable } = rowBand(cropBox);
  const y = rowY(cropBox, top, index);
  let x = left;
  return parts.map((part, i) => {
    const width = usable * share[i] - LAYOUT.column;
    const rect = { x, y, width, height: LAYOUT.height };
    x += width + LAYOUT.column;
    return { part: part.key, rect };
  });
}

export function signerRowRects(index, cropBox) {
  return rowRects(SIGNER_PARTS, [0.4, 0.35, 0.25], cropBox, SIGNER_TOP, index);
}

export function jointRowRects(index, cropBox) {
  return rowRects(JOINT_PARTS, [0.65, 0.35], cropBox, JOINT_TOP, index);
}

// One line holding every joint name, so it takes the whole width.
export function combinedJointRect(cropBox) {
  const { left, usable } = rowBand(cropBox);
  return { x: left, y: rowY(cropBox, JOINT_TOP, 1), width: usable, height: LAYOUT.height };
}

// Where any one special field lands when it is placed from the panel rather
// than drawn.
export function specialFieldRect(name, cropBox, anchorRect = null) {
  const parsed = parseSpecialName(name);
  if (!parsed) return null;
  if (parsed.family === 'esign') {
    // Without the button there is nothing to sit beside, so it lands on the
    // combined joint line's row and can be dragged.
    if (!anchorRect) return { ...combinedJointRect(cropBox), width: 93, height: 14 };
    return esignClusterRects(anchorRect).find((r) => r.name === name)?.rect ?? null;
  }
  if (parsed.family === 'combinedJoint') return combinedJointRect(cropBox);
  const rects = parsed.family === 'signer' ? signerRowRects : jointRowRects;
  return rects(parsed.index, cropBox).find((r) => r.part === parsed.part)?.rect ?? null;
}

// Places one named field, so a part deleted from a row can be put back and a
// joint row can be started without drawing first. Refuses anything the picker
// would not have offered, which is the same rule in one place.
export function addSpecialField(fields, name, cropBox, page = 0, anchorRect = null) {
  const legal = availableSpecialNames(fields).some((o) => o.name === name);
  const rect = specialFieldRect(name, cropBox, anchorRect);
  if (!legal || !rect) return fields;
  return [...fields, createField({ name, type: specialFieldType(name), page, rect })];
}

// Adds the next row whole, all three parts, since deleting one is a single
// action and drawing one is several.
export function addSignerRow(fields, cropBox, page = 0) {
  const rows = deriveSignerRows(fields);
  if (rows.length >= MAX_SIGNER_ROWS) return fields;
  const index = rows.length + 1;

  return [
    ...fields,
    ...signerRowRects(index, cropBox).map(({ part, rect }) =>
      createField({ name: signerName(index, part), type: specialFieldType(signerName(index, part)), page, rect })
    ),
  ];
}

// Completed rather than reported. Only a hand edit in Acrobat can split the
// pair, and where the missing one goes is fully determined, so there is nothing
// for a person to decide.
export function completeEsignPair(fields) {
  const found = ESIGN_PARTS.map((part) => ({
    part,
    field: fields.find((f) => f.name.trim() === part.name) ?? null,
  }));
  const present = found.filter((f) => f.field);
  if (present.length !== 1) return { fields, added: [] };

  const anchor = fields.find((f) => f.name.trim() === ESIGN_ANCHOR);
  const survivor = present[0];
  const missing = found.find((f) => !f.field).part;

  // Rebuild the whole cluster off the button so both sit exactly where they
  // belong. Without the button, sit the missing one next to its partner.
  const rect = anchor
    ? esignClusterRects(anchor.rect).find((r) => r.name === missing.name)?.rect
    : {
        x:
          missing.key === 'code'
            ? survivor.field.rect.x + survivor.field.rect.width
            : survivor.field.rect.x - missing.width,
        y: survivor.field.rect.y,
        width: missing.width,
        height: missing.height,
      };

  return {
    fields: [
      ...fields,
      createField({
        name: missing.name,
        type: 'text',
        page: survivor.field.page,
        rect,
        hidden: true,
        editable: missing.editable,
      }),
    ],
    added: [missing.name],
  };
}

// An imported PDF can carry a gap this tool would never create, so this reports
// what placing cannot prevent after the fact.
export function specialFieldIssues(fields) {
  const issues = [];
  for (const [family, parts, prefix] of [
    ['signer', SIGNER_PARTS, 'Signer'],
    ['joint', JOINT_PARTS, 'Joint'],
  ]) {
    toRows(partsByIndex(fields, family), parts).forEach((row, i) => {
      if (rowIsEmpty(row)) issues.push(`${prefix} row ${i + 1} is missing, so later rows are unreachable.`);
    });
  }
  return issues;
}

export { MAX_SIGNER_ROWS, MAX_JOINT_ROWS };
