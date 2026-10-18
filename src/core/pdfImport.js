// Reading an uploaded PDF into the field model. Three cases in priority order,
// embedded requirements JSON, an AcroForm rebuilt from the real widgets and
// flagged as inferred, then a flat PDF and an empty field set.
//
// A radio group is one field whose options are its widgets, so each option
// arrives as its own placement sharing the group's name.

import { PDFDocument, PDFName, PDFString, PDFHexString, PDFTextField } from 'pdf-lib';
import {
  createField,
  parseDocument,
  reconcileFields,
  DEFAULT_FONT,
  createConfig,
  alignmentFromQuadding,
  TEXT_RENDERING_TYPES,
  EXPORT_VALUE_TYPES,
} from './schema.js';
import { rectFromPdfArray } from './coords.js';
import {
  ensureSystemFields,
  reconcileSystemTypes,
  buildSystemIndex,
  CONFIG_VALUE_FIELDS,
} from './systemFields.js';
import { extractRequirements } from './pdfEmbed.js';
import { fontFromDa } from './defaultAppearance.js';
import { completeEsignPair } from './specialFields.js';
import { buildButtonIndex } from './signingButtons.js';
import { readDocumentScripts, decodeScript } from './pdfScripts.js';
import { readFormatScripts, DATE_PATTERN, CUSTOM, isPlainText } from './fieldFormat.js';
import { declaredValidation, declaredValidationNotes } from './declaredValidation.js';
import {
  replacedFunctions,
  OWNED_SCRIPTS,
  ownScripts,
  lateScripts,
} from '../starter/buildScripts.js';

// Field flags, PDF 32000-1 tables 221, 226 and 228.
const FLAG_READ_ONLY = 1 << 0;
const FLAG_RADIO = 1 << 15;
const FLAG_PUSHBUTTON = 1 << 16;
const FLAG_COMBO = 1 << 17;

// Annotation flag, PDF 32000-1 table 165 bit 2.
const ANNOT_HIDDEN = 1 << 1;

// Text field flag, PDF 32000-1 table 228 bit 13.
const FLAG_MULTILINE = 1 << 12;

export const SOURCE = {
  EMBEDDED: 'embedded',
  ACROFORM: 'acroform',
  FLAT: 'flat',
};

