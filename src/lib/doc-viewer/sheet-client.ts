// Browser side of the spreadsheet reader: sends the bytes to a worker and waits for the model. Falls back to the main thread only when
// workers don't exist and the file isn't a legacy .xls.
import { parseWorkbook, sheetErrorMessage, sniffSheetKind } from "./sheet-parse";
import type { Workbook } from "./sheet-model";

export const SHEET_TIMEOUT_MS = 90_000;

export function loadWorkbook(buffer: ArrayBuffer, name: string, signal?: AbortSignal): Promise<Workbook> {
  const legacy = sniffSheetKind(new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)), name) === "xls";
  return new Promise<Workbook>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled."));
    let worker: Worker | null = null;
    try { worker = typeof Worker === "undefined" ? null : new Worker(new URL("./sheet.worker.ts", import.meta.url), { type: "module" }); } catch { worker = null; }
    if (!worker) {
      if (legacy) return reject(new Error("This browser can't open .xls files here. Save the file as .xlsx and try again."));
      parseWorkbook(buffer, name).then(resolve, (e) => reject(new Error(sheetErrorMessage(e))));
      return;
    }
    const w = worker;
    const done = (fn: () => void) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); w.terminate(); fn(); };
    const onAbort = () => done(() => reject(new Error("Cancelled.")));
    const timer = setTimeout(() => done(() => reject(new Error("Opening this spreadsheet took too long."))), SHEET_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    w.onmessage = (e: MessageEvent<{ ok: boolean; workbook?: Workbook; error?: string }>) => {
      if (e.data.ok && e.data.workbook) done(() => resolve(e.data.workbook!)); else done(() => reject(new Error(e.data.error ?? "Couldn't open this spreadsheet.")));
    };
    w.onerror = () => done(() => reject(new Error("Couldn't open this spreadsheet.")));
    w.postMessage({ id: 1, name, buffer }, [buffer]);
  });
}
