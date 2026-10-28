// Reads .xlsx/.xlsm (exceljs), .xls (SheetJS, only ever inside the worker) and .csv (own reader) into the viewer's SheetData model.
// Read only: nothing is evaluated, macros are never loaded or run, links are not followed. Runs in a Web Worker (sheet.worker.ts); the
// main thread only uses it directly when workers aren't available and the file isn't a legacy .xls.
import { MAX_CELLS, MAX_COLS, MAX_ROWS, SHEET_MAX_BYTES, cellKey, displayValue, excelWidthToPx, parseCsv, pointsToPx, sheetFromRows, type Cell, type CellStyle, type Merge, type SheetData, type Workbook } from "./sheet-model";

export type SheetKind = "xlsx" | "xls" | "csv";

/** Decides the format from the first bytes first (a renamed file still opens), then the extension. */
export function sniffSheetKind(bytes: Uint8Array, name: string): SheetKind {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return "xlsx";
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return "xls";
  if (/\.(xlsx|xlsm)$/i.test(name)) return "xlsx";
  if (/\.xls$/i.test(name)) return "xls";
  return "csv";
}

export function sheetErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/password|encrypt|protected/i.test(msg)) return "This workbook is password-protected. Remove the password in Excel, then open it again.";
  if (/too large|exceeds/i.test(msg)) return msg;
  if (/cancel|abort/i.test(msg)) return "Cancelled.";
  if (/zip|central directory|end of data|corrupt|not a|invalid|unsupported|unexpected|can't find|bad/i.test(msg)) return "This file isn't a readable spreadsheet.";
  return "Couldn't open this spreadsheet.";
}

const rgb = (c: { argb?: string } | undefined): string | undefined => {
  const a = c?.argb;
  return typeof a === "string" && /^[0-9a-f]{8}$/i.test(a) ? `#${a.slice(2)}` : undefined;
};

type ExCell = { value: unknown; numFmt?: string; font?: { bold?: boolean; italic?: boolean; underline?: unknown; color?: { argb?: string }; size?: number }; fill?: { type?: string; pattern?: string; fgColor?: { argb?: string } }; alignment?: { horizontal?: string; wrapText?: boolean } };

function plainValue(v: unknown): { value: unknown; formula?: string | undefined } {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) {
      const result = o["result"];
      const err = result && typeof result === "object" && "error" in (result as object) ? String((result as { error: unknown }).error) : undefined;
      return { value: err ?? result ?? "", formula: typeof o["formula"] === "string" ? o["formula"] : typeof o["sharedFormula"] === "string" ? o["sharedFormula"] : undefined };
    }
    if (Array.isArray(o["richText"])) return { value: (o["richText"] as { text?: string }[]).map((t) => t.text ?? "").join("") };
    if ("hyperlink" in o) return { value: typeof o["text"] === "string" ? o["text"] : o["text"] && typeof o["text"] === "object" ? plainValue(o["text"]).value : String(o["hyperlink"] ?? "") };
    if ("error" in o) return { value: String(o["error"]) };
    return { value: "" };
  }
  return { value: v };
}

function styleOf(cell: ExCell): CellStyle | undefined {
  const st: CellStyle = {};
  if (cell.font?.bold) st.b = true;
  if (cell.font?.italic) st.i = true;
  if (cell.font?.underline) st.u = true;
  const color = rgb(cell.font?.color); if (color && color !== "#000000") st.color = color;
  if (cell.font?.size && cell.font.size !== 11) st.size = cell.font.size;
  if (cell.fill?.type === "pattern" && cell.fill.pattern === "solid") { const bg = rgb(cell.fill.fgColor); if (bg && bg !== "#FFFFFF") st.bg = bg; }
  const h = cell.alignment?.horizontal; if (h === "left" || h === "center" || h === "right") st.align = h;
  if (cell.alignment?.wrapText) st.wrap = true;
  return Object.keys(st).length ? st : undefined;
}

