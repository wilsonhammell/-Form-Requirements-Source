import { useEffect, useMemo, useRef } from 'react';
import { isLoadAttempted } from '../core/schema.js';
import { fieldTone, TONE_TITLE } from '../core/fieldTone.js';

// The dot beside each row, one class per tone.
const DOT = {
  button: 'bg-violet-500',
  special: 'bg-teal-600',
  system: 'bg-slate-400',
  attempted: 'bg-emerald-600',
  standard: 'bg-blue-500',
};

// Mirror of what is on the canvas. Selecting here selects there and the other
// way round.
//
// More than one row can be selected, because setting the same validation flag on
// forty fields one at a time is the bulk of the work on an imported form. Shift
// extends from the last row clicked, Ctrl or Cmd adds and removes one. The
// property panel still edits the last one clicked, the bulk bar handles the set.
//
// Two shapes here, matching what Acrobat's Fields panel does:
//
//   A radio group is nested, because its options are genuinely parts of one
//   field. Each option is labelled by its export value, not a number, since the
//   value is what tells the options apart. Two options may carry the same value
//   and both show it, that being radios in unison rather than a mistake.
//
//   Any other repeated name stays a flat row with a #0, #1 suffix. A checkbox
//   placed twice is still just a field placed twice, so it reads as one.
//
// Either way the suffix is display only, exactly as in Acrobat, and never
// reaches the stored name.
// The order rows appear in, grouped by page then by name. Arrow key navigation
// needs the same order the eye sees, so it is worked out here and exported
// rather than guessed at from the unsorted field array.
export function fieldListOrder(fields) {
  const ids = [];
  for (const [, pageFields] of groupByPage(fields)) {
    for (const group of groupByName(pageFields)) {
      for (const field of group.fields) ids.push(field.id);
    }
  }
  return ids;
}

// Page number to its fields, lowest page first, which is the order rows render
// in and the order arrow keys walk.
function groupByPage(fields) {
  const byPage = new Map();
  for (const field of fields) {
    if (!byPage.has(field.page)) byPage.set(field.page, []);
    byPage.get(field.page).push(field);
  }
  return [...byPage.entries()].sort((a, b) => a[0] - b[0]);
}

export default function FieldList({
  fields,
  selectedId,
  selectedIds,
  dbIndex,
  systemIndex,
  canonicalIds,
  onSelect,
  onGoToPage,
}) {
  const selectedRef = useRef(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // Numbering runs across the whole document, not per page, since one field's
  // placements can sit on different pages. The running count doubles as the
  // final total once every field has been walked.
  const placement = useMemo(() => {
    const indexById = new Map();
    const countByName = new Map();
    for (const field of fields) {
      const name = field.name.trim();
      if (!name) continue;
      const n = countByName.get(name) ?? 0;
      indexById.set(field.id, n);
      countByName.set(name, n + 1);
    }
    return { indexById, countByName };
  }, [fields]);

  if (fields.length === 0) {
    return <p className="px-3 py-4 text-sm text-slate-500">No fields yet.</p>;
  }

  const pages = groupByPage(fields);

  const rowProps = (field) => ({
    field,
    selected: selectedIds ? selectedIds.has(field.id) : field.id === selectedId,
    primary: field.id === selectedId,
    attempted: isLoadAttempted(field.name, dbIndex),
    // Only the canonical placement reads as a system field. The extra copies
    // are there to show the value on the form, so they read as ordinary ones.
    system: canonicalIds?.has(field.id) ?? false,
    onSelect,
    onGoToPage,
  });

  return (
    <ul className="divide-y divide-slate-100">
      {pages.map(([page, pageFields]) => (
        <li key={page}>
          <div className="sticky top-0 z-10 bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Page {page + 1}
          </div>
          <ul>
            {groupByName(pageFields).map((group) => {
              // Only a radio group is a real parent. Anything else repeated is
              // just one field placed more than once, so it stays flat and is
              // numbered instead.
              const isRadioGroup = group.name && group.fields[0].type === 'radio';
              if (!isRadioGroup) {
                const repeated = group.name && placement.countByName.get(group.name) > 1;
                return group.fields.map((field) => (
                  <li key={field.id} ref={field.id === selectedId ? selectedRef : null}>
                    <FieldRow
                      {...rowProps(field)}
                      index={repeated ? placement.indexById.get(field.id) : undefined}
                    />
                  </li>
                ));
              }

              return (
                <li key={group.name}>
                  <div className="flex items-baseline gap-2 px-3 pb-0.5 pt-1.5">
                    <span className="truncate font-mono text-xs font-semibold text-slate-700">
                      {group.name}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      radio group, {placement.countByName.get(group.name)} option
                      {placement.countByName.get(group.name) === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="ml-3 border-l border-slate-200">
                    {group.fields.map((field) => (
                      <li key={field.id} ref={field.id === selectedId ? selectedRef : null}>
                        <FieldRow {...rowProps(field)} asOption />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// Placements of one name are shown together even when something else was drawn
// between them.
function groupByName(pageFields) {
  const groups = new Map();
  const loose = [];
  for (const field of pageFields) {
    const name = field.name.trim();
    if (!name) {
      loose.push({ name: '', fields: [field] });
      continue;
    }
    if (!groups.has(name)) groups.set(name, { name, fields: [] });
    groups.get(name).fields.push(field);
  }
  return [...groups.values(), ...loose];
}

function FieldRow({
  field,
  selected,
  primary,
  attempted,
  system,
  index,
  asOption,
  onSelect,
  onGoToPage,
}) {
  const tone = fieldTone(field, { system, attempted });
  // Inside a radio group the option's own value is its identity, so it stands in
  // for the name rather than repeating the group name on every row.
  const label = asOption ? field.exportValue || '(no value)' : field.name || '(unnamed)';
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
        selected
          ? `bg-sky-50 ring-1 ring-inset ${primary ? 'ring-sky-400' : 'ring-sky-200'}`
          : 'hover:bg-slate-50'
      }`}
      onClick={(event) => {
        onSelect(field.id, { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
        onGoToPage(field.page);
      }}
    >
      <span
        className={`h-2 w-2 shrink-0 ${system ? 'rotate-45' : 'rounded-full'} ${DOT[tone]}`}
        title={TONE_TITLE[tone]}
      />
      <span
        className={`flex-1 truncate font-mono text-xs ${
          (asOption ? field.exportValue : field.name) ? 'text-slate-800' : 'italic text-slate-400'
        }`}
        title={asOption ? `Export value: ${field.exportValue}` : field.name}
      >
        {label}
        {index !== undefined && <span className="text-slate-400">#{index}</span>}
      </span>

      {field.loadValidated && (
        <span
          className="rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800"
          title="Load Validation"
        >
          LV
        </span>
      )}
      {field.saveValidated && (
        <span
          className="rounded bg-sky-100 px-1 text-[10px] font-medium text-sky-800"
          title="Save Validation"
        >
          SV
        </span>
      )}
      {field.customSaveValidated && (
        <span
          className="rounded bg-violet-100 px-1 text-[10px] font-medium text-violet-800"
          title={`Custom Save Validation: ${field.note}`}
        >
          SV*
        </span>
      )}
      {field.hidden && (
        <span
          className="rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600"
          title="Hidden, not shown or printed"
        >
          HID
        </span>
      )}
      {!field.editable && (
        <span
          className="rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-600"
          title="Read-only"
        >
          RO
        </span>
      )}
      <span className="w-12 shrink-0 text-right text-[10px] text-slate-400">{field.type}</span>
    </button>
  );
}
