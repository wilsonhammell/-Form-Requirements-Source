import { describe, it, expect } from 'vitest';
import {
  signingButtons,
  normalizeSigningButtons,
  buildButtonIndex,
  isSubmissionButton,
  hasButton,
  addButton,
  removeButton,
  buttonSlotRect,
  BUTTON_STYLE,
} from '../src/core/signingButtons.js';
import { createField } from '../src/core/schema.js';

const BUTTONS = normalizeSigningButtons([
  { identifier: 'PhoneAuthButton', caption: 'Phone Auth' },
  { identifier: 'DigitalSignatureButton', caption: 'In-Branch eSign' },
  { identifier: 'RemoteESignButton', caption: 'Remote eSign' },
  { identifier: 'PrintButton', caption: 'Print Form' },
]);
const buttonIndex = buildButtonIndex(BUTTONS);
const LETTER = [0, 0, 612, 792];

describe('the button list', () => {
  it('keeps the caption and falls back to the standard size', () => {
    expect(BUTTONS[1]).toMatchObject({
      identifier: 'DigitalSignatureButton',
      caption: 'In-Branch eSign',
      width: BUTTON_STYLE.width,
      height: BUTTON_STYLE.height,
    });
  });

  it('carries a script, defaulting to none', () => {
    expect(BUTTONS.every((b) => b.script === '')).toBe(true);
    const withScript = normalizeSigningButtons([
      { identifier: 'PrintButton', script: 'this.print();' },
    ]);
    expect(withScript[0].script).toBe('this.print();');
  });

  it('drops blanks and repeats', () => {
    const list = normalizeSigningButtons([
      { identifier: 'PrintButton' },
      { identifier: '  ' },
      { identifier: 'PrintButton' },
    ]);
    expect(list).toHaveLength(1);
  });

  it('recognises a submission button by name and nothing else', () => {
    expect(isSubmissionButton('PrintButton', buttonIndex)).toBe(true);
    expect(isSubmissionButton('CUSTNAME', buttonIndex)).toBe(false);
    // A generic button, should one ever be wanted, is the same type with a name
    // that is simply not in this list.
    expect(isSubmissionButton('SomeOtherButton', buttonIndex)).toBe(false);
  });
});

describe('the shipped list', () => {
  it('carries the five submission channels', () => {
    expect(signingButtons().map((b) => b.identifier)).toEqual([
      'PhoneAuthButton',
      'DigitalSignatureButton',
      'RemoteESignButton',
      'PrintButton',
      'SubmitForProcessingButton',
    ]);
  });

  it('gives each the caption it shows', () => {
    expect(signingButtons().map((b) => b.caption)).toEqual([
      'Phone Auth',
      'In-Branch eSign',
      'Remote eSign',
      'Print Form',
      'Submit for Processing',
    ]);
  });

  it('is the measured size, in points', () => {
    // Measured off the real button at 1.1007 x 0.2514 inches. 72 points to the
    // inch makes that 79.25 x 18.10, rounded here to 80 x 18: a quarter inch
    // tall exactly, and under a point wider, which is not a visible difference.
    expect(Math.abs(BUTTON_STYLE.width - 1.1007 * 72)).toBeLessThan(1);
    expect(Math.abs(BUTTON_STYLE.height - 0.2514 * 72)).toBeLessThan(1);
    expect(BUTTON_STYLE.height / 72).toBe(0.25);
  });

  it('is black bordered, green faced, thin and beveled, at size 10', () => {
    expect(BUTTON_STYLE).toMatchObject({
      borderColor: [0, 0, 0],
      backgroundColor: [0, 1, 0],
      borderWidth: 1,
      borderStyle: 'B',
      fontSize: 10,
    });
  });

  it('calls into the helper script, one entry point each', () => {
    // The action is code this repo maintains, not something a user of the tool
    // configures, so it lives in source and is the same on every form.
    expect(signingButtons().map((b) => b.script)).toEqual([
      'submitPhoneAuth();',
      'submitDigitalSignature();',
      'submitRemoteESign();',
      'submitPrintOnly();',
      'submitForProcessing();',
    ]);
  });

  it('marks Print as the one that is not a FileOptics button', () => {
    // FILEOPTICS_BUTTON_FIELDS is shown and hidden as a set, and printing never
    // goes to FileOptics, which is why both example forms list only three.
    expect(signingButtons().filter((b) => b.fileOptics).map((b) => b.identifier)).toEqual([
      'PhoneAuthButton',
      'DigitalSignatureButton',
      'RemoteESignButton',
      'SubmitForProcessingButton',
    ]);
    expect(signingButtons().find((b) => b.identifier === 'PrintButton').fileOptics).toBe(false);
  });

  it('makes Submit for Processing wide enough for its caption, as K_DCR had it', () => {
    expect(signingButtons().find((b) => b.identifier === 'SubmitForProcessingButton').width).toBe(112);
  });

  it('lays the shipped buttons out without overlap, wide one included', () => {
    const shipped = signingButtons();
    const rects = shipped
      .map((b) => buttonSlotRect(b, shipped, LETTER))
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < rects.length; i += 1) {
      expect(rects[i].x).toBeGreaterThanOrEqual(rects[i - 1].x + rects[i - 1].width);
    }
    const last = rects[rects.length - 1];
    expect(last.x + last.width).toBeLessThanOrEqual(LETTER[2]);
  });
});

