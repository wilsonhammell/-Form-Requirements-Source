// What size the printed form is set in.
//
// Read from the page's own text, not from the fields. A field's /DA is whoever
// drew it last, so on a form nobody has standardised yet it says nothing. The
// printed body text is the thing a filled box has to sit beside and match.
//
// pdf.js only, so this runs in the browser and in a node test, never in the
// pdf-lib export path.

// The box the toolbar offers, so a suggestion it cannot take is not a
// suggestion. A 2pt printer's mark and a 60pt watermark are both noise here.
const MIN_SIZE = 4;
const MAX_SIZE = 72;

// Sizes come off the page with the text matrix baked in, so text set in 10pt
// reads as 9.96 or 10.02 depending on the scale it was placed at. Rounding
// first puts those in one bucket instead of three, and half a point is as fine
// as the toolbar box goes.
const STEP = 0.5;

const roundToStep = (size) => Math.round(size / STEP) * STEP;

/** The size of one text item, or null when it is not a size worth counting. */
export function sizeOfItem(item) {
  const text = String(item?.str ?? '').trim();
  if (!text) return null;

  // The vertical half of the text matrix. hypot rather than transform[3] alone,
  // so text on an angle counts as the size it was set in.
  const tx = item.transform;
  if (!Array.isArray(tx) || tx.length < 4) return null;
  const size = roundToStep(Math.hypot(tx[2], tx[3]));
  if (!Number.isFinite(size) || size < MIN_SIZE || size > MAX_SIZE) return null;
  return size;
}

/**
 * The median of a size to character count map.
 *
 * Weighted by characters rather than by text item, because a PDF splits its
 * text wherever it likes: a heading is one item of six characters and a
 * paragraph of body text can be one item of four hundred. Counting items would
 * let a handful of headings outvote the whole form.
 */
export function weightedMedian(weights) {
  const entries = [...weights.entries()].filter(([, count]) => count > 0).sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const half = total / 2;

  let seen = 0;
  for (const [size, count] of entries) {
    seen += count;
    // Strictly past halfway, so the median is the size the middle character is
    // set in rather than the one before it.
    if (seen > half) return size;
  }
  return entries[entries.length - 1][0];
}

/** Every page's text, as a size to character count map. */
export async function collectTextSizes(doc) {
  const weights = new Map();
  if (!doc) return weights;

  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const { items } = await page.getTextContent();
    for (const item of items) {
      const size = sizeOfItem(item);
      if (size === null) continue;
      weights.set(size, (weights.get(size) ?? 0) + item.str.trim().length);
    }
  }

  return weights;
}

/**
 * The size to suggest for this document, or null when the pages carry no text
 * to go on, a scan or a drawn form being the usual reasons.
 */
export async function suggestedFontSize(doc) {
  return weightedMedian(await collectTextSizes(doc));
}
