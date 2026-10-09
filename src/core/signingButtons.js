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
import {
  normalizeIdentifierList,
  indexByIdentifier,
  hasIdentifier,
} from './identifierList.js';

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
  // The channel for a form nobody signs, K_DCR's. Wider than the rest, as
  // K_DCR's was, so the caption fits at size 10.
  {
    identifier: 'SubmitForProcessingButton',
    caption: 'Submit for Processing',
    width: 112,
    fileOptics: true,
    script: 'submitForProcessing();',
  },
];

const SLOT = { gap: 8, margin: 6, top: 50 };

// Through the normaliser even though it is a literal, so a malformed edit here
// is caught the way a malformed data file would be.
export function signingButtons() {
  return normalizeSigningButtons(SIGNING_BUTTONS);
}

const BUTTON_LIST = {
  what: 'Signing button list',
  entry: (raw, identifier) => ({
    caption: String(raw?.caption ?? identifier).trim(),
    width: positive(raw?.width, BUTTON_STYLE.width),
    height: positive(raw?.height, BUTTON_STYLE.height),
    fileOptics: raw?.fileOptics !== false,
    script: String(raw?.script ?? ''),
  }),
};

export const normalizeSigningButtons = (raw) => normalizeIdentifierList(raw, BUTTON_LIST);

function positive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const buildButtonIndex = indexByIdentifier;

export const isSubmissionButton = hasIdentifier;

export function hasButton(fields, identifier) {
  return fields.some((f) => f.name.trim() === identifier);
}

// Slot by list order rather than by how many are placed, so a button lands in
// the same spot whether it was added first or last.
//
// Measured down from the top edge, where the signing block reads, rather than
// up from the bottom, which is where the signer rows go. Only a new placement
// lands here: an imported form keeps whatever positions it arrived with.
export function buttonSlotRect(entry, buttons, cropBox) {
  const [x0, y0, x1, y1] = cropBox;
  const slot = Math.max(0, buttons.findIndex((b) => b.identifier === entry.identifier));
  const usable = x1 - x0 - SLOT.margin * 2;
  const width = Math.min(entry.width, usable);
  // Summed rather than slot times width, since the buttons are not all one width.
  const offset = buttons
    .slice(0, slot)
    .reduce((sum, b) => sum + Math.min(b.width, usable) + SLOT.gap, 0);
  return {
    x: x0 + SLOT.margin + offset,
    // Clamped, so a page shorter than the inset still holds the button.
    y: Math.max(y0, y1 - SLOT.top - entry.height),
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