export async function loadPdfBytes(bytes) {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

// bytes is the raw file. Returns the field set plus what it came from.
export async function importPdf(bytes, dbIndex, systemFields = [], buttons = []) {
  const pdfDoc = await loadPdfBytes(bytes);

  // System fields belong on every form however it arrives. Ones already placed
  // correctly keep their position.
  const systemIndex = buildSystemIndex(systemFields);
  const systemNotes = [];
  const withSystem = (fields) => {
    const { fields: retyped, corrected } = reconcileSystemTypes(fields, systemIndex);
    if (corrected.length > 0) {
      systemNotes.push(
        `Corrected the type of ${corrected.length} system field${
          corrected.length === 1 ? '' : 's'
        } the starter code reads as text: ${corrected.join(', ')}.`
      );
    }
    const { fields: paired, added: pairAdded } = completeEsignPair(retyped);
    if (pairAdded.length > 0) {
      systemNotes.push(`Replaced ${pairAdded.join(', ')}, which the Remote eSign pair needs.`);
    }

    const crop = pdfDoc.getPage(0)?.getCropBox();
    if (!crop) return paired;
    const box = [crop.x, crop.y, crop.x + crop.width, crop.y + crop.height];
    const complete = ensureSystemFields(paired, systemFields, box);
    const added = complete.length - paired.length;
    if (added > 0) {
      systemNotes.push(`Placed ${added} missing system field${added === 1 ? '' : 's'}.`);
    }
    return complete;
  };

  // Blunt on purpose. Telling a bespoke line from an older version of the same
  // flow needs guesswork, and a detector that guesses wrong is worse than one
  // that states the plain fact. Keeping the bodies would not help either, since
  // every call site is in regenerated code too.
  const documentScripts = readDocumentScripts(pdfDoc);
  if (OWNED_SCRIPTS.some((name) => documentScripts.has(name))) {
    systemNotes.push(
      'Helper_Functions and Main are replaced on export. Anything in them this tool does not generate is lost, apart from CustomSaveValidation, CustomAfterValidation, CustomAfterLoad and CustomBeforeSubmit, which are carried across. Code of your own belongs in its own document script, which is never touched, run from CustomAfterValidation, CustomAfterLoad or CustomBeforeSubmit.'
    );
  }

  // Saying which scripts survive is how someone checks their code is in one.
  const own = ownScripts(documentScripts);
  if (own.length > 0) {
    systemNotes.push(`Export leaves these scripts untouched: ${own.join(', ')}.`);
  }

  // Loading after Main() has run means a hook defined there never fires, and
  // nothing reports an error.
  const late = lateScripts(documentScripts);
  if (late.length > 0) {
    systemNotes.push(
      `${late.join(', ')} sorts after Main, so it loads too late to define a hook. Rename it to sort before Main, such as Form_Custom.`
    );
  }

  systemNotes.push(...declaredValidationNotes(declaredValidation(documentScripts), dbIndex));

  // Named functions can be reported exactly, so unlike the blunt warning above
  // they are.
  const replaced = replacedFunctions(documentScripts);
  if (replaced.length > 0) {
    systemNotes.push(
      `This form defines ${replaced.length} function${
        replaced.length === 1 ? '' : 's'
      } the starter code does not: ${replaced.join(', ')}. Export will replace ${
        replaced.length === 1 ? 'it' : 'them'
      }.`
    );
  }

  const embedded = extractRequirements(pdfDoc);
  if (embedded) {
    const { fields: parsed, config, markers, predatesFormat, predatesMaxLength } =
      parseDocument(embedded, dbIndex);
    const { fields: formatted, notes: formatNotes } = formatsFromPdf(parsed, pdfDoc, predatesFormat);
    const fields = lengthsFromPdf(formatted, pdfDoc, predatesMaxLength);
    systemNotes.push(...formatNotes);
    return {
      pdfDoc,
      fields: withSystem(fields),
      config: withFieldValues(config, pdfDoc),
      // Only this route carries them. Markers are never written to the PDF, so
      // there are no widgets for the AcroForm route to rebuild them from, the
      // same way notes and validation flags are not inferred there.
      markers,
      source: SOURCE.EMBEDDED,
      notes: [
        `Loaded ${fields.length} field${fields.length === 1 ? '' : 's'} from embedded JSON.`,
        ...systemNotes,
      ],
    };
  }

  const { fields: rebuilt, notes } = reconstructFromAcroForm(pdfDoc, buildButtonIndex(buttons));
  if (rebuilt.length > 0) {
    const { fields, notes: formatNotes } = formatsFromPdf(rebuilt, pdfDoc);
    return {
      pdfDoc,
      fields: withSystem(reconcileFields(fields, dbIndex)),
      config: withFieldValues(createConfig(), pdfDoc),
      markers: [],
      source: SOURCE.ACROFORM,
      notes: [...notes, ...formatNotes, ...systemNotes],
    };
  }

  return {
    pdfDoc,
    fields: withSystem([]),
    config: createConfig(),
    markers: [],
    source: SOURCE.FLAT,
    notes: ['No form fields found, starting empty.', ...systemNotes],
  };
}

// A blank config value is filled from the field it is written to. Export writes
// a blank box as an empty field, so this only picks up a value that was really
// there, such as on a form built before Config held it. A field that cannot be
// read leaves the box blank rather than stopping the PDF opening.
function withFieldValues(config, pdfDoc) {
  if (!pdfDoc.catalog.getAcroForm()) return config;
  const filled = { ...config };
  for (const { identifier, key } of CONFIG_VALUE_FIELDS) {
    if (filled[key].trim()) continue;
    try {
      const field = pdfDoc.getForm().getFieldMaybe(identifier);
      if (field instanceof PDFTextField) filled[key] = field.acroField.getValue()?.decodeText() ?? '';
    } catch {
      // Left blank.
    }
  }
  return filled;
}

// Text fields take the format the PDF carries, all of them or only the ids in
// only. Exported for a JSON sidecar loaded over an open PDF, which needs the
// same reading for the same reason.
//
// A date in any other pattern becomes the one there is. That is the rule the
// picker enforces, and import saying so is how a form drawn before it gets
// brought into line.
export function formatsFromPdf(fields, pdfDoc, only = null) {
  const formats = readFieldFormats(pdfDoc);
  const changed = new Map();
  const cleared = new Set();
  const next = fields.map((f) => {
    if (f.type !== 'text' || (only && !only.has(f.id))) return f;
    const name = f.name.trim();
    // Not found means not read, and None would have export strip whatever
    // the field carries, so it is left as it is.
    const read = formats.get(name) ?? { format: { category: CUSTOM } };
    if (isPlainText(name)) {
      if (formats.get(name) && read.format.category !== 'none') cleared.add(name);
      return { ...f, format: { category: 'none' } };
    }
    if (read.was) changed.set(name, read.was);
    return { ...f, format: read.format };
  });
  const notes = [];
  if (changed.size > 0) {
    notes.push(
      `Set ${changed.size} date field${changed.size === 1 ? '' : 's'} to ${DATE_PATTERN}: ${[...changed]
        .map(([name, was]) => `${name} (was ${was})`)
        .join(', ')}.`
    );
  }
  if (cleared.size > 0) {
    notes.push(`Removed the format on ${[...cleared].join(', ')}, plain text only.`);
  }
  return { fields: next, notes };
}

// Character limits for fields whose requirements were written before the limit
// was, read off the PDF's own MaxLen, so a limit set in Acrobat survives.
export function lengthsFromPdf(fields, pdfDoc, only = null) {
  if (only && only.size === 0) return fields;
  if (!pdfDoc.catalog.getAcroForm()) return fields;
  const form = pdfDoc.getForm();
  return fields.map((f) => {
    if (f.type !== 'text' || (only && !only.has(f.id))) return f;
    const field = form.getFieldMaybe(f.name.trim());
    const n = field instanceof PDFTextField ? field.getMaxLength() ?? 0 : 0;
    return n ? { ...f, maxLength: n } : f;
  });
}

// Acrobat keeps Format and Keystroke on the field rather than its widgets, so
// the field's pair is read first, and a widget's only when the field has none.
function readFieldFormats(pdfDoc) {
  const out = new Map();
  // getForm would add an AcroForm to a PDF that has none.
  if (!pdfDoc.catalog.getAcroForm()) return out;
  const context = pdfDoc.context;
  const pair = (dict) => {
    const aa = context.lookup(dict.get(PDFName.of('AA')));
    if (!aa?.get) return null;
    const script = (key) => {
      const action = context.lookup(aa.get(PDFName.of(key)));
      return action?.get ? decodeScript(context.lookup(action.get(PDFName.of('JS')))) : '';
    };
    const found = [script('F'), script('K')];
    return found.some((s) => s.trim()) ? found : null;
  };
  try {
    for (const field of pdfDoc.getForm().getFields()) {
      if (!(field instanceof PDFTextField)) continue;
      const dicts = [field.acroField.dict, ...field.acroField.getWidgets().map((w) => w.dict)];
      const found = dicts.map(pair).find(Boolean) ?? ['', ''];
      out.set(field.getName(), readFormatScripts(...found));
    }
  } catch {
    // Read as nothing, which formatsFromPdf leaves alone.
  }
  return out;
}

// Pages rather than form.getFields(), because the page a widget sits on is part
// of the model and walking pages is the only way that is unambiguous.
export function reconstructFromAcroForm(pdfDoc, buttonIndex = new Map()) {
  const context = pdfDoc.context;
  const fields = [];
  const notes = [];
  const seenNames = new Set();
  const repeatedNames = new Set();
  let unsupported = 0;

  const pages = pdfDoc.getPages();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const annots = pages[pageIndex].node.Annots();
    if (!annots) continue;

    for (let i = 0; i < annots.size(); i += 1) {
      const annot = context.lookup(annots.get(i));
      if (!annot || typeof annot.get !== 'function') continue;
      if (annot.get(PDFName.of('Subtype'))?.asString?.() !== '/Widget') continue;

      const fieldType = inherited(context, annot, 'FT')?.asString?.();
      const flags = numberOf(inherited(context, annot, 'Ff'));
      const name = fullyQualifiedName(context, annot);
      if (!name) {
        unsupported += 1;
        continue;
      }

      const type = mapType(fieldType, flags, name, buttonIndex);
      if (!type) {
        unsupported += 1;
        continue;
      }
      const font = TEXT_RENDERING_TYPES.includes(type) ? readFont(context, annot) : DEFAULT_FONT;
      const exportValue = EXPORT_VALUE_TYPES.includes(type) ? readExportValue(context, annot) : '';
      const options = type === 'dropdown' ? readOptions(context, annot) : [];
      const alignment = TEXT_RENDERING_TYPES.includes(type)
        ? alignmentFromQuadding(numberOf(inherited(context, annot, 'Q')))
        : 'left';
      const multiline = type === 'text' && (flags & FLAG_MULTILINE) !== 0;
      const maxLength = type === 'text' ? numberOf(inherited(context, annot, 'MaxLen')) : 0;
      // Visibility rides on the widget, so it is read per placement.
      const hidden = (numberOf(context.lookup(annot.get(PDFName.of('F')))) & ANNOT_HIDDEN) !== 0;
      // Every widget becomes its own entry, and export groups them back into
      // one field.
      if (seenNames.has(name)) repeatedNames.add(name);
      seenNames.add(name);

      const rectArray = context.lookup(annot.get(PDFName.of('Rect')));
      if (!rectArray?.asRectangle && !rectArray?.get) continue;
      const nums = [0, 1, 2, 3].map((k) => numberOf(context.lookup(rectArray.get(k))));

      fields.push(
        createField({
          name,
          type,
          editable: (flags & FLAG_READ_ONLY) === 0,
          page: pageIndex,
          rect: rectFromPdfArray(nums),
          font,
          hidden,
          alignment,
          multiline,
          maxLength,
          exportValue,
          options,
          // Nothing in a PDF records what a field is called on the printed
          // form, and a validation flag this tool did not write is not trusted.
          customerFacingName: '',
          loadValidated: false,
          saveValidated: false,
          customSaveValidated: false,
          imported: true,
        })
      );
    }
  }

  if (fields.length > 0) {
    notes.push(
      `Rebuilt ${fields.length} field${fields.length === 1 ? '' : 's'} from the PDF's AcroForm. Names and rects are inferred, check them before exporting.`
    );
  }
  if (repeatedNames.size > 0) {
    notes.push(
      `${repeatedNames.size} name${repeatedNames.size === 1 ? ' is' : 's are'} placed more than once, each placement shares one value.`
    );
  }
  if (unsupported > 0) {
    notes.push(
      `${unsupported} field${unsupported === 1 ? '' : 's'} of an unsupported type skipped and preserved unchanged.`
    );
  }
  return { fields, notes };
}

