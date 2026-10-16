import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Opens the uploaded bytes for rendering. pdf.js takes ownership of the buffer
// it is handed, so it always gets a copy and the original stays intact for export.
//
// The document handed back is only ever the one for the bytes asked about.
// When the bytes change, the old document is destroyed at once while the new
// one is still loading, and handing the old one back in between let the page
// view ask a destroyed document for a page: stepping from one form of a batch
// back to another left on page 2 threw inside pdf.js and stopped the app. Null
// in between instead, which reads as loading.
export function usePdfDocument(bytes) {
  const [loaded, setLoaded] = useState({ bytes: null, doc: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    if (!bytes) {
      setLoaded({ bytes: null, doc: null });
      return undefined;
    }
    let cancelled = false;
    const task = pdfjsLib.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
    });
    task.promise.then(
      (doc) => {
        if (cancelled) doc.destroy();
        else setLoaded({ bytes, doc });
      },
      (err) => {
        if (!cancelled) setError(err);
      }
    );
    return () => {
      cancelled = true;
      task.destroy();
      // Destroyed with the task, so it is forgotten with it. Kept, it came
      // back the moment the same bytes did: Prev pressed before the next form
      // had finished loading handed the page view a destroyed document.
      setLoaded((current) => (current.bytes === bytes ? { bytes: null, doc: null } : current));
    };
  }, [bytes]);

  return { doc: loaded.bytes === bytes ? loaded.doc : null, error };
}
