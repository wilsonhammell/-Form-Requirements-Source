// Which family a field reads as, and which group it filters into. Two related
// questions with different answers, in one place so the canvas, the field list
// and the workbook cannot drift on either.
//
// system and attempted are passed in rather than derived. Both need an index the
// caller already holds, and system means the canonical placement rather than
// merely a system name.

import { isSpecialField, isEsignField } from './specialFields.js';

export const FIELD_TONES = ['button', 'special', 'system', 'attempted', 'standard'];

export function fieldTone(field, { system = false, attempted = false } = {}) {
  if (field.type === 'button') return 'button';
  if (isSpecialField(field.name)) return 'special';
  if (system) return 'system';
  return attempted ? 'attempted' : 'standard';
}

// Every field lands in exactly one, so the four together are the whole form and
// any subset is a legible view.
//
// Order matters. The eSign label and code box are special fields but belong to
// the Remote eSign button, so submission claims them first.
export const FIELD_SCOPES = ['standard', 'system', 'signers', 'submission'];

// Markers have no fieldScope, not being fields, but they answer the question the
// Signers scope answers, who marks this form and where, so they show with it
// rather than taking a pill of their own. Standard is the scope the app opens
// on and is meant to be the fields the form is about.
export const MARKER_SCOPE = 'signers';

export function fieldScope(field, { system = false, submissionButton = false } = {}) {
  if (submissionButton || isEsignField(field.name)) return 'submission';
  if (isSpecialField(field.name)) return 'signers';
  if (system) return 'system';
  return 'standard';
}

// Not one of FIELD_TONES, because a marker is not a field. It shares the tone
// tables so the canvas, the list and the workbook colour it from one place, the
// same as everything else on the page.
export const MARKER_TONE = 'marker';

// What each tone means, shown as the title on the field list's dot.
export const TONE_TITLE = {
  button: 'Submission button',
  special: 'Signer or joint field, its row shape drives the starter code',
  system: 'System field, read by the starter code',
  attempted: 'Load Attempted',
  standard: 'Custom name',
  marker: 'Initials marker, placed in FileOptics rather than on this PDF',
};

// The same tones as hex, for anything outside the app that cannot use a class.
// Tailwind's teal-600, emerald-600, blue-500, violet-500 and slate-400, so a
// field reads the same colour in the requirements workbook as on screen.
//
// A marker takes amber-600, well clear of all five, because the one thing a
// reader must not do is take it for a field.
export const TONE_HEX = {
  button: 'FF8B5CF6',
  special: 'FF0D9488',
  system: 'FF94A3B8',
  attempted: 'FF059669',
  standard: 'FF3B82F6',
  marker: 'FFD97706',
};