// Anything returning null passes through export untouched rather than being
// silently converted. A signature has no value to fill, /Ch covers list boxes
// as well as dropdowns, and a pushbutton is only ours when the list knows it.
function mapType(fieldType, flags, name, buttonIndex) {
  if (fieldType === '/Tx') return 'text';
  if (fieldType === '/Ch') return flags & FLAG_COMBO ? 'dropdown' : null;
  if (fieldType === '/Btn') {
    if (flags & FLAG_PUSHBUTTON) return buttonIndex.has(name.trim()) ? 'button' : null;
    return flags & FLAG_RADIO ? 'radio' : 'checkbox';
  }
  return null;
}

// The on-state name is the export value, whatever the appearance dictionary
// calls it, anything other than /Off.
function readExportValue(context, annot) {
  const ap = context.lookup(annot.get(PDFName.of('AP')));
  const normal = ap ? context.lookup(ap.get(PDFName.of('N'))) : null;
  if (!normal?.keys) return '';
  for (const key of normal.keys()) {
    const name = key.asString();
    if (name !== '/Off') return name.slice(1);
  }
  return '';
}

// Both halves are kept, since a form can store ON and show Ontario.
function readOptions(context, annot) {
  const opt = context.lookup(inherited(context, annot, 'Opt'));
  if (!opt?.size) return [];
  const options = [];
  for (let i = 0; i < opt.size(); i += 1) {
    const entry = context.lookup(opt.get(i));
    if (entry instanceof PDFString || entry instanceof PDFHexString) {
      options.push({ value: entry.decodeText(), label: entry.decodeText() });
    } else if (entry?.size?.() >= 1) {
      const value = decodeText(context.lookup(entry.get(0)));
      const label = entry.size() > 1 ? decodeText(context.lookup(entry.get(1))) : '';
      if (value) options.push({ value, label: label || value });
    }
  }
  return options;
}

