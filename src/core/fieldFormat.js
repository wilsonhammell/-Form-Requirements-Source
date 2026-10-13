// Acrobat's Format tab on a text field, cut down to the choices the business
// allows. A date has one pattern, so it cannot be set to the wrong one, and a
// number keeps Acrobat's options apart from the separator styles and currencies
// nobody here uses.
//
// The scripts written are exactly what Acrobat writes for the same choice, so a
// field formatted here and one formatted there are indistinguishable, and a
// form already formatted that way round trips unchanged.
//
// Depends on nothing.

export const DATE_PATTERN = 'dd-mmm-yyyy';

export const FORMAT_CATEGORIES = [
  { value: 'none', label: 'None' },
  { value: 'number', label: 'Number' },
  { value: 'percent', label: 'Percentage' },
  { value: 'date', label: 'Date' },
];

// Read off a form, never offered. A script this tool cannot describe is left
// exactly as it was.
export const CUSTOM = 'custom';

// Codes, read as typed, so import clears any format and the panel offers none.
export const PLAIN_TEXT_NAMES = ['PROD_CODE'];

export function isPlainText(name) {
  return PLAIN_TEXT_NAMES.includes(String(name ?? '').trim());
}

export const SEPARATOR_STYLES = [
  { value: 'comma', label: '1,234.56' },
  { value: 'none', label: '1234.56' },
];

export const CURRENCY_SYMBOLS = [
  { value: 'none', label: 'None' },
  { value: 'dollar', label: 'Dollar ($)' },
];

export const MAX_DECIMALS = 10;

// Acrobat's arguments, sepStyle and strCurrency.
const SEP_STYLE = { comma: 0, none: 1 };
const CURRENCY = { none: '', dollar: '$' };

// What Acrobat starts a Number and a Percentage on.
const NUMBER_DEFAULTS = {
  decimals: 2,
  separator: 'comma',
  currency: 'none',
  parentheses: false,
  redText: false,
};

export function normalizeFormat(raw) {
  const category = raw?.category;
  if (category === 'date' || category === CUSTOM) return { category };
  if (category !== 'number' && category !== 'percent') return { category: 'none' };
  const decimals = Number(raw.decimals);
  const common = {
    category,
    decimals: Number.isInteger(decimals)
      ? Math.min(Math.max(decimals, 0), MAX_DECIMALS)
      : NUMBER_DEFAULTS.decimals,
    separator: raw.separator in SEP_STYLE ? raw.separator : NUMBER_DEFAULTS.separator,
  };
  // Acrobat offers a percentage neither a currency nor a negative style.
  if (category === 'percent') return common;
  return {
    ...common,
    currency: raw.currency in CURRENCY ? raw.currency : NUMBER_DEFAULTS.currency,
    parentheses: !!raw.parentheses,
    redText: !!raw.redText,
  };
}

// normalizeFormat writes the keys in one order, so the strings compare.
export function sameFormat(a, b) {
  return JSON.stringify(normalizeFormat(a)) === JSON.stringify(normalizeFormat(b));
}

// null for none, the field carries neither script. undefined for custom,
// whatever it carries is left alone.
export function formatScripts(format) {
  const f = normalizeFormat(format);
  if (f.category === 'date') {
    return {
      Format: `AFDate_FormatEx("${DATE_PATTERN}");`,
      Keystroke: `AFDate_KeystrokeEx("${DATE_PATTERN}");`,
    };
  }
  if (f.category === 'number') {
    const args = numberArgs(f);
    return { Format: `AFNumber_Format(${args});`, Keystroke: `AFNumber_Keystroke(${args});` };
  }
  if (f.category === 'percent') {
    const args = `${f.decimals}, ${SEP_STYLE[f.separator]}`;
    return { Format: `AFPercent_Format(${args});`, Keystroke: `AFPercent_Keystroke(${args});` };
  }
  return f.category === CUSTOM ? undefined : null;
}

// Acrobat's negStyle counts 0 to 3: minus, red, parentheses, red parentheses.
// currStyle is unused and always 0, and the symbol always goes in front.
function numberArgs(f) {
  const negStyle = (f.parentheses ? 2 : 0) + (f.redText ? 1 : 0);
  return [f.decimals, SEP_STYLE[f.separator], negStyle, 0, JSON.stringify(CURRENCY[f.currency]), 'true'].join(', ');
}

