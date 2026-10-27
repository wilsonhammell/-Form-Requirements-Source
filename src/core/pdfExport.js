// Writing the field model back out as a real AcroForm.
//
// The tool owns eleven things on a field. Name, type, rect, page, read-only,
// visibility, font, alignment, wrapping, format and the requirements JSON.
// Everything else already in the PDF is left alone, so an imported form keeps
// its appearance streams, tab order and anything this build does not model.
//
// Always starts from the original uploaded bytes, never from a document a
// previous export mutated, so repeated exports cannot accumulate drift.

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFButton,
  degrees,
  setFontAndSize,
  setFillingColor,
  grayscale,
  rgb,
} from 'pdf-lib';
import {
  serializeDocument,
  TEXT_RENDERING_TYPES,
  ALIGNMENT_QUADDING,
  DEFAULT_FONT,
} from './schema.js';
import { BUTTON_STYLE, buildButtonIndex } from './signingButtons.js';
import { MESSAGE_BOXES, OWNED_VALUE_FIELDS, ownedValue } from './systemFields.js';
import { embedRequirements } from './pdfEmbed.js';
import { daMatchesFont, replaceDaFont } from './defaultAppearance.js';
import { stripComments } from './pdfComments.js';
import { installDocumentScripts, readDocumentScripts } from './pdfScripts.js';
import {
  buildDocumentScripts,
  findCustomSaveValidation,
  findFormHooks,
  generatedFieldScripts,
} from '../starter/buildScripts.js';
import { formatScripts } from './fieldFormat.js';
import { normalizeRotation } from './coords.js';

// Annotation flag, PDF 32000-1 table 165, 1 based bit positions there.
const FLAG_HIDDEN = 1 << 1;

// Button field flags, PDF 32000-1 table 226, also 1 based there. Not exported
// by pdf-lib, so they are spelled out.
const FLAG_NO_TOGGLE_TO_OFF = 1 << 14;
const FLAG_RADIOS_IN_UNISON = 1 << 25;

