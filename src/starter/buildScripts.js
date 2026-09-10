// Turning the designer's state into the two document-level scripts.
//
// Helper_Functions goes out verbatim, it is the same on every form. Main is the
// same file with its //<CONFIG> region replaced by values worked out from what
// was placed, so the config and the PDF cannot disagree.
//
// The output is Acrobat's JavaScript, ES3 era. This file is ordinary app code,
// only what it emits has to stay in that dialect.

import { helperScript, mainScript } from './index.js';
import {
  deriveSignerRows,
  deriveJointRows,
  hasCombinedJoint,
  hasEsignFields,
  SIGNER_PARTS,
} from '../core/specialFields.js';

// ProductValidation is told which field holds the code. One product code field
// now, so this is a constant rather than something the designer picks.
export const PRODUCT_CODE_FIELD = 'PROD_CODE';

// DNA supplies the primary plus SIGNER1 to SIGNER5. The loops read i < this.
export const MAX_DNA_SIGNERS = 6;

// The one thing an export must not throw away. Everything else in the two
// scripts is regenerated, but this block is bespoke per form and written by
// hand, so it is read back out of the PDF being exported and re-emitted.
//
// Brace counting, skipping strings and comments so a brace inside either does
// not end the body early.
export function extractCustomSaveValidation(source) {
  const text = String(source ?? '');
  const match = /function\s+CustomSaveValidation\s*\(\s*\)\s*\{/.exec(text);
  if (!match) return '';

  const start = match.index + match[0].length;
  let depth = 1;
  let quote = null;
  let i = start;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '/' && next === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const body = text.slice(start, i);
        // Leading blank lines and trailing whitespace go, the body itself and
        // its indentation are kept exactly as written.
        return body.trim() === '' ? '' : `${body.replace(/^\n+|\s+$/g, '')}\n`;
      }
    }

    i += 1;
  }

  // Unbalanced, so there is no body to trust. Better empty than truncated.
  return '';
}

// Callers hand these over as either a Map from readDocumentScripts or a plain
// object from a test fixture.
const asScriptMap = (scripts) =>
  scripts instanceof Map ? scripts : new Map(Object.entries(scripts ?? {}));

// Where the block actually is depends on the form's age. This tool writes it
// into Main, alongside the config it belongs with, but the existing forms keep
// it in Helper_Functions. Looking only where we put it would silently drop a
// real one, so every script is searched.
export function findCustomSaveValidation(scripts) {
  const sources = asScriptMap(scripts);
  // Main first, then Helper_Functions where the older forms keep it, then
  // whatever else the tree holds.
  const order = [sources.get('Main'), sources.get('Helper_Functions'), ...sources.values()];

  for (const source of order) {
    const body = extractCustomSaveValidation(source);
    if (body) return body;
  }

  return '';
}

// The two scripts this tool writes. Anything else in the name tree is left
// alone, so a function defined there is not at risk.
export const OWNED_SCRIPTS = ['Helper_Functions', 'Main'];

// Deliberately dropped rather than missing. injectErrorFlagClearing walked every
// field at load time and set its OnBlur; those scripts are generated at export
// now, so the pass is gone on purpose and warning about it every time would be
// noise.
const RETIRED = ['injectErrorFlagClearing'];

// Acrobat runs document scripts in name order, and Main() is called at the
// bottom of the Main script, so anything defining the hooks has to have run by
// then. A script sorting after "Main" runs too late: its functions do not exist
// when Main() executes, the typeof guard is false, and the hook silently does
// not fire.
export function runsBeforeMain(scriptName) {
  return String(scriptName ?? '') < 'Main';
}

/** Scripts export leaves alone, which is where a form keeps its own code. */
export function ownScripts(scripts) {
  return [...asScriptMap(scripts).keys()].filter((name) => !OWNED_SCRIPTS.includes(name)).sort();
}

/** Scripts that survive export but are loaded too late to define a hook. */
export function lateScripts(scripts) {
  return ownScripts(scripts).filter((name) => !runsBeforeMain(name));
}

function functionNames(source) {
  const matches = String(source ?? '').matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  return new Set([...matches].map((m) => m[1]));
}

/**
 * Functions the form defines that the starter code has no equivalent for, and
 * which export would therefore drop.
 *
 * Preserving the bodies would not save them: on every example form the calls
 * come from Main or from a submit handler, both of which are regenerated, so a
 * kept definition would be orphaned. The point of knowing is to decide what
 * general rule the function is an instance of, and build that.
 *
 * CustomSaveValidation is excluded because it is carried across by name.
 */
export function replacedFunctions(scripts) {
  const sources = asScriptMap(scripts);
  const ours = new Set([
    ...functionNames(helperScript()),
    ...functionNames(mainScript()),
    'CustomSaveValidation',
    ...RETIRED,
  ]);

  const found = new Set();
  for (const name of OWNED_SCRIPTS) {
    for (const fn of functionNames(sources.get(name))) {
      if (!ours.has(fn)) found.add(fn);
    }
  }
  return [...found].sort();
}

const CONFIG_OPEN = '//<CONFIG>';
const CONFIG_CLOSE = '//</CONFIG>';

