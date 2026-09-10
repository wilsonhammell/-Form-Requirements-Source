// Reading and rewriting a field's /DA string.
//
// /DA is a fragment of content stream, "0 g /Arial 10 Tf" or
// "/Arial 10 Tf 0.898 0.133 0.215 rg". Only the Tf operator names the font. The
// rest sets the colour, and on a form drawn in Acrobat the colour is doing real
// work: the error message fields are red, the success one green.
//
// So rebuilding /DA from the font alone throws that away. Everything here
// exists to touch the Tf operator and nothing else.

import { DEFAULT_FONT } from './schema.js';

// The resource name, then the size, then Tf.
const DA_FONT_RE = /\/([A-Za-z0-9+#_-]+)\s+([0-9.]+)\s+Tf/;

/**
 * The resource name in /DA is whatever the PDF's own DR dictionary calls it,
 * commonly "Helv"/"TiRo"/"Cour", Acrobat's convention, or the bare PostScript
 * name. Anything unrecognised returns null: it is a font this tool cannot embed,
 * so it falls back rather than being guessed at.
 */
export function familyFromResourceName(name) {
  const lower = String(name ?? '').toLowerCase();
  if (lower.startsWith('helv')) return 'Helvetica';
  if (lower.startsWith('tiro') || lower.startsWith('times')) return 'Times-Roman';
  if (lower.startsWith('cour')) return 'Courier';
  return null;
}

/** What the designer shows for a field carrying this /DA. */
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

/**
 * True when a field carrying this /DA already reads back as this font, which
 * means the designer left it alone and the string should not be touched.
 *
 * An unrecognised font reads back as the default, so "/Calibri 10 Tf" matches
 * Helvetica 10. That is deliberate. The alternative is rewriting a font the
 * tool never offered and cannot embed, for a field nobody edited.
 */
export function daMatchesFont(da, font) {
  if (!DA_FONT_RE.test(String(da ?? ''))) return false;
  const current = fontFromDa(da);
  return current.family === font.family && current.size === font.size;
}

/**
 * The same /DA with a different font, every other operator left as it was.
 * Returns null when there is no Tf operator to replace, so the caller can write
 * a fresh string instead.
 */
export function replaceDaFont(da, resourceName, size) {
  const text = String(da ?? '');
  if (!DA_FONT_RE.test(text)) return null;
  return text.replace(DA_FONT_RE, `/${resourceName} ${size} Tf`);
}
