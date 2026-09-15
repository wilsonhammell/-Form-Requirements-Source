// Drives the real UI in a real browser, because the node tests cannot tell you
// whether pdf.js renders, whether the worker resolves, or whether a drag on the
// page turns into the right PDF user space rect.
//
// Not part of the production build, vite only bundles index.html. Start the dev
// server, then run: node tests/browser/run.mjs
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import App from '../../src/App.jsx';
import '../../src/index.css';
import { exportPdf } from '../../src/core/pdfExport.js';
import { importPdf, SOURCE } from '../../src/core/pdfImport.js';
import { buildDbIndex } from '../../src/core/dbFields.js';
import { createField } from '../../src/core/schema.js';
import { signingButtons } from '../../src/core/signingButtons.js';

const results = [];
const diagnostics = [];
const out = document.getElementById('results');

// Anything the page throws is far more useful than a bare timeout.
window.addEventListener('error', (e) => diagnostics.push(`error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) =>
  diagnostics.push(`rejection: ${e.reason?.message ?? e.reason}`)
);
const realConsoleError = console.error.bind(console);
console.error = (...args) => {
  diagnostics.push('console.error: ' + args.map((a) => a?.message ?? String(a)).join(' '));
  realConsoleError(...args);
};

// The notices bar is where the app reports what it made of an upload. Absent
// while minimized.
function noticesBar() {
  return document.querySelector('#root [role=status]');
}

function notices() {
  const bar = noticesBar();
  if (!bar) return '(not shown)';
  return [...bar.querySelectorAll('p')].map((p) => p.textContent.trim()).join(' ');
}

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  render();
}

function render() {
  const failed = results.filter((r) => !r.ok).length;
  out.textContent =
    results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`)
      .join('\n') +
    `\nSUMMARY ${results.length - failed} passed, ${failed} failed`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, timeout = 15000) {
  const started = Date.now();
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch {
      value = null;
    }
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

// Page 1 upright with printed text, page 2 rotated 90.
async function samplePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('Insurance Application', { x: 60, y: 730, size: 18, font, color: rgb(0, 0, 0) });
  p1.drawText('Named Insured:', { x: 60, y: 660, size: 11, font });
  const p2 = doc.addPage([612, 792]);
  p2.setRotation({ type: 'degrees', angle: 90 });
  p2.drawText('Schedule of Locations', { x: 60, y: 700, size: 14, font });
  return doc.save();
}

function overlay() {
  const canvas = document.querySelector('#root canvas');
  return canvas?.nextElementSibling ?? null;
}

function pointer(type, target, clientX, clientY) {
  // Dispatching straight at the overlay would make it the event target, and the
  // app decides between draw and move by what is under the pointer. Hit test.
  const el = (type === 'pointerdown' ? document.elementFromPoint(clientX, clientY) : null) ?? target;
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    })
  );
}

async function drag(from, to) {
  const el = overlay();
  const box = el.getBoundingClientRect();
  const at = (p) => [box.left + p[0], box.top + p[1]];
  pointer('pointerdown', el, ...at(from));
  await sleep(16);
  pointer('pointermove', el, ...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]));
  await sleep(16);
  pointer('pointermove', el, ...at(to));
  await sleep(16);
  pointer('pointerup', el, ...at(to));
  await sleep(120);
}

// The property panel is the readout for the stored rect, in PDF user space.
function readRect() {
  const dl = document.querySelector('#root aside dl');
  if (!dl) return null;
  const rows = new Map();
  const kids = [...dl.children];
  for (let i = 0; i < kids.length - 1; i += 1) {
    if (kids[i].tagName === 'DT' && kids[i + 1].tagName === 'DD') {
      rows.set(kids[i].textContent.trim(), kids[i + 1].textContent.trim());
    }
  }
  const pos = rows.get('x, y');
  const size = rows.get('w x h');
  if (!pos || !size) return null;
  const [x, y] = pos.split(',').map((s) => Number(s.trim()));
  const [w, h] = size.split('x').map((s) => Number(s.trim()));
  return { x, y, width: w, height: h };
}

function near(a, b, tol = 0.51) {
  return Math.abs(a - b) <= tol;
}

function rectMatches(got, want) {
  return (
    got &&
    near(got.x, want.x) &&
    near(got.y, want.y) &&
    near(got.width, want.width) &&
    near(got.height, want.height)
  );
}

// React tracks the value on the DOM node, so setting el.value directly is
// ignored. Going through the native setter for that element's own class is what
// makes React see the change. A textarea is not an HTMLInputElement.
function setInputValue(el, value) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function toggle(labelText) {
  const aside = document.querySelector('#root aside');
  const label = [...aside.querySelectorAll('label')].find((l) =>
    l.textContent.trim().startsWith(labelText)
  );
  return label?.querySelector('input[type=checkbox]') ?? null;
}

// Tabs carry a count beside the label, so they match on the start of the text
// rather than the whole of it.
function clickTab(label) {
  const button = [...document.querySelectorAll('#root aside button')].find((b) =>
    b.textContent.trim().startsWith(label)
  );
  if (!button) throw new Error(`no tab labelled ${label}`);
  button.click();
}

function clickButton(text, scope = document) {
  const button = [...scope.querySelectorAll('button')].find(
    (b) => b.textContent.trim().toLowerCase() === text.toLowerCase()
  );
  if (!button) throw new Error(`no button labelled ${text}`);
  button.click();
}

// The groups are independent toggles, so "show exactly these" means turning
// everything on and the rest back off. Clicking one name alone would only flip
// it, which is what the old exclusive tabs did.
const ALL_SCOPES = ['Standard', 'System', 'Signers', 'Submission'];
async function onlyScopes(...wanted) {
  const pane = document.querySelector('#root aside');
  clickButton('All', pane);
  for (const name of ALL_SCOPES) {
    if (!wanted.includes(name)) clickButton(name, pane);
  }
  await sleep(200);
}