export async function exportPdf({
  originalBytes,
  fields,
  buttons = [],
  systemFields = [],
  meta = {},
}) {
  const pdfDoc = await PDFDocument.load(originalBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const form = pdfDoc.getForm();
  const pages = pdfDoc.getPages();
  const warnings = [];

  // A button's caption and action come from the list rather than the field, the
  // same way a system field's type does.
  const buttonIndex = buildButtonIndex(buttons);
  const groups = groupByName(fields, pages.length, buttonIndex, warnings);
  const existing = indexExistingFields(form, buttonIndex);
  const fontsByFamily = await embedTextFonts(pdfDoc, groups);

  // Types this build does not model are never touched, they are not ours to
  // delete.
  for (const [name, field] of existing) {
    if (!groups.has(name)) {
      removeField(pdfDoc, field);
      existing.delete(name);
    }
  }

  for (const [name, group] of groups) {
    const prior = existing.get(name);
    // One field, one widget per placement, exactly as Acrobat models a name
    // used more than once. As long as the count still lines up, move the
    // widgets rather than rebuilding, so per-placement settings this build does
    // not model, visibility and border style among them, survive.
    const reusable =
      prior &&
      typeOf(prior) === group.type &&
      prior.acroField.getWidgets().length === group.rects.length;

    if (reusable) {
      const widgets = alignWidgets(prior.acroField.getWidgets(), group.rects, pages);
      group.rects.forEach((target, index) => {
        const page = pages[target.page];
        // A reused widget can have moved page, which means fixing the Annots
        // arrays as well. A new one is added to the right page already.
        widgets[index].setP(page.ref);
        ensurePageAnnot(pdfDoc, page, prior, widgets[index]);
        applyPlacement(widgets[index], target, page, group.type);
      });
      applyFieldSettings(prior, group, fontsByFamily, widgets, true);
      continue;
    }

    if (prior) {
      // Type changed, or the widget count no longer lines up. Rebuild it.
      removeField(pdfDoc, prior);
    }
    createField(form, pages, name, group, fontsByFamily, warnings);
  }

  // Per field scripts, written before the merge so a merged field keeps the
  // widget's own entry. Regenerated every export like everything else, so a
  // field that is no longer scripted loses the one it had.
  const scripts = generatedFieldScripts(
    [...groups].map(([name, group]) => [name, group.type]),
    new Set(systemFields.map((f) => String(f?.identifier ?? f).trim())),
    fields
  );
  applyFormats(form, groups, scripts);
  applyFieldScripts(form, groups, scripts);

  const doc = serializeDocument(fields, meta);

  // Before the merge, since /V is a field entry and the merge carries it down
  // onto the widget.
  fillOwnedValues(form, groups, doc.config, warnings);

  // NeedAppearances is never set, and comes off a PDF that arrives with it.
  // With it on, Acrobat redraws every field while the file opens, and a field
  // placed more than once with a Format action on the first page runs that
  // script before the fields exist. Main's lookups then fail, every one alerts
  // "was not found", and the buttons never show. Acrobat itself never sets it.
  form.acroForm.dict.delete(PDFName.of('NeedAppearances'));
  drawOwnedAppearances(form, groups, fontsByFamily);

  mergeSingleWidgetFields(pdfDoc, new Set(groups.keys()));

  // After the widgets are settled, since comments share the /Annots array.
  const comments = stripComments(pdfDoc);
  if (comments > 0) {
    warnings.push(`Removed ${comments} comment${comments === 1 ? '' : 's'} left on the form.`);
  }

  raiseMessageBoxes(pdfDoc);

  // Written last, so the config reflects everything that was placed.
  //
  // Every line of script is replaced except the bespoke functions.
  // CustomSaveValidation and the form hooks are written per form, so they are
  // read back out of the document being exported and carried across. Older
  // forms keep them in Helper_Functions rather than Main.
  const existingScripts = readDocumentScripts(pdfDoc);
  const customSaveValidation = findCustomSaveValidation(existingScripts);
  const hooks = findFormHooks(existingScripts);
  installDocumentScripts(
    pdfDoc,
    buildDocumentScripts({ fields, config: doc.config, buttons, customSaveValidation, hooks })
  );

  const jsonBytes = await embedRequirements(pdfDoc, doc);

  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  return { pdfBytes, jsonBytes, doc, warnings };
}

// Both carry their on-state on the widget rather than the field, so each
// placement names its own. For a checkbox that is how a Yes/No pair works.
// Renaming only the first left the second on pdf-lib's default, and the
// question could only ever answer yes.
const ON_STATE_TYPES = ['radio', 'checkbox'];

// Everything the tool owns on one widget. Both paths write the same set, so
// they cannot drift on what a placement carries.
function applyPlacement(widget, target, page, type) {
  // The stored rect verbatim, whatever pdf-lib computed.
  widget.setRectangle(target.rect);
  applyRotation(widget, page);
  applyVisibility(widget, target.hidden);
  if (ON_STATE_TYPES.includes(type)) renameOnState(widget, target.exportValue);
}

// The field level half, once every widget is in place. fromSource says the
// field came out of the uploaded PDF, which is what lets applyFont leave a /DA
// the designer never touched alone.
function applyFieldSettings(field, group, fontsByFamily, widgets, fromSource) {
  if (group.type === 'radio') applyRadioFlags(field, group);
  setReadOnly(field, !group.editable);
  applyFont(field, group, fontsByFamily, fromSource, widgets);
  applyTextLayout(field, group);
  applyButton(field, group, fontsByFamily);
}

function applyFieldScripts(form, groups, scripts) {
  for (const field of form.getFields()) {
    const name = field.getName();
    if (!groups.has(name)) continue;
    const script = scripts.get(name);
    const isButton = groups.get(name).type === 'button';
    for (const widget of field.acroField.getWidgets()) {
      setFieldActions(widget.dict, script, isButton);
    }
  }
}

// Owned the way the scripts are, so a blank Config box clears the field. Only
// written when it differs, so a form that already says the same thing is left
// exactly as it was.
function fillOwnedValues(form, groups, config, warnings) {
  for (const entry of OWNED_VALUE_FIELDS) {
    const { identifier } = entry;
    if (groups.get(identifier)?.type !== 'text') continue;
    const field = form.getFieldMaybe(identifier);
    if (!(field instanceof PDFTextField)) continue;
    const wanted = ownedValue(entry, config);
    if ((field.acroField.getValue()?.decodeText() ?? '') === wanted) continue;
    try {
      field.setText(wanted || undefined);
    } catch (err) {
      // A MaxLen shorter than the value is the one way this throws.
      warnings.push(`Could not write ${identifier}: ${err.message}`);
    }
  }
}

// Without NeedAppearances a viewer shows the stored appearance until the value
// changes, so anything whose look export owns is drawn here. That is a button,
// its caption and colours, and the config values, the only values export
// writes. Drawn every export, since a form exported while the flag was on
// carries a grey button and a blank FORM_NAME. Everything else keeps the
// appearance it arrived with.
//
// pdf-lib rewrites /DA as it draws, keeping only colour, font and size, so each
// one is put back as it was, see applyFont.
function drawOwnedAppearances(form, groups, fontsByFamily) {
  const ownedNames = new Set(OWNED_VALUE_FIELDS.map((f) => f.identifier));
  for (const [name, group] of groups) {
    if (group.type !== 'button' && !(group.type === 'text' && ownedNames.has(name))) continue;
    const field = form.getFieldMaybe(name);
    const font = fontsByFamily.get(group.type === 'button' ? DEFAULT_FONT.family : group.font.family);
    if (!field || typeOf(field) !== group.type || !font) continue;

    const dicts = [field.acroField.dict, ...field.acroField.getWidgets().map((w) => w.dict)];
    const kept = dicts.map((dict) => dict.get(PDFName.of('DA')));
    field.updateAppearances(font);
    dicts.forEach((dict, index) => {
      if (kept[index]) dict.set(PDFName.of('DA'), kept[index]);
      else dict.delete(PDFName.of('DA'));
    });
  }
}

// OnBlur and Mouse Down are always ours, so nothing to write clears them. A
// Keystroke is written here only for eSign_Code, and is otherwise the format's,
// see applyFormats.
//
// Mouse Up goes in /A, which is where Acrobat keeps it, see applyButton. A /U
// beside it would run as a second Mouse Up, so it goes. Only on a field that
// has one, since a button's /A is the button list's. A button's Mouse Down is
// left as it was for the same reason.
function setFieldActions(dict, scripts, isButton) {
  writeActions(dict, {
    Bl: scripts?.OnBlur ?? null,
    ...(isButton ? {} : { D: scripts?.MouseDown ?? null }),
    ...(scripts?.MouseUp ? { U: null } : {}),
    ...(scripts?.Keystroke ? { K: scripts.Keystroke } : {}),
  });
  if (scripts?.MouseUp) {
    dict.set(
      PDFName.of('A'),
      dict.context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(scripts.MouseUp) })
    );
  }
}

