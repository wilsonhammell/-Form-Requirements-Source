// Document-level JavaScript, in the catalog's /Names /JavaScript name tree.
// Acrobat runs the entries in tree order and a name tree sorts by name, which
// is what puts Helper_Functions before Main.
//
// pdf-lib's addJavaScript is not used. It appends to the flat Names array
// without reading what is there, so re-exporting a form this tool wrote would
// leave two entries under one name, and it ignores a tree using Kids.

import {
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib';

const NAMES = PDFName.of('Names');
const JAVASCRIPT = PDFName.of('JavaScript');
const KIDS = PDFName.of('Kids');
const LIMITS = PDFName.of('Limits');
const OPEN_ACTION = PDFName.of('OpenAction');
const NEXT = PDFName.of('Next');

// All the open action does. Exported so a test can run the document the way
// Acrobat does, scripts first and then this.
export const OPEN_ACTION_SCRIPT = 'Main();';

// Exported because a field's Format and Keystroke are stored the same way.
export function decodeScript(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  // Acrobat writes a long script as a compressed stream rather than a string,
  // which is how both example forms store theirs. Reading only strings would
  // quietly return nothing for exactly the forms that have code worth keeping.
  if (obj instanceof PDFRawStream) {
    const bytes = decodePDFRawStream(obj).decode();
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < bytes.length; i += 2) {
        out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
      }
      return out;
    }
    return new TextDecoder().decode(bytes);
  }
  return '';
}

// Kids or Names, at any depth, flattened to name and ref pairs.
function collect(context, node, out = []) {
  if (!(node instanceof PDFDict)) return out;

  const kids = context.lookupMaybe(node.get(KIDS), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i += 1) {
      collect(context, context.lookupMaybe(kids.get(i), PDFDict), out);
    }
  }

  const names = context.lookupMaybe(node.get(NAMES), PDFArray);
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      out.push({ name: decodeScript(context.lookup(names.get(i))), value: names.get(i + 1) });
    }
  }

  return out;
}

/**
 * Installs the given scripts, replacing any the tree already holds under the
 * same name. Returns the names written.
 */
export function installDocumentScripts(pdfDoc, scripts) {
  const { context, catalog } = pdfDoc;

  let namesDict = context.lookupMaybe(catalog.get(NAMES), PDFDict);
  if (!namesDict) {
    namesDict = context.obj({});
    catalog.set(NAMES, namesDict);
  }

  const tree = context.lookupMaybe(namesDict.get(JAVASCRIPT), PDFDict);
  const owned = new Set(scripts.map((s) => s.name));
  const entries = collect(context, tree).filter((e) => !owned.has(e.name));

  for (const { name, source } of scripts) {
    // A JavaScript action, the same shape a field action takes.
    const action = context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(source) });
    entries.push({ name, value: context.register(action) });
  }

  // A name tree has to be sorted, and the sort is what decides the run order.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const flat = [];
  for (const entry of entries) {
    flat.push(PDFHexString.fromText(entry.name), entry.value);
  }

  const rebuilt = context.obj({});
  rebuilt.set(NAMES, context.obj(flat));
  // Limits belong on a node with Kids. This one is a single flat node, so an
  // inherited Limits entry would be a lie about what it holds.
  rebuilt.delete(LIMITS);
  namesDict.set(JAVASCRIPT, rebuilt);

  return entries.map((e) => e.name);
}

// Main runs from the document's open action, which Acrobat runs once the file
// has opened, rather than from the end of its own script, see main.js.
//
// Whatever the file did on opening before, usually going to page 1, runs after
// it. Ours from an earlier export is replaced rather than wrapped again.
export function installOpenAction(pdfDoc) {
  const { context, catalog } = pdfDoc;
  // An action is a dictionary. Anything else is a destination.
  const isAction = (obj) => obj !== undefined && context.lookup(obj) instanceof PDFDict;

  let then = catalog.get(OPEN_ACTION);
  if (isAction(then) && runsMain(context, context.lookup(then))) then = context.lookup(then).get(NEXT);

  const run = context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(OPEN_ACTION_SCRIPT) });
  if (then) {
    // A destination on its own is shorthand for going to it.
    run.set(NEXT, isAction(then) ? then : context.obj({ S: 'GoTo', D: then }));
  }
  catalog.set(OPEN_ACTION, context.register(run));
}

function runsMain(context, action) {
  const js = action.get(PDFName.of('JS'));
  return js !== undefined && decodeScript(context.lookup(js)).trim() === OPEN_ACTION_SCRIPT;
}

/** Reads them back, for tests and for checking an export. */
export function readDocumentScripts(pdfDoc) {
  const { context, catalog } = pdfDoc;
  const namesDict = context.lookupMaybe(catalog.get(NAMES), PDFDict);
  const tree = namesDict && context.lookupMaybe(namesDict.get(JAVASCRIPT), PDFDict);
  const out = new Map();
  for (const { name, value } of collect(context, tree)) {
    const action = context.lookupMaybe(value, PDFDict);
    out.set(name, action ? decodeScript(context.lookup(action.get(PDFName.of('JS')))) : '');
  }
  return out;
}