async function run() {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // The DB list has to load before names can be matched.
  await waitFor('db field list', () => document.querySelector('#root header'));

  const bytes = await samplePdf();
  const input = document.querySelector('#root input[type=file][accept*=pdf]');
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes], 'sample.pdf', { type: 'application/pdf' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const canvas = await waitFor('page canvas', () => {
    const c = document.querySelector('#root canvas');
    return c?.style.width ? c : null;
  });
  check(
    'pdf.js renders a page',
    canvas.width > 0 && canvas.height > 0,
    `${canvas.style.width} x ${canvas.style.height}`
  );

  // A blank canvas would mean the worker never ran.
  await sleep(400);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 300)).data;
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] < 128 && data[i + 3] > 0) dark += 1;
  }
  check('pdf.js worker painted real content', dark > 50, `${dark} dark pixels`);

  check('canvas is the unrotated page size', canvas.style.width === '612px', canvas.style.width);

  // A flat PDF still arrives with every system field placed for it.
  const systemList = await (await fetch('/systemFields.json')).json();
  await sleep(300);
  const aside = () => document.querySelector('#root aside');
  // Standard is the default, so a fresh form opens uncluttered even though all
  // the system fields are there.
  check(
    'the view starts on Standard',
    aside().textContent.includes(`0 of ${systemList.length}`),
    aside().textContent.slice(0, 60)
  );
  check(
    'the system fields are off the page by default',
    document.querySelectorAll('#root [data-field-id]').length === 0
  );

  clickButton('All', aside());
  await sleep(200);
  check(
    'they were placed all the same',
    document.querySelectorAll('#root [data-field-id]').length === systemList.length,
    String(document.querySelectorAll('#root [data-field-id]').length)
  );

  // The groups are independent toggles, so turning Standard off while All is on
  // leaves the system fields and nothing else. That is the view the old
  // exclusive System tab gave, reached by saying what to hide instead.
  clickButton('Standard', aside());
  clickButton('Signers', aside());
  clickButton('Submission', aside());
  await sleep(200);
  check(
    'turning the other groups off leaves the system fields',
    document.querySelectorAll('#root [data-field-id]').length === systemList.length,
    String(document.querySelectorAll('#root [data-field-id]').length)
  );

  // And turning the last one off shows nothing, which is a legible state rather
  // than a forbidden one.
  clickButton('System', aside());
  await sleep(200);
  check(
    'turning every group off empties the page',
    document.querySelectorAll('#root [data-field-id]').length === 0,
    String(document.querySelectorAll('#root [data-field-id]').length)
  );

  clickButton('All', aside());
  await sleep(200);
  check(
    'All brings every group back',
    document.querySelectorAll('#root [data-field-id]').length === systemList.length
  );

  clickButton('Standard', aside());
  clickButton('Signers', aside());
  clickButton('Submission', aside());
  await sleep(200);

  // The last placement of a system name is the one thing that cannot go.
  const firstRow = aside().querySelector('button[type=button] + *') ?? null;
  const rows = [...aside().querySelectorAll('button')].filter((b) =>
    b.textContent.includes('DNA_REQ')
  );
  rows[0]?.click();
  await sleep(200);
  const deleteBtn = [...aside().querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Delete'
  );
  check('a system field cannot be deleted', deleteBtn?.disabled === true);
  const nameField = aside().querySelector('input[type=text]');
  check('its name is fixed', nameField?.readOnly === true, nameField?.value);
  check(
    'position and visibility are still editable',
    toggle('Hidden') !== null && toggle('Editable') !== null && !toggle('Hidden').disabled
  );
  check('it defaults to hidden and read-only', toggle('Hidden').checked && !toggle('Editable').checked);

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await sleep(200);
  check(
    'the delete key will not remove it either',
    document.querySelectorAll('#root [data-field-id]').length === systemList.length
  );

  // Back to the default before the rest of the run.
  await onlyScopes('Standard');
  await sleep(200);

  // Draw a text field on page 1. Screen y 92..112 from the top maps to PDF y
  // 680..700 measured from the bottom.
  await drag([100, 92], [300, 112]);
  const first = readRect();
  check(
    'drawing on an upright page stores the right rect',
    rectMatches(first, { x: 100, y: 680, width: 200, height: 20 }),
    JSON.stringify(first)
  );

  // Name it from the DB list.
  const nameInput = await waitFor('name input', () =>
    document.querySelector('#root aside input[type=text]')
  );
  setInputValue(nameInput, 'CUSTNAME');
  await sleep(120);
  check(
    'a DB identifier reads as Load Attempted',
    document.querySelector('#root aside').textContent.includes('Load Attempted'),
    ''
  );
  check(
    'Load Validation stays locked until the customer-facing name is filled',
    toggle('Load Validation')?.disabled === true
  );
  const customerName = [...document.querySelectorAll('#root aside input[type=text]')][1];
  setInputValue(customerName, 'Account Holder');
  await sleep(150);

  const validated = toggle('Load Validation');
  check(
    'Load Validation unlocks once the name matches and the label is set',
    validated && !validated.disabled
  );
  validated.click();
  await sleep(80);
  check(
    'Load Validation shows in the field list',
    document.querySelector('#root aside').textContent.includes('LV')
  );

  setInputValue(document.querySelectorAll('#root aside input[type=text]')[1], '');
  await sleep(150);
  check(
    'clearing the customer-facing name clears Load Validation',
    toggle('Load Validation')?.checked === false && toggle('Load Validation')?.disabled === true
  );
  setInputValue(document.querySelectorAll('#root aside input[type=text]')[1], 'Account Holder');
  await sleep(120);
  toggle('Load Validation').click();
  await sleep(120);

  // A custom name must clear the validation flag.
  setInputValue(nameInput, 'NOT_A_DB_COLUMN');
  await sleep(150);
  const asideText = document.querySelector('#root aside').textContent;
  const nowDisabled = toggle('Load Validation')?.disabled;
  check(
    'a name that stops matching clears and disables Load Validation',
    asideText.includes('Custom name, not in DB list') && !asideText.includes('LV') && nowDisabled,
    ''
  );
  // Save Validation does not depend on the DB list, so it stays usable on a
  // custom name while Load Validation is disabled.
  check(
    'Save Validation is available on a custom name',
    toggle('Load Validation')?.disabled === true && toggle('Save Validation')?.disabled === false
  );
  toggle('Save Validation').click();
  await sleep(120);
  check(
    'Save Validation shows in the field list',
    document.querySelector('#root aside').textContent.includes('SV')
  );

  // Custom Save Validation needs a note before it can be used at all.
  const noteBox = () => toggle('Custom Save Validation');
  check('Custom Save Validation is disabled without a note', noteBox()?.disabled === true);

  const note = document.querySelector('#root aside textarea');
  check('every field has a note box', !!note);
  setInputValue(note, 'Saved by the nightly reconciliation job.');
  await sleep(150);
  check('a note enables Custom Save Validation', noteBox()?.disabled === false);

  // Checking it must turn Save Validation off, they are mutually exclusive.
  noteBox().click();
  await sleep(150);
  check(
    'Custom Save Validation clears plain Save Validation',
    toggle('Custom Save Validation').checked === true &&
      toggle('Save Validation').checked === false
  );
  check(
    'the field list marks it distinctly from plain Save Validation',
    document.querySelector('#root aside').textContent.includes('SV*')
  );

  // Removing the note has to take the flag with it.
  setInputValue(document.querySelector('#root aside textarea'), '');
  await sleep(150);
  check(
    'clearing the note clears and disables Custom Save Validation',
    toggle('Custom Save Validation').checked === false &&
      toggle('Custom Save Validation').disabled === true &&
      !document.querySelector('#root aside').textContent.includes('SV*')
  );
  // Both save flags are already off at this point, no cleanup needed.

  setInputValue(nameInput, 'CUSTNAME');
  await sleep(120);

  // Move it, 40 right and 10 down on screen is 40 right and 10 down in PDF y.
  const before = readRect();
  await drag([200, 102], [240, 112]);
  const moved = readRect();
  check(
    'dragging a field moves it in PDF user space',
    rectMatches(moved, { x: before.x + 40, y: before.y - 10, width: 200, height: 20 }),
    JSON.stringify(moved)
  );

  // Zoom must not change anything stored.
  const zoomSelect = document.querySelector('#root header select');
  zoomSelect.value = '2';
  zoomSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor('zoomed canvas', () => document.querySelector('#root canvas')?.style.width === '1224px');
  await sleep(200);
  const afterZoom = readRect();
  check('zoom leaves the stored rect alone', rectMatches(afterZoom, moved), JSON.stringify(afterZoom));

  // Drawing at 200% must still store points, not pixels.
  await drag([200, 200], [600, 240]);
  const atZoom = readRect();
  check(
    'drawing while zoomed stores points not pixels',
    rectMatches(atZoom, { x: 100, y: 672, width: 200, height: 20 }),
    JSON.stringify(atZoom)
  );
  clickButton('Delete', document.querySelector('#root aside'));
  await sleep(80);

  zoomSelect.value = '1';
  zoomSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor('unzoomed canvas', () => document.querySelector('#root canvas')?.style.width === '612px');

  // Page 2 is rotated 90. Screen x runs down the PDF page and screen y runs
  // across it, so a wide box on screen is a tall rect in user space.
  clickButton('Next', document.querySelector('#root header'));
  await waitFor('rotated page', () => document.querySelector('#root canvas')?.style.width === '792px');
  await sleep(300);
  await drag([100, 100], [300, 120]);
  const rotated = readRect();
  check(
    'drawing on a rotated page stores the right rect',
    rectMatches(rotated, { x: 100, y: 100, width: 20, height: 200 }),
    JSON.stringify(rotated)
  );

  // Type comes from the Draw buttons, it is no longer editable once placed.
  check(
    'the property panel has no type switcher',
    ![...document.querySelectorAll('#root aside button')].some((b) =>
      ['text', 'checkbox'].includes(b.textContent.trim().toLowerCase())
    )
  );

  // Font: the selected field is the rotated-page text field drawn just above.
  const familySelect = document.querySelector('#root aside select');
  const sizeInput = document.querySelector('#root aside input[type=number]');
  check(
    'a new text field defaults to Arial 10',
    familySelect?.value === 'Helvetica' && Number(sizeInput?.value) === 10,
    `${familySelect?.value} ${sizeInput?.value}`
  );
  check(
    'the family list offers Arial by name, not Helvetica',
    [...(familySelect?.options ?? [])].some((o) => o.textContent.trim() === 'Arial')
  );

  // The standard is a default, not a lock. It has to be changeable.
  familySelect.value = 'Courier';
  familySelect.dispatchEvent(new Event('change', { bubbles: true }));
  setInputValue(sizeInput, '14');
  await sleep(150);
  check(
    'font family and size can both be changed',
    document.querySelector('#root aside select')?.value === 'Courier' &&
      Number(document.querySelector('#root aside input[type=number]')?.value) === 14
  );

  // And one button puts every field back to the standard.
  clickButton('Enforce Font Standards', document.querySelector('#root header'));
  await sleep(200);
  check(
    'Enforce Font Standards resets the field to Arial 10',
    document.querySelector('#root aside select')?.value === 'Helvetica' &&
      Number(document.querySelector('#root aside input[type=number]')?.value) === 10
  );

  // A checkbox renders no text, so it gets no font control, but it does carry
  // the export value the filler compares against.
  const header = document.querySelector('#root header');
  clickButton('Checkbox', header);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await drag([520, 300], [536, 316]);
  await sleep(150);
  check(
    'a checkbox field has no font control',
    !document.querySelector('#root aside select') &&
      !document.querySelector('#root aside input[type=number]')
  );
  const cbExport = [...document.querySelectorAll('#root aside input[type=text]')].at(-1);
  check('a checkbox defaults its export value to Yes', cbExport?.value === 'Yes', cbExport?.value);

  // A radio option has no safe default, so it starts blank and is flagged.
  clickButton('Radio', header);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await drag([520, 450], [536, 466]);
  await sleep(150);
  const radioExport = [...document.querySelectorAll('#root aside input[type=text]')].at(-1);
  check(
    'a radio option gets an Acrobat style placeholder value',
    radioExport?.value === 'Choice1',
    JSON.stringify(radioExport?.value)
  );

  // Clearing it is still an error, the field could never fill without one.
  setInputValue(radioExport, '');
  await sleep(150);
  check(
    'clearing the export value is reported',
    document.querySelector('#root aside').textContent.includes('no export value')
  );
  setInputValue(radioExport, 'A B');
  await sleep(150);
  check(
    'an export value that would be escaped is rejected',
    document.querySelector('#root aside').textContent.includes('Letters, digits')
  );
  setInputValue(radioExport, 'BASIC');
  await sleep(150);
  check(
    'a valid export value clears the complaint',
    !document.querySelector('#root aside').textContent.includes('no export value')
  );

  // Alignment and wrapping live with the font, both field level.
  clickButton('Text', header);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await drag([560, 520], [700, 545]);
  await sleep(180);
  const aligned = () =>
    [...document.querySelectorAll('#root aside button')].filter((b) =>
      ['Left', 'Center', 'Right'].includes(b.textContent.trim())
    );
  check('a text field offers Left, Center and Right', aligned().length === 3);
  check(
    'it starts left aligned',
    aligned().find((b) => b.textContent.trim() === 'Left')?.getAttribute('aria-pressed') === 'true'
  );
  aligned().find((b) => b.textContent.trim() === 'Center').click();
  await sleep(150);
  check(
    'alignment can be changed',
    aligned().find((b) => b.textContent.trim() === 'Center')?.getAttribute('aria-pressed') === 'true'
  );
  const multi = toggle('Multiline');
  check('a text field has a Multiline toggle, off by default', multi && !multi.checked);
  multi.click();
  await sleep(150);
  check('multiline can be turned on', toggle('Multiline').checked === true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await sleep(150);

  // A dropdown takes an option list and, since it draws text, a font.
  clickButton('Dropdown', header);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await drag([180, 520], [340, 540]);
  await sleep(150);
  const optionBox = [...document.querySelectorAll('#root aside textarea')].at(-1);
  check('a dropdown has an options box', !!optionBox);
  check('a dropdown has a font control', !!document.querySelector('#root aside select'));
  // Typed one character at a time, since a whole value paste hides a
  // reformat-on-keystroke bug: the resync lands on the same text either way.
  const nl2 = String.fromCharCode(10);
  for (const ch of `SOLE${nl2}CORP = Corporation`) {
    const box = [...document.querySelectorAll('#root aside textarea')].at(-1);
    setInputValue(box, box.value + ch);
    await sleep(25);
  }
  const typedOptions = [...document.querySelectorAll('#root aside textarea')].at(-1).value;
  check(
    'newlines and the = separator survive being typed',
    typedOptions === `SOLE${nl2}CORP = Corporation`,
    JSON.stringify(typedOptions)
  );
  check(
    'dropdown options are counted',
    document.querySelector('#root aside').textContent.includes('2 options')
  );
  check(
    'a value that differs from its label is shown as a pair',
    document.querySelector('#root aside').textContent.includes('shows as')
  );
  check(
    'a dropdown aligns but cannot wrap',
    [...document.querySelectorAll('#root aside button')].some(
      (b) => b.textContent.trim() === 'Center'
    ) && toggle('Multiline') === null
  );

  // Three options of one group: the list should nest and number them the way
  // Acrobat's Fields panel does, rather than showing three identical rows.
  clickButton('Radio', header);
  for (const y of [200, 230, 260]) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await drag([600, y], [616, y + 16]);
    await sleep(80);
    const nameBox = document.querySelector('#root aside input[type=text]');
    setInputValue(nameBox, 'COVERAGE');
    await sleep(120);
  }
  const listText = document.querySelector('#root aside').textContent;
  check(
    'a radio group is nested under its name',
    listText.includes('radio group, 3 options'),
    ''
  );
  check(
    'radio options are labelled by value, not numbered',
    listText.includes('Choice1') && listText.includes('Choice2') && listText.includes('Choice3')
  );
  check(
    'radio options carry no # suffix, as in Acrobat',
    !listText.includes('COVERAGE#0')
  );

  clickButton('Text', header);

  // Keyboard delete on the selection.
  const countBefore = document.querySelectorAll('#root [data-field-id]').length;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await sleep(120);
  check(
    'delete key removes the selected field',
    document.querySelectorAll('#root [data-field-id]').length === countBefore - 1
  );

  // Editable applies to all four types and must be reachable on each, not
  // pushed under the fold by the type specific controls. Drawn last, since
  // these scratch fields are drawn and deleted again.
  const editableVisible = () => {
    const aside = document.querySelector('#root aside');
    const label = [...aside.querySelectorAll('label')].find((l) =>
      l.textContent.trim().startsWith('Editable')
    );
    if (!label) return false;
    const box = label.getBoundingClientRect();
    const panel = label.closest('.overflow-auto').getBoundingClientRect();
    return box.top >= panel.top - 1 && box.bottom <= panel.bottom + 1;
  };

  const editableSeen = {};
  for (const [type, label] of [['text', 'Text'], ['checkbox', 'Checkbox'], ['radio', 'Radio'], ['dropdown', 'Dropdown']]) {
    clickButton(label, header);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await drag([660, 200], [700, 220]);
    await sleep(180);
    editableSeen[type] = editableVisible();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await sleep(120);
  }
  check(
    'every field type shows Editable without scrolling',
    Object.values(editableSeen).every(Boolean),
    JSON.stringify(editableSeen)
  );

  // Visibility is per placement and shows on the canvas, since a hidden field
  // is not drawn in the exported PDF at all.
  // Standard scope, so the system fields, hidden by design, do not answer for
  // the one being toggled here.
  clickButton('Text', header);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await drag([120, 300], [280, 320]);
  await sleep(180);
  const hiddenBox = toggle('Hidden');
  check('every field has a Hidden toggle, unset by default', hiddenBox && !hiddenBox.checked);
  hiddenBox.click();
  await sleep(180);
  check(
    'hiding is marked in the field list',
    document.querySelector('#root aside').textContent.includes('HID')
  );
  const hiddenOnCanvas = [...document.querySelectorAll('#root [data-field-id]')].some(
    (el) => el.className.includes('opacity-40') && el.textContent.includes('hidden')
  );
  check('a hidden field reads as faint on the page', hiddenOnCanvas);
  toggle('Hidden').click();
  await sleep(150);
  check(
    'unhiding clears both',
    !document.querySelector('#root aside').textContent.includes('HID') &&
      ![...document.querySelectorAll('#root [data-field-id]')].some((el) =>
        el.className.includes('opacity-40')
      )
  );
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await sleep(120);
  // The right panel switches to form level config.
  clickTab('Config');
  await sleep(200);
  const configPanel = document.querySelector('#root aside');
  check('the Config tab replaces the field list', !configPanel.querySelector('dl'));
  check(
    'form type offers Person, Org and Combined',
    ['Person', 'Org', 'Combined'].every((t) =>
      [...configPanel.querySelectorAll('button')].some((b) => b.textContent.trim() === t)
    )
  );
  clickButton('Org', configPanel);
  await sleep(120);
  check(
    'form type can be changed',
    [...configPanel.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Org')
      ?.getAttribute('aria-pressed') === 'true'
  );

  // Free text boxes, labelled exactly as the business names them and in their
  // order. Typed a character at a time, since the config is rebuilt on every
  // keystroke and a trim there would eat a space.
  const TEXT_LABELS = [
    'Form Menu Group(s)',
    'Form Name',
    'FO Form ID',
    'FO Form Description',
    'FO Cabinet',
  ];
  const textBox = (label) =>
    [...document.querySelectorAll('#root aside label')]
      .find((l) => l.textContent.trim() === label)
      ?.parentElement.querySelector('input[type=text]');
  const shownLabels = [...document.querySelectorAll('#root aside label')]
    .map((l) => l.textContent.trim())
    .filter((t) => TEXT_LABELS.includes(t));
  check(
    'Config has its text boxes, in the order the business names them',
    JSON.stringify(shownLabels) === JSON.stringify(TEXT_LABELS) &&
      TEXT_LABELS.every((t) => !!textBox(t)),
    JSON.stringify(shownLabels)
  );

  // The three FO Processing questions. A checkbox answers its row either way,
  // so the sheet reads Yes or No rather than being left blank.
  const cfgCheck = (label) =>
    [...document.querySelectorAll('#root aside label')]
      .find((l) => l.textContent.trim() === label)
      ?.querySelector('input[type=checkbox]');
  const CHECK_LABELS = ['Post Processing', 'Admin Queue', 'Support Services'];
  check(
    'Config offers Post Processing, Admin Queue and Support Services, all off',
    CHECK_LABELS.every((l) => cfgCheck(l) && !cfgCheck(l).checked)
  );
  cfgCheck('Admin Queue').click();
  await sleep(150);
  check(
    'one can be ticked without the others',
    cfgCheck('Admin Queue').checked &&
      !cfgCheck('Post Processing').checked &&
      !cfgCheck('Support Services').checked
  );
  for (const ch of 'Coverdraft Protection') {
    const box = textBox('FO Form Description');
    setInputValue(box, box.value + ch);
    await sleep(20);
  }
  check(
    'a space survives being typed into the description',
    textBox('FO Form Description').value === 'Coverdraft Protection',
    JSON.stringify(textBox('FO Form Description').value)
  );
  setInputValue(textBox('FO Form ID'), ' K_COV ');
  await sleep(120);
  textBox('FO Form ID').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await sleep(120);
  check(
    'leaving the FO Form ID box trims it',
    textBox('FO Form ID').value === 'K_COV',
    JSON.stringify(textBox('FO Form ID').value)
  );

  const codeBox = configPanel.querySelector('textarea');
  setInputValue(codeBox, 'M101,RSP,C101, LMNOP,,M101');
  await sleep(180);
  const codes = [...document.querySelectorAll('#root aside li')]
    .map((li) => li.textContent.trim())
    .filter((t) => ['M101', 'RSP', 'C101', 'LMNOP'].includes(t));
  check(
    'pasted codes are split, trimmed and deduped',
    JSON.stringify(codes) === JSON.stringify(['M101', 'RSP', 'C101', 'LMNOP']),
    JSON.stringify(codes)
  );

  // Typed one character at a time, which is what actually broke: a whole-value
  // paste hid the bug because the resync landed on the same text.
  const newline = String.fromCharCode(10);
  setInputValue(configPanel.querySelector('textarea'), '');
  await sleep(120);
  for (const ch of `AB,CD${newline}EF`) {
    const box = document.querySelector('#root aside textarea');
    setInputValue(box, box.value + ch);
    await sleep(30);
  }
  const typed = document.querySelector('#root aside textarea').value;
  check(
    'commas and newlines survive being typed',
    typed === `AB,CD${newline}EF`,
    JSON.stringify(typed)
  );
  const typedCodes = [...document.querySelectorAll('#root aside li')]
    .map((li) => li.textContent.trim())
    .filter((t) => ['AB', 'CD', 'EF'].includes(t));
  check(
    'typed codes still parse',
    JSON.stringify(typedCodes) === JSON.stringify(['AB', 'CD', 'EF']),
    JSON.stringify(typedCodes)
  );

  // Leaving the box tidies it up, and a trailing separator does not add a code.
  setInputValue(document.querySelector('#root aside textarea'), 'AB,CD,');
  await sleep(120);
  // React maps onBlur to focusout, which is the one that bubbles.
  document
    .querySelector('#root aside textarea')
    .dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await sleep(150);
  check(
    'leaving the box reformats it',
    document.querySelector('#root aside textarea').value === 'AB, CD',
    JSON.stringify(document.querySelector('#root aside textarea').value)
  );

  // Submission buttons: placing one is what says the form offers that channel.
  // Maintained in source, not fetched, so it is imported the same way the app
  // gets it.
  const buttonList = signingButtons();
  const channel = (caption) =>
    [...document.querySelectorAll('#root aside label')]
      .find((l) => l.textContent.includes(caption))
      ?.querySelector('input[type=checkbox]');
  check(
    'the Config tab lists every signing channel',
    buttonList.every((b) => !!channel(b.caption)),
    buttonList.map((b) => b.caption).join(', ')
  );
  check('none are on to begin with', buttonList.every((b) => !channel(b.caption).checked));

  channel('Phone Auth').click();
  await sleep(200);
  channel('Print Form').click();
  await sleep(200);
  check(
    'turning two on leaves the other two off',
    channel('Phone Auth').checked &&
      channel('Print Form').checked &&
      !channel('Remote eSign').checked
  );

  // Remote eSign brings its label and code box with it, sitting against the
  // button, and they move as one cluster.
  clickTab('Config');
  await sleep(200);
  channel('Remote eSign').click();
  await sleep(250);
  clickTab('Fields');
  await sleep(200);
  const boxAt = (title) =>
    [...document.querySelectorAll('#root [data-field-id]')].find((el) => el.title === title);
  check(
    'turning Remote eSign on places its label and code box',
    !!boxAt('eSignLBL') && !!boxAt('eSign_Code'),
    [...document.querySelectorAll('#root [data-field-id]')].map((e) => e.title).join(',')
  );
  // The cluster runs along the page, but the page may be rotated, and then PDF
  // x is a different screen axis. So compare along whichever axis the pair
  // actually differs on, in whichever direction that axis runs.
  const seen = (t) => boxAt(t).getBoundingClientRect();
  const b = seen('RemoteESignButton');
  const l = seen('eSignLBL');
  const c = seen('eSign_Code');
  const horizontal = Math.abs(l.left - c.left) > Math.abs(l.top - c.top);
  const along = (r) => (horizontal ? r.left : r.top);
  const ordered = (p, q, r) => (p < q && q < r) || (p > q && q > r);
  check(
    'they run on from the button, in order',
    ordered(along(b), along(l), along(c)),
    `${horizontal ? 'x' : 'y'}: ${along(b)}, ${along(l)}, ${along(c)}`
  );
  check(
    'and butt against it rather than floating off',
    Math.abs(along(l) - along(b)) < 200 && Math.abs(along(c) - along(l)) < 200
  );
  check(
    'and share the Submission scope with the button, not the Signers one',
    [...document.querySelectorAll('#root aside button')]
      .find((b) => b.textContent.trim() === 'Submission')
      ?.getAttribute('aria-pressed') === 'true'
  );
  clickTab('Config');
  await sleep(200);
  channel('Remote eSign').click();
  await sleep(250);
  clickTab('Fields');
  await sleep(200);
  check(
    'turning it off takes the pair with it',
    !boxAt('eSignLBL') && !boxAt('eSign_Code')
  );

  // Environment. Defaults to Test so an untouched form fails safe.
  clickTab('Config');
  await sleep(200);
  const envBtn = (label) =>
    [...document.querySelectorAll('#root aside button')].find(
      (b) => b.textContent.trim() === label
    );
  check(
    'the environment defaults to Test',
    envBtn('Test')?.getAttribute('aria-pressed') === 'true' &&
      envBtn('Production')?.getAttribute('aria-pressed') === 'false'
  );
  envBtn('Production').click();
  await sleep(200);
  check(
    'and can be switched to Production',
    envBtn('Production')?.getAttribute('aria-pressed') === 'true'
  );
  envBtn('Test').click();
  await sleep(200);

  clickTab('Fields');
  await sleep(150);
  // Buttons only show in their own scope, so turning one on follows the change
  // there. Otherwise ticking the box looks like it did nothing.
  check(
    'turning a channel on switches to the Submission scope',
    [...document.querySelectorAll('#root aside button')]
      .find((b) => b.textContent.trim() === 'Submission')
      ?.getAttribute('aria-pressed') === 'true'
  );
  // Turning the channel on already moved the view here, so clicking the name
  // would toggle it back off. Say what is wanted instead.
  await onlyScopes('Submission');
  check(
    'the Submission scope shows just the buttons',
    document.querySelectorAll('#root [data-field-id]').length === 2,
    String(document.querySelectorAll('#root [data-field-id]').length)
  );

  // A button is the one type that is really drawn in the PDF, so it is drawn
  // here rather than outlined, and stays at full strength while hidden, which
  // is how Acrobat shows it.
  const buttonBox = [...document.querySelectorAll('#root [data-field-id]')].find(
    (el) => el.title === 'PrintButton'
  );
  const look = buttonBox && getComputedStyle(buttonBox);
  check(
    'a button is drawn green, black bordered and beveled',
    look?.backgroundColor === 'rgb(0, 255, 0)' &&
      look.borderTopColor === 'rgb(0, 0, 0)' &&
      look.boxShadow.includes('inset'),
    `${look?.backgroundColor} / ${look?.borderTopColor}`
  );
  check('and is not dimmed, though it is hidden', look?.opacity === '1', look?.opacity);
  check('and carries its caption', buttonBox?.textContent.includes('Print Form'));

  // Selected from the list, which has real buttons. A canvas box selects on
  // pointerdown, which a synthetic click does not produce.
  [...document.querySelectorAll('#root aside button')]
    .find((b) => b.textContent.includes('PrintButton'))
    ?.click();
  await sleep(250);
  check(
    'a button says what it is and fixes its name',
    document.querySelector('#root aside').textContent.includes('Submission button') &&
      document.querySelector('#root aside input[type=text]')?.readOnly === true
  );
  check(
    'it carries none of the value machinery',
    !document.querySelector('#root aside').textContent.includes('Load Validation') &&
      !document.querySelector('#root aside').textContent.includes('Customer-facing')
  );

  clickTab('Config');
  await sleep(200);
  channel('Phone Auth').click();
  await sleep(200);
  clickTab('Fields');
  await sleep(200);
  check(
    'turning a channel off removes its button',
    document.querySelectorAll('#root [data-field-id]').length === 1
  );
  await onlyScopes('Standard');

  clickTab('Fields');
  await sleep(150);
  check(
    'switching back leaves the config panel',
    !document.querySelector('#root aside textarea[placeholder*="M101"]')
  );

  // Signer rows. Placing is what says a row exists, so the config follows the
  // page rather than the other way round.
  clickTab('Config');
  await sleep(200);
  const cfgPane = () => document.querySelector('#root aside');
  check(
    'the Config tab offers to add a signer row',
    cfgPane().textContent.includes('Signer rows') &&
      [...cfgPane().querySelectorAll('button')].some(
        (b) => b.textContent.trim() === 'Add signer row'
      )
  );
  check('none placed to begin with', cfgPane().textContent.includes('None placed'));

  clickButton('Add signer row', cfgPane());
  await sleep(250);
  // The scope tabs live on the Fields tab, and adding a row happens on Config.
  clickTab('Fields');
  await sleep(200);
  check(
    'adding a row switches to the Signers scope',
    [...document.querySelectorAll('#root aside button')]
      .find((b) => b.textContent.trim() === 'Signers')
      ?.getAttribute('aria-pressed') === 'true'
  );
  const boxTitles = () =>
    [...document.querySelectorAll('#root [data-field-id]')].map((el) => el.title);
  check(
    'it drops all three parts of row 1',
    boxTitles().join(',') === 'Member1Name,Member1Signature,Member1SignDate',
    boxTitles().join(',')
  );

  const signerBox = [...document.querySelectorAll('#root [data-field-id]')].find(
    (el) => el.title === 'Member1Name'
  );
  // Tailwind reports colours as oklch. 184 is teal's hue, which is what marks
  // the signer family apart from grey system and blue standard.
  check(
    'signer fields are teal, not the system grey or the standard blue',
    /184/.test(getComputedStyle(signerBox).borderTopColor),
    getComputedStyle(signerBox).borderTopColor
  );

  // Selected from the list, since a canvas box needs a real pointerdown.
  [...document.querySelectorAll('#root aside button')]
    .find((b) => b.textContent.includes('Member1Name'))
    ?.click();
  await sleep(250);
  check(
    'a signer name says its options come at run time',
    cfgPane().textContent.includes('options are built at run time')
  );
  check('and says which row it belongs to', cfgPane().textContent.includes('Signer row 1'));

  // The picker only offers what is legal to place, which is what keeps rows
  // contiguous without a rule to break.
  const signerNameInput = document.querySelector('#root aside input[type=text]');
  const dbList = await (await fetch('/dbFields.json')).json();
  const picker = () => signerNameInput.parentElement;
  const pickerNames = () =>
    [...picker().querySelectorAll('ul button span:first-child')].map((s) => s.textContent);
  signerNameInput.focus();
  await sleep(250);
  // The box arrives holding a name, and filtering by it hid everything else.
  check(
    'opening the picker shows every DB field',
    dbList.every((f) => pickerNames().includes(f.identifier)),
    `${pickerNames().length} offered, ${dbList.length} in the DB list`
  );
  const highlighted = () => picker().querySelector('ul button.bg-sky-50 span')?.textContent;
  check('and lands on the name already in the box', highlighted() === 'Member1Name', highlighted());

  // Typing narrows it. The list below the box is the field list, whose rows
  // read "nametype", so options are matched on the label they carry.
  const offeredNames = () =>
    [...document.querySelectorAll('#root aside ul button')].map((b) => b.textContent.trim());
  setInputValue(signerNameInput, 'Member');
  await sleep(250);
  check(
    'the picker offers row 2 but never row 3',
    offeredNames().some((t) => t.startsWith('Member2Name')) &&
      !offeredNames().some((t) => t.startsWith('Member3Name')),
    offeredNames().filter((t) => t.startsWith('Member2') || t.startsWith('Member3')).join(' | ')
  );

  setInputValue(signerNameInput, 'Joint');
  await sleep(250);
  check(
    'and offers both joint shapes while neither is used',
    offeredNames().some((t) => t.startsWith('JointMember1Name')) &&
      offeredNames().some((t) => t.startsWith('JointMembers')),
    offeredNames().filter((t) => t.startsWith('Joint')).join(' | ')
  );

  // Put the name back, since renaming it emptied row 1 of its dropdown.
  setInputValue(signerNameInput, 'Member1Name');
  await sleep(250);
  signerNameInput.blur();
  await sleep(150);

  clickTab('Config');
  await sleep(200);
  // A complete row shows its parts and offers none of them to place.
  check(
    'the config reads the row shape off the page',
    cfgPane().textContent.includes('Member1') &&
      ![...cfgPane().querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('+')),
    [...cfgPane().querySelectorAll('button')].map((b) => b.textContent.trim()).join(' | ')
  );
  clickButton('Add signer row', cfgPane());
  await sleep(250);
  check('a second row is picked up too', cfgPane().textContent.includes('Member2'));
  clickTab('Fields');
  await sleep(200);
  check(
    'and both rows are on the page, six fields',
    document.querySelectorAll('#root [data-field-id]').length === 6,
    String(document.querySelectorAll('#root [data-field-id]').length)
  );
  // Deleting one part of a row leaves the row, and Config offers it back. Without
  // that, putting it back means drawing a box and knowing to look in the picker.
  [...document.querySelectorAll('#root aside button')]
    .find((b) => b.textContent.includes('Member2Signature'))
    ?.click();
  await sleep(250);
  [...document.querySelectorAll('#root aside button')]
    .find((b) => b.textContent.trim() === 'Delete')
    ?.click();
  await sleep(250);
  check(
    'deleting one part leaves the rest of the row',
    document.querySelectorAll('#root [data-field-id]').length === 5,
    String(document.querySelectorAll('#root [data-field-id]').length)
  );

  clickTab('Config');
  await sleep(250);
  const missingBtn = () =>
    [...cfgPane().querySelectorAll('button')].find((b) => b.textContent.trim() === '+ Signature');
  check('Config shows the missing part as something to place', !!missingBtn());
  missingBtn().click();
  await sleep(250);
  check(
    'and clicking it puts the part back',
    !cfgPane().textContent.includes('+ Signature')
  );
  clickTab('Fields');
  await sleep(200);
  check(
    'back to six fields, in the same slot',
    document.querySelectorAll('#root [data-field-id]').length === 6,
    String(document.querySelectorAll('#root [data-field-id]').length)
  );

  // Joint members. Two shapes, and placing one rules out the other.
  clickTab('Config');
  await sleep(250);
  const cfgButtons = () =>
    [...cfgPane().querySelectorAll('button')].map((b) => b.textContent.trim());
  check(
    'Config offers both joint shapes',
    cfgButtons().includes('Add joint row') && cfgButtons().includes('Add combined line')
  );
  clickButton('Add joint row', cfgPane());
  await sleep(250);
  check(
    'a numbered row does not rule out the combined line, they are independent',
    cfgButtons().includes('Add combined line'),
    cfgButtons().join(' | ')
  );
  check('and offers the optional member number', cfgButtons().includes('+ Member number'));

  clickButton('Add combined line', cfgPane());
  await sleep(250);
  check(
    'both shapes together, and the combined line is offered only once',
    !cfgButtons().includes('Add combined line') &&
      cfgPane().textContent.includes('JointMembers placed'),
    cfgButtons().join(' | ')
  );

  clickTab('Fields');
  await sleep(200);
  check(
    'both joint fields are on the page with the signers',
    boxTitles().includes('JointMember1Name') && boxTitles().includes('JointMembers'),
    boxTitles().join(',')
  );

  await onlyScopes('Standard');

  // Naming a field, then deleting it with the keyboard.
  await onlyScopes('Standard');
  const boxes = () => document.querySelectorAll('#root [data-field-id]').length;
  const beforeDraw = boxes();
  await drag([120, 330], [260, 350]);
  await sleep(200);
  check('a field was drawn to delete', boxes() === beforeDraw + 1, `${beforeDraw} -> ${boxes()}`);

  const nameBox = document.querySelector('#root aside input[type=text]');
  setInputValue(nameBox, 'CUSTNAME');
  await sleep(200);

  // Selecting on focus is what lets an existing name be typed straight over.
  nameBox.blur();
  nameBox.focus();
  await sleep(100);
  check(
    'the name box selects its contents on focus',
    nameBox.selectionStart === 0 && nameBox.selectionEnd === nameBox.value.length,
    `${nameBox.selectionStart}..${nameBox.selectionEnd} of ${nameBox.value.length}`
  );

  // Clicking the field on the page has to take the keyboard out of the name
  // box. The pointer handler calls preventDefault to stop the drag selecting
  // text, which also suppresses the focus change, so without the overlay taking
  // focus itself Delete would edit the name instead of removing the field.
  const beforeDelete = boxes();
  await drag([190, 340], [190, 340]);
  await sleep(150);
  check(
    'clicking the page takes the keyboard out of the name box',
    document.activeElement !== nameBox,
    document.activeElement?.tagName
  );

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await sleep(200);
  check(
    'the delete key removes the selected field',
    boxes() === beforeDelete - 1,
    `${beforeDelete} -> ${boxes()}`
  );

  // Clicking an issue narrows the list to exactly the fields it counted.
  await onlyScopes('Standard');
  await drag([120, 250], [260, 270]);
  await drag([120, 290], [260, 310]);
  await sleep(200);

  const issueButton = () =>
    [...document.querySelectorAll('#root aside button')].find((b) =>
      b.textContent.includes('no name')
    );
  check('two unnamed fields raise one counted issue', !!issueButton(), issueButton()?.textContent);

  const sidebarText = () => document.querySelector('#root aside').textContent;
  // However many there are, the issue is one line carrying a count rather than
  // a row each.
  const counted = Number(/(\d+) fields have no name/.exec(sidebarText())?.[1] ?? 0);
  check('the issue is a count, not a row each', counted >= 2, String(counted));

  issueButton()?.click();
  await sleep(250);
  check(
    'clicking it filters the list to just those fields',
    sidebarText().includes(`showing ${counted} from an issue`),
    sidebarText().slice(0, 90)
  );

  const rowsWhileFiltered = [...document.querySelectorAll('#root aside button')].filter((b) =>
    b.querySelector('span.font-mono')
  );
  check(
    'and shows exactly the counted rows',
    rowsWhileFiltered.length === counted,
    `${rowsWhileFiltered.length} rows for a count of ${counted}`
  );

  [...document.querySelectorAll('#root aside button')]
    .find((b) => b.textContent.includes('from an issue'))
    ?.click();
  await sleep(200);
  check('the filter can be cleared', !sidebarText().includes('from an issue'));

  // Selecting more than one row. This is the bulk of the work on an imported
  // form, so it is worth driving through the real list rather than the model.
  const listRows = () =>
    [...document.querySelectorAll('#root aside button')].filter((b) =>
      b.querySelector('span.font-mono')
    );

  const rowsNow = listRows();
  check('the field list has rows to select', rowsNow.length >= 3, String(rowsNow.length));

  rowsNow[0].click();
  await sleep(150);
  const panelText = () => document.querySelector('#root aside').textContent;
  check('one row selected still shows the property panel', !panelText().includes('fields selected'));

  // Ctrl adds a second.
  rowsNow[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await sleep(200);
  check(
    'Ctrl click adds to the selection and the bulk bar takes over',
    panelText().includes('2 fields selected'),
    panelText().slice(0, 60)
  );

  // Shift takes the run between the anchor and the row clicked.
  rowsNow[0].click();
  await sleep(150);
  rowsNow[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  await sleep(200);
  check(
    'Shift click takes the whole run between two rows',
    panelText().includes('3 fields selected'),
    panelText().slice(0, 60)
  );

  // Arrow keys walk the list, Shift keeps what they pass over.
  rowsNow[0].click();
  await sleep(150);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
  await sleep(200);
  check(
    'arrow keys move through the list and Shift extends',
    panelText().includes('2 fields selected'),
    panelText().slice(0, 60)
  );

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(150);
  check('Escape clears the whole selection', !panelText().includes('fields selected'));

  // The requirements workbook. Rendering the pages needs pdf.js and a canvas,
  // so this is the only place it runs for real.
  await onlyScopes('Standard');
  const exportBtn = [...document.querySelectorAll('#root header button')].find(
    (b) => b.textContent.trim() === 'Export Requirements'
  );
  check('the requirements export is offered', !!exportBtn && !exportBtn.disabled);
  exportBtn?.click();
  await waitFor('the requirements workbook', () => notices().includes('.requirements.xlsx'), 30000);
  check('it reports the workbook it wrote', notices().includes('.requirements.xlsx'), notices().slice(0, 70));

  // Minimized rather than closed, and anything new brings it back.
  clickButton('Hide', noticesBar());
  await sleep(100);
  const showNotices = () =>
    [...document.querySelectorAll('#root header button')].find(
      (b) => b.textContent.trim() === 'Messages'
    );
  check('the notices bar minimizes to a toolbar button', !noticesBar() && !!showNotices());
  showNotices()?.click();
  await sleep(100);
  check(
    'which brings it back as it was',
    notices().includes('.requirements.xlsx') && !showNotices(),
    notices().slice(0, 70)
  );

  clickButton('Hide', noticesBar());
  await sleep(100);
  clickButton('Enforce Font Standards', document.querySelector('#root header'));
  await sleep(100);
  check('a new message opens it again', notices().startsWith('Set '), notices().slice(0, 70));

  // Full export and reopen, in the browser rather than node.
  const dbIndex = buildDbIndex(await (await fetch('/dbFields.json')).json());
  const fields = [
    createField({ name: 'CUSTNAME', page: 0, rect: { x: 100, y: 680, width: 200, height: 20 } }),
    createField({
      name: 'CLAIMSFLAG',
      type: 'checkbox',
      page: 1,
      rect: { x: 90, y: 430, width: 14, height: 14 },
      // Load Validation needs the label the field carries on the form.
      customerFacingName: 'Prior claims',
      loadValidated: true,
    }),
  ];
  const exported = await exportPdf({ originalBytes: bytes, fields, meta: { sourceFileName: 'sample.pdf' } });
  const reopened = await importPdf(exported.pdfBytes, dbIndex);
  check('export then reopen in the browser', reopened.source === SOURCE.EMBEDDED, reopened.source);
  check(
    'the reopened field set matches',
    reopened.fields.length === 2 &&
      reopened.fields[0].name === 'CUSTNAME' &&
      reopened.fields[1].type === 'checkbox' &&
      reopened.fields[1].loadValidated === true
  );

  render();
  document.title = results.every((r) => r.ok) ? 'BROWSER CHECK OK' : 'BROWSER CHECK FAILED';
}

function summary() {
  const failed = results.filter((r) => !r.ok);
  return {
    lines: results.map(
      (r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`
    ),
    passed: results.length - failed.length,
    failed: failed.length,
    diagnostics,
  };
}

// The runner waits on this and reads the result out of the page.
window.__browserCheck = run().then(
  () => {
    diagnostics.push(`notices: ${notices()}`);
    return summary();
  },
  (err) => {
    check('harness completed', false, err.message || String(err));
    diagnostics.push(`notices: ${notices()}`);
    return summary();
  }
);
