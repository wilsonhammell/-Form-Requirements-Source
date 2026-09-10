// Writing the field model back out as a real AcroForm.
//
// The tool owns exactly ten things on a field: name, type, rect, page,
// read-only, visibility, font, alignment, wrapping, and the requirements JSON.
// Everything else that was already in the PDF is left alone, so an imported form
// keeps its appearance streams, tab order and anything this build does not model.
//
// Export always starts from the original uploaded bytes, never from a document
// a previous export mutated, so repeated exports cannot accumulate drift.

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFBool,
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
} from 'pdf-lib';
import {
  serializeDocument,
  TEXT_RENDERING_TYPES,
  ALIGNMENT_QUADDING,
  DEFAULT_FONT,
} from './schema.js';
import { BUTTON_STYLE, buildButtonIndex } from './signingButtons.js';
import { embedRequirements } from './pdfEmbed.js';
import { daMatchesFont, replaceDaFont } from './defaultAppearance.js';
import { stripComments } from './pdfComments.js';
import { installDocumentScripts, readDocumentScripts } from './pdfScripts.js';
import { buildDocumentScripts, findCustomSaveValidation } from '../starter/buildScripts.js';
import { fieldScripts } from '../starter/fieldScripts.js';
import { deriveSignerRows } from './specialFields.js';
import { normalizeRotation } from './coords.js';

// Annotation flags, PDF 32000-1 table 165, again 1 based bit positions.
//   bit 2 Hidden, the widget is not rendered or printed at all
//   bit 3 Print, without which a widget shows on screen but never prints
const FLAG_HIDDEN = 1 << 1;
const FLAG_PRINT = 1 << 2;

// Button field flags, PDF 32000-1 table 226, given there as 1 based bit
// positions. Not exported by pdf-lib, so they are spelled out here.
//   bit 15 NoToggleToOff, clicking the selected radio does not clear it
//   bit 26 RadiosInUnison, options sharing an on-state turn on together
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

  // A button's caption and action come from the button list, not from the
  // field, the same way a system field's type does.
  const buttonIndex = buildButtonIndex(buttons);
  const groups = groupByName(fields, pages.length, buttonIndex, warnings);
  const existing = indexExistingFields(form, buttonIndex);
  const fontsByFamily = await embedTextFonts(pdfDoc, groups);

  // Anything modelled that is no longer wanted goes. Field types this build does
  // not model are never touched, they are not ours to delete.
  for (const [name, field] of existing) {
    if (!groups.has(name)) {
      form.removeField(field);
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
        const widget = widgets[index];
        widget.setRectangle(target.rect);
        widget.setP(pages[target.page].ref);
        ensurePageAnnot(pdfDoc, pages[target.page], prior, widget);
        applyRotation(widget, pages[target.page]);
        applyVisibility(widget, target.hidden);
      });
      // The on-state belongs to the widget, not the field, for both types.
      // Two placements of one checkbox carrying different values is a Yes/No
      // pair: one field, two boxes, one answer. Renaming only the first left
      // the second on pdf-lib's default and silently broke the pair.
      if (ON_STATE_TYPES.includes(group.type)) {
        group.rects.forEach((target, index) => renameOnState(widgets[index], target.exportValue));
      }
      if (group.type === 'radio') applyRadioFlags(prior, group);
      setReadOnly(prior, !group.editable);
      applyFont(prior, group, fontsByFamily, true, widgets);
      applyTextLayout(prior, group);
      applyButton(prior, group, fontsByFamily);
      continue;
    }

    if (prior) {
      // Type changed, or the widget count no longer lines up. Rebuild it.
      form.removeField(prior);
    }
    createField(form, pages, name, group, fontsByFamily, warnings);
  }

  // Per field scripts, written before the merge so a merged field keeps the
  // widget's own entry. Regenerated every export like everything else, so a
  // field that is no longer scripted loses the one it had.
  applyFieldScripts(
    form,
    groups,
    new Set(systemFields.map((f) => String(f?.identifier ?? f).trim())),
    deriveSignerRows(fields)
  );

  // Tell the viewer to build appearance streams from the field values. This is
  // what keeps a filled value visible without this tool regenerating, and
  // overwriting, appearances it did not create.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

  mergeSingleWidgetFields(pdfDoc, new Set(groups.keys()));

  // Draft forms are reviewed in Acrobat and pick up sticky notes. They live in
  // the same /Annots array as the fields, so this runs after the widgets are
  // settled and only ever removes markup.
  const comments = stripComments(pdfDoc);
  if (comments > 0) {
    warnings.push(`Removed ${comments} comment${comments === 1 ? '' : 's'} left on the form.`);
  }

  const doc = serializeDocument(fields, meta);

  // The starter code, and the config block it runs against, both worked out
  // from the same fields the AcroForm above was built from. Written last so the
  // config reflects everything that was placed.
  //
  // An export replaces every line of script in the form except one: the body of
  // CustomSaveValidation is bespoke, written by hand per form, so it is read
  // back out of the document being exported and carried across. Older forms
  // keep it in Helper_Functions rather than Main, so every script is searched.
  const customSaveValidation = findCustomSaveValidation(readDocumentScripts(pdfDoc));
  installDocumentScripts(
    pdfDoc,
    buildDocumentScripts({ fields, config: doc.config, buttons, customSaveValidation })
  );

  const jsonBytes = await embedRequirements(pdfDoc, doc);

  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  return { pdfBytes, jsonBytes, doc, warnings };
}

