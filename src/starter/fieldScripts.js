// Field level Acrobat scripts, generated per field.
//
// The old forms wrote these at load time, walking every field and calling
// setAction. That pass is gone: it could only run once safely, and re-running it
// flattened the signer dropdown scripts back to the generic line. These are
// generated at export instead, so what a field carries is decided here.
//
// Output is Acrobat's JavaScript, ES3 era. Nothing here is executed.
//
// Formatting is deliberately not generated beyond this. Fields drawn in Acrobat
// are formatted in Acrobat and export leaves their Format and Keystroke entries
// untouched, so the only one written here is on a field Acrobat never saw.

import { SIGNER_PARTS, SIGNER_PREFIX, ESIGN_PARTS } from '../core/specialFields.js';

// Field names reach the script as literals, so they go through this rather than
// being pasted between quotes.
const js = (value) => JSON.stringify(String(value));

// Taken from the one definition, so a generated script cannot name a field the
// designer would not have placed.
const SUFFIX = Object.fromEntries(SIGNER_PARTS.map((p) => [p.key, p.suffix]));
const memberField = (index, part) => `${SIGNER_PREFIX}${index}${SUFFIX[part]}`;

// Clears the required flag once a field has a value, which is what takes the
// red highlight off after a failed validation. Off is a checkbox with nothing
// ticked, so it counts as empty.
export function clearRequiredOnBlur(fieldName) {
  const f = `this.getField(${js(fieldName)})`;
  return `if (${f}.value !== "" && ${f}.value !== "Off") { ${f}.required = false; }`;
}

// The signer dropdown. Picking a name reveals that row's signature and date,
// clearing it hides them again, which is how rows past the first get turned on.
// enableSignerRows only ever enables row 1, deliberately, because this is what
// handles the rest.
//
// The row's shape is known when this runs, so only the parts the row actually
// carries are written. Nothing checks a flag at run time.
export function signerNameOnBlur(index, row) {
  if (!row || !row.name) return null;

  const field = (part) => `this.getField(${js(memberField(index, part))})`;
  const parts = ['signature', 'signDate'].filter((p) => row[p]);

  const shown = parts.map(
    (p) => `\n    ${field(p)}.display = display.visible;\n    ${field(p)}.readonly = false;`
  );
  const hidden = parts.map(
    (p) =>
      `\n    ${field(p)}.display = display.hidden;` +
      `\n    ${field(p)}.readonly = true;` +
      `\n    ${field(p)}.required = false;`
  );

  const head = `if (getSelectedText(${js(memberField(index, 'name'))}) !== "") {\n    ${field(
    'name'
  )}.required = false;${shown.join('')}\n}`;

  // With no signature and no date there is nothing to reveal, so the else is
  // dead weight and is left off.
  return hidden.length === 0 ? head : `${head} else {${hidden.join('')}\n}`;
}

// The Remote eSign code box. Lower cases what is typed and refuses anything that
// is not alphanumeric.
//
// This is the one formatting script the tool writes, because eSign_Code is
// placed by the tool rather than drawn in Acrobat, so there is no earlier step
// where a person could have set it. Verified against both example forms, where
// it is also the only Format or Keystroke entry on any field.
//
// The star matters. On a backspace, and on the final firing where willCommit is
// true, event.change is empty, and an empty string has to pass or a character
// could not be deleted. Anchored so a paste carrying one bad character is
// rejected whole rather than in part.
export function esignCodeKeystroke() {
  return [
    'event.change = event.change.toLowerCase();',
    'event.rc = /^[A-Za-z0-9]*$/.test(event.change);',
  ].join('\n');
}

const ESIGN_CODE = ESIGN_PARTS.find((p) => p.key === 'code').name;

// Every script a form's fields carry, keyed by field name. Rows come from the
// same SIGNER_ROWS the config block is built from, so the two cannot disagree.
export function fieldScripts({ fieldNames = [], signerRows = [] } = {}) {
  const out = new Map();

  for (const name of fieldNames) {
    out.set(name, { OnBlur: clearRequiredOnBlur(name) });
  }

  signerRows.forEach((row, i) => {
    const script = signerNameOnBlur(i + 1, row);
    if (script) out.set(memberField(i + 1, 'name'), { OnBlur: script });
  });

  // Alongside the OnBlur it already has, which is how the real form carries it.
  if (out.has(ESIGN_CODE)) {
    out.get(ESIGN_CODE).Keystroke = esignCodeKeystroke();
  }

  return out;
}
