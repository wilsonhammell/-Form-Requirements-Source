import { useEffect, useRef, useState } from 'react';
import { FORM_TYPES, ENVIRONMENTS, parseProductCodes } from '../core/schema.js';
import {
  SIGNER_PARTS,
  JOINT_PARTS,
  COMBINED_JOINT_NAME,
  SIGNER_PREFIX,
  JOINT_PREFIX,
} from '../core/specialFields.js';

// Built from the one definition rather than spelled out here. A name this panel
// invents that the picker would not offer is refused silently, so the button
// would simply stop working.
const rowName = (prefix, index, part) => `${prefix}${index}${part.suffix}`;
const jointNamePart = JOINT_PARTS.find((p) => p.key === 'name');

const LABEL = 'block text-xs font-medium text-slate-600';
const HELP = 'mt-1 text-xs text-slate-500';
const ACTION =
  'rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';
const CHIP = 'rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-800 ring-1 ring-teal-200';

// One row of segmented buttons. Production takes amber rather than sky, since
// it is the choice worth noticing.
function Choice({ options, value, onPick, alert = null }) {
  return (
    <div className="mt-1 flex gap-1.5">
      {options.map(({ value: option, label }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          className={`flex-1 rounded border px-2 py-1.5 text-sm ${
            value !== option
              ? 'border-slate-300 text-slate-700 hover:bg-slate-50'
              : option === alert
                ? 'border-amber-600 bg-amber-600 text-white'
                : 'border-sky-600 bg-sky-600 text-white'
          }`}
          onClick={() => onPick(option)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// A part a row is missing reads as a dashed button that places it. Without it,
// putting back a deleted part means drawing a box and knowing to look in the
// name picker.
function PartChip({ present, label, name, onPlace }) {
  if (present) return <span className={CHIP}>{label}</span>;
  return (
    <button
      type="button"
      className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-teal-400 hover:text-teal-700"
      onClick={() => onPlace(name)}
    >
      + {label}
    </button>
  );
}

// Signer rows and joint rows read the same, so they are drawn the same. Both
// are entirely derived from what is on the page, so there is nothing to set.
function RowList({ rows, prefix, parts, width, onPlace }) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {rows.map((row, i) => (
        <li key={i} className="flex flex-wrap items-center gap-1.5">
          <span className={`${width} shrink-0 font-mono text-xs text-slate-700`}>
            {prefix}
            {i + 1}
          </span>
          {parts.map((part) => (
            <PartChip
              key={part.key}
              present={row[part.key]}
              label={part.label}
              name={rowName(prefix, i + 1, part)}
              onPlace={onPlace}
            />
          ))}
        </li>
      ))}
    </ul>
  );
}

// Stored as typed, so a space survives the config being rebuilt on every
// keystroke, and trimmed when the box is left.
function TextSetting({ label, value, onChange }) {
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <input
        type="text"
        spellCheck={false}
        value={value}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => {
          const trimmed = e.target.value.trim();
          if (trimmed !== e.target.value) onChange(trimmed);
        }}
      />
    </div>
  );
}

// A plain yes or no, drawn the way the submission buttons are.
function CheckSetting({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-800">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

// Form level settings, one set for the whole document, carried in the
// requirements JSON.
export default function FormConfigPanel({
  config,
  onChange,
  buttons = [],
  isButtonOn,
  onToggleButton,
  signerRows = [],
  jointRows = [],
  hasCombined = false,
  maxSignerRows = 6,
  maxJointRows = 5,
  onAddSignerRow,
  onPlaceSpecial,
}) {
  // The codes box is free text while it is being typed, so a trailing comma or
  // a half typed code does not vanish under the cursor. It is parsed into the
  // stored list on every change, and only reformatted when the field is left.
  const [draft, setDraft] = useState(() => config.productCodes.join(', '));

  // Typing rebuilds the stored list, which arrives back as a new array every
  // keystroke. Resyncing on that would rewrite the box mid-word and swallow the
  // separator just typed, so a change this box caused is skipped. Only a config
  // from elsewhere, opening a PDF or importing JSON, refills it.
  const typing = useRef(false);
  useEffect(() => {
    if (typing.current) {
      typing.current = false;
      return;
    }
    setDraft(config.productCodes.join(', '));
  }, [config.productCodes]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <TextSetting
        label="Form Menu Group(s)"
        value={config.formMenuGroups}
        onChange={(formMenuGroups) => onChange({ formMenuGroups })}
      />

      <TextSetting
        label="Form ID"
        value={config.formId}
        onChange={(formId) => onChange({ formId })}
      />

      <TextSetting
        label="Form Description"
        value={config.formDescription}
        onChange={(formDescription) => onChange({ formDescription })}
      />

      <TextSetting
        label="FO Cabinet"
        value={config.foCabinet}
        onChange={(foCabinet) => onChange({ foCabinet })}
      />

      <div className="flex flex-col gap-1.5">
        <CheckSetting
          label="Post Processing"
          checked={config.postProcessing}
          onChange={(postProcessing) => onChange({ postProcessing })}
        />
        <CheckSetting
          label="Admin Queue"
          checked={config.adminQueue}
          onChange={(adminQueue) => onChange({ adminQueue })}
        />
        <CheckSetting
          label="Support Services"
          checked={config.supportServices}
          onChange={(supportServices) => onChange({ supportServices })}
        />
      </div>

      <div>
        <label className={LABEL}>Form type</label>
        <Choice
          options={FORM_TYPES}
          value={config.formType}
          onPick={(formType) => onChange({ formType })}
        />
        <p className={HELP}>Who this form is about.</p>
      </div>

      <div>
        <label className={LABEL}>FileOptics environment</label>
        <Choice
          options={ENVIRONMENTS}
          value={config.environment}
          alert="PROD"
          onPick={(environment) => onChange({ environment })}
        />
        <p className={HELP}>
          Which endpoint the submit paths send to, and the flow id they use. Defaults to Test, so a
          form that never gets touched fails safe rather than talking to the live system.
        </p>
      </div>

      <div>
        <label className={LABEL}>Product codes</label>
        <textarea
          rows={5}
          spellCheck={false}
          value={draft}
          placeholder="M101, RSP, C101, LMNOP"
          className="mt-1 w-full resize-y rounded border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          onChange={(e) => {
            typing.current = true;
            setDraft(e.target.value);
            onChange({ productCodes: parseProductCodes(e.target.value) });
          }}
          onBlur={() => setDraft(config.productCodes.join(', '))}
        />
        <p className={HELP}>
          Paste them separated by commas or new lines. Whitespace is trimmed and repeats are
          dropped. Case is kept as typed.
        </p>
      </div>

      <div className="rounded bg-slate-50 p-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            {config.productCodes.length} code{config.productCodes.length === 1 ? '' : 's'}
          </span>
          {config.productCodes.length > 0 && (
            <button
              type="button"
              className="text-[10px] text-slate-500 underline decoration-dotted"
              onClick={() => onChange({ productCodes: [] })}
            >
              clear
            </button>
          )}
        </div>
        {config.productCodes.length === 0 ? (
          <p className={HELP}>None yet.</p>
        ) : (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {config.productCodes.map((code) => (
              <li
                key={code}
                className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-700 ring-1 ring-slate-200"
              >
                {code}
              </li>
            ))}
          </ul>
        )}
      </div>

      {buttons.length > 0 && (
        <div>
          <label className={LABEL}>Submission buttons</label>
          <div className="mt-1 flex flex-col gap-1.5">
            {buttons.map((entry) => (
              <label key={entry.identifier} className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  checked={isButtonOn(entry.identifier)}
                  onChange={(e) => onToggleButton(entry, e.target.checked)}
                />
                {entry.caption}
                <span className="font-mono text-[10px] text-slate-400">{entry.identifier}</span>
              </label>
            ))}
          </div>
          <p className={HELP}>
            Placing a button is what says this form offers that channel. They start hidden and are
            shown by the starter code.
          </p>
        </div>
      )}

      {/* Read only from here down. Every one of these follows from what is on
          the page, so there is nothing to set and nothing to fall out of step. */}
      <div>
        <label className={LABEL}>Signer rows</label>
        {signerRows.length === 0 ? (
          <p className={HELP}>None placed.</p>
        ) : (
          <RowList
            rows={signerRows}
            prefix={SIGNER_PREFIX}
            parts={SIGNER_PARTS}
            width="w-16"
            onPlace={onPlaceSpecial}
          />
        )}
        <button
          type="button"
          disabled={signerRows.length >= maxSignerRows}
          className={`mt-1.5 ${ACTION}`}
          onClick={onAddSignerRow}
        >
          Add signer row
        </button>
        <p className={HELP}>
          Drops all three parts on the page to drag into place. Draw a box and name it instead to
          place one on its own. Caps at {maxSignerRows}, the eSign slot count.
        </p>
      </div>

      <div>
        <label className={LABEL}>Joint members</label>

        <p className={HELP}>
          Two shapes, filled independently. Numbered rows hold one member each and stop at{' '}
          {maxJointRows}, the combined line takes every name joined by commas. A form can carry
          either, both, or neither.
        </p>

        {jointRows.length > 0 && (
          <RowList
            rows={jointRows}
            prefix={JOINT_PREFIX}
            parts={JOINT_PARTS}
            width="w-24"
            onPlace={onPlaceSpecial}
          />
        )}

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={jointRows.length >= maxJointRows}
            className={ACTION}
            onClick={() => onPlaceSpecial(rowName(JOINT_PREFIX, jointRows.length + 1, jointNamePart))}
          >
            Add joint row
          </button>
          {hasCombined ? (
            <span className="rounded bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200">
              {COMBINED_JOINT_NAME} placed
            </span>
          ) : (
            <button type="button" className={ACTION} onClick={() => onPlaceSpecial(COMBINED_JOINT_NAME)}>
              Add combined line
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