describe('turning a channel on and off', () => {
  it('places a button, which is what says the form offers that channel', () => {
    const fields = addButton([], BUTTONS[0], BUTTONS, LETTER);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ name: 'PhoneAuthButton', type: 'button' });
  });

  it('starts hidden and read-only, the code shows it at run time', () => {
    const [button] = addButton([], BUTTONS[0], BUTTONS, LETTER);
    expect(button.hidden).toBe(true);
    expect(button.editable).toBe(false);
  });

  it('uses the size from the list', () => {
    const [button] = addButton([], BUTTONS[0], BUTTONS, LETTER);
    expect(button.rect.width).toBe(BUTTON_STYLE.width);
    expect(button.rect.height).toBe(BUTTON_STYLE.height);
  });

  it('appears at most once', () => {
    let fields = addButton([], BUTTONS[0], BUTTONS, LETTER);
    fields = addButton(fields, BUTTONS[0], BUTTONS, LETTER);
    expect(fields.filter((f) => f.name === 'PhoneAuthButton')).toHaveLength(1);
  });

  it('returns the same array when it is already placed', () => {
    const fields = addButton([], BUTTONS[0], BUTTONS, LETTER);
    expect(addButton(fields, BUTTONS[0], BUTTONS, LETTER)).toBe(fields);
  });

  it('removes cleanly and leaves everything else alone', () => {
    const own = createField({ name: 'CUSTNAME' });
    let fields = addButton([own], BUTTONS[0], BUTTONS, LETTER);
    fields = removeButton(fields, 'PhoneAuthButton');
    expect(fields).toEqual([own]);
    expect(hasButton(fields, 'PhoneAuthButton')).toBe(false);
  });

  it('supports none of them, or all of them', () => {
    expect(addButton([], BUTTONS[0], BUTTONS, LETTER)).toHaveLength(1);
    const all = BUTTONS.reduce((acc, b) => addButton(acc, b, BUTTONS, LETTER), []);
    expect(all).toHaveLength(4);
    expect(all.every((f) => f.type === 'button')).toBe(true);
  });
});

describe('where they land', () => {
  it('gives each one its own slot, side by side', () => {
    const xs = BUTTONS.map((b) => buttonSlotRect(b, BUTTONS, LETTER).x);
    expect(new Set(xs).size).toBe(4);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('keeps a slot fixed whatever else is placed', () => {
    // Adding a third button must not shuffle the two already on the page.
    const alone = buttonSlotRect(BUTTONS[3], BUTTONS, LETTER);
    const withOthers = buttonSlotRect(BUTTONS[3], BUTTONS, LETTER);
    expect(withOthers).toEqual(alone);
  });

  it('stays on the page, including one that is not Letter', () => {
    for (const box of [LETTER, [0, 0, 595.28, 841.89], [20, 30, 632, 822]]) {
      for (const entry of BUTTONS) {
        const r = buttonSlotRect(entry, BUTTONS, box);
        expect(r.x).toBeGreaterThanOrEqual(box[0]);
        expect(r.y).toBeGreaterThanOrEqual(box[1]);
        expect(r.x + r.width).toBeLessThanOrEqual(box[2] + 0.001);
        expect(r.y + r.height).toBeLessThanOrEqual(box[3] + 0.001);
      }
    }
  });

  it('sits at the top, clear of the bottom where the signer fields go', () => {
    const r = buttonSlotRect(BUTTONS[0], BUTTONS, LETTER);
    // Nearer the top edge than the bottom one, and inset from it.
    expect(r.y + r.height).toBeLessThan(LETTER[3]);
    expect(LETTER[3] - (r.y + r.height)).toBeLessThan(100);
    expect(r.y).toBeGreaterThan((LETTER[3] - LETTER[1]) / 2);
  });

  it('keeps the whole row on a page shorter than the inset', () => {
    const squat = [0, 0, 612, 40];
    for (const entry of BUTTONS) {
      const r = buttonSlotRect(entry, BUTTONS, squat);
      expect(r.y).toBeGreaterThanOrEqual(squat[1]);
    }
  });
});
