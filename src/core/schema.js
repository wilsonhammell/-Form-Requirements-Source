// The field model and the JSON document format. JSON is the source of truth,
// the PDF is generated from it.
//
// Load Attempted is derived, never stored. A field is Load Attempted when its
// name matches an identifier in the DB field list. loadValidated is only
// meaningful for a Load Attempted field and is cleared as soon as the name
// stops matching. saveValidated is independent, any field can carry it.

export const SCHEMA_VERSION = 1;

// A button carries no value, so it takes none of the machinery the other four
// do: no export value, no options, no alignment, no validation.
export const FIELD_TYPES = ['text', 'checkbox', 'radio', 'dropdown', 'button'];

// Form level configuration, one set per document rather than per field. It
// describes the form itself and is carried in the JSON for whatever generates
// code from it later, so nothing here affects the exported AcroForm.
export const FORM_TYPES = [
  { value: 'person', label: 'Person' },
  { value: 'org', label: 'Org' },
  { value: 'combined', label: 'Combined' },
];

const FORM_TYPE_VALUES = new Set(FORM_TYPES.map((t) => t.value));

// Which FileOptics the form talks to. Decides the flow id the submit paths send,
// FO or TFO and so on, so shipping a form on TEST sends it nowhere real.
export const ENVIRONMENTS = [
  { value: 'TEST', label: 'Test' },
  { value: 'PROD', label: 'Production' },
];

const ENVIRONMENT_VALUES = new Set(ENVIRONMENTS.map((e) => e.value));

export const DEFAULT_CONFIG = { formType: 'person', productCodes: [], environment: 'TEST' };