// Format and Keystroke belong to the field, the dictionary carrying /T, which
// is where Acrobat keeps them. A widget's own copy is cleared so the two cannot
// disagree.
//
// Custom is a pair this tool cannot describe and is left as it was. A field
// whose Keystroke the tool generates keeps that one, and has no format.
function applyFormats(form, groups, scripts) {
  for (const field of form.getFields()) {
    const name = field.getName();
    const group = groups.get(name);
    if (group?.type !== 'text' || scripts.get(name)?.Keystroke) continue;
    const wanted = formatScripts(group.format);
    if (wanted === undefined) continue;

    const dict = field.acroField.dict;
    for (const widget of field.acroField.getWidgets()) {
      if (widget.dict !== dict) writeActions(widget.dict, { F: null, K: null });
    }
    writeActions(dict, { F: wanted?.Format ?? null, K: wanted?.Keystroke ?? null });
  }
}

// Each entry is a script to write or null to remove. Every other entry in /AA
// is left alone, and an /AA left empty goes.
function writeActions(dict, entries) {
  const context = dict.context;
  let additional = dict.lookupMaybe(PDFName.of('AA'), PDFDict);

  for (const [key, source] of Object.entries(entries)) {
    if (!source) {
      additional?.delete(PDFName.of(key));
      continue;
    }
    if (!additional) {
      additional = context.obj({});
      dict.set(PDFName.of('AA'), additional);
    }
    additional.set(
      PDFName.of(key),
      context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(source) })
    );
  }

  if (additional && additional.keys().length === 0) dict.delete(PDFName.of('AA'));
}

