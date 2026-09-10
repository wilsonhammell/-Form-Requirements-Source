// The starter code, as text.
//
// helpers.js and main.js are Acrobat document-level scripts, not app code. They
// are imported raw and never executed here, so they stay readable JavaScript
// files rather than strings in a module, and edits to them are ordinary edits.

import helpers from './helpers.js?raw';
import main from './main.js?raw';

// A form's signer rows cap here because the FileOptics Org eSigner list is a
// fixed width slot list, ESIGN_SLOT_COUNT wide, in KCU tag element 12. The two
// numbers have to agree, which a test checks.
export const MAX_SIGNER_ROWS = 6;

// Joint lines cap one lower. PopulateJointData loops i < MAX_DNA_SIGNERS with
// MAX_DNA_SIGNERS 6, so DNA supplies signers 1 to 5 and there is never a sixth
// joint name to write.
export const MAX_JOINT_ROWS = 5;

export function helperScript() {
  return helpers;
}

export function mainScript() {
  return main;
}