// Both carry their on-state on the widget rather than the field, so each
// placement names its own. For a radio that is the option, for a checkbox it is
// usually one value repeated, and sometimes a Yes/No pair.
const ON_STATE_TYPES = ['radio', 'checkbox'];

// The types Acrobat's own pass covered, matching what clearAllRequired walks.
// A pushbutton carries no value, so there is nothing to clear on one.
const SCRIPTABLE_TYPES = ['text', 'checkbox', 'dropdown'];

// The signer dropdowns get their own script, everything else gets the one that
// takes the red highlight off once a value is entered. System fields get none:
// they are read-only and filled by code, so nothing ever flags them.
//
// This replaces the load time pass the old forms ran, which could only run once
// safely and flattened the dropdown scripts whenever it ran again.
function applyFieldScripts(form, groups, systemNames, signerRows) {
  const scriptable = [...groups.entries()]
    .filter(([name, group]) => SCRIPTABLE_TYPES.includes(group.type) && !systemNames.has(name))
    .map(([name]) => name);
  const scripts = fieldScripts({ fieldNames: scriptable, signerRows });

  for (const field of form.getFields()) {
    const name = field.getName();
    if (!groups.has(name)) continue;
    const script = scripts.get(name);
    for (const widget of field.acroField.getWidgets()) {
      setFieldActions(widget.dict, script);
    }
  }
}

// OnBlur is ours on every scriptable field, so it is written or cleared to match
// what was generated. Keystroke is only ever written, never cleared: eSign_Code
// is the one field this tool generates one for, and a Keystroke on any other
// field was set in Acrobat by the person who drew it. Format is not touched at
// all, for the same reason.
const ACTION_KEYS = { OnBlur: 'Bl', Keystroke: 'K' };
// The ones we clear when we have nothing to write. Anything absent here is left
// as it was found.
const OWNED_ACTIONS = ['OnBlur'];