// Fields sharing a name are one PDF field with several widgets, which is how
// one value repeats across pages.
function groupByName(fields, pageCount, buttonIndex, warnings) {
  const groups = new Map();
  for (const f of fields) {
    const name = f.name.trim();
    if (!name) {
      warnings.push('Skipped a field with no name.');
      continue;
    }
    if (!Number.isInteger(f.page) || f.page < 0 || f.page >= pageCount) {
      warnings.push(`Skipped "${name}", page ${f.page + 1} is not in this PDF.`);
      continue;
    }
    let group = groups.get(name);
    if (!group) {
      // The first placement's font stands for the group where one value is
      // needed. Each placement carries its own too, and that is what is written,
      // so placements that disagree keep their differences.
      group = {
        type: f.type,
        editable: !!f.editable,
        font: { ...f.font },
        exportValue: f.exportValue,
        options: [...f.options],
        caption: buttonIndex.get(name)?.caption ?? '',
        script: buttonIndex.get(name)?.script ?? '',
        alignment: f.alignment,
        multiline: !!f.multiline,
        // Kept in step across placements, so the first speaks for them all.
        format: f.format,
        maxLength: f.maxLength ?? 0,
        comb: !!f.comb && f.maxLength > 0,
        rects: [],
      };
      groups.set(name, group);
    } else if (group.type !== f.type) {
      warnings.push(
        `Skipped a "${name}" placement, one name cannot be both ${group.type} and ${f.type}.`
      );
      continue;
    }
    // Read-only lives on the field, not the widget, so any read-only placement
    // makes the whole field read-only.
    group.editable = group.editable && !!f.editable;
    group.rects.push({
      page: f.page,
      rect: { ...f.rect },
      exportValue: f.exportValue,
      hidden: !!f.hidden,
      // /DA sits on the widget, so placements of one name can carry different
      // fonts. A trust form shows the member number at Arial 10 in the body and
      // Courier 9 in a footer.
      font: { ...f.font },
    });
  }
  return groups;
}

function indexExistingFields(form, buttonIndex) {
  const map = new Map();
  for (const field of form.getFields()) {
    const type = typeOf(field);
    if (!type) continue;
    // A pushbutton is only ours when the button list knows its name, matching
    // what import recognises. Any other stays out of this index, so the removal
    // pass cannot reach it.
    if (type === 'button' && !buttonIndex.has(field.getName())) continue;
    map.set(field.getName(), field);
  }
  return map;
}

function typeOf(field) {
  // A pushbutton is checked first, PDFCheckBox and PDFButton are both /Btn.
  if (field instanceof PDFButton) return 'button';
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  return null;
}

// Each family used needs embedding once and registering as a resource the
// viewer can resolve a field's /DA against.
async function embedTextFonts(pdfDoc, groups) {
  const families = new Set();
  for (const group of groups.values()) {
    if (TEXT_RENDERING_TYPES.includes(group.type)) {
      families.add(group.font.family);
      for (const placement of group.rects) families.add(placement.font.family);
    }
    // A button's caption draws from its own /DA, whether or not a text field
    // uses the same family.
    if (group.type === 'button') families.add(DEFAULT_FONT.family);
  }

  const fontsByFamily = new Map();
  for (const family of families) {
    fontsByFamily.set(family, await pdfDoc.embedFont(family));
  }

  if (fontsByFamily.size > 0) registerFontResources(pdfDoc, fontsByFamily);
  return fontsByFamily;
}

// Whenever the viewer redraws a field, on a value typed or set by script, it
// resolves the font named in /DA against the AcroForm's /DR. pdf-lib does not populate /DR, so this does it by hand,
// merging alongside whatever entries the original PDF had.
function registerFontResources(pdfDoc, fontsByFamily) {
  const acroDict = pdfDoc.getForm().acroForm.dict;
  let dr = acroDict.lookupMaybe(PDFName.of('DR'), PDFDict);
  if (!dr) {
    dr = pdfDoc.context.obj({});
    acroDict.set(PDFName.of('DR'), dr);
  }
  let drFont = dr.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!drFont) {
    drFont = pdfDoc.context.obj({});
    dr.set(PDFName.of('Font'), drFont);
  }
  for (const font of fontsByFamily.values()) {
    drFont.set(PDFName.of(font.name), font.ref);
  }
}