const str = (value) => JSON.stringify(String(value));

// One item per line when there is anything, [] when there is not, so an empty
// list does not become three lines of nothing.
function list(items, indent = '    ') {
  if (items.length === 0) return '[]';
  return `[\n${items.map((i) => `${indent}${i}`).join(',\n')}\n]`;
}

// Names collapse to one entry. A field placed twice is still one field, and the
// starter code would otherwise check it twice.
function distinct(fields, predicate, pick) {
  const seen = new Set();
  const out = [];
  for (const field of fields) {
    const name = field.name.trim();
    if (!name || seen.has(name) || !predicate(field)) continue;
    seen.add(name);
    out.push(pick(field, name));
  }
  return out;
}

export function buildConfigBlock({
  fields = [],
  config = {},
  buttons = [],
  customSaveValidation = '',
} = {}) {
  const signerRows = deriveSignerRows(fields);
  const jointRows = deriveJointRows(fields);
  const combined = hasCombinedJoint(fields);

  const placed = new Set(fields.map((f) => f.name.trim()));
  // Print is a submission button but not a FileOptics one, so it is shown and
  // hidden on its own rather than with the set.
  const fileOpticsButtons = buttons
    .filter((b) => b.fileOptics && placed.has(b.identifier))
    .map((b) => str(b.identifier));

  const rows = signerRows.map(
    (row) => `{ ${SIGNER_PARTS.map((p) => `${p.key}: ${!!row[p.key]}`).join(', ')} }`
  );

  // [field name, the name a person reads in the error message]. The customer
  // facing name is required alongside Load Validation for exactly this.
  const loadValidation = distinct(
    fields,
    (f) => f.loadValidated,
    (f, name) => `[${str(name)}, ${str(f.customerFacingName || name)}]`
  );

  // Plain Save Validation only. Custom Save Validation is conditional logic that
  // lives in CustomSaveValidation, written per form, not generated.
  const saveValidation = distinct(fields, (f) => f.saveValidated, (f, name) => str(name));

  const codes = (config.productCodes ?? []).map((c) => str(c));

  return `${CONFIG_OPEN}

var FILEOPTICS_ENVIRONMENT = ${str(config.environment ?? 'TEST')}; // TEST or PROD

// The Remote eSign label and code box. Every submission path touches them, so
// this says whether the form carries them at all.
var HAS_ESIGN_FIELDS = ${hasEsignFields(fields)};

// The buttons shown and hidden as a set. Print is not one, it never goes to
// FileOptics.
var FILEOPTICS_BUTTON_FIELDS = ${list(fileOpticsButtons)};

// One entry per signer row, in order, so SIGNER_ROWS[0] is Member1. A row
// carries whichever of the three parts was placed.
var SIGNER_ROWS = ${list(rows)};

var MAX_SIGNERS_ON_FORM = SIGNER_ROWS.length;

// Numbered joint rows and the combined line are independent, either, both or
// neither.
var MAX_JOINT_LINES = ${jointRows.length};
var HAS_COMBINED_JOINT = ${combined};
var JOINT_ROW_HAS_MEMBER_NUMBER = ${jointRows.some((r) => r.number)};
var POPULATE_JOINT_DATA = ${jointRows.length > 0 || combined};

var MAX_DNA_SIGNERS = ${MAX_DNA_SIGNERS};

// person, org, or combined
var MEMBERSHIP_TYPE = ${str(config.formType ?? 'person')};

// Which field holds the product code, and the codes this form is valid for. An
// empty code list means no product check.
var CODE_TYPES = [${str(PRODUCT_CODE_FIELD)}];
var PRODUCT_CODES = ${list(codes)};

// [field name, friendly name for the error message]
var LOAD_VALIDATION_FIELDS = ${list(loadValidation)};

// Simple emptiness checks. Conditional ones go in CustomSaveValidation.
var SAVE_VALIDATION_FIELDS = ${list(saveValidation)};

// Written per form when the form needs it. Empty otherwise, and it has to exist
// either way because runBaseSaveValidationOnly calls it. Everything else in
// these two scripts is regenerated, this is the one part carried across.
function CustomSaveValidation() {
${customSaveValidation}}

${CONFIG_CLOSE}`;
}

// Main with its config region swapped for the generated one. The markers stay,
// so the next export can find the region again.
export function buildMainScript(state) {
  const source = mainScript();
  const start = source.indexOf(CONFIG_OPEN);
  const end = source.indexOf(CONFIG_CLOSE);
  if (start === -1 || end === -1) {
    throw new Error('Main is missing its config region markers.');
  }
  return source.slice(0, start) + buildConfigBlock(state) + source.slice(end + CONFIG_CLOSE.length);
}

// The two document-level scripts, named as Acrobat names them. Sorted order is
// the run order, and Helper_Functions sorts before Main, which is what makes
// the helpers defined by the time Main calls them.
//
// state.customSaveValidation is read out of the PDF being exported, so the
// bespoke block survives while everything around it is replaced.
export function buildDocumentScripts(state) {
  return [
    { name: 'Helper_Functions', source: helperScript() },
    { name: 'Main', source: buildMainScript(state) },
  ];
}
