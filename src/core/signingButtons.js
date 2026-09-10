// Submission buttons: the signing channels a form offers.
//
// A pushbutton has no value. Nothing fills it, nothing validates it, and the
// filler skips it entirely, which is why it carries none of the machinery the
// other four types do.
//
// The field type is plain "button" and membership in this list is what makes
// one a submission button, derived from the name the way system fields are. A
// generic button, if one is ever wanted, is the same type with a name that is
// not in the list, so nothing here has to be renamed to make room for it.
//
// The rule is the mirror of a system field's: at most one placement of each
// name, where a system name needs at least one. Placing a button is what says
// the form supports that channel, so there is no separate flag to fall out of
// step with the buttons themselves.

import { createField } from './schema.js';

// Every button looks the same, so the styling is one constant rather than four
// copies. Sizes are PDF points, 72 to the inch: 80 x 18 is 1.111 x 0.25 inches,
// within a hundredth of an inch of the measured button and round in the unit
// everything else here is stored in.
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

// Defined here rather than in a data file on purpose. dbFields.json and
// systemFields.json are swapped by the business, but nothing about a button is:
// the captions are the product's, the sizes are fixed, and the action is
// JavaScript this repo maintains. Nobody using this tool edits code.
// fileOptics says whether the button belongs in FILEOPTICS_BUTTON_FIELDS, the
// list the starter code shows and hides together. Print is not one of them, it
// never goes to FileOptics, which is why both example forms list only three.
export const SIGNING_BUTTONS = [
  {
    identifier: 'PhoneAuthButton',
    caption: 'Phone Auth',
    fileOptics: true,
    // The action, run when the mouse is released over the button. Each is a
    // call into the helper script, the same on every form, since the scripts
    // are exported afresh each time.
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

// Buttons are a fixed size, so only a position is chosen. Each one keeps the
// same slot whatever else is placed, so adding a third does not shuffle the two
// already on the page.
const SLOT = { gap: 8, margin: 6, bottom: 50 };

// The list still goes through the normaliser, so a malformed edit here is
// caught the same way a malformed data file would be.
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

// One slot per entry, laid left to right above the signer row. Position is by
// list order rather than by how many are placed, so a button lands in the same
// spot whether it is the first one added or the last.
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

// Placing one is what says the form supports that channel, so this is the whole
// of "turn this channel on". Adding one already present is a no-op, a button
// appears at most once.
export function addButton(fields, entry, buttons, cropBox, page = 0) {
  if (hasButton(fields, entry.identifier)) return fields;
  return [
    ...fields,
    createField({
      name: entry.identifier,
      type: 'button',
      page,
      rect: buttonSlotRect(entry, buttons, cropBox),
      // Shown and hidden by the starter code at run time, so it starts hidden
      // and the designer rarely touches it.
      hidden: true,
      editable: false,
    }),
  ];
}

export function removeButton(fields, identifier) {
  if (!hasButton(fields, identifier)) return fields;
  return fields.filter((f) => f.name.trim() !== identifier);
}