// Acrobat merges a single widget field into one dictionary, so /T and /FT sit
// on the annotation. pdf-lib always keeps them apart, and a reader taking the
// name and type straight off the annotation sees nothing in the split shape.
//
// A field with several widgets genuinely owns them all and cannot be merged.
function mergeSingleWidgetFields(pdfDoc, managedNames) {
  const context = pdfDoc.context;
  const fieldsArray = pdfDoc
    .getForm()
    .acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fieldsArray) return;

  for (let i = 0; i < fieldsArray.size(); i += 1) {
    const fieldRef = fieldsArray.get(i);
    const field = context.lookup(fieldRef);
    if (!(field instanceof PDFDict)) continue;

    const name = decodeTextValue(field.get(PDFName.of('T')));
    if (!name || !managedNames.has(name)) continue;

    const kids = field.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (!kids || kids.size() !== 1) continue;

    const widgetRef = kids.get(0);
    const widget = context.lookup(widgetRef);
    if (!(widget instanceof PDFDict)) continue;

    // Field level keys move down. Anything the widget defines is more specific
    // and stays.
    for (const [key, value] of field.entries()) {
      const keyName = key.asString();
      if (keyName === '/Kids' || keyName === '/Parent') continue;
      if (keyName === '/AA') {
        mergeActions(context, widget, value);
        continue;
      }
      if (widget.get(key) !== undefined) continue;
      widget.set(key, value);
    }
    widget.delete(PDFName.of('Parent'));

    // Page /Annots already points at this ref, so only the form's field list
    // needs repointing.
    fieldsArray.set(i, widgetRef);
    context.delete(fieldRef);
  }
}

// Both carry an /AA. The field's holds Format and Keystroke and the widget's
// holds OnBlur, so keeping only the widget's, as with any other key, dropped the
// formatting of every single widget field Acrobat had stored split.
function mergeActions(context, widget, fieldActions) {
  const from = context.lookupMaybe(fieldActions, PDFDict);
  const into = widget.lookupMaybe(PDFName.of('AA'), PDFDict);
  if (!into) {
    widget.set(PDFName.of('AA'), fieldActions);
    return;
  }
  if (!from) return;
  for (const [key, value] of from.entries()) {
    if (into.get(key) === undefined) into.set(key, value);
  }
}

// Import walks each page's /Annots while getWidgets reads the field's /Kids,
// and the two orders differ. A trust form in the example set has a field whose
// first two widgets are swapped between them, so pairing by position handed a
// placement to the wrong widget.
//
// A widget still sitting where its placement says identifies itself. Whatever
// is left over, a placement since moved, pairs off in order.
function alignWidgets(widgets, rects, pages) {
  if (widgets.length < 2) return widgets;

  const spare = [...widgets];
  const take = (predicate) => {
    const at = spare.findIndex(predicate);
    return at === -1 ? null : spare.splice(at, 1)[0];
  };
  const sameRect = (widget, target) => {
    const r = widget.getRectangle();
    const wanted = target.rect;
    return (
      Math.abs(Math.min(r.x, r.x + r.width) - wanted.x) < 0.01 &&
      Math.abs(Math.min(r.y, r.y + r.height) - wanted.y) < 0.01 &&
      Math.abs(Math.abs(r.width) - wanted.width) < 0.01 &&
      Math.abs(Math.abs(r.height) - wanted.height) < 0.01
    );
  };

  const aligned = rects.map((target) => {
    const page = pages[target.page]?.ref;
    // Prefer a widget on the right page, so two identical boxes on different
    // pages cannot swap.
    return (
      take((w) => w.dict.get(PDFName.of('P')) === page && sameRect(w, target)) ??
      take((w) => sameRect(w, target)) ??
      null
    );
  });

  return aligned.map((widget) => widget ?? spare.shift());
}

function decodeTextValue(obj) {
  return obj instanceof PDFString || obj instanceof PDFHexString ? obj.decodeText() : '';
}

function fontDefaultAppearance(font, size, color) {
  const fill = setFillingColor(color ? rgb(...color) : grayscale(0));
  return [fill.toString(), setFontAndSize(font.name, size).toString()].join('\n');
}

