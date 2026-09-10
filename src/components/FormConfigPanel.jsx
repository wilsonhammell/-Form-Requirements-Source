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

// Form level settings, one set for the whole document. Nothing here changes the
// exported AcroForm, it is carried in the requirements JSON for whatever
// generates code from it later.
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
  // A part a row is missing reads as a dashed button that places it. Without
  // it, putting back a deleted part means drawing a box and knowing to look in
  // the name picker.
  const partChip = (present, label, name) =>
    present ? (
      <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-800 ring-1 ring-teal-200">
        {label}
      </span>
    ) : (
      <button
        type="button"
        className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-500 hover:border-teal-400 hover:text-teal-700"
        onClick={() => onPlaceSpecial(name)}
      >
        + {label}
      </button>
    );
  // The codes box is free text while it is being typed, so a trailing comma or
  // a half typed code does not vanish under the cursor. It is parsed into the
  // stored list on every change, and only reformatted when the field is left.
  const [draft, setDraft] = useState(() => config.productCodes.join(', '));

  // Typing rebuilds the stored list, which arrives back here as a brand new
  // array every keystroke. Resyncing on that would rewrite the box from the
  // parsed list mid-word and swallow the separator just typed, so a change this
  // box caused is skipped. Only a config from elsewhere, opening a PDF or
  // importing JSON, refills it.
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
      <div>
        <label className="block text-xs font-medium text-slate-600">Form type</label>
        <div className="mt-1 flex gap-1.5">
          {FORM_TYPES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={config.formType === value}
              className={`flex-1 rounded border px-2 py-1.5 text-sm ${
                config.formType === value
                  ? 'border-sky-600 bg-sky-600 text-white'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              onClick={() => onChange({ formType: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">Who this form is about.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">FileOptics environment</label>
        <div className="mt-1 flex gap-1.5">
          {ENVIRONMENTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={config.environment === value}
              className={`flex-1 rounded border px-2 py-1.5 text-sm ${
                config.environment === value
                  ? value === 'PROD'
                    ? 'border-amber-600 bg-amber-600 text-white'
                    : 'border-sky-600 bg-sky-600 text-white'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
              onClick={() => onChange({ environment: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Which endpoint the submit paths send to, and the flow id they use. Defaults to Test, so a
          form that never gets touched fails safe rather than talking to the live system.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Product codes</label>
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
        <p className="mt-1 text-xs text-slate-500">
          Paste them separated by commas or new lines. Whitespace is trimmed and
          repeats are dropped. Case is kept as typed.
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
          <p className="mt-1 text-xs text-slate-500">None yet.</p>
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
          <label className="block text-xs font-medium text-slate-600">Submission buttons</label>
          <div className="mt-1 flex flex-col gap-1.5">
            {buttons.map((entry) => (
              <label
                key={entry.identifier}
                className="flex items-center gap-2 text-sm text-slate-800"
              >
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
          <p className="mt-1 text-xs text-slate-500">
            Placing a button is what says this form offers that channel. They start hidden and are
            shown by the starter code.
          </p>
        </div>
      )}

      {/* Read only. Every one of these follows from what is on the page, so
          there is nothing here to set and nothing to fall out of step. */}
      <div>
        <label className="block text-xs font-medium text-slate-600">Signer rows</label>
        {signerRows.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">None placed.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {signerRows.map((row, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 shrink-0 font-mono text-xs text-slate-700">
                  {SIGNER_PREFIX}
                  {i + 1}
                </span>
                {SIGNER_PARTS.map((part) => (
                  <span key={part.key}>
                    {partChip(row[part.key], part.label, rowName(SIGNER_PREFIX, i + 1, part))}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          disabled={signerRows.length >= maxSignerRows}
          className="mt-1.5 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onAddSignerRow}
        >
          Add signer row
        </button>
        <p className="mt-1 text-xs text-slate-500">
          Drops all three parts on the page to drag into place. Draw a box and name it instead to
          place one on its own. Caps at {maxSignerRows}, the eSign slot count.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600">Joint members</label>

        <p className="mt-1 text-xs text-slate-500">
          Two shapes, filled independently. Numbered rows hold one member each and stop at{' '}
          {maxJointRows}, the combined line takes every name joined by commas. A form can carry
          either, both, or neither.
        </p>

        {jointRows.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-1">
            {jointRows.map((row, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-700">
                  {JOINT_PREFIX}
                  {i + 1}
                </span>
                {JOINT_PARTS.map((part) => (
                  <span key={part.key}>
                    {partChip(row[part.key], part.label, rowName(JOINT_PREFIX, i + 1, part))}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={jointRows.length >= maxJointRows}
            className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() =>
              onPlaceSpecial(rowName(JOINT_PREFIX, jointRows.length + 1, jointNamePart))
            }
          >
            Add joint row
          </button>
          {hasCombined ? (
            <span className="rounded bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200">
              {COMBINED_JOINT_NAME} placed
            </span>
          ) : (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => onPlaceSpecial(COMBINED_JOINT_NAME)}
            >
              Add combined line
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
