// Pure spreadsheet model for the viewer: data shapes, cell references, number formats, CSV, merged cells, virtual windows and search.
// No exceljs/xlsx and no DOM here, so all of it is unit tested.

export const SHEET_MAX_BYTES = 30_000_000;
export const MAX_ROWS = 50_000;
export const MAX_COLS = 200;
export const MAX_CELLS = 400_000;
export const MAX_MERGES = 5_000;
export const DEFAULT_COL_W = 88;
export const DEFAULT_ROW_H = 24;

export type CellStyle = { b?: boolean; i?: boolean; u?: boolean; color?: string; bg?: string; align?: "left" | "center" | "right"; wrap?: boolean; size?: number };
/** `t` is the text shown, `v` the raw value (for the formula bar), `f` the formula without "=", `s` an index into `SheetData.styles`, `n` the kind. */
export type Cell = { t: string; v?: string | number | boolean; f?: string; s?: number; n?: "n" | "s" | "b" | "d" | "e" };
export type Merge = { r1: number; c1: number; r2: number; c2: number };
export type SheetData = {
  name: string;
  rows: number; cols: number;
  cells: Map<number, Cell>;
  styles: CellStyle[];
  colWidths: Record<number, number>;
  rowHeights: Record<number, number>;
  merges: Merge[];
  frozen: { rows: number; cols: number };
  truncated: boolean;
  hiddenRows?: number[]; hiddenCols?: number[];
};
export type Workbook = { sheets: SheetData[]; notes: string[] };

const KEY = 16384;
export const cellKey = (r: number, c: number): number => r * KEY + c;
export const cellAt = (s: SheetData, r: number, c: number): Cell | undefined => s.cells.get(cellKey(r, c));

/** 0 → A, 25 → Z, 26 → AA */
export function colName(c: number): string {
  let n = Math.max(0, Math.floor(c)) + 1; let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) { const d = ch.charCodeAt(0) - 64; if (d < 1 || d > 26) return -1; n = n * 26 + d; }
  return n - 1;
}
export const refOf = (r: number, c: number): string => `${colName(c)}${r + 1}`;
/** "B7" → {r:6,c:1}; null when it isn't a cell reference. */
export function parseRef(ref: string): { r: number; c: number } | null {
  const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*$/.exec(ref);
  if (!m) return null;
  const c = colIndex(m[1]!); const r = Number(m[2]) - 1;
  return c < 0 || c >= KEY || r < 0 ? null : { r, c };
}

// ---------- number formats ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number, w = 2) => String(Math.trunc(n)).padStart(w, "0");

/** Excel serial day number → UTC Date (1900 system; accounts for Excel's fake 1900-02-29). */
export function serialToDate(serial: number): Date {
  const days = serial >= 61 ? serial - 25569 : serial - 25568;
  return new Date(Math.round(days * 86400000));
}

const stripQuoted = (fmt: string) => fmt.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, (m) => (/^\[(h+|m+|s+)\]$/i.test(m) ? m : "")).replace(/\\./g, "").replace(/_./g, "").replace(/\*./g, "");
export function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt || /^general$/i.test(fmt)) return false;
  const bare = stripQuoted(fmt.split(";")[0] ?? "");
  return /[ymdhs]/i.test(bare.replace(/e[+-]/gi, "")) && !/^[#0?.,%$\s()+-]*$/.test(bare);
}

export function formatDate(d: Date, fmt: string): string {
  const section = (fmt.split(";")[0] ?? "").replace(/\[(?!h|m|s)[^\]]*\]/gi, "");
  const twelve = /AM\/PM|A\/P/i.test(section);
  const tokens = section.match(/"[^"]*"|\\.|\[[hms]+\]|yyyy|yy|mmmmm|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|A\/P|\.0+|[^]/gi) ?? [];
  const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), D = d.getUTCDate(), H = d.getUTCHours(), Mi = d.getUTCMinutes(), S = d.getUTCSeconds(), wd = d.getUTCDay();
  let out = "";
  tokens.forEach((tok, i) => {
    const t = tok.toLowerCase();
    if (tok.startsWith('"')) out += tok.slice(1, -1);
    else if (tok.startsWith("\\")) out += tok.slice(1);
    else if (t === "yyyy") out += pad(Y, 4);
    else if (t === "yy") out += pad(Y % 100);
    else if (t === "mmmmm") out += MONTHS[Mo]![0];
    else if (t === "mmmm") out += MONTHS[Mo];
    else if (t === "mmm") out += MONTHS[Mo]!.slice(0, 3);
    else if (t === "mm" || t === "m") {
      // m after h (or before s) means minutes, otherwise month
      const prev = tokens.slice(0, i).reverse().find((x) => /^(h+|\[h+\]|s+)$/i.test(x) || /^(yyyy|yy|d+)$/i.test(x));
      const next = tokens.slice(i + 1).find((x) => /^(s+|d+|yy+|yyyy|h+)$/i.test(x));
      const minutes = (prev && /^(h+|\[h+\])$/i.test(prev)) || (!prev && next && /^s+$/i.test(next));
      const v = minutes ? Mi : Mo + 1;
      out += t === "mm" ? pad(v) : String(v);
    }
    else if (t === "dddd") out += DAYS[wd];
    else if (t === "ddd") out += DAYS[wd]!.slice(0, 3);
    else if (t === "dd") out += pad(D);
    else if (t === "d") out += String(D);
    else if (t === "hh" || t === "h") { const h = twelve ? H % 12 || 12 : H; out += t === "hh" ? pad(h) : String(h); }
    else if (/^\[h+\]$/.test(t)) out += String(H);
    else if (t === "ss" || t === "s") out += t === "ss" ? pad(S) : String(S);
    else if (t === "am/pm") out += H >= 12 ? "PM" : "AM";
    else if (t === "a/p") out += H >= 12 ? "P" : "A";
    else if (/^\.0+$/.test(t)) out += "." + pad(Math.floor(d.getUTCMilliseconds() / 10 ** (3 - (t.length - 1))), t.length - 1);
    else out += tok;
  });
  return out;
}

