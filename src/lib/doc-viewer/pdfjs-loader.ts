// Loads pdf.js (and its worker) the first time a PDF is opened. Nothing here runs until then, so the main bundle doesn't grow.
type PdfJs = typeof import("pdfjs-dist");
let loading: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  loading ??= (async () => {
    const pdfjs = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    return pdfjs;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

/**
 * Opens untrusted bytes. Embedded JavaScript can't run (no scripting manager or annotation layer is ever created), `eval` is off, XFA forms are off,
 * and no link is ever followed. The bytes are copied because pdf.js hands them to its worker (which empties the original).
 */
export async function openPdf(buffer: ArrayBuffer) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer.slice(0)),
    isEvalSupported: false, enableXfa: false, stopAtErrors: false, verbosity: 0,
    disableRange: true, disableStream: true, disableAutoFetch: true, maxImageSize: 16 * 1024 * 1024,
  });
  return { pdfjs, task, doc: await task.promise };
}