function setFieldActions(dict, scripts) {
  const context = dict.context;
  let additional = dict.lookupMaybe(PDFName.of('AA'), PDFDict);

  for (const [name, key] of Object.entries(ACTION_KEYS)) {
    const source = scripts?.[name] ?? null;

    if (!source) {
      if (additional && OWNED_ACTIONS.includes(name)) additional.delete(PDFName.of(key));
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

// Fields sharing a name are one PDF field with several widgets, which is how a
// value repeats across pages. That is intended, not a mistake.
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
      // needed. Each placement carries its own as well, and that is what is
      // written, so placements that disagree keep their differences.
      group = {
        type: f.type,
        editable: !!f.editable,
        font: { ...f.font },
        // A checkbox has one export value. A radio group has one per option, so
        // that one rides on the placement below instead.
        exportValue: f.exportValue,
        options: [...f.options],
        caption: buttonIndex.get(name)?.caption ?? '',
        script: buttonIndex.get(name)?.script ?? '',
        alignment: f.alignment,
        multiline: !!f.multiline,
        rects: [],
      };
      groups.set(name, group);
    } else if (group.type !== f.type) {
      warnings.push(
        `Skipped a "${name}" placement, one name cannot be both ${group.type} and ${f.type}.`
      );
      continue;
    }
    // A read-only flag lives on the field, not the widget, so any read-only
    // instance makes the whole field read-only.
    group.editable = group.editable && !!f.editable;
    group.rects.push({
      page: f.page,
      rect: { ...f.rect },
      exportValue: f.exportValue,
      hidden: !!f.hidden,
      // /DA sits on the widget, so placements of one name can each carry their
      // own font. A trust form shows the member number at Arial 10 in the body
      // and Courier 9 in a footer, both under the one name.
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
    // A pushbutton is only ours when its name is one the button list knows,
    // matching what import recognises. Any other button in the document is not
    // ours to move or remove, so it never enters this index and the removal
    // pass below cannot reach it.
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

// Every distinct family actually used by a text field needs embedding once
// and registering as a resource the viewer can resolve a field's /DA against.
async function embedTextFonts(pdfDoc, groups) {
  const families = new Set();
  for (const group of groups.values()) {
    if (TEXT_RENDERING_TYPES.includes(group.type)) {
      families.add(group.font.family);
      for (const placement of group.rects) families.add(placement.font.family);
    }
    // A button's caption is drawn from its own /DA, so its font needs embedding
    // and registering too, whether or not any text field uses the same one.
    if (group.type === 'button') families.add(DEFAULT_FONT.family);
  }

  const fontsByFamily = new Map();
  for (const family of families) {
    fontsByFamily.set(family, await pdfDoc.embedFont(family));
  }

  if (fontsByFamily.size > 0) registerFontResources(pdfDoc, fontsByFamily);
  return fontsByFamily;
}

// NeedAppearances means the viewer builds each field's look from /DA at
// render time, and resolves the font named there against the AcroForm's /DR
// dictionary. pdf-lib does not populate /DR for us, so this does it by hand,
// merging in alongside whatever DR entries the original PDF already had.
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

// Acrobat writes a field that has a single widget as one dictionary, the field
// and the annotation merged, so /T and /FT sit directly on the annotation.
// pdf-lib always keeps them apart, field as parent and widget as kid. Readers
// that take the name and type straight off the annotation, which is the common
// way to walk a form, see nothing in the split shape. So match Acrobat.
//
// A field with several widgets cannot be merged, one field genuinely owns them
// all, and is left alone. Only fields this export manages are touched.
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

    // Field level keys move down. Anything the widget already defines is more
    // specific and stays as it is.
    for (const [key, value] of field.entries()) {
      const keyName = key.asString();
      if (keyName === '/Kids' || keyName === '/Parent') continue;
      if (widget.get(key) !== undefined) continue;
      widget.set(key, value);
    }
    widget.delete(PDFName.of('Parent'));

    // The widget is the field now. Page /Annots already points at this ref, so
    // only the form's field list needs repointing.
    fieldsArray.set(i, widgetRef);
    context.delete(fieldRef);
  }
}

// Lines the existing widgets up with the placements they were imported from.
//
// Import walks each page's /Annots, while getWidgets reads the field's /Kids,
// and the two orders are not the same: a trust form in the example set has one
// field whose first two widgets are swapped between them. Pairing by position
// then hands a placement to the wrong widget, which matters because everything
// written here is compared against the widget's own current state.
//
// A widget still sitting where its placement says identifies itself, so match on
// that. Whatever is left over, a placement the user has since moved, pairs off
// in order.
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

function fontDefaultAppearance(font, size) {
  const parts = [setFillingColor(grayscale(0)).toString(), setFontAndSize(font.name, size).toString()];
  return parts.join('\n');
}

// /DA is written on each widget rather than on the field, because that is where
// a PDF actually allows it to differ. One name shown in two places can carry two
// fonts, and a trust form in the example set does exactly that.
//
// A field that came from the source PDF keeps the /DA it arrived with unless the
// designer actually changed the font. Rebuilding it every time drops the colour,
// and on a real form the colour is load bearing: the error fields are red and
// the success one green. A field drawn in Acrobat is formatted in Acrobat, this
// included.
//
// A field this tool creates has no prior appearance to respect, so it gets the
// plain black default.
// widgets must already be lined up with group.rects, see alignWidgets.
function applyFont(field, group, fontsByFamily, fromSource, widgets) {
  if (!TEXT_RENDERING_TYPES.includes(group.type)) return;

  widgets.forEach((widget, index) => {
    // Placements and widgets are in step, the same correspondence the on-state
    // pass relies on. A widget past the end keeps the group's font.
    const wanted = group.rects[index]?.font ?? group.font;
    const font = fontsByFamily.get(wanted.family);
    const write = (da) => widget.dict.set(PDFName.of('DA'), PDFString.of(da));

    if (!fromSource) {
      write(fontDefaultAppearance(font, wanted.size));
      return;
    }

    // The widget's own /DA if it has one, otherwise the field's, which is what
    // it inherits today.
    const existing = decodeTextValue(
      widget.dict.get(PDFName.of('DA')) ?? field.acroField.dict.get(PDFName.of('DA'))
    );

    // Untouched, so there is nothing to write. This keeps the resource name the
    // form already used, /Arial rather than our /Helvetica, along with the
    // colour, and leaves an inherited /DA inherited.
    if (daMatchesFont(existing, wanted)) return;

    // Changed, so swap the font and leave every other operator alone.
    write(replaceDaFont(existing, font.name, wanted.size) ?? fontDefaultAppearance(font, wanted.size));
  });
}

// No background and no border, so the printed form underneath stays visible.
// Passing the keys explicitly matters, pdf-lib fills in white and black when
// they are absent. borderWidth 0 also stops pdf-lib padding the rect.
const TRANSPARENT_WIDGET = {
  backgroundColor: undefined,
  borderColor: undefined,
  borderWidth: 0,
  rotate: degrees(0),
};

function createField(form, pages, name, group, fontsByFamily, warnings) {
  let field;
  try {
    field = makeField(form, name, group);
  } catch (err) {
    warnings.push(`Could not create "${name}": ${err.message}`);
    return;
  }

  group.rects.forEach((placement, index) => {
    const target = pages[placement.page];
    const geometry = {
      x: placement.rect.x,
      y: placement.rect.y,
      width: placement.rect.width,
      height: placement.rect.height,
      ...TRANSPARENT_WIDGET,
    };

    if (group.type === 'radio') {
      // Each placement is one option of the group. pdf-lib names the on-state
      // by position, Acrobat names it after the export value, and the filler
      // reads that name, so the value is written back over it below.
      field.addOptionToPage(`opt${index}`, target, geometry);
    } else if (group.type === 'button') {
      // A button keeps a background and a border, unlike the others: it is
      // meant to look like something to press rather than to sit invisibly
      // over printed artwork. applyButton sets the actual colours.
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

    const widget = field.acroField.getWidgets().at(-1);
    // Write the stored rect verbatim, whatever pdf-lib computed.
    widget.setRectangle(placement.rect);
    applyRotation(widget, target);
    applyVisibility(widget, placement.hidden);

    if (ON_STATE_TYPES.includes(group.type)) {
      renameOnState(widget, placement.exportValue);
    }
  });

  if (group.type === 'radio') {
    // The index to label map pdf-lib keeps is meaningless once the states carry
    // the real values, and leaving it would contradict them.
    field.acroField.dict.delete(PDFName.of('Opt'));
    applyRadioFlags(field, group);
  }
  if (group.type === 'dropdown' && group.options.length > 0) {
    writeOptions(field, group.options);
  }

  setReadOnly(field, !group.editable);
  applyFont(field, group, fontsByFamily, false, field.acroField.getWidgets());
  applyTextLayout(field, group);
  applyButton(field, group, fontsByFamily);
}

// The caption, the look and the action are all ours, since the button list fixes
// all three. A button whose list entry carries no script keeps whatever action it
// already had.
//
// Unlike every other type a button is drawn, so it gets the whole set: /MK for
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
  // /A is the annotation's activation action, which for a widget is the mouse
  // released inside it. That is Acrobat's Mouse Up trigger. /AA /U is the other
  // way to say it, and setting both would run the script twice.
  field.acroField.dict.set(
    PDFName.of('A'),
    context.obj({ S: 'JavaScript', JS: PDFHexString.fromText(group.script) })
  );
}

// /Opt takes either a bare string, when the stored value is also what the
// reader sees, or a two string array of [value, label] when they differ. Acrobat
// writes the short form for a simple list, so this does too.
function writeOptions(field, options) {
  const context = field.acroField.dict.context;
  const entries = options.map((option) =>
    option.value === option.label
      ? PDFHexString.fromText(option.value)
      : context.obj([PDFHexString.fromText(option.value), PDFHexString.fromText(option.label)])
  );
  field.acroField.dict.set(PDFName.of('Opt'), context.obj(entries));
}

// Quadding and the multiline flag, both field level, so every placement of a
// name shares them. /Q is valid on any variable text field, which is why it is
// written straight to the dictionary rather than through a per-type helper.
function applyTextLayout(field, group) {
  if (!TEXT_RENDERING_TYPES.includes(group.type)) return;
  field.acroField.dict.set(
    PDFName.of('Q'),
    PDFNumber.of(ALIGNMENT_QUADDING[group.alignment] ?? 0)
  );
  // Wrapping is a text field flag. A dropdown shows one line by definition.
  if (group.type !== 'text') return;
  if (group.multiline) field.enableMultiline();
  else field.disableMultiline();
}

function makeField(form, name, group) {
  if (group.type === 'button') return form.createButton(name);
  if (group.type === 'checkbox') return form.createCheckBox(name);
  if (group.type === 'radio') return form.createRadioGroup(name);
  if (group.type === 'dropdown') return form.createDropdown(name);
  return form.createTextField(name);
}

// Options sharing an export value is a real Acrobat feature, not a mistake: the
// same choice offered in more than one place, selected together. The viewer
// needs telling, otherwise only the drawn appearance agrees and clicking does
// not. Acrobat exposes this as "buttons with the same name and choice are
// selected in unison".
function applyRadioFlags(field, group) {
  const values = group.rects.map((r) => (r.exportValue ?? '').trim());
  const inUnison = values.some((v, i) => v && values.indexOf(v) !== i);
  // Acrobat's default: a chosen option cannot be cleared by clicking it.
  field.acroField.setFlagTo(FLAG_NO_TOGGLE_TO_OFF, true);
  field.acroField.setFlagTo(FLAG_RADIOS_IN_UNISON, inUnison);
}

// A button widget's on-state is whatever its appearance dictionary calls it.
// That name is the export value a filler compares against, so it has to be the
// value the user asked for rather than pdf-lib's placeholder.
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
  // Start unselected. A default value is not something this build models.
  widget.dict.set(PDFName.of('AS'), PDFName.of('Off'));
}

// Hidden is per widget, so one placement of a name can be hidden while another
// shows. Print is left alone when hiding, a hidden widget is not rendered at
// all, and clearing it would change what an already visible widget does.
function applyVisibility(widget, hidden) {
  widget.setFlagTo(FLAG_HIDDEN, !!hidden);
}

// A widget on a rotated page has to be rotated to match, otherwise its text runs
// sideways to everything printed around it.
function applyRotation(widget, page) {
  const angle = normalizeRotation(page.getRotation().angle);
  if (angle === 0) return;
  widget.getOrCreateAppearanceCharacteristics().setRotation(angle);
}

function setReadOnly(field, readOnly) {
  if (readOnly) field.enableReadOnly();
  else field.disableReadOnly();
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
