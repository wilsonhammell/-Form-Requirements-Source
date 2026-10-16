// The batch, in a real browser: several PDFs opened at once, Prev and Next,
// the list, and every form keeping what was done to it while another is shown.
//
// Start the dev server, then run: node tests/browser/run.mjs <server>/tests/browser/batch.html
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import App from '../../src/App.jsx';
import '../../src/index.css';

const results = [];
const diagnostics = [];
const out = document.getElementById('results');
window.addEventListener('error', (e) => diagnostics.push(`error: ${e.message} ${e.error?.stack ?? ''}`));
window.addEventListener('unhandledrejection', (e) => diagnostics.push(`rejection: ${e.reason?.message ?? e.reason}`));

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const failed = results.filter((r) => !r.ok).length;
  out.textContent =
    results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`).join('\n') +
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

// The same wait the main check does: an upload that lands before the system
// field list has arrived places none of them.
const LISTS = ['/dbFields.json', '/systemFields.json'];
const listsLoaded = new Set();
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const response = await realFetch(input, init);
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  const hit = LISTS.find((path) => url.endsWith(path));
  if (hit && response.ok) response.clone().json().then(() => listsLoaded.add(hit), () => {});
  return response;
};

// Downloads go nowhere in a headless browser, and nothing here needs the file.
URL.createObjectURL = () => 'blob:batch-check';
URL.revokeObjectURL = () => {};

function setInputValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function pdf(title) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText(title, { x: 60, y: 730, size: 18, font, color: rgb(0, 0, 0) });
  doc.addPage([612, 792]).drawText(`${title}, page 2`, { x: 60, y: 730, size: 14, font });
  return doc.save();
}

const bar = () => document.querySelector('#root nav[aria-label=Batch]');
const picker = () => bar()?.querySelector('select');
const button = (label) => bar()?.querySelector(`button[aria-label="${label}"]`);
const onScreen = () => document.querySelector('#root header span[title]')?.getAttribute('title') ?? '';
const counter = () => bar()?.querySelector('label span')?.textContent.trim() ?? '';
const options = () => [...(picker()?.options ?? [])].map((o) => o.textContent);
const formNameBox = () => {
  const label = [...document.querySelectorAll('#root aside label')].find((l) => l.textContent.trim() === 'Form Name');
  return label?.parentElement.querySelector('input') ?? null;
};
const pageSelect = () => document.querySelector('#root header select[aria-label=Page]');

async function showing(name) {
  await waitFor(`${name} on screen`, () => onScreen() === name && !bar()?.querySelector('button:disabled[aria-label="Busy"]'));
  // the busy flag clears once the import is done
  await waitFor(`${name} imported`, () => !picker()?.disabled);
}

async function run() {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  await waitFor('app header', () => document.querySelector('#root header'));
  await waitFor('the DB and system field lists', () => listsLoaded.size === LISTS.length);

  // Picked out of order and with a file that is not a PDF among them, as a
  // folder's worth often is.
  const input = document.querySelector('#root input[type=file][accept*=pdf]');
  check('the PDF picker takes several files', input.multiple === true);
  const transfer = new DataTransfer();
  transfer.items.add(new File([await pdf('Form ten')], 'Form 10.pdf', { type: 'application/pdf' }));
  transfer.items.add(new File([await pdf('Form one')], 'Form 1.pdf', { type: 'application/pdf' }));
  transfer.items.add(new File(['not a pdf'], 'notes.txt', { type: 'text/plain' }));
  transfer.items.add(new File([await pdf('Form two')], 'Form 2.pdf', { type: 'application/pdf' }));
  // and one that is broken, as a folder's worth sometimes has
  transfer.items.add(new File(['%PDF-1.7 not really'], 'Form 3.pdf', { type: 'application/pdf' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  await waitFor('the batch bar', () => bar());
  await showing('Form 1.pdf');
  check('opens the first PDF by name', onScreen() === 'Form 1.pdf', onScreen());
  check('shows where it is in the batch', counter() === '1 of 4', counter());
  check(
    'lists the PDFs in natural name order, the other file left out',
    options().map((o) => o.replace(/^\S*\s*\d+\.\s*/, '')).join(' | ') === 'Form 1.pdf | Form 2.pdf | Form 3.pdf | Form 10.pdf',
    options().join(' | ')
  );
  check('Prev is off on the first form', button('Previous form').disabled === true);
  check('the forms not yet shown are not opened', /3 not opened yet/.test(bar().textContent), bar().textContent);

  // An edit, and the page turned, on form 1.
  const box = await waitFor('the Form Name box', () => formNameBox());
  setInputValue(box, 'Reviewed one');
  // pdf.js is still reading the form when its name shows; the page list
  // comes with it
  await waitFor('the page list', () => pageSelect()?.options.length === 2 && !pageSelect().disabled);
  const pages = pageSelect();
  pages.value = '1';
  pages.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor('the edit', () => options()[0].startsWith('●'));
  await waitFor('page 2', () => pageSelect().value === '1', 3000).catch(() => null);
  check('the page turns to 2 before leaving', pageSelect().value === '1', pageSelect().value);
  check('an edited form is marked in the list', options()[0].startsWith('●'), options()[0]);
  check('and counted', /1 edited, not exported/.test(bar().textContent), bar().textContent);

  // The browser asks before closing the tab on an unexported edit.
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  check('closing the tab asks first while an edit is not exported', leaving.defaultPrevented);

  button('Next form').click();
  await showing('Form 2.pdf');
  check('Next shows the next form', onScreen() === 'Form 2.pdf' && counter() === '2 of 4', `${onScreen()} ${counter()}`);
  check('which has its own document, not the last one', (formNameBox()?.value ?? '') === '', formNameBox()?.value);
  check('and starts on its first page', pageSelect().value === '0', pageSelect().value);
  check('Prev is on now', button('Previous form').disabled === false);

  button('Previous form').click();
  await showing('Form 1.pdf');
  check('Prev goes back', onScreen() === 'Form 1.pdf' && counter() === '1 of 4', `${onScreen()} ${counter()}`);
  check('the edit is still there', formNameBox()?.value === 'Reviewed one', formNameBox()?.value);
  // the page list is there once pdf.js has read the form again
  await waitFor('the page list', () => pageSelect()?.options.length === 2 && !pageSelect().disabled);
  check('so is the page it was left on', pageSelect().value === '1', pageSelect().value);
  const shownWidth = await waitFor('page 2 drawn', () => document.querySelector('#root canvas')?.style.width);
  check('and that page is the one drawn', !!shownWidth, shownWidth);

  // Its undo is its own, and came back with it.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await waitFor('the undo', () => formNameBox()?.value === '');
  check('undo on a form shown again takes back its own edit', formNameBox()?.value === '', formNameBox()?.value);
  check('and the form reads as unchanged again', options()[0].startsWith('·'), options()[0]);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
  await waitFor('the redo', () => formNameBox()?.value === 'Reviewed one');

  // Exported as it stands, then the list says so.
  const exportButton = [...document.querySelectorAll('#root header button')].find((b) => /^Export/.test(b.textContent.trim()));
  exportButton.click();
  const item = await waitFor('Export PDF', () =>
    [...document.querySelectorAll('#root [role=menuitem]')].find((b) => b.textContent.trim() === 'Export PDF')
  );
  item.click();
  await waitFor('the export', () => options()[0].startsWith('✓'), 30000);
  check('an exported form is marked exported', options()[0].startsWith('✓'), options()[0]);
  const after = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(after);
  check('and closing the tab no longer asks', !after.defaultPrevented);

  // The list jumps straight to a form - here the broken one.
  const select = picker();
  select.value = '2';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor('the broken form', () => options()[2].startsWith('✗') && !picker().disabled);
  check('the list jumps straight to a form', counter() === '3 of 4', counter());
  check('a PDF that will not open is marked so', options()[2].startsWith('✗'), options()[2]);
  check('and says why on the page', /could not be opened/i.test(document.querySelector('#root main')?.textContent ?? ''),
    (document.querySelector('#root main')?.textContent ?? '').slice(0, 120));
  check('and is counted', /1 could not be opened/.test(bar().textContent), bar().textContent);

  // Next goes on past it.
  button('Next form').click();
  await showing('Form 10.pdf');
  check('Next steps past a form that would not open', onScreen() === 'Form 10.pdf' && counter() === '4 of 4', `${onScreen()} ${counter()}`);
  check('Next is off on the last form', button('Next form').disabled === true);

  // Form 2, opened and left untouched, still reads as only opened.
  check('a form looked at and left alone is opened, not edited', options()[1].startsWith('·'), options()[1]);
  check('and no form is left unvisited', !/not opened yet/.test(bar().textContent), bar().textContent);
}

function summary() {
  const failed = results.filter((r) => !r.ok);
  return {
    lines: results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.detail ? ` -- ${r.detail}` : ''}`),
    passed: results.length - failed.length,
    failed: failed.length,
    diagnostics,
  };
}

window.__browserCheck = run().then(summary, (err) => {
  check('harness completed', false, err.message || String(err));
  return summary();
});