// /FT, /Ff and /T can live on a parent field node. Exported because the round
// trip test reads the same forms the same way, and two copies would let import
// and the check that guards it disagree.
export function inherited(context, dict, key) {
  let node = dict;
  let guard = 0;
  while (node && guard < 64) {
    const value = node.get(PDFName.of(key));
    if (value !== undefined) return context.lookup(value);
    node = context.lookup(node.get(PDFName.of('Parent')));
    guard += 1;
  }
  return undefined;
}

// The name the downstream filler sees is the fully qualified one, parents first.
function fullyQualifiedName(context, annot) {
  const parts = [];
  let node = annot;
  let guard = 0;
  while (node && guard < 64) {
    const t = context.lookup(node.get(PDFName.of('T')));
    const text = decodeText(t);
    if (text) parts.unshift(text);
    node = context.lookup(node.get(PDFName.of('Parent')));
    guard += 1;
  }
  return parts.join('.');
}

function decodeText(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return '';
}

// The parsing lives in defaultAppearance.js, shared with export so the two
// cannot disagree about what a given string means.
function readFont(context, annot) {
  return fontFromDa(decodeText(inherited(context, annot, 'DA')));
}

function numberOf(obj) {
  const n = Number(obj?.asNumber?.() ?? obj);
  return Number.isFinite(n) ? n : 0;
}