// On the widget rather than the field, because that is where a PDF allows it to
// differ. One name shown twice can carry two fonts, and a trust form does.
//
// A field from the source PDF keeps the /DA it arrived with unless the font was
// actually changed. Rebuilding it every time drops the colour, which on a real
// form is load bearing, the error fields being red and the success one green.
// A field this tool creates gets black text, or its message box colour.
//
// widgets must already be lined up with group.rects, see alignWidgets.
function applyFont(field, group, fontsByFamily, fromSource, widgets) {
  if (!TEXT_RENDERING_TYPES.includes(group.type)) return;
  const color = MESSAGE_BOXES[field.getName()]?.color;

  widgets.forEach((widget, index) => {
    // A widget past the end keeps the group's font.
    const wanted = group.rects[index]?.font ?? group.font;
    const font = fontsByFamily.get(wanted.family);
    const write = (da) => widget.dict.set(PDFName.of('DA'), PDFString.of(da));

    if (!fromSource) {
      write(fontDefaultAppearance(font, wanted.size, color));
      return;
    }

    // The widget's own /DA if it has one, otherwise the field's, which is what
    // it inherits today.
    const existing = decodeTextValue(
      widget.dict.get(PDFName.of('DA')) ?? field.acroField.dict.get(PDFName.of('DA'))
    );

    // Untouched, so keep the resource name the form used, /Arial rather than
    // our /Helvetica, along with the colour, and leave inheritance alone.
    if (daMatchesFont(existing, wanted)) return;

    // Changed, so swap the font and leave every other operator as it is.
    write(replaceDaFont(existing, font.name, wanted.size) ?? fontDefaultAppearance(font, wanted.size, color));
  });
}

// The printed form underneath stays visible. The keys have to be passed even as
// undefined, pdf-lib fills in white and black when they are absent, and
// borderWidth 0 stops it padding the rect.
const TRANSPARENT_WIDGET = {
  backgroundColor: undefined,
  borderColor: undefined,
  borderWidth: 0,
  rotate: degrees(0),
};

// A message box is drawn the way the example forms draw it, border and text in
// one colour on white. Keys passed for the same reason.
//
// The colour here is only the seed. The strip carries the success message as
// well as the errors, so the starter code recolours it per message at fill time.
function messageWidget(look) {
  return {
    borderColor: rgb(...look.color),
    backgroundColor: rgb(1, 1, 1),
    borderWidth: 1,
    rotate: degrees(0),
  };
}

function createField(form, pages, name, group, fontsByFamily, warnings) {
  let field;
  try {
    field = makeField(form, name, group);
  } catch (err) {
    warnings.push(`Could not create "${name}": ${err.message}`);
    return;
  }

  const look = MESSAGE_BOXES[name];

  group.rects.forEach((placement, index) => {
    const target = pages[placement.page];
    const geometry = {
      x: placement.rect.x,
      y: placement.rect.y,
      width: placement.rect.width,
      height: placement.rect.height,
      ...(look ? messageWidget(look) : TRANSPARENT_WIDGET),
    };

    if (group.type === 'radio') {
      // pdf-lib names the on-state by position, Acrobat after the export value,
      // and the filler reads that name, so it is written back over below.
      field.addOptionToPage(`opt${index}`, target, geometry);
    } else if (group.type === 'button') {
      // A button keeps a background and a border, being something to press
      // rather than something to sit invisibly over artwork.
      field.addToPage(group.caption, target, {
        x: placement.rect.x,
        y: placement.rect.y,
        width: placement.rect.width,
        height: placement.rect.height,
        rotate: degrees(0),
      });
    } else {
      field.addToPage(target, geometry);
    }

    applyPlacement(field.acroField.getWidgets().at(-1), placement, target, group.type);
  });

  if (group.type === 'radio') {
    // pdf-lib's index to label map contradicts the states once they carry the
    // real values.
    field.acroField.dict.delete(PDFName.of('Opt'));
  }
  if (group.type === 'dropdown' && group.options.length > 0) {
    writeOptions(field, group.options);
  }

  applyFieldSettings(field, group, fontsByFamily, field.acroField.getWidgets(), false);
}