const DATE_FORMAT_RE = /^AFDate_FormatEx\(\s*"([^"]*)"\s*\);?$/;
const DATE_KEYSTROKE_RE = /^AFDate_KeystrokeEx\(\s*"([^"]*)"\s*\);?$/;
// Acrobat before 5 picked the pattern by number.
const OLD_DATE_FORMAT_RE = /^AFDate_Format\(\s*\d+\s*\);?$/;
const OLD_DATE_KEYSTROKE_RE = /^AFDate_Keystroke\(\s*\d+\s*\);?$/;

const NUMBER_ARGS = String.raw`\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*(true|false)\s*\);?$`;
const NUMBER_FORMAT_RE = new RegExp(`^AFNumber_Format${NUMBER_ARGS}`);
const NUMBER_KEYSTROKE_RE = new RegExp(`^AFNumber_Keystroke${NUMBER_ARGS}`);

// Later Acrobats add a third argument, the sign in front, which is false unless
// someone wrote the script by hand.
const PERCENT_ARGS = String.raw`\(\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*false\s*)?\);?$`;
const PERCENT_FORMAT_RE = new RegExp(`^AFPercent_Format${PERCENT_ARGS}`);
const PERCENT_KEYSTROKE_RE = new RegExp(`^AFPercent_Keystroke${PERCENT_ARGS}`);

// What a form already carries, read back into the model. A date in another
// pattern reads as the one date there is, with the pattern it had as was, so
// import can say what changed. Anything this tool could not have written,
// including half a pair, is custom.
export function readFormatScripts(formatJs, keystrokeJs) {
  const f = (formatJs ?? '').trim();
  const k = (keystrokeJs ?? '').trim();
  if (!f && !k) return { format: { category: 'none' } };

  const date = DATE_FORMAT_RE.exec(f);
  const dateKey = DATE_KEYSTROKE_RE.exec(k);
  if ((date || OLD_DATE_FORMAT_RE.test(f)) && (dateKey || OLD_DATE_KEYSTROKE_RE.test(k))) {
    const patterns = [date?.[1] ?? null, dateKey?.[1] ?? null];
    if (patterns.every((p) => p === DATE_PATTERN)) return { format: { category: 'date' } };
    const was = patterns.find((p) => p && p !== DATE_PATTERN) ?? 'an older Acrobat pattern';
    return { format: { category: 'date' }, was };
  }

  const number = NUMBER_FORMAT_RE.exec(f);
  const numberKey = NUMBER_KEYSTROKE_RE.exec(k);
  if (number && numberKey && number.slice(1).join() === numberKey.slice(1).join()) {
    const read = fromNumberArgs(number.slice(1));
    if (read) return { format: read };
  }

  const percent = PERCENT_FORMAT_RE.exec(f);
  const percentKey = PERCENT_KEYSTROKE_RE.exec(k);
  if (percent && percentKey && percent.slice(1).join() === percentKey.slice(1).join()) {
    const separator = separatorOf(percent[2]);
    if (separator && Number(percent[1]) <= MAX_DECIMALS) {
      return { format: normalizeFormat({ category: 'percent', decimals: Number(percent[1]), separator }) };
    }
  }

  return { format: { category: CUSTOM } };
}

function separatorOf(sepStyle) {
  return Object.keys(SEP_STYLE).find((key) => SEP_STYLE[key] === Number(sepStyle));
}

function fromNumberArgs([decimals, sepStyle, negStyle, , currency, prepend]) {
  const separator = separatorOf(sepStyle);
  const symbol = Object.keys(CURRENCY).find((key) => CURRENCY[key] === currency);
  const neg = Number(negStyle);
  if (!separator || !symbol || neg > 3 || Number(decimals) > MAX_DECIMALS) return null;
  if (symbol !== 'none' && prepend !== 'true') return null;
  return normalizeFormat({
    category: 'number',
    decimals: Number(decimals),
    separator,
    currency: symbol,
    parentheses: neg >= 2,
    redText: neg % 2 === 1,
  });
}
