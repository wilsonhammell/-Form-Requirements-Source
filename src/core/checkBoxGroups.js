// Check boxes sharing a name are one field, so they tick in unison or as radios,
// never independently. Dotted names (Reason.A, Reason.B) keep them separate
// fields, and the part before the last dot groups them, the way Acrobat nests
// them under a parent. A group needs two names, so a dotted box on its own is an
// ordinary one.
//
// Save Validation belongs to the group: set on one box, it is set on all of
// them, and the form asks for at least one ticked rather than every one.

export function checkBoxParent(field) {
  if (field.type !== 'checkbox') return null;
  const name = field.name.trim();
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(0, dot) : null;
}

/** parent -> member names, in the order they first appear. Groups only. */
export function checkBoxGroups(fields) {
  const byParent = new Map();
  for (const field of fields) {
    const parent = checkBoxParent(field);
    if (!parent) continue;
    const members = byParent.get(parent) ?? [];
    const name = field.name.trim();
    if (!members.includes(name)) members.push(name);
    byParent.set(parent, members);
  }
  for (const [parent, members] of byParent) {
    if (members.length < 2) byParent.delete(parent);
  }
  return byParent;
}

// What a Save Validation change on one box hands the rest of its group. The two
// save flags are mutually exclusive, so turning it on clears Custom as well.
function groupSavePatch(patch) {
  if (patch.saveValidated === undefined) return null;
  return patch.saveValidated
    ? { saveValidated: true, customSaveValidated: false }
    : { saveValidated: false };
}

/**
 * Carries a Save Validation change made on the named boxes to every box in
 * their groups. Fields that take it are passed through reconcile.
 */
export function spreadGroupSave(fields, names, patch, reconcile = (f) => f) {
  const shared = groupSavePatch(patch);
  if (!shared) return fields;
  const groups = checkBoxGroups(fields);
  const parents = new Set(
    fields
      .filter((f) => names.has(f.name.trim()))
      .map(checkBoxParent)
      .filter((p) => p && groups.has(p))
  );
  if (parents.size === 0) return fields;
  return fields.map((f) =>
    parents.has(checkBoxParent(f)) ? reconcile({ ...f, ...shared }) : f
  );
}

/**
 * A box named into a group takes the group's Save Validation, the way a box
 * named after an existing field takes that field's values.
 */
export function adoptGroupSave(field, fields) {
  const parent = checkBoxParent(field);
  if (!parent) return field;
  const name = field.name.trim();
  if (fields.some((f) => f.id !== field.id && f.name.trim() === name)) return field;
  const mates = fields.filter((f) => f.id !== field.id && checkBoxParent(f) === parent);
  if (mates.length === 0) return field;
  const saveValidated = mates.some((f) => f.saveValidated);
  if (saveValidated === field.saveValidated) return field;
  return { ...field, ...groupSavePatch({ saveValidated }) };
}