// Caption, look and action are all ours, the button list fixing all three. One
// whose entry carries no script keeps whatever action it had.
//
// Unlike every other type a button is drawn, so it gets the whole set. /MK for
// the colours and caption, /BS for the border, /DA for the caption's font.
function applyButton(field, group, fontsByFamily) {
  if (group.type !== 'button') return;
  const context = field.acroField.dict.context;

  for (const widget of field.acroField.getWidgets()) {
    const look = widget.getOrCreateAppearanceCharacteristics();
    if (group.caption) look.setCaptions({ normal: group.caption });
    look.setBorderColor(BUTTON_STYLE.borderColor);
    look.setBackgroundColor(BUTTON_STYLE.backgroundColor);
    widget.dict.set(
      PDFName.of('BS'),
      context.obj({ W: BUTTON_STYLE.borderWidth, S: PDFName.of(BUTTON_STYLE.borderStyle) })
    );
  }

  const font = fontsByFamily?.get(DEFAULT_FONT.family);
  if (font) {
    field.acroField.setDefaultAppearance(fontDefaultAppearance(font, BUTTON_STYLE.fontSize));
  }

  if (!group.script) return;
  // /A is the activation action, which for a widget is the mouse released
  // inside it, Acrobat's Mouse Up. /AA /U says the same, and setting both would
  // run the script twice.
  field.acroField.dict.set(
    PDFName.of('A'),
    context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(group.script) })
  );
}

// Acrobat writes the bare string form for a simple list and the [value, label]
// pair only where the two differ, so this does too.
function writeOptions(field, options) {
  const context = field.acroField.dict.context;
  const entries = options.map((option) =>
    option.value === option.label
      ? PDFHexString.fromText(option.value)
      : context.obj([PDFHexString.fromText(option.value), PDFHexString.fromText(option.label)])
  );
  field.acroField.dict.set(PDFName.of('Opt'), context.obj(entries));
}

// Both field level, so every placement of a name shares them. /Q is valid on
// any variable text field, which is why it goes straight to the dictionary
// rather than through a per-type helper.
function applyTextLayout(field, group) {
  if (!TEXT_RENDERING_TYPES.includes(group.type)) return;
  field.acroField.dict.set(
    PDFName.of('Q'),
    PDFNumber.of(ALIGNMENT_QUADDING[group.alignment] ?? 0)
  );
  // A dropdown shows one line by definition.
  if (group.type !== 'text') return;
  if (group.multiline) field.enableMultiline();
  else field.disableMultiline();
  // Straight to the dictionary: pdf-lib's setMaxLength refuses a limit shorter
  // than a value already in the field, and the limit is what was asked for.
  const dict = field.acroField.dict;
  if (group.maxLength > 0) dict.set(PDFName.of('MaxLen'), PDFNumber.of(group.maxLength));
  else dict.delete(PDFName.of('MaxLen'));
  // After the limit, which a comb is spaced by. Combing also clears multiline.
  if (group.comb) field.enableCombing();
  else field.disableCombing();
}

function makeField(form, name, group) {
  if (group.type === 'button') return form.createButton(name);
  if (group.type === 'checkbox') return form.createCheckBox(name);
  if (group.type === 'radio') return form.createRadioGroup(name);
  if (group.type === 'dropdown') return form.createDropdown(name);
  return form.createTextField(name);
}

// Options sharing an export value is Acrobat's radios in unison, the same
// choice offered in more than one place. The viewer needs telling, or only the
// drawn appearance agrees and clicking does not.
function applyRadioFlags(field, group) {
  const values = group.rects.map((r) => (r.exportValue ?? '').trim());
  const inUnison = values.some((v, i) => v && values.indexOf(v) !== i);
  // Acrobat's default: a chosen option cannot be cleared by clicking it.
  field.acroField.setFlagTo(FLAG_NO_TOGGLE_TO_OFF, true);
  field.acroField.setFlagTo(FLAG_RADIOS_IN_UNISON, inUnison);
}