function group(intPart: string): string { return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

/** Formats a number with an Excel number format (General, 0.00, #,##0, 0%, $#,##0.00, (#,##0), 0.00E+00, "text"0 …). Unknown patterns fall back to General. */
export function formatNumber(value: number, fmt?: string): string {
  if (!Number.isFinite(value)) return String(value);
  if (!fmt || /^general$/i.test(fmt) || fmt === "@") return general(value);
  const sections = fmt.split(";");
  let section = sections[0] ?? "";
  let negative = value < 0;
  if (negative && sections[1]) { section = sections[1]; negative = false; } // a second section already carries the sign
  else if (value === 0 && sections[2]) section = sections[2];
  const clean = section.replace(/\[(?!h|m|s)[^\]]*\]/gi, "").replace(/_./g, "").replace(/\*./g, "");
  const m = /^((?:"[^"]*"|\\.|[^0#?.,eE%])*)([#0?,]*(?:\.[0#?]*)?(?:E[+-][0#]+)?)((?:.|\n)*)$/i.exec(clean);
  if (!m || !/[0#?]/.test(m[2] ?? "")) return general(value);
  const text = (s: string) => s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");
  const prefix = text(m[1] ?? ""); const core = m[2] ?? ""; let suffix = m[3] ?? "";
  let v = Math.abs(value);
  const percents = (suffix.match(/%/g)?.length ?? 0) + (prefix.match(/%/g)?.length ?? 0);
  if (percents) v *= 100 ** percents;
  let body: string;
  const sci = /E[+-]([0#]+)$/i.exec(core);
  if (sci) {
    const mant = core.slice(0, core.length - sci[0].length);
    const dec = (mant.split(".")[1] ?? "").length;
    const [a, bRaw] = v.toExponential(dec).split("e");
    const exp = Number(bRaw);
    body = `${a}E${exp < 0 ? "-" : "+"}${pad(Math.abs(exp), sci[1]!.length)}`;
  } else {
    const [intPat, decPat = ""] = core.replace(/,/g, "").split(".");
    const comma = core.includes(",");
    const zerosDec = (decPat.match(/0/g) ?? []).length;
    const fixed = v.toFixed(decPat.length);
    let [i = "0", d = ""] = fixed.split(".");
    while (d.length > zerosDec && d.endsWith("0")) d = d.slice(0, -1);
    const minInt = (intPat?.match(/0/g) ?? []).length;
    i = i.replace(/^0+(?=\d)/, "");
    if (minInt === 0 && i === "0" && (d || !decPat)) i = decPat ? "" : i;
    if (i.length < minInt) i = i.padStart(minInt, "0");
    body = (comma ? group(i) : i) + (d ? `.${d}` : "");
    if (body === "" ) body = "0";
  }
  suffix = text(suffix);
  const rounded = Number(body.replace(/[^0-9.]/g, "")) === 0;
  const sign = negative && !rounded ? (/\(/.test(prefix + suffix) ? "" : "-") : "";
  const out = `${prefix}${body}${suffix}`;
  return sign ? (prefix ? `${sign}${out}` : `${sign}${out}`) : out;
}
function general(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const s = Number(v.toPrecision(10));
  const a = Math.abs(s);
  if (a !== 0 && (a >= 1e11 || a < 1e-4)) return s.toExponential(5).replace(/\.?0+e/, "E").replace("e", "E").replace(/E([+-])(\d)$/, "E$10$2");
  return String(s);
}

/** The text a cell shows. Dates (by number format) become dates; everything else follows the number format. */
export function displayValue(value: unknown, fmt?: string): { t: string; n: NonNullable<Cell["n"]> } {
  if (value === null || value === undefined || value === "") return { t: "", n: "s" };
  if (value instanceof Date) return { t: Number.isNaN(value.getTime()) ? "" : formatDate(value, fmt && isDateFormat(fmt) ? fmt : "yyyy-mm-dd"), n: "d" };
  if (typeof value === "number") return isDateFormat(fmt) ? { t: formatDate(serialToDate(value), fmt!), n: "d" } : { t: formatNumber(value, fmt), n: "n" };
  if (typeof value === "boolean") return { t: value ? "TRUE" : "FALSE", n: "b" };
  const s = String(value);
  return { t: s, n: /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!)/.test(s) ? "e" : "s" };
}

// ---------- CSV ----------

/** Small RFC 4180 reader: quoted fields, doubled quotes, newlines inside quotes, comma/semicolon/tab separators. */
export function parseCsv(text: string, maxRows = MAX_ROWS, maxCols = MAX_COLS): { rows: string[][]; truncated: boolean } {
  const src = text.replace(/^﻿/, "");
  const head = src.slice(0, 2000).split(/\r?\n/)[0] ?? "";
  const sep = [",", ";", "\t"].map((s) => [s, head.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; let truncated = false;
  const endField = () => { if (row.length < maxCols) row.push(field); else truncated = true; field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) endField();
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; endRow(); if (rows.length >= maxRows) { truncated = i < src.length - 1; return { rows, truncated }; } }
    else field += ch;
  }
  if (field !== "" || row.length) endRow();
  return { rows, truncated };
}

export function sheetFromRows(name: string, rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>, truncated = false): SheetData {
  const cells = new Map<number, Cell>(); let cols = 0;
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (c >= MAX_COLS || v === null || v === undefined || v === "") return;
    cols = Math.max(cols, c + 1);
    const { t, n } = displayValue(v);
    cells.set(cellKey(r, c), { t, v: typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v), n });
  }));
  return { name, rows: rows.length, cols, cells, styles: [], colWidths: {}, rowHeights: {}, merges: [], frozen: { rows: 0, cols: 0 }, truncated };
}

// ---------- layout, merges, windows ----------

/** Running totals of row heights / column widths, so a scroll position maps to a row/column with a binary search. */
export function buildOffsets(count: number, size: (i: number) => number): Float64Array {
  const out = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) out[i + 1] = out[i]! + Math.max(0, size(i));
  return out;
}
/** The indexes [first, last] (inclusive) whose cells touch the window [scroll, scroll+extent), widened by `overscan` items. */
export function rangeFor(offsets: Float64Array, scroll: number, extent: number, overscan = 3): { first: number; last: number } {
  const count = offsets.length - 1;
  if (count < 1) return { first: 0, last: -1 };
  const find = (pos: number) => { let lo = 0, hi = count - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (offsets[mid]! <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const first = Math.max(0, find(Math.max(0, scroll)) - overscan);
  const last = Math.min(count - 1, find(Math.max(0, scroll + extent)) + overscan);
  return { first, last };
}

export type MergeIndex = { master: Map<number, Merge>; covered: Set<number> };
/** Which cells start a merged block and which are hidden under one. Very large merges are capped so a hostile file can't build a huge set. */
export function indexMerges(merges: readonly Merge[]): MergeIndex {
  const master = new Map<number, Merge>(); const covered = new Set<number>();
  let budget = 200_000;
  for (const m of merges.slice(0, MAX_MERGES)) {
    master.set(cellKey(m.r1, m.c1), m);
    for (let r = m.r1; r <= m.r2 && budget > 0; r++) for (let c = m.c1; c <= m.c2 && budget > 0; c++) { if (r !== m.r1 || c !== m.c1) { covered.add(cellKey(r, c)); budget--; } }
  }
  return { master, covered };
}
export const mergeContaining = (merges: readonly Merge[], r: number, c: number): Merge | undefined => merges.find((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2);

// ---------- search ----------

export type Hit = { r: number; c: number };
/** Cells whose shown text or formula contains the query, row by row. */
export function searchSheet(s: SheetData, query: string, max = 5000): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: Hit[] = [];
  for (const [key, cell] of s.cells) {
    if (cell.t.toLowerCase().includes(q) || (cell.f && cell.f.toLowerCase().includes(q))) hits.push({ r: Math.floor(key / KEY), c: key % KEY });
  }
  hits.sort((a, b) => a.r - b.r || a.c - b.c);
  return hits.slice(0, max);
}
/** The next hit after the current cell (wrapping), or -1. */
export function nextHitIndex(hits: readonly Hit[], at: Hit | null, dir: 1 | -1): number {
  if (!hits.length) return -1;
  if (!at) return dir === 1 ? 0 : hits.length - 1;
  const i = hits.findIndex((h) => h.r === at.r && h.c === at.c);
  if (i >= 0) return (i + dir + hits.length) % hits.length;
  const after = hits.findIndex((h) => h.r > at.r || (h.r === at.r && h.c > at.c));
  if (dir === 1) return after < 0 ? 0 : after;
  return after < 0 ? hits.length - 1 : (after - 1 + hits.length) % hits.length;
}

/** How wide a column should be in pixels from an Excel width (characters). */
export const excelWidthToPx = (w: number): number => Math.max(20, Math.min(600, Math.round(w * 7 + 5)));
export const pointsToPx = (pt: number): number => Math.max(10, Math.min(400, Math.round((pt * 96) / 72)));

/** The sheet's display size for a status line. */
export const describeSheet = (s: SheetData): string => `${s.rows.toLocaleString()} rows × ${s.cols.toLocaleString()} columns${s.truncated ? " (first part shown)" : ""}`;