function decodeRange(range: string): Merge | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/i.exec(range);
  if (!m) return null;
  const col = (s: string) => { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  return { r1: Number(m[2]) - 1, c1: col(m[1]!), r2: Number(m[4]) - 1, c2: col(m[3]!) };
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<Workbook> {
  const module = await import("exceljs");
  const ExcelJS = (module as unknown as { default?: typeof import("exceljs") }).default ?? module;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: SheetData[] = []; const notes: string[] = [];
  let budget = MAX_CELLS; let hidden = 0;
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") { hidden++; continue; }
    const cells = new Map<number, Cell>(); const styles: CellStyle[] = []; const styleIdx = new Map<string, number>();
    const rowHeights: Record<number, number> = {}; const colWidths: Record<number, number> = {}; const hiddenRows: number[] = []; const hiddenCols: number[] = [];
    let rows = 0, cols = 0, truncated = false;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      const r = rn - 1;
      if (r >= MAX_ROWS || budget <= 0) { truncated = true; return; }
      rows = Math.max(rows, rn);
      if (row.height) rowHeights[r] = pointsToPx(row.height);
      if (row.hidden) hiddenRows.push(r);
      row.eachCell({ includeEmpty: false }, (cell, cn) => {
        const c = cn - 1;
        if (c >= MAX_COLS) { truncated = true; return; }
        if (budget <= 0) { truncated = true; return; }
        const raw = cell as unknown as ExCell;
        const { value, formula } = plainValue(raw.value);
        if (value === null || value === undefined || (value === "" && !formula)) { const st0 = styleOf(raw); if (!st0?.bg) return; }
        const { t, n } = displayValue(value, raw.numFmt);
        const st = styleOf(raw);
        let s: number | undefined;
        if (st) { const k = JSON.stringify(st); s = styleIdx.get(k); if (s === undefined) { s = styles.length; styles.push(st); styleIdx.set(k, s); } }
        const out: Cell = { t, n };
        const v = value instanceof Date ? t : typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
        if (v !== undefined) out.v = v;
        if (formula) out.f = formula;
        if (s !== undefined) out.s = s;
        cells.set(cellKey(r, c), out); cols = Math.max(cols, cn); budget--;
      });
    });
    const maxCol = Math.min(MAX_COLS, Math.max(cols, ws.columnCount || 0));
    for (let c = 1; c <= maxCol; c++) {
      const col = ws.getColumn(c);
      if (col.width) colWidths[c - 1] = excelWidthToPx(col.width);
      if (col.hidden) hiddenCols.push(c - 1);
    }
    const mergeList = ((ws.model as unknown as { merges?: string[] }).merges ?? []).map(decodeRange).filter((m): m is Merge => !!m && m.r1 < MAX_ROWS && m.c1 < MAX_COLS);
    const view = (ws.views ?? []).find((v) => (v as { state?: string }).state === "frozen") as { xSplit?: number; ySplit?: number } | undefined;
    sheets.push({ name: ws.name, rows, cols, cells, styles, colWidths, rowHeights, merges: mergeList.map((m) => ({ ...m, r2: Math.min(m.r2, MAX_ROWS - 1), c2: Math.min(m.c2, MAX_COLS - 1) })), frozen: { rows: Math.min(view?.ySplit ?? 0, 50), cols: Math.min(view?.xSplit ?? 0, 20) }, truncated, ...(hiddenRows.length ? { hiddenRows } : {}), ...(hiddenCols.length ? { hiddenCols } : {}) });
  }
  if (hidden) notes.push(`${hidden} hidden sheet${hidden === 1 ? "" : "s"} not shown.`);
  if (!sheets.length) throw new Error("This workbook has no visible sheets.");
  return { sheets, notes };
}

/** Legacy .xls. Only called from the worker, so anything odd in a hostile file stays out of the page. */
export async function parseXls(buffer: ArrayBuffer): Promise<Workbook> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true, cellStyles: false, bookVBA: false, sheetRows: MAX_ROWS + 1 });
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws["!ref"]) { sheets.push(sheetFromRows(name, [])); continue; }
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cells = new Map<number, Cell>(); let rows = 0, cols = 0, truncated = false, budget = MAX_CELLS;
    for (const key of Object.keys(ws)) {
      if (key.startsWith("!")) continue;
      const { r, c } = XLSX.utils.decode_cell(key);
      if (r >= MAX_ROWS || c >= MAX_COLS || budget <= 0) { truncated = true; continue; }
      const cell = ws[key] as { t?: string; v?: unknown; w?: string; f?: string };
      const shown = cell.w ?? displayValue(cell.v).t;
      if (shown === "" && !cell.f) continue;
      const out: Cell = { t: String(shown), n: cell.t === "n" ? "n" : cell.t === "b" ? "b" : cell.t === "d" ? "d" : cell.t === "e" ? "e" : "s" };
      if (typeof cell.v === "string" || typeof cell.v === "number" || typeof cell.v === "boolean") out.v = cell.v; else if (cell.v instanceof Date) out.v = String(shown);
      if (cell.f) out.f = cell.f;
      cells.set(cellKey(r, c), out); rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1); budget--;
    }
    const colWidths: Record<number, number> = {};
    (ws["!cols"] as { wpx?: number; wch?: number }[] | undefined)?.forEach((c, i) => { if (i < MAX_COLS && (c?.wpx || c?.wch)) colWidths[i] = c.wpx ? Math.min(600, Math.max(20, c.wpx)) : excelWidthToPx(c.wch!); });
    const merges = ((ws["!merges"] as { s: { r: number; c: number }; e: { r: number; c: number } }[] | undefined) ?? []).slice(0, 5000).map((m) => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }));
    sheets.push({ name, rows: Math.max(rows, Math.min(range.e.r + 1, MAX_ROWS)), cols, cells, styles: [], colWidths, rowHeights: {}, merges, frozen: { rows: 0, cols: 0 }, truncated });
  }
  if (!sheets.length) throw new Error("This workbook has no sheets.");
  return { sheets, notes: ["Opened with the legacy .xls reader: colours and fonts aren't shown."] };
}

export function parseCsvFile(buffer: ArrayBuffer, name: string): Workbook {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if ((text.match(/�/g)?.length ?? 0) > 3) text = new TextDecoder("windows-1252").decode(buffer);
  const { rows, truncated } = parseCsv(text);
  return { sheets: [sheetFromRows(name.replace(/\.[^.]+$/, "") || "Sheet1", rows, truncated)], notes: truncated ? ["Only the first part of this file is shown."] : [] };
}

/** Entry point used by the worker (and by tests). */
export async function parseWorkbook(buffer: ArrayBuffer, name: string): Promise<Workbook> {
  if (buffer.byteLength > SHEET_MAX_BYTES) throw new Error(`This file is larger than ${Math.round(SHEET_MAX_BYTES / 1_000_000)} MB, which is too large to open here.`);
  const kind = sniffSheetKind(new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength)), name);
  if (kind === "xlsx") return parseXlsx(buffer);
  if (kind === "xls") return parseXls(buffer);
  return parseCsvFile(buffer, name);
}
