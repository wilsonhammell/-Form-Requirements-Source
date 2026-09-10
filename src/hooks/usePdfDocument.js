import { useEffect, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Opens the uploaded bytes for rendering. pdf.js takes ownership of the buffer
// it is handed, so it always gets a copy and the original stays intact for export.
export function usePdfDocument(bytes) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    if (!bytes) {
      setDoc(null);
      return undefined;
    }
    let cancelled = false;
    const task = pdfjsLib.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
    });
    task.promise.then(
      (loaded) => {
        if (cancelled) loaded.destroy();
        else setDoc(loaded);
      },
      (err) => {
        if (!cancelled) setError(err);
      }
    );
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [bytes]);

  return { doc, error };
}
