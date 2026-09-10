// The signing channels a form offers, one pushbutton each.
//
// A pushbutton has no value, which is why it carries none of the machinery the
// other four types do. The type is plain button and membership in this list is
// what makes one a submission button, so a generic button would be the same
// type under a name the list does not hold.
//
// The rule mirrors a system field's. At most one placement of each name, where
// a system name needs at least one, and placing one is what says the form
// supports that channel.

import { createField } from './schema.js';

// Points, 72 to the inch. A real button measured 1.1007 x 0.2514 inches, so
// 80 x 18 is a quarter inch tall exactly and under a point wider.
export const BUTTON_STYLE = {
  width: 80,
  height: 18,
  fontSize: 10,
  // rgb, 0 to 1. Black border, green face.
  borderColor: [0, 0, 0],
  backgroundColor: [0, 1, 0],
  borderWidth: 1,
  // /BS /S: B is beveled, the raised look Acrobat draws.
  borderStyle: 'B',
};

// In source rather than in a data file. The business swaps dbFields.json and
// systemFields.json, but nothing about a button is theirs to change, and the
// script is JavaScript this repo maintains.
//
// fileOptics says whether the button belongs in FILEOPTICS_BUTTON_FIELDS, the
// set the starter code shows and hides together. Print never goes to FileOptics.
export const SIGNING_BUTTONS = [
  {
    identifier: 'PhoneAuthButton',
    caption: 'Phone Auth',
    fileOptics: true,
    script: 'submitPhoneAuth();',
  },
  {
    identifier: 'DigitalSignatureButton',
    caption: 'In-Branch eSign',
    fileOptics: true,
    script: 'submitDigitalSignature();',
  },
  {
    identifier: 'RemoteESignButton',
    caption: 'Remote eSign',
    fileOptics: true,
    script: 'submitRemoteESign();',
  },
  { identifier: 'PrintButton', caption: 'Print Form', fileOptics: false, script: 'submitPrintOnly();' },
];

const SLOT = { gap: 8, margin: 6, bottom: 50 };

// Through the normaliser even though it is a literal, so a malformed edit here
// is caught the way a malformed data file would be.
export function signingButtons() {
  return normalizeSigningButtons(SIGNING_BUTTONS);
}

export function normalizeSigningButtons(raw) {
  if (!Array.isArray(raw)) throw new Error('Signing button list must be a JSON array.');
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const identifier = String(entry?.identifier ?? '').trim();
    if (!identifier || seen.has(identifier)) continue;
    seen.add(identifier);
    out.push({
      identifier,
      caption: String(entry?.caption ?? identifier).trim(),
      width: positive(entry?.width, BUTTON_STYLE.width),
      height: positive(entry?.height, BUTTON_STYLE.height),
      fileOptics: entry?.fileOptics !== false,
      script: String(entry?.script ?? ''),
    });
  }
  return out;
}

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function buildButtonIndex(buttons) {
  return new Map(buttons.map((b) => [b.identifier, b]));
}

// Derived, never stored, exactly like isSystemField.
export function isSubmissionButton(name, buttonIndex) {
  if (!name || !buttonIndex) return false;
  return buttonIndex.has(name.trim());
}

export function hasButton(fields, identifier) {
  return fields.some((f) => f.name.trim() === identifier);
}

// Slot by list order rather than by how many are placed, so a button lands in
// the same spot whether it was added first or last.
export function buttonSlotRect(entry, buttons, cropBox) {
  const [x0, y0, x1] = cropBox;
  const slot = Math.max(0, buttons.findIndex((b) => b.identifier === entry.identifier));
  const width = Math.min(entry.width, x1 - x0 - SLOT.margin * 2);
  return {
    x: x0 + SLOT.margin + slot * (width + SLOT.gap),
    y: y0 + SLOT.bottom,
    width,
    height: entry.height,
  };
}

// The whole of turning a channel on. Adding one already placed is a no-op,
// since a button appears at most once.
export function addButton(fields, entry, buttons, cropBox, page = 0) {
  if (hasButton(fields, entry.identifier)) return fields;
  return [
    ...fields,
    createField({
      name: entry.identifier,
      type: 'button',
      page,
      rect: buttonSlotRect(entry, buttons, cropBox),
      // The starter code shows it at run time.
      hidden: true,
      editable: false,
    }),
  ];
}

export function removeButton(fields, identifier) {
  if (!hasButton(fields, identifier)) return fields;
  return fields.filter((f) => f.name.trim() !== identifier);
}
