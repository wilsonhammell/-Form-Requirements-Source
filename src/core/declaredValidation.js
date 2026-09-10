// Reading what a built form says about its own validation.
//
// A form that has been through the old process declares this in Main:
//
//   var LOAD_VALIDATION_FIELDS = [["ACCOUNT_NUMBER", "Account Number"], ...];
//   var SAVE_VALIDATION_FIELDS = ["txtAcct1", "Member1Name"];
//
// That is the Load Validation flag, the Save Validation flag, and the customer
// facing label, all sitting in the file already.
//
// It is reported and never applied. Setting the flags from here would mean the
// requirements document was filled in from the form it is meant to specify, and
// a tester ticking Pass against inherited values checks nothing. So this tells a
// person what the old form declared and they decide what is still true.
//
// Nothing is executed. Both are arrays of string literals and are read as such,
// so a form carrying anything else yields nothing rather than running it.

const OWNED_SCRIPTS = ['Helper_Functions', 'Main'];

// The whole array, by counting brackets. A non greedy match would stop at the
// first inner ] and take only the first pair.
function arrayLiteral(source, name) {
  const opening = new RegExp(`var\\s+${name}\\s*=\\s*\\[`).exec(source);
  if (!opening) return null;

  const start = opening.index + opening[0].length - 1;
  let depth = 0;
  let quote = null;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

// Strings in order, comments dropped so a commented out entry is not read as
// live. Nested structure is flattened, which is what both shapes need: the load
// array is pairs, the save array is bare names.
function stringsIn(literal) {
  const text = literal.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\\(.)/g, '$1').trim())
    .filter(Boolean);
}

/**
 * What the form declares. load is [{ name, label }], save is names.
 * Empty when the form declares nothing, which is every form this tool wrote.
 */
export function declaredValidation(scripts) {
  const sources = scripts instanceof Map ? scripts : new Map(Object.entries(scripts ?? {}));
  const text = OWNED_SCRIPTS.map((name) => sources.get(name) ?? '').join('\n');

  const loadLiteral = arrayLiteral(text, 'LOAD_VALIDATION_FIELDS');
  const saveLiteral = arrayLiteral(text, 'SAVE_VALIDATION_FIELDS');

  const flat = loadLiteral ? stringsIn(loadLiteral) : [];
  const load = [];
  // Pairs of name then label. An odd trailing entry is a name with no label.
  for (let i = 0; i < flat.length; i += 2) {
    load.push({ name: flat[i], label: flat[i + 1] ?? '' });
  }

  return { load, save: saveLiteral ? stringsIn(saveLiteral) : [] };
}

/**
 * The notices to show. dbIndex decides whether a declared load name is one the
 * filler knows, which is the condition Load Validation cannot stand without.
 */
export function declaredValidationNotes({ load, save }, dbIndex) {
  const notes = [];

  if (load.length > 0) {
    const shown = load.map((f) => (f.label ? `${f.name} (${f.label})` : f.name));
    notes.push(
      `This form declares ${load.length} field${load.length === 1 ? '' : 's'} as Load Validated: ${shown.join(', ')}. Set them here if they are still right, nothing was applied.`
    );

    const missing = dbIndex ? load.filter((f) => !dbIndex.has(f.name)) : [];
    // All of them missing says more about the field list than about the form,
    // and naming every one on every import would be noise nobody reads.
    if (missing.length === load.length && load.length > 0) {
      notes.push(
        'None of those names are in the DB field list, so Load Validation cannot be set on them yet.'
      );
    } else if (missing.length > 0) {
      notes.push(
        `${missing.map((f) => f.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in the DB field list, so Load Validation cannot be set on ${missing.length === 1 ? 'it' : 'them'}.`
      );
    }
  }

  // Save Validation stands on any field, so there is no list to check it against.
  if (save.length > 0) {
    notes.push(
      `It declares ${save.length} field${save.length === 1 ? '' : 's'} as Save Validated: ${save.join(', ')}.`
    );
  }

  return notes;
}
