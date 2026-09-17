// Apart from the export logic so that path stays testable outside a browser.

export function downloadBytes(bytes, fileName, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick, Safari needs the URL to outlive the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "application.pdf" becomes "application.json", "application.pdf" and "application.xlsx".
const baseName = (pdfFileName) => (pdfFileName || 'form').replace(/\.pdf$/i, '');

export function sidecarName(pdfFileName) {
  return baseName(pdfFileName) + '.json';
}

export function exportedPdfName(pdfFileName) {
  return baseName(pdfFileName) + '.pdf';
}

export function requirementsName(pdfFileName) {
  return baseName(pdfFileName) + '.xlsx';
}
