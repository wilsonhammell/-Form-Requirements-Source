import NameCombobox from './NameCombobox.jsx';
import OptionsEditor from './OptionsEditor.jsx';
import { isSystemField } from '../core/systemFields.js';
import { parseSpecialName } from '../core/specialFields.js';
import { isSubmissionButton } from '../core/signingButtons.js';
import {
  isLoadAttempted,
  FONT_FAMILIES,
  TEXT_ALIGNMENTS,
  TEXT_RENDERING_TYPES,
  EXPORT_VALUE_TYPES,
  EXPORT_VALUE_PATTERN,
} from '../core/schema.js';

// One line per family. The eSign pair used to fall through to the joint text,
// which described neither what it is nor where it lives.
const SPECIAL_NOTE = {
  signer: (part) =>
    `Signer row ${part.index}. Its name says which row and which part, so rows stay numbered 1 up with no gaps. Deleting the last part of a row renumbers the rows after it.`,
  joint: () =>
    'Joint member row, filled from DNA by the starter code. The numbered rows and the combined line are filled independently, so a form can carry either or both.',
  combinedJoint: () =>
    'Every joint name on one line, joined by commas. Independent of the numbered rows, so a form can carry both.',
  esign: () =>
    'Part of the Remote eSign cluster. It is placed, moved and removed with RemoteESignButton, and starts hidden until the starter code reveals it.',
};

const LABEL = 'block text-xs font-medium text-slate-600';
const INPUT =
  'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500';
const CHECK =
  'h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-50';
const HINT = 'text-xs text-slate-400';

const BANNER = {
  submission: 'border-violet-200 bg-violet-50 text-violet-900',
  system: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  special: 'border-teal-200 bg-teal-50 text-teal-900',
  imported: 'border-slate-300 bg-slate-50 text-slate-600',
};

function Banner({ tone, children }) {
  return <p className={`rounded border px-2 py-1.5 text-xs ${BANNER[tone]}`}>{children}</p>;
}

// Disabled says the flag cannot stand on this field, so it also greys the text.
function Check({ label, checked, onChange, disabled = false, hint = null }) {
  return (
    <label
      className={`flex items-center gap-2 text-sm ${disabled ? 'text-slate-400' : 'text-slate-800'}`}
    >
      <input
        type="checkbox"
        className={CHECK}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
      {hint && <span className={HINT}>{hint}</span>}
    </label>
  );
}

function Fact({ term, children }) {
  return (
    <>
      <dt className="text-slate-500">{term}</dt>
      <dd className="text-right font-mono text-slate-700">{children}</dd>
    </>
  );
}

