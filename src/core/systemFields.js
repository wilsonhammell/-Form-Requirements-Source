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

const SYSTEM_FIELDS_URL = `${import.meta.env?.BASE_URL ?? '/'}systemFields.json`;

// Worked out against the real page rather than stored, since a rect that fits
// Letter is wrong on A4 and 80 percent of the width is a ratio anyway.
const COMPACT = { width: 54, height: 10, gap: 2, rowGap: 2, margin: 6 };
const WIDE = { widthRatio: 0.8, height: 18, gap: 6 };
// A column per signer along the bottom, roughly where they land on a real form.
const SIGNER = { columns: 5, height: 10, rowGap: 2, colGap: 4, margin: 6 };

export async function loadSystemFields(url = SYSTEM_FIELDS_URL) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`);
  return normalizeSystemFields(await res.json());
}

export function normalizeSystemFields(raw) {
  if (!Array.isArray(raw)) throw new Error('System field list must be a JSON array.');
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const identifier = String(entry?.identifier ?? '').trim();
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    out.push({
      identifier,
      // Every one is text today. Explicit so a future list can say otherwise
      // without a code change.
      type: entry?.type === 'checkbox' ? 'checkbox' : 'text',
      placement: ['wide', 'signer'].includes(entry?.placement)
        ? entry.placement
        : 'compact',
      column: Number.isInteger(entry?.column) ? entry.column : 1,
      multiline: !!entry?.multiline,
    });
  }
  return out;
}

export function buildSystemIndex(systemFields) {
  return new Map(systemFields.map((f) => [f.identifier, f]));
}

// Derived, never stored.
export function isSystemField(name, systemIndex) {
  if (!name || !systemIndex) return false;
  return systemIndex.has(name.trim());
}

// True when removing or renaming this field would leave a system name with no
// placement at all. That is the one thing the tool refuses to allow.
export function isLastSystemPlacement(field, fields, systemIndex) {
  const name = field.name.trim();
  if (!isSystemField(name, systemIndex)) return false;
  return fields.filter((f) => f.name.trim() === name).length <= 1;
}

// They ship hidden, so where they land matters less than that they do not sit
// on top of each other and can be found.
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

  // Wide enough to read, since these are shown to a person and DNA_REQ often
  // gets stretched over the whole page.
  const wideWidth = width * WIDE.widthRatio;
  const block = wide.length * WIDE.height + Math.max(0, wide.length - 1) * WIDE.gap;
  const firstTop = y0 + height / 2 + block / 2;
  wide.forEach((entry, i) => {
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

// The first placement is the one the starter code reads. The rest are copies
// put on the form to show the value, so they read as ordinary fields.
export function canonicalSystemIds(fields, systemIndex) {
  const firstByName = new Map();
  for (const field of fields) {
    const name = field.name.trim();
    if (!isSystemField(name, systemIndex)) continue;
    if (!firstByName.has(name)) firstByName.set(name, field.id);
  }
  return new Set(firstByName.values());
}

// Corrected rather than only reported. The last placement of a system name
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
  const present = new Set(fields.map((f) => f.name.trim()));
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
    })
  );
  return [...fields, ...added];
}
