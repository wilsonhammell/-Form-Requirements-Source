// The requirements JSON inside the PDF, so reopening an exported form is a full
// fidelity round trip.
//
// Written twice. The catalog stream is what this tool reads back, being cheap
// to find and impossible for a user to rename. The attachment is the same bytes
// in Acrobat's attachment pane, reachable without this tool.

import { PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export const CATALOG_KEY = 'PdfRequirementDesigner';
export const SIDECAR_FILENAME = 'form.fields.json';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function serializeJsonBytes(doc) {
  return encoder.encode(JSON.stringify(doc, null, 2));
}

export async function embedRequirements(pdfDoc, doc) {
  const bytes = serializeJsonBytes(doc);

  const stream = pdfDoc.context.flateStream(bytes, {
    Type: CATALOG_KEY,
    SchemaVersion: doc.schemaVersion,
  });
  const previous = pdfDoc.catalog.get(PDFName.of(CATALOG_KEY));
  if (previous instanceof PDFRef) pdfDoc.context.delete(previous);
  pdfDoc.catalog.set(PDFName.of(CATALOG_KEY), pdfDoc.context.register(stream));

  // pdf-lib's attach appends, so a reexported form would carry one attachment
  // per export.
  removeAttachments(pdfDoc, SIDECAR_FILENAME);
  await pdfDoc.attach(bytes, SIDECAR_FILENAME, {
    mimeType: 'application/json',
    description: 'Form field requirements written by the PDF Requirement Designer.',
    creationDate: new Date(),
    modificationDate: new Date(),
  });

  return bytes;
}

function removeAttachments(pdfDoc, fileName) {
  const names = pdfDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const list = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (!list) return;

  const removed = [];
  // The array alternates name, file spec.
  for (let i = list.size() - 2; i >= 0; i -= 2) {
    if (String(list.lookup(i)?.decodeText?.() ?? '') !== fileName) continue;
    removed.push(list.get(i + 1));
    list.remove(i + 1);
    list.remove(i);
  }
  if (removed.length === 0) return;

  const af = pdfDoc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  for (let i = (af?.size() ?? 0) - 1; i >= 0; i--) {
    if (removed.includes(af.get(i))) af.remove(i);
  }

  for (const ref of removed) {
    if (!(ref instanceof PDFRef)) continue;
    const spec = pdfDoc.context.lookup(ref);
    const file = spec instanceof PDFDict ? spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.get(PDFName.of('F')) : null;
    if (file instanceof PDFRef) pdfDoc.context.delete(file);
    pdfDoc.context.delete(ref);
  }
}

// Returns the parsed JSON, or null when the PDF was not written by this tool.
export function extractRequirements(pdfDoc) {
  return readFromCatalog(pdfDoc) ?? readFromAttachments(pdfDoc);
}

function readFromCatalog(pdfDoc) {
  try {
    const stream = pdfDoc.context.lookup(pdfDoc.catalog.get(PDFName.of(CATALOG_KEY)));
    return parseStream(stream);
  } catch {
    return null;
  }
}

// Fallback for a PDF whose catalog entry was stripped by another tool but whose
// attachment survived.
function readFromAttachments(pdfDoc) {
  try {
    const names = pdfDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
    const embedded = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
    const list = embedded?.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (!list) return null;
    // The array alternates name, file spec.
    for (let i = 0; i < list.size(); i += 2) {
      const fileName = String(list.lookup(i)?.decodeText?.() ?? '');
      if (fileName !== SIDECAR_FILENAME) continue;
      const spec = list.lookup(i + 1, PDFDict);
      const ef = spec?.lookupMaybe(PDFName.of('EF'), PDFDict);
      const parsed = parseStream(ef?.lookup(PDFName.of('F')));
      if (parsed) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function parseStream(stream) {
  if (!(stream instanceof PDFRawStream)) return null;
  const bytes = decodePDFRawStream(stream).decode();
  const text = decoder.decode(bytes).trim();
  if (!text) return null;
  return JSON.parse(text);
}
