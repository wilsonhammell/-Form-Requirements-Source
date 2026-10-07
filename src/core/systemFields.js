// The fields the starter code reads, on every form whether it needs them or
// not, because standardising them is the point.
//
// Membership is derived from the name, so swapping systemFields.json
// reclassifies everything at once. A name can be both a system and a DB field.
//
// The invariant this file protects. Every system name keeps at least one
// placement, and extra placements are ordinary fields, which is how one value
// shows in several places.

import { createField } from './schema.js';
import {
  fetchIdentifierList,
  normalizeIdentifierList,
  indexByIdentifier,
  hasIdentifier,
  publicUrl,
} from './identifierList.js';

// Worked out against the real page rather than stored, since a rect that fits
// Letter is wrong on A4 and 80 percent of the width is a ratio anyway.
const COMPACT = { width: 54, height: 10, gap: 2, rowGap: 2, margin: 6 };
const WIDE = { widthRatio: 0.8, height: 18, gap: 6 };

// The message boxes the starter code shows a person. Colours are rgb from 0 to
// 1, heights and margins are points, measured off the seven example forms.
//
// Two boxes, where there were five. Only one of the old five could ever be on
// screen at once, so the strip carries whichever message is current and the
// starter code sets the text and the colour together. That is one thing to
// place per form instead of four.
//
// Listed bottom to top, the order they stack in on export, above every other
// field. DNA_REQ is last so it covers the rest, as on most of the forms.
const RED = [0.898, 0.133, 0.215];
const GREEN = [0.415, 0.851, 0.156];
const MESSAGE_MARGIN = { top: 80, bottom: 55 };

// What the strip is recoloured to at fill time. The starter code carries its
// own copy of these numbers, because it ships as text rather than as a module,
// and a test pins the two together.
export const MESSAGE_COLORS = { error: RED, success: GREEN };

export const MESSAGE_BOXES = {
  // Seeded red, since all but one of the messages are errors. Two lines tall at
  // the strip width: the eSign failure names the members missing an email, and
  // a couple of long names run past one line.
  FORM_MESSAGE: { color: RED, widthRatio: 0.9575, height: 34, band: 'strip' },
  // Covers the form when the wrong account is selected. Kept separate because a
  // page of missing DNA data was never going to fit a strip.
  DNA_REQ: { color: RED, widthRatio: 0.92, band: 'page' },
};

function messageBoxRect(box, [x0, y0, x1, y1]) {
  const width = (x1 - x0) * box.widthRatio;
  const x = x0 + (x1 - x0 - width) / 2;
  if (box.band === 'page') {
    const height = Math.max(0, y1 - y0 - MESSAGE_MARGIN.top - MESSAGE_MARGIN.bottom);
    return { x, y: y0 + MESSAGE_MARGIN.bottom, width, height };
  }
  const centre = y0 + (y1 - y0) / 2;
  return { x, y: centre - box.height / 2, width, height: box.height };
}

// The system fields whose value comes from Config rather than the filler, and
// the config entry each is read from. Every example form carries both, as K_COV
// and Coverdraft Protection.
export const CONFIG_VALUE_FIELDS = [
  { identifier: 'FORM_ID', key: 'formId' },
  { identifier: 'FORM_NAME', key: 'formName' },
];

// A column per signer along the bottom, roughly where they land on a real form.
const SIGNER = { columns: 5, height: 10, rowGap: 2, colGap: 4, margin: 6 };

const SYSTEM_LIST = {
  what: 'System field list',
  entry: (raw) => ({
    // Every one is text today. Explicit so a future list can say otherwise
    // without a code change.
    type: raw?.type === 'checkbox' ? 'checkbox' : 'text',
    placement: ['wide', 'signer'].includes(raw?.placement) ? raw.placement : 'compact',
    column: Number.isInteger(raw?.column) ? raw.column : 1,
    multiline: !!raw?.multiline,
  }),
};

export const loadSystemFields = (url = publicUrl('systemFields.json')) =>
  fetchIdentifierList(url, SYSTEM_LIST);

export const normalizeSystemFields = (raw) => normalizeIdentifierList(raw, SYSTEM_LIST);

export const buildSystemIndex = indexByIdentifier;

export const isSystemField = hasIdentifier;

// True for the placement the starter code reads. It cannot be removed or
// renamed, so a system name always keeps it and copies come and go around it.
export function isFixedSystemPlacement(field, fields, systemIndex) {
  return canonicalSystemIds(fields, systemIndex).has(field.id);
}