// Product codes are pasted, so accept whatever a paste brings: commas, but also
// the newlines and tabs a spreadsheet column arrives with. Codes are kept as
// typed rather than upper cased, since something downstream matches on them and
// this tool does not get to decide their case.
export function parseProductCodes(text) {
  const seen = new Set();
  const codes = [];
  for (const raw of String(text ?? '').split(/[,;\n\r\t]+/)) {
    const code = raw.trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

export function createConfig(partial = {}) {
  return {
    formType: FORM_TYPE_VALUES.has(partial?.formType)
      ? partial.formType
      : DEFAULT_CONFIG.formType,
    productCodes: Array.isArray(partial?.productCodes)
      ? parseProductCodes(partial.productCodes.join(','))
      : parseProductCodes(partial?.productCodes),
    // Defaults to TEST on purpose. A form that reaches production untouched
    // fails safe by talking to the test endpoint rather than the live one.
    environment: ENVIRONMENT_VALUES.has(partial?.environment)
      ? partial.environment
      : DEFAULT_CONFIG.environment,
  };
}

// The viewer draws a value as text for these, so a font and an alignment apply.
export const TEXT_RENDERING_TYPES = ['text', 'dropdown'];

// Quadding, the /Q entry every variable text field carries. Stored by name
// rather than as 0, 1, 2 so the requirements JSON reads as English.
export const TEXT_ALIGNMENTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

export const ALIGNMENT_QUADDING = { left: 0, center: 1, right: 2 };
const QUADDING_ALIGNMENT = ['left', 'center', 'right'];

export function alignmentFromQuadding(q) {
  return QUADDING_ALIGNMENT[q] ?? 'left';
}

// These carry an on-state export value. The filler compares the database value
// against it exactly, so it is part of the requirement, not a cosmetic detail.
//
// Two options of one radio group may share a value. That is Acrobat's
// radios-in-unison behaviour, the same choice offered in more than one place and
// selected together, so it is allowed rather than reported.
export const EXPORT_VALUE_TYPES = ['checkbox', 'radio'];

export const DEFAULT_SIZE = {
  text: { width: 160, height: 18 },
  checkbox: { width: 14, height: 14 },
  radio: { width: 14, height: 14 },
  dropdown: { width: 160, height: 20 },
  button: { width: 120, height: 24 },
};

// Acrobat pre-fills these, a checkbox with Yes and each radio option with
// Choice1, Choice2 and so on, so a group works the moment it is drawn. The
// radio number depends on what is already placed, so it is filled in by
// nextRadioExportValue rather than being a constant.
export const DEFAULT_EXPORT_VALUE = { checkbox: 'Yes', radio: '' };

export const RADIO_VALUE_PREFIX = 'Choice';

// The lowest placeholder not already taken, so a new option never lands on the
// same value as an existing one. One of the first used.size + 1 candidates is
// always free, so the loop always returns.
export function nextRadioExportValue(fields) {
  const used = new Set(
    fields.filter((f) => f.type === 'radio').map((f) => (f.exportValue ?? '').trim())
  );
  for (let n = 1; ; n += 1) {
    const candidate = `${RADIO_VALUE_PREFIX}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

// Characters that survive PDF name encoding untouched. Anything outside this
// gets escaped as #xx in the file, so the filler would compare against the
// escaped form and never match.
//
// The PDF way around that restriction is the /Opt array, which holds the real
// strings while the appearance states stay simple indices. Readers that take
// the export value straight off the appearance state, this project's filler
// among them, never see /Opt, so staying inside these characters is what keeps
// the two ends agreeing.
export const EXPORT_VALUE_PATTERN = /^[A-Za-z0-9_.-]+$/;

// Values are pdf-lib StandardFonts names, embeddable in every reader with no
// font file of our own to license. Arial isn't one of the 14 standard PDF
// fonts, but it's metrically identical to Helvetica and is what Acrobat and
// Windows readers substitute for it, so "Helvetica" reads as Arial on screen.
export const FONT_FAMILIES = [
  { value: 'Helvetica', label: 'Arial' },
  { value: 'Times-Roman', label: 'Times New Roman' },
  { value: 'Courier', label: 'Courier New' },
];

const FONT_FAMILY_VALUES = new Set(FONT_FAMILIES.map((f) => f.value));

export const DEFAULT_FONT = { family: 'Helvetica', size: 10 };

const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 72;

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // crypto.randomUUID needs a secure context, which plain http on an intranet
  // host is not. Only needs to be unique within a session.
  return 'f-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createField(partial = {}) {
  const type = FIELD_TYPES.includes(partial.type) ? partial.type : 'text';
  return {
    id: partial.id || newId(),
    name: typeof partial.name === 'string' ? partial.name : '',
    type,
    editable: partial.editable !== undefined ? !!partial.editable : true,
    page: Number.isInteger(partial.page) ? partial.page : 0,
    rect: {
      x: num(partial.rect?.x),
      y: num(partial.rect?.y),
      width: Math.max(1, num(partial.rect?.width, DEFAULT_SIZE[type].width)),
      height: Math.max(1, num(partial.rect?.height, DEFAULT_SIZE[type].height)),
    },
    font: normalizeFont(partial.font),
    // Visibility is an annotation flag, so unlike editable it belongs to the
    // placement. One placement of a name can be hidden while another shows.
    hidden: !!partial.hidden,
    // Both are field level, like the font, so every placement of a name shares
    // them. That is how Acrobat models them too.
    alignment: ALIGNMENT_QUADDING[partial.alignment] !== undefined ? partial.alignment : 'left',
    multiline: !!partial.multiline,
    exportValue:
      typeof partial.exportValue === 'string'
        ? partial.exportValue
        : (DEFAULT_EXPORT_VALUE[type] ?? ''),
    options: normalizeOptions(partial.options),
    note: typeof partial.note === 'string' ? partial.note : '',
    // What this field is called on the form the customer reads. One DB field
    // wears different labels on different forms, CUSTNAME might be "Name" on
    // one and "Account Holder" on another, so it belongs to the placement
    // rather than to the DB list.
    customerFacingName:
      typeof partial.customerFacingName === 'string' ? partial.customerFacingName : '',
    loadValidated: !!partial.loadValidated,
    saveValidated: !!partial.saveValidated,
    customSaveValidated: !!partial.customSaveValidated,
    // Runtime only, marks a field reconstructed from an AcroForm rather than
    // read back from embedded JSON. Never written to the document.
    imported: !!partial.imported,
  };
}

// A choice option carries what gets stored and what the reader sees. They are
// usually the same, but a form can show "Ontario" while the value written is
// "ON", which is what the /Opt array's two string form is for.
//
// Bare strings are accepted so an older document, or a hand written one, still
// loads: the string becomes both halves.
export function normalizeOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const value = String(
      typeof entry === 'string' ? entry : (entry?.value ?? '')
    ).trim();
    if (!value || seen.has(value)) continue;
    const label = String(typeof entry === 'string' ? entry : (entry?.label ?? '')).trim();
    seen.add(value);
    out.push({ value, label: label || value });
  }
  return out;
}

// One per line, "value = label" where they differ. A tab counts as the
// separator too, so a two column paste out of a spreadsheet lands correctly.
const OPTION_SEPARATOR = /^([^=\t]*)[=\t](.*)$/;

export function parseOptionLines(text) {
  const parsed = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const split = OPTION_SEPARATOR.exec(trimmed);
    if (split) parsed.push({ value: split[1], label: split[2] });
    else parsed.push({ value: trimmed, label: trimmed });
  }
  return normalizeOptions(parsed);
}

export function formatOptionLines(options) {
  return options
    .map((o) => (o.value === o.label ? o.value : `${o.value} = ${o.label}`))
    .join('\n');
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFont(font) {
  const family = FONT_FAMILY_VALUES.has(font?.family) ? font.family : DEFAULT_FONT.family;
  const size = clamp(num(font?.size, DEFAULT_FONT.size), MIN_FONT_SIZE, MAX_FONT_SIZE);
  return { family, size };
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// Derived, not stored. dbIndex is a Map of identifier to entry.
export function isLoadAttempted(name, dbIndex) {
  if (!name || !dbIndex) return false;
  return dbIndex.has(name.trim());
}

// Enforce the flags that cannot stand on their own. Call this after anything
// that can change a name, a note, or the DB list. Returns the same object when
// nothing needed fixing, so callers can skip a re-render.
export function reconcileField(field, dbIndex) {
  const patch = {};

  // Load Validation cannot outlive a name that matches the DB list.
  if (field.loadValidated && !isLoadAttempted(field.name, dbIndex)) {
    patch.loadValidated = false;
  }

  // Nor can it stand without the customer facing name. Validating that a field
  // loads is a claim about a specific label on a specific form, so the label is
  // part of the claim.
  if (field.loadValidated && !field.customerFacingName?.trim()) {
    patch.loadValidated = false;
  }

  // Custom Save Validation exists to flag a situation the plain flag cannot
  // describe, so it is meaningless without the note that describes it.
  if (field.customSaveValidated && !field.note?.trim()) {
    patch.customSaveValidated = false;
  }

  // The two save flags are mutually exclusive. The UI cannot produce both, so
  // this only fires on a hand edited file. The plain flag wins, being the one
  // with no preconditions of its own.
  if (field.saveValidated && field.customSaveValidated) {
    patch.customSaveValidated = false;
  }

  return Object.keys(patch).length > 0 ? { ...field, ...patch } : field;
}

export function reconcileFields(fields, dbIndex) {
  let changed = false;
  const next = fields.map((f) => {
    const r = reconcileField(f, dbIndex);
    if (r !== f) changed = true;
    return r;
  });
  return changed ? next : fields;
}

// The JSON document. Only the modelled attributes are written, so a reader
// never has to guess which keys are meaningful.
export function serializeDocument(fields, meta = {}) {
  const config = createConfig(meta.config);
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    ...(meta.sourceFileName ? { sourceFileName: meta.sourceFileName } : {}),
    config,
    fields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      editable: !!f.editable,
      page: f.page,
      rect: {
        x: round(f.rect.x),
        y: round(f.rect.y),
        width: round(f.rect.width),
        height: round(f.rect.height),
      },
      font: { ...f.font },
      hidden: !!f.hidden,
      alignment: f.alignment ?? 'left',
      multiline: !!f.multiline,
      exportValue: f.exportValue ?? '',
      options: (f.options ?? []).map((o) => ({ value: o.value, label: o.label })),
      note: f.note ?? '',
      customerFacingName: f.customerFacingName ?? '',
      loadValidated: !!f.loadValidated,
      saveValidated: !!f.saveValidated,
      customSaveValidated: !!f.customSaveValidated,
    })),
  };
}

// Four decimals is well under a printer dot and keeps the JSON readable.
function round(n) {
  return Math.round(n * 10000) / 10000;
}

export class SchemaError extends Error {}

export function parseDocument(raw, dbIndex) {
  let data = raw;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new SchemaError('File is not valid JSON.');
    }
  }
  if (!data || typeof data !== 'object') {
    throw new SchemaError('File is not a requirements document.');
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new SchemaError(
      `Unsupported schemaVersion ${data.schemaVersion}, this build reads version ${SCHEMA_VERSION}.`
    );
  }
  if (!Array.isArray(data.fields)) {
    throw new SchemaError('Document has no fields array.');
  }
  const fields = data.fields.map((f) => createField(f));
  return {
    meta: { sourceFileName: data.sourceFileName, generatedAt: data.generatedAt },
    config: createConfig(data.config),
    fields: reconcileFields(fields, dbIndex),
  };
}

// Only things worth acting on. A name placed more than once is deliberate and
// fully supported, so it is not listed here.
//
// Every issue carries the ids it counted, so the panel can filter the list down
// to exactly the fields it is complaining about. A count on its own means going
// hunting through eighty rows to find the three it meant.
//
// isRuntimeFilled says which dropdowns the starter code fills on load. It is
// passed in rather than imported: this module is the base model and depends on
// nothing, while the naming rule it needs lives in specialFields.js, which
// depends on this one.
export function fieldIssues(
  fields,
  dbIndex,
  systemIndex = new Map(),
  isRuntimeFilled = () => false
) {
  const issues = [];
  const plural = (n, one, many) => (n === 1 ? one : many);

  // Reports one issue naming the fields it matched, or nothing when none did.
  const count = (level, matches, describe) => {
    const hit = fields.filter(matches);
    if (hit.length === 0) return;
    issues.push({ level, text: describe(hit.length), ids: hit.map((f) => f.id) });
  };

  for (const f of fields) {
    const entry = systemIndex.get(f.name.trim());
    if (entry && entry.type !== f.type) {
      issues.push({
        level: 'error',
        text: `"${f.name.trim()}" is a system field and must be ${entry.type}, not ${f.type}.`,
        ids: [f.id],
      });
    }
  }

  count(
    'error',
    (f) => !f.name.trim(),
    (n) => `${n} field${plural(n, '', 's')} ha${plural(n, 's', 've')} no name.`
  );

  // The filler matches the database value against the export value exactly, so
  // a missing or unencodable one is a silent no-fill, not a cosmetic problem.
  count(
    'error',
    (f) => EXPORT_VALUE_TYPES.includes(f.type) && !f.exportValue.trim(),
    (n) =>
      `${n} checkbox or radio field${plural(n, '', 's')} ha${plural(n, 's', 've')} no export value.`
  );

  for (const f of fields) {
    if (!EXPORT_VALUE_TYPES.includes(f.type)) continue;
    const value = f.exportValue.trim();
    if (value && !EXPORT_VALUE_PATTERN.test(value)) {
      issues.push({
        level: 'error',
        text: `Export value "${value}" needs letters, digits, dot, dash or underscore only.`,
        ids: [f.id],
      });
    }
  }

  // A signer name menu is filled from the DNA data on load, so it is meant to be
  // empty here. Counting it would put a permanent warning on every form that has
  // signers.
  count(
    'warn',
    (f) => f.type === 'dropdown' && f.options.length === 0 && !isRuntimeFilled(f.name),
    (n) => `${n} dropdown${plural(n, ' has', 's have')} no options.`
  );

  // A name outside the DB list is not a fault. Plenty of fields are typed into
  // by hand and never filled, so counting them put a number on the panel that
  // was healthy on every form. It is a filter worth having, not a warning.

  return issues;
}

