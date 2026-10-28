// Parses a spreadsheet off the main thread so the page stays responsive. See sheet-parse.ts.
import { parseWorkbook, sheetErrorMessage } from "./sheet-parse";

type Request = { id: number; name: string; buffer: ArrayBuffer };
const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage: (m: unknown) => void };
scope.onmessage = async (e) => {
  const { id, name, buffer } = e.data;
  try { scope.postMessage({ id, ok: true, workbook: await parseWorkbook(buffer, name) }); }
  catch (err) { scope.postMessage({ id, ok: false, error: sheetErrorMessage(err) }); }
};
