// A field's /DA is a fragment of content stream, "0 g /Arial 10 Tf". Only the
// Tf operator names the font. The rest sets the colour, and on a form drawn in
// Acrobat the colour does real work, the error fields being red.
//
// Rebuilding /DA from the font alone throws that away, so everything here
// touches the Tf operator and nothing else.

import { DEFAULT_FONT } from './schema.js';

// The resource name, then the size, then Tf.
const DA_FONT_RE = /\/([A-Za-z0-9+#_-]+)\s+([0-9.]+)\s+Tf/;

// The resource name is whatever the PDF's own /DR calls it, commonly Acrobat's
// Helv, TiRo and Cour or the bare PostScript name. Anything unrecognised is a
// font this tool cannot embed, so it returns null rather than being guessed at.
export function familyFromResourceName(name) {
  const lower = String(name ?? '').toLowerCase();
  if (lower.startsWith('helv')) return 'Helvetica';
  if (lower.startsWith('tiro') || lower.startsWith('times')) return 'Times-Roman';
  if (lower.startsWith('cour')) return 'Courier';
  return null;
}

export function fontFromDa(da) {
  const match = DA_FONT_RE.exec(String(da ?? ''));
  if (!match) return { ...DEFAULT_FONT };

  const [, resourceName, sizeText] = match;
  const size = Number(sizeText);
  return {
    family: familyFromResourceName(resourceName) ?? DEFAULT_FONT.family,
    size: Number.isFinite(size) && size > 0 ? size : DEFAULT_FONT.size,
  };
}

// True when the designer left the font alone, so the string is not touched.
//
// An unrecognised font reads back as the default, so "/Calibri 10 Tf" matches
// Helvetica 10. Deliberate, since the alternative is rewriting a font the tool
// never offered and cannot embed, on a field nobody edited.
export function daMatchesFont(da, font) {
  if (!DA_FONT_RE.test(String(da ?? ''))) return false;
  const current = fontFromDa(da);
  return current.family === font.family && current.size === font.size;
}

// Null when there is no Tf operator to replace, so the caller can write a fresh
// string instead.
export function replaceDaFont(da, resourceName, size) {
  const text = String(da ?? '');
  if (!DA_FONT_RE.test(text)) return null;
  return text.replace(DA_FONT_RE, `/${resourceName} ${size} Tf`);
}
