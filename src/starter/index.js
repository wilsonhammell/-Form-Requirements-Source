// The starter code, as text.
//
// helpers.js and main.js are Acrobat document-level scripts, not app code, and
// are never executed here. Imported raw so they stay readable files rather than
// strings in a module, which keeps edits to them ordinary edits.

import helpers from './helpers.js?raw';
import main from './main.js?raw';

// The FileOptics Org eSigner list in FO tag element 12 is a fixed width slot
// list this wide, so forms built past it would silently truncate on submit. A
// test pins this against ESIGN_SLOT_COUNT.
export const MAX_SIGNER_ROWS = 6;

// One lower, since PopulateJointData loops i < MAX_DNA_SIGNERS and DNA supplies
// signers 1 to 5, so there is never a sixth joint name to write.
export const MAX_JOINT_ROWS = 5;

export function helperScript() {
  return helpers;
}

export function mainScript() {
  return main;
}