// A widget's on-state is whatever its appearance dictionary calls it, and that
// name is the export value a filler compares against, so it has to be the value
// the user asked for rather than pdf-lib's placeholder.
function renameOnState(widget, exportValue) {
  const value = (exportValue ?? '').trim();
  if (!value) return;

  const normal = widget.dict.context.lookup(
    widget.dict.lookupMaybe(PDFName.of('AP'), PDFDict)?.get(PDFName.of('N'))
  );
  if (!(normal instanceof PDFDict)) return;

  const target = PDFName.of(value);
  for (const key of normal.keys()) {
    if (key.asString() === '/Off' || key === target) continue;
    const stream = normal.get(key);
    normal.delete(key);
    normal.set(target, stream);
  }
  // Unselected. A default value is not something this build models.
  widget.dict.set(PDFName.of('AS'), PDFName.of('Off'));
}

// Per widget, so one placement of a name can be hidden while another shows.
// Print is left alone, since a hidden widget is not rendered either way and
// clearing it would change what an already visible widget does.
function applyVisibility(widget, hidden) {
  widget.setFlagTo(FLAG_HIDDEN, !!hidden);
}

// Otherwise its text runs sideways to everything printed around it.
function applyRotation(widget, page) {
  const angle = normalizeRotation(page.getRotation().angle);
  if (angle === 0) return;
  widget.getOrCreateAppearanceCharacteristics().setRotation(angle);
}

function setReadOnly(field, readOnly) {
  if (readOnly) field.enableReadOnly();
  else field.disableReadOnly();
}

// pdf-lib has its own removeField, but it finds each widget annotation through
// the widget appearance stream and throws when there is none. Most real forms
// leave appearances to the viewer, so most of their widgets have no /AP at all,
// and renaming or deleting any of those failed the whole export. This removes
// by reference instead, which never needs an appearance.
function removeField(pdfDoc, field) {
  const refs = new Set([field.ref]);
  for (const widget of field.acroField.getWidgets()) {
    const ref = findWidgetRef(pdfDoc, field, widget);
    if (ref) refs.add(ref);
  }
  // Every page rather than the one a widget names, since /P is optional.
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (const ref of refs) removeRefFromArray(annots, ref);
  }
  pdfDoc.getForm().acroForm.removeField(field.acroField);
  for (const ref of refs) pdfDoc.context.delete(ref);
}

// A page draws its annotations in /Annots order, so the message boxes go last,
// in MESSAGE_BOXES order. Everything else keeps its place, which on a form set
// to widget order is also the tab order.
function raiseMessageBoxes(pdfDoc) {
  const form = pdfDoc.getForm();
  const refs = Object.keys(MESSAGE_BOXES).flatMap((name) => {
    const field = form.getFieldMaybe(name);
    return field ? field.acroField.getWidgets().map((w) => findWidgetRef(pdfDoc, field, w)) : [];
  });
  for (const page of pdfDoc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (const ref of refs.filter((r) => r && arrayIncludesRef(annots, r))) {
      removeRefFromArray(annots, ref);
      annots.push(ref);
    }
  }
}

// Moving a widget between pages means fixing the Annots arrays too.
function ensurePageAnnot(pdfDoc, page, field, widget) {
  const widgetRef = findWidgetRef(pdfDoc, field, widget);
  if (!widgetRef) return;
  for (const other of pdfDoc.getPages()) {
    const annots = other.node.Annots();
    if (!annots) continue;
    const has = arrayIncludesRef(annots, widgetRef);
    if (other.ref === page.ref && !has) other.node.addAnnot(widgetRef);
    if (other.ref !== page.ref && has) removeRefFromArray(annots, widgetRef);
  }
}

function findWidgetRef(pdfDoc, field, widget) {
  const kids = field.acroField.Kids();
  if (kids) {
    for (let i = 0; i < kids.size(); i += 1) {
      const ref = kids.get(i);
      if (pdfDoc.context.lookup(ref) === widget.dict) return ref;
    }
    return undefined;
  }
  // A field with no Kids is its own widget.
  return field.ref;
}

function arrayIncludesRef(array, ref) {
  for (let i = 0; i < array.size(); i += 1) {
    if (array.get(i) === ref) return true;
  }
  return false;
}

function removeRefFromArray(array, ref) {
  for (let i = array.size() - 1; i >= 0; i -= 1) {
    if (array.get(i) === ref) array.remove(i);
  }
}