// They ship hidden. The message boxes sit where the example forms put them, and
// everything else is kept apart so it can be found.
export function layoutSystemFields(entries, cropBox) {
  const [x0, y0, x1, y1] = cropBox;
  const width = x1 - x0;
  const height = y1 - y0;

  const compact = entries.filter((e) => e.placement === 'compact');
  const wide = entries.filter((e) => e.placement === 'wide');
  const signers = entries.filter((e) => e.placement === 'signer');
  const rects = new Map();

  const usable = width - COMPACT.margin * 2;
  const cellWidth = Math.min(COMPACT.width, usable);
  const perRow = Math.max(1, Math.floor((usable + COMPACT.gap) / (cellWidth + COMPACT.gap)));
  compact.forEach((entry, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const top = y1 - COMPACT.margin - row * (COMPACT.height + COMPACT.rowGap);
    rects.set(entry.identifier, {
      x: x0 + COMPACT.margin + col * (cellWidth + COMPACT.gap),
      y: top - COMPACT.height,
      width: cellWidth,
      height: COMPACT.height,
    });
  });

  // The message boxes land where every example form puts them, overlapping as
  // those do. Anything else on the wide list stacks in the middle.
  for (const entry of wide) {
    const box = MESSAGE_BOXES[entry.identifier];
    if (box) rects.set(entry.identifier, messageBoxRect(box, cropBox));
  }
  const plain = wide.filter((entry) => !MESSAGE_BOXES[entry.identifier]);
  const wideWidth = width * WIDE.widthRatio;
  const block = plain.length * WIDE.height + Math.max(0, plain.length - 1) * WIDE.gap;
  const firstTop = y0 + height / 2 + block / 2;
  plain.forEach((entry, i) => {
    const top = firstTop - i * (WIDE.height + WIDE.gap);
    rects.set(entry.identifier, {
      x: x0 + (width - wideWidth) / 2,
      y: top - WIDE.height,
      width: wideWidth,
      height: WIDE.height,
    });
  });

  // Stacked in list order, so a signer's first entry sits above the rest.
  const colGaps = SIGNER.colGap * (SIGNER.columns - 1);
  const colWidth = (width - SIGNER.margin * 2 - colGaps) / SIGNER.columns;
  const byColumn = new Map();
  for (const entry of signers) {
    const col = Math.min(Math.max(entry.column, 1), SIGNER.columns) - 1;
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col).push(entry);
  }
  for (const [col, column] of byColumn) {
    const blockTop =
      y0 + SIGNER.margin + column.length * SIGNER.height + (column.length - 1) * SIGNER.rowGap;
    column.forEach((entry, row) => {
      const top = blockTop - row * (SIGNER.height + SIGNER.rowGap);
      rects.set(entry.identifier, {
        x: x0 + SIGNER.margin + col * (colWidth + SIGNER.colGap),
        y: top - SIGNER.height,
        width: colWidth,
        height: SIGNER.height,
      });
    });
  }

  return rects;
}

// The flagged placement is the one the starter code reads, the box this tool
// placed. Any other box carrying a system name is an ordinary field that shows
// the value, wherever it sits in the list.
export function canonicalSystemIds(fields, systemIndex) {
  const byName = new Map();
  for (const field of fields) {
    if (!field.systemPlacement) continue;
    const name = field.name.trim();
    if (!isSystemField(name, systemIndex) || byName.has(name)) continue;
    byName.set(name, field.id);
  }
  return new Set(byName.values());
}

// At most one flagged placement per system name, and none on anything else.
export function markSystemPlacements(fields, systemIndex) {
  const canonical = canonicalSystemIds(fields, systemIndex);
  let changed = false;
  const next = fields.map((f) => {
    const flagged = canonical.has(f.id);
    if (!!f.systemPlacement === flagged) return f;
    changed = true;
    return { ...f, systemPlacement: flagged };
  });
  return changed ? next : fields;
}

// Corrected rather than only reported. The system placement of a system name
// cannot be deleted or renamed and type is fixed once a field is drawn, so
// reporting alone would leave nothing to fix it with.
export function reconcileSystemTypes(fields, systemIndex) {
  const corrected = [];
  const next = fields.map((field) => {
    const entry = systemIndex.get(field.name.trim());
    if (!entry || entry.type === field.type) return field;
    corrected.push(field.name.trim());
    return createField({
      ...field,
      type: entry.type,
      // An export value and an option list mean nothing on a text field.
      ...(entry.type === 'text' ? { exportValue: '', options: [] } : {}),
    });
  });
  return { fields: corrected.length > 0 ? next : fields, corrected };
}

// Returns the same array when there was nothing to add, so callers can skip a
// re-render.
export function ensureSystemFields(fields, systemFields, cropBox, page = 0) {
  fields = markSystemPlacements(fields, buildSystemIndex(systemFields));
  // Only a flagged placement counts. A box that merely shares the name stays
  // an ordinary field and the system one is placed alongside it.
  const present = new Set(fields.filter((f) => f.systemPlacement).map((f) => f.name.trim()));
  const missing = systemFields.filter((entry) => !present.has(entry.identifier));
  if (missing.length === 0) return fields;

  const rects = layoutSystemFields(missing, cropBox);
  const added = missing.map((entry) =>
    createField({
      name: entry.identifier,
      type: entry.type,
      page,
      rect: rects.get(entry.identifier),
      // Defaults only. Both are editable afterwards, since some forms show them.
      hidden: true,
      editable: false,
      multiline: entry.multiline,
      systemPlacement: true,
    })
  );
  return [...fields, ...added];
}
