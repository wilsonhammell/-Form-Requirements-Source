// Field level Acrobat scripts, generated per field.
//
// The old forms wrote these at load time, a pass that was only safe once and
// flattened the signer dropdown scripts whenever it ran again. Generating at
// export removes the hazard.
//
// Output is Acrobat's JavaScript, ES3 era. Nothing here is executed.
//
// Formats are not written here, see core/fieldFormat.js. The one Keystroke here
// is eSign_Code's, which filters what is typed rather than formatting it.

import { SIGNER_PARTS, SIGNER_PREFIX, ESIGN_PARTS } from '../core/specialFields.js';

// Field names reach the script as literals, so they go through this rather than
// being pasted between quotes.
const js = (value) => JSON.stringify(String(value));

// From the one definition, so a generated script cannot name a field the
// designer would not have placed.
const SUFFIX = Object.fromEntries(SIGNER_PARTS.map((p) => [p.key, p.suffix]));
const memberField = (index, part) => `${SIGNER_PREFIX}${index}${SUFFIX[part]}`;

// Takes the red highlight off after a failed validation. Off is a checkbox with
// nothing ticked, so it counts as empty.
export function clearRequiredOnBlur(fieldName) {
  const f = `this.getField(${js(fieldName)})`;
  return `if (${f}.value !== "" && ${f}.value !== "Off") { ${f}.required = false; }`;
}

// How rows past the first get turned on. enableSignerRows enabling only row 1
// is the design rather than a quirk, since every other row is revealed by its
// own dropdown.
//
// The row's shape is known when this runs, so only the parts it carries are
// written and nothing checks a flag at run time.
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

  // With no signature and no date there is nothing to reveal.
  return hidden.length === 0 ? head : `${head} else {${hidden.join('')}\n}`;
}

// eSign_Code is placed here rather than drawn in Acrobat, so there was no
// earlier step where a person could have set this. It outranks a format, and
// the panel offers none on this field.
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

// Rows come from the same derivation the config block is built from, so the two
// cannot disagree.
export function fieldScripts({ fieldNames = [], signerRows = [] } = {}) {
  const out = new Map();

  for (const name of fieldNames) {
    out.set(name, { OnBlur: clearRequiredOnBlur(name) });
  }

  signerRows.forEach((row, i) => {
    const script = signerNameOnBlur(i + 1, row);
    if (script) out.set(memberField(i + 1, 'name'), { OnBlur: script });
  });

  // Alongside its OnBlur, which is how the real form carries it.
  if (out.has(ESIGN_CODE)) {
    out.get(ESIGN_CODE).Keystroke = esignCodeKeystroke();
  }

  return out;
}
