// Carrying the requirements JSON inside the PDF, so the definition travels with
// the file and reopening an exported PDF is a full fidelity round trip.
//
// Written twice on purpose. The catalog stream is what this tool reads back,
// it is cheap to find and cannot be renamed by a user. The attachment is the
// same bytes in Acrobat's attachment pane, so someone without this tool can
// still get at the spec.

import { PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

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
  pdfDoc.catalog.set(PDFName.of(CATALOG_KEY), pdfDoc.context.register(stream));

  await pdfDoc.attach(bytes, SIDECAR_FILENAME, {
    mimeType: 'application/json',
    description: 'Form field requirements written by the PDF Requirement Designer.',
    creationDate: new Date(),
    modificationDate: new Date(),
  });

  return bytes;
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