export default function PropertyPanel({
  field,
  dbFields,
  dbIndex,
  caseIndex,
  systemIndex,
  buttonIndex,
  specialNames = [],
  locked,
  pageCount,
  onChange,
  onDelete,
  onDuplicate,
}) {
  if (!field) {
    return (
      <div className="p-4 text-sm text-slate-500">
        Select a field, or drag on the page to draw one.
      </div>
    );
  }

  const system = isSystemField(field.name, systemIndex);
  const specialPart = parseSpecialName(field.name);
  const submission = isSubmissionButton(field.name, buttonIndex);
  // A pushbutton has no value, so none of the value machinery applies to it.
  const carriesValue = field.type !== 'button';
  const attempted = isLoadAttempted(field.name, dbIndex);
  const hasNote = field.note.trim().length > 0;
  const hasCustomerName = field.customerFacingName.trim().length > 0;
  const canLoadValidate = attempted && hasCustomerName;
  // The filler compares the database value against this exactly, so an empty or
  // unencodable one means the field silently never fills.
  const exportValueProblem = !EXPORT_VALUE_TYPES.includes(field.type)
    ? null
    : !field.exportValue.trim()
      ? 'Required. Without it this field can never be filled.'
      : !EXPORT_VALUE_PATTERN.test(field.exportValue.trim())
        ? 'Letters, digits, dot, dash and underscore only.'
        : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      {submission && (
        <Banner tone="submission">
          Submission button. Its name and caption come from the button list, and it is turned on
          and off from the Config tab. Position is yours, the size is fixed.
        </Banner>
      )}

      {system && (
        <Banner tone="system">
          System field, read by the starter code.{' '}
          {locked
            ? 'This is its only placement, so the name is fixed and it cannot be removed. Position, size and visibility are still yours.'
            : 'An extra placement, so this one is free to rename or remove. It shares one value with the others.'}
        </Banner>
      )}

      {specialPart && (
        <Banner tone="special">
          {SPECIAL_NOTE[specialPart.family](specialPart)}
          {specialPart.type === 'dropdown' &&
            ' Its options are built at run time from DNA, so it has none here.'}
        </Banner>
      )}

      {field.imported && (
        <Banner tone="imported">
          Rebuilt from the PDF's existing form fields. Name and position are inferred, confirm
          them before exporting.
        </Banner>
      )}

      {locked || submission ? (
        <div>
          <label className={LABEL}>Name</label>
          <input
            type="text"
            readOnly
            value={field.name}
            className="mt-1 w-full cursor-not-allowed rounded border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-sm text-slate-600"
          />
        </div>
      ) : (
        <NameCombobox
          value={field.name}
          dbFields={dbFields}
          dbIndex={dbIndex}
          caseIndex={caseIndex}
          specialNames={specialNames}
          onChange={(name) => onChange({ name })}
        />
      )}

      {carriesValue && (
        <div>
          <label className={LABEL}>Error Message Field Name</label>
          <input
            type="text"
            value={field.customerFacingName}
            placeholder="What the error message should call this field"
            className={INPUT}
            onChange={(e) => onChange({ customerFacingName: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-500">
            Names the field in the load validation error message, so write what a member
            reads beside the box. The same DB field reads differently form to form, so it
            belongs to the placement.
          </p>
        </div>
      )}

      {/* Every field level toggle sits above the type specific controls, so
          none of them ends up under the fold on a type that carries a lot. */}
      <div className="flex flex-col gap-2">
        <Check
          label="Editable"
          checked={field.editable}
          onChange={(editable) => onChange({ editable })}
          hint={field.editable ? 'fillable' : 'read-only'}
        />

        <Check
          label="Hidden"
          checked={field.hidden}
          onChange={(hidden) => onChange({ hidden })}
          hint={field.hidden ? 'not shown or printed' : null}
        />

        {carriesValue && (
          <>
            {/* Load Validation is a claim about a specific label on a specific
                form, so it needs a DB match and the Error Message Field Name.
                Save Validation needs neither and stands on every field. */}
            <Check
              label="Load Validation"
              checked={field.loadValidated}
              disabled={!canLoadValidate}
              onChange={(loadValidated) => onChange({ loadValidated })}
              hint={attempted && !hasCustomerName ? 'needs an Error Message Field Name' : null}
            />

            {/* The two save flags are mutually exclusive, checking one clears
                the other. Custom also needs a note describing the situation. */}
            <Check
              label="Save Validation"
              checked={field.saveValidated}
              onChange={(on) =>
                onChange(on ? { saveValidated: true, customSaveValidated: false } : { saveValidated: false })
              }
            />

            <Check
              label="Custom Save Validation"
              checked={field.customSaveValidated}
              disabled={!hasNote}
              onChange={(on) =>
                onChange(on ? { customSaveValidated: true, saveValidated: false } : { customSaveValidated: false })
              }
              hint={hasNote ? null : 'needs a note'}
            />
          </>
        )}
      </div>

      <div>
        <label className={LABEL}>Note</label>
        <textarea
          rows={3}
          value={field.note}
          placeholder="Describe anything unusual about this field."
          className={`${INPUT} resize-y`}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </div>

      {EXPORT_VALUE_TYPES.includes(field.type) && (
        <div>
          <label className={LABEL}>Export value</label>
          <input
            type="text"
            value={field.exportValue}
            spellCheck={false}
            autoComplete="off"
            placeholder={field.type === 'radio' ? 'Value for this option' : 'Yes'}
            className={`mt-1 w-full rounded border px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 ${
              exportValueProblem
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                : 'border-slate-300 focus:border-sky-500 focus:ring-sky-500'
            }`}
            onChange={(e) => onChange({ exportValue: e.target.value })}
          />
          <p className={`mt-1 text-xs ${exportValueProblem ? 'text-red-700' : 'text-slate-500'}`}>
            {exportValueProblem ??
              (field.type === 'radio'
                ? 'The value written when this option is the one chosen.'
                : 'The value written when this box is ticked.')}
          </p>
        </div>
      )}

      {field.type === 'dropdown' && (
        <OptionsEditor options={field.options} onChange={(options) => onChange({ options })} />
      )}

      {TEXT_RENDERING_TYPES.includes(field.type) && (
        <div>
          <label className={LABEL}>Font</label>
          <div className="mt-1 flex gap-2">
            <select
              className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              value={field.font.family}
              onChange={(e) => onChange({ font: { ...field.font, family: e.target.value } })}
            >
              {FONT_FAMILIES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={4}
              max={72}
              step={0.5}
              value={field.font.size}
              className="w-16 rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              onChange={(e) => onChange({ font: { ...field.font, size: Number(e.target.value) } })}
            />
          </div>

          {/* Alignment and wrapping are field level, like the font, so every
              placement of a name shares them. Same as Acrobat. */}
          <div className="mt-2 flex gap-1.5">
            {TEXT_ALIGNMENTS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={field.alignment === value}
                className={`flex-1 rounded border px-2 py-1 text-xs ${
                  field.alignment === value
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => onChange({ alignment: value })}
              >
                {label}
              </button>
            ))}
          </div>

          {field.type === 'text' && (
            <div className="mt-2">
              <Check
                label="Multiline"
                checked={field.multiline}
                onChange={(multiline) => onChange({ multiline })}
                hint={field.multiline ? 'wraps' : 'one line'}
              />
            </div>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-slate-50 p-2 text-xs">
        <Fact term="Type">{field.type}</Fact>
        <Fact term="Page">
          {field.page + 1} of {pageCount || '?'}
        </Fact>
        <Fact term="x, y">
          {round(field.rect.x)}, {round(field.rect.y)}
        </Fact>
        <Fact term="w x h">
          {round(field.rect.width)} x {round(field.rect.height)}
        </Fact>
        <dt className="col-span-2 pt-1 text-[10px] uppercase tracking-wide text-slate-400">
          PDF user space, points
        </dt>
      </dl>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={submission}
          title={submission ? 'A submission button appears at most once.' : undefined}
          className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
          onClick={onDuplicate}
        >
          Duplicate
        </button>
        <button
          type="button"
          disabled={locked}
          title={locked ? 'A system field must keep at least one placement.' : undefined}
          className="flex-1 rounded border border-red-300 px-2 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400 disabled:hover:bg-transparent"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

const round = (n) => Math.round(n * 100) / 100;
