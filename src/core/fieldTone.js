// Which family a field reads as on screen, and the one place that decides it.
//
// The canvas and the field list both colour a field by the same rule, and both
// used to spell it out as a chain of ternaries, once per thing being coloured.
// Five copies of one priority order is five chances for them to drift, so the
// order lives here and each view only maps a tone to its own classes.
//
// system and attempted are passed in rather than derived: both need an index the
// caller already holds, and system means the canonical placement rather than
// merely a system name.

import { isSpecialField, isEsignField } from './specialFields.js';

export const FIELD_TONES = ['button', 'special', 'system', 'attempted', 'standard'];

export function fieldTone(field, { system = false, attempted = false } = {}) {
  if (field.type === 'button') return 'button';
  // Teal marks the signer and joint families: visible and member facing, unlike
  // the grey system fields.
  if (isSpecialField(field.name)) return 'special';
  if (system) return 'system';
  return attempted ? 'attempted' : 'standard';
}

// Which group a field belongs to for the view filter. Every field lands in
// exactly one, so the four together are the whole form and any subset is a
// legible view.
//
// Order matters. The eSign label and code box are special fields, but they
// belong to the Remote eSign button rather than to the signers, so they are
// claimed first.
export const FIELD_SCOPES = ['standard', 'system', 'signers', 'submission'];

export function fieldScope(field, { system = false, submissionButton = false } = {}) {
  if (submissionButton || isEsignField(field.name)) return 'submission';
  if (isSpecialField(field.name)) return 'signers';
  if (system) return 'system';
  return 'standard';
}

// What each tone means, shown as the title on the field list's dot.
export const TONE_TITLE = {
  button: 'Submission button',
  special: 'Signer or joint field, its row shape drives the starter code',
  system: 'System field, read by the starter code',
  attempted: 'Load Attempted',
  standard: 'Custom name',
};

// The same tones as hex, for anything outside the app that cannot use a class.
// Tailwind's teal-600, emerald-600, blue-500, violet-500 and slate-400, so a
// field reads the same colour in the requirements workbook as on screen.
export const TONE_HEX = {
  button: 'FF8B5CF6',
  special: 'FF0D9488',
  system: 'FF94A3B8',
  attempted: 'FF059669',
  standard: 'FF3B82F6',
};
