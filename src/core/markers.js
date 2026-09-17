// Initials markers: where FileOptics should place an initials box, and whose
// initials belong there.
//
// Not fields. FileOptics places initials in its own configuration step that
// never touches the PDF, so a marker is a note to whoever does that step which
// happens to carry coordinates. It reaches the requirements JSON, the workbook
// and the page pictures, and never the AcroForm, the starter code or the
// downstream filler.
//
// They live in their own array rather than as a flag on a field so that every
// rule a field carries, a name matching the DB list, an export value, a type, a
// generated OnBlur script, stays true of fields by construction rather than by
// excluding markers at each of those sites.
//
// Imports nothing, so schema.js can keep owning document assembly without a
// cycle. That is also why the two helpers below are repeated rather than
// shared.

// What the workbook calls one. There is a single kind today, so it is a
// constant rather than a field on the marker; a second kind would add one.
export const MARKER_LABEL = 'Initials';

// About the size of a box someone writes two letters in.
export const DEFAULT_MARKER_SIZE = { width: 40, height: 18 };

// The toolbar's draw mode for a marker, sitting alongside the field types. A
// mode, not a stored value: nothing on a marker records it, because there is
// only the one kind.
export const DRAW_MARKER = 'initials';

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // randomUUID needs a secure context, which plain http on an intranet host is
  // not. Only has to be unique within a session.
  return 'm-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Four decimals, the same as a field rect, which is well under a printer dot.
function round(n) {
  return Math.round(n * 10000) / 10000;
}

export function createMarker(partial = {}) {
  return {
    id: partial.id || newId(),
    page: Number.isInteger(partial.page) ? partial.page : 0,
    // PDF user space, lower-left origin, exactly as a field rect is stored.
    rect: {
      x: num(partial.rect?.x),
      y: num(partial.rect?.y),
      width: Math.max(1, num(partial.rect?.width, DEFAULT_MARKER_SIZE.width)),
      height: Math.max(1, num(partial.rect?.height, DEFAULT_MARKER_SIZE.height)),
    },
    // Who initials here. Free text, because the person is as often a guarantor,
    // an overseer or a branch manager as a member, and no list this tool could
    // ship would cover them. It is a plain string either way, so offering
    // suggestions later would read what is already stored rather than migrate
    // it.
    role: typeof partial.role === 'string' ? partial.role : '',
    note: typeof partial.note === 'string' ? partial.note : '',
  };
}

export function serializeMarkers(markers) {
  return (markers ?? []).map((m) => ({
    id: m.id,
    page: m.page,
    rect: {
      x: round(m.rect.x),
      y: round(m.rect.y),
      width: round(m.rect.width),
      height: round(m.rect.height),
    },
    role: m.role ?? '',
    note: m.note ?? '',
  }));
}

// A document written before markers existed simply has none, which is why their
// absence is not an error the way a missing fields array is.
export function parseMarkers(raw) {
  return Array.isArray(raw) ? raw.map((m) => createMarker(m)) : [];
}

// The role is the whole point of a marker, so one without it is an error.
//
// It cannot clear itself the way Custom Save Validation's flag does. There is no
// flag to take off, and a marker cannot be refused before it is placed, since
// the box is drawn first and labelled second. So the rule is reported rather
// than enforced, in the shape fieldIssues uses, carrying the ids so clicking it
// filters to exactly the boxes that need an answer.
export function markerIssues(markers) {
  const missing = (markers ?? []).filter((m) => !m.role?.trim());
  if (missing.length === 0) return [];
  const n = missing.length;
  return [
    {
      level: 'error',
      text: `${n} initials marker${n === 1 ? '' : 's'} ${
        n === 1 ? 'does' : 'do'
      } not say whose initials go there.`,
      ids: missing.map((m) => m.id),
    },
  ];
}
