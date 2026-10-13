import { describe, it, expect } from 'vitest';
import {
  normalizeFormat,
  formatScripts,
  readFormatScripts,
  sameFormat,
  DATE_PATTERN,
  SEPARATOR_STYLES,
  CURRENCY_SYMBOLS,
  MAX_DECIMALS,
  isPlainText,
} from '../src/core/fieldFormat.js';

describe('field format', () => {
  it('writes what Acrobat writes for the same choice', () => {
    // Both straight off the example forms, so a form formatted in Acrobat
    // round trips without a byte changing.
    expect(formatScripts({ category: 'date' })).toEqual({
      Format: 'AFDate_FormatEx("dd-mmm-yyyy");',
      Keystroke: 'AFDate_KeystrokeEx("dd-mmm-yyyy");',
    });
    expect(
      formatScripts({ category: 'number', decimals: 0, separator: 'none', currency: 'none' })
    ).toEqual({
      Format: 'AFNumber_Format(0, 1, 0, 0, "", true);',
      Keystroke: 'AFNumber_Keystroke(0, 1, 0, 0, "", true);',
    });
  });

  it('counts the negative styles the way Acrobat does', () => {
    const neg = (parentheses, redText) =>
      formatScripts({ category: 'number', parentheses, redText }).Format.split(', ')[2];
    expect([neg(false, false), neg(false, true), neg(true, false), neg(true, true)]).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
  });

  it('puts the dollar sign in front', () => {
    expect(formatScripts({ category: 'number', currency: 'dollar' }).Format).toBe(
      'AFNumber_Format(2, 0, 0, 0, "$", true);'
    );
  });

  it('writes nothing for None and leaves Custom alone', () => {
    expect(formatScripts({ category: 'none' })).toBeNull();
    expect(formatScripts({ category: 'custom' })).toBeUndefined();
  });

  it('starts a Number where Acrobat does and clamps what a hand edit gets wrong', () => {
    expect(normalizeFormat({ category: 'number' })).toEqual({
      category: 'number',
      decimals: 2,
      separator: 'comma',
      currency: 'none',
      parentheses: false,
      redText: false,
    });
    const odd = normalizeFormat({ category: 'number', decimals: 40, separator: 'dot', currency: 'euro' });
    expect(odd.decimals).toBe(MAX_DECIMALS);
    expect(odd.separator).toBe('comma');
    expect(odd.currency).toBe('none');
    expect(normalizeFormat({ category: 'date', pattern: 'mm/dd/yyyy' })).toEqual({ category: 'date' });
    expect(normalizeFormat({ category: 'special' })).toEqual({ category: 'none' });
    // Acrobat offers a percentage neither a currency nor a negative style.
    expect(normalizeFormat({ category: 'percent', currency: 'dollar', parentheses: true })).toEqual({
      category: 'percent',
      decimals: 2,
      separator: 'comma',
    });
    expect(normalizeFormat(undefined)).toEqual({ category: 'none' });
  });

  it('reads back every choice it can write', () => {
    const choices = [{ category: 'none' }, { category: 'date' }];
    for (let decimals = 0; decimals <= MAX_DECIMALS; decimals += 1) {
      for (const { value: separator } of SEPARATOR_STYLES) {
        choices.push({ category: 'percent', decimals, separator });
        for (const { value: currency } of CURRENCY_SYMBOLS) {
          for (const parentheses of [false, true]) {
            for (const redText of [false, true]) {
              choices.push({ category: 'number', decimals, separator, currency, parentheses, redText });
            }
          }
        }
      }
    }
    for (const choice of choices) {
      const scripts = formatScripts(choice);
      const read = readFormatScripts(scripts?.Format, scripts?.Keystroke);
      expect(read.was).toBeUndefined();
      expect(sameFormat(read.format, choice)).toBe(true);
    }
  });

  it('reads a date in any other pattern as the one date there is, and says what it was', () => {
    expect(readFormatScripts('AFDate_FormatEx("mm/dd/yyyy");', 'AFDate_KeystrokeEx("mm/dd/yyyy");')).toEqual({
      format: { category: 'date' },
      was: 'mm/dd/yyyy',
    });
    expect(readFormatScripts('AFDate_FormatEx("dd-mmm-yy");', 'AFDate_KeystrokeEx("dd-mmm-yy");').was).toBe(
      'dd-mmm-yy'
    );
    // Acrobat before 5 numbered its patterns.
    expect(readFormatScripts('AFDate_Format(2);', 'AFDate_Keystroke(2);').format).toEqual({
      category: 'date',
    });
    expect(readFormatScripts('AFDate_Format(2);', 'AFDate_Keystroke(2);').was).toBeDefined();
  });

  it('calls anything it could not have written Custom', () => {
    const custom = { category: 'custom' };
    // A separator style and a currency the picker leaves out.
    expect(readFormatScripts('AFNumber_Format(2, 2, 0, 0, "", true);', 'AFNumber_Keystroke(2, 2, 0, 0, "", true);').format).toEqual(custom);
    expect(readFormatScripts('AFNumber_Format(2, 0, 0, 0, "€", true);', 'AFNumber_Keystroke(2, 0, 0, 0, "€", true);').format).toEqual(custom);
    expect(readFormatScripts('AFNumber_Format(2, 0, 0, 0, "$", false);', 'AFNumber_Keystroke(2, 0, 0, 0, "$", false);').format).toEqual(custom);
    // A pair that disagrees, half a pair, and categories not offered.
    expect(readFormatScripts('AFNumber_Format(2, 0, 0, 0, "", true);', 'AFNumber_Keystroke(0, 0, 0, 0, "", true);').format).toEqual(custom);
    expect(readFormatScripts('AFDate_FormatEx("dd-mmm-yyyy");', '').format).toEqual(custom);
    expect(readFormatScripts('AFPercent_Format(2, 2);', 'AFPercent_Keystroke(2, 2);').format).toEqual(custom);
    expect(readFormatScripts('AFPercent_Format(2, 0, true);', 'AFPercent_Keystroke(2, 0, true);').format).toEqual(custom);
    expect(readFormatScripts('AFSpecial_Format(2);', 'AFSpecial_Keystroke(2);').format).toEqual(custom);
    expect(readFormatScripts('event.value = event.value.toUpperCase();', '').format).toEqual(custom);
  });

  it('writes a percentage the way Acrobat does, and reads the later three argument form', () => {
    expect(formatScripts({ category: 'percent', decimals: 1, separator: 'none' })).toEqual({
      Format: 'AFPercent_Format(1, 1);',
      Keystroke: 'AFPercent_Keystroke(1, 1);',
    });
    expect(readFormatScripts('AFPercent_Format(2, 0, false);', 'AFPercent_Keystroke(2, 0, false);').format).toEqual({
      category: 'percent',
      decimals: 2,
      separator: 'comma',
    });
  });

  it('keeps the code fields plain text', () => {
    expect(isPlainText(' PROD_CODE ')).toBe(true);
    expect(isPlainText('PRIMARY_SIGN_DATE')).toBe(false);
  });

  it('reads a blank pair as None', () => {
    expect(readFormatScripts('', '\n\r\n\r').format).toEqual({ category: 'none' });
    expect(readFormatScripts(undefined, undefined).format).toEqual({ category: 'none' });
  });

  it('compares by value', () => {
    expect(sameFormat({ category: 'number' }, normalizeFormat({ category: 'number' }))).toBe(true);
    expect(sameFormat({ category: 'number' }, { category: 'number', decimals: 0 })).toBe(false);
    expect(sameFormat({ category: 'date' }, { category: 'none' })).toBe(false);
  });

  it('has the one date pattern the requirements sheet states', () => {
    expect(DATE_PATTERN).toBe('dd-mmm-yyyy');
  });
});
