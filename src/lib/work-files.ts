// Browser-only file readers for work tools. Libraries load on demand.
import { BALLROOM_ROWS, ENGINEER_ROSTER, HALL_ROWS, weekLayouts, type WeekLayout, DEFAULT_SCHEDULE_NAME, parseShift, reportDateToIso, type EventEntry, type EventRow, type Shift } from "./work-tools";

type Item = { str: string; x: number; y: number };

export async function readEventPdf(file: File): Promise<EventRow[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const rows: EventRow[] = [];
  type Cols = { usage: number; start: number; end: number; desc: number; reader: number; space: number; notes: number };
  let cols: Cols | null = null;
  // "For Scheduling" layout: Start | End | Event | Description | Space | Usage | Usage Category | Level, under weekday date headings.
  let sched: { name: string; x: number }[] | null = null;
  let day = "";
  let last: EventRow | null = null;
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items as { str?: string; transform?: number[] }[])
      if (it.str?.trim() && it.transform) items.push({ str: it.str, x: it.transform[4] ?? 0, y: Math.round(it.transform[5] ?? 0) });
    const lines = new Map<number, Item[]>();
    for (const it of items) {
      const key = [...lines.keys()].find((k) => Math.abs(k - it.y) <= 2) ?? it.y;
      lines.set(key, [...(lines.get(key) ?? []), it]);
    }
    const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l.sort((a, b) => a.x - b.x));
    for (const line of sorted) {
      const text = line.map((i) => i.str).join(" ");
      if (/^\s*Start Time\b/.test(text) && /\bLevel\b/.test(text) && /\bEvent\b/.test(text)) {
        sched = line.map((i) => ({ name: i.str.trim(), x: i.x }));
        continue;
      }
      if (sched) {
        const dm = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
        if (dm) {
          const mo = months.indexOf((dm[1] ?? "").toLowerCase()) + 1;
          day = `${dm[3]}-${String(mo).padStart(2, "0")}-${(dm[2] ?? "").padStart(2, "0")}`;
          last = null;
          continue;
        }
        if (!day || /^Page \d+ of/.test(text)) continue;
        const cell: Record<string, string> = {};
        for (const it of line) {
          const col = [...sched].reverse().find((h) => it.x >= h.x - 6) ?? sched[0]!;
          cell[col.name] = `${cell[col.name] ?? ""} ${it.str.trim()}`.trim();
        }
        const start = cell["Start Time"] ?? "";
        if (!/\d{1,2}:\d{2}\s*[AP]M/i.test(start)) {
          if (last && cell["Description"]) last.description += ` ${cell["Description"]}`;
          continue;
        }
        last = {
          level: Number(cell["Level"] ?? 2) || 2,
          usage: cell["Usage"] ?? "",
          start,
          end: cell["End Time"] ?? "",
          description: cell["Description"] ?? "",
          space: cell["Space"] ?? "",
          event: cell["Event"] ?? "",
          date: day,
        };
        rows.push(last);
        continue;
      }
      if (/\bUsage\b/.test(text) && /\bSpace\b/.test(text)) {
        const find = (re: RegExp) => line.find((i) => re.test(i.str))?.x ?? 0;
        cols = { usage: find(/^Usage/), start: find(/^Start Time|^Start$/), end: find(/^End Time|^End$/), desc: find(/^Description/), reader: find(/^Reader/), space: find(/^Space/), notes: find(/^Notes/) };
        continue;
      }
      if (!cols) continue;
      const date = text.match(/\b\d{2}\/\d{2}\/\d{2}\b/)?.[0];
      const level = Number(line[0]?.str.trim());
      if (!date || !Number.isFinite(level) || (line[0]?.x ?? 0) > cols.usage) continue;
      const c = cols;
      const between = (lo: number, hi: number) => line.filter((i) => i.x >= lo - 2 && i.x < hi - 2).map((i) => i.str.trim()).join(" ").trim();
      const times = text.match(/\d{2}:\d{2}\s*[AP]M/gi) ?? [];
      rows.push({
        level,
        usage: between(c.usage, c.start),
        start: times[0] ?? "",
        end: times[1] ?? "",
        description: between(c.reader, c.space) || between(c.desc, c.reader),
        space: between(c.space, c.notes).replace(/\s+/g, " "),
        date: reportDateToIso(date),
      });
    }
  }
  return rows;
}

const serialToIso = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);

/** Reads every "Week #" sheet and returns the shifts in the named person's row. */
export async function readScheduleWorkbook(file: File, name = DEFAULT_SCHEDULE_NAME): Promise<{ shifts: Shift[]; people: string[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const shifts: Shift[] = [];
  const people = new Set<string>();
  const target = name.trim().toLowerCase();
  for (const sheetName of wb.SheetNames) {
    if (!/week/i.test(sheetName)) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, { header: 1, raw: true, defval: "" });
    const dayRow = grid.findIndex((r) => String(r[1]).trim().toUpperCase() === "MON");
    if (dayRow < 0) continue;
    const dates = grid[dayRow + 1] ?? [];
    for (let r = dayRow + 2; r < grid.length; r++) {
      const cells = grid[r] ?? [];
      const label = String(cells[0] ?? "").trim();
      const next = String(grid[r + 1]?.[0] ?? "").trim();
      if (label && /^\d{3}$/.test(next)) people.add(label);
      if (label.toLowerCase() !== target) continue;
      for (let c = 1; c <= 7; c++) {
        const raw = String(cells[c] ?? "").trim();
        const time = parseShift(raw);
        const d = dates[c];
        if (!time || typeof d !== "number") continue;
        shifts.push({ date: serialToIso(d), ...time, raw });
      }
    }
  }
  const seen = new Set<string>();
  return { shifts: shifts.filter((s) => !seen.has(s.date) && seen.add(s.date)).sort((a, b) => a.date.localeCompare(b.date)), people: [...people] };
}

type XWorkbook = import("exceljs").Workbook;
type XSheet = import("exceljs").Worksheet;
const FILL: Record<string, string> = { MI: "FF92D050", Exmi: "FF92D050", S: "FFFFFF00", MO: "FFF4B084", moveInShow: "FF4DB6AC", allThree: "FF5B9BD5" };
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

function paint(cell: import("exceljs").Cell, codes: string[]) {
  const show = codes.includes("S"), moveIn = codes.includes("MI") || codes.includes("Exmi"), moveOut = codes.includes("MO");
  const code = show && moveIn && moveOut ? "allThree" : show && moveOut ? "MO" : show && moveIn ? "moveInShow" : show ? "S" : codes[0];
  const color = code ? FILL[code] : undefined;
  cell.fill = color ? { type: "pattern", pattern: "solid", fgColor: { argb: color } } : { type: "pattern", pattern: "none" };
  cell.font = { name: "Aptos Narrow", size: 20, bold: codes.includes("S") };
}

/** Merge only adjacent space rows with identical shows, activities and times. */
function mergeEventSpaces(ws: XSheet, w: WeekLayout, byLabel: Map<string, number>, cols: Map<string, number>) {
  for (const labels of [HALL_ROWS, BALLROOM_ROWS]) {
    const positions = labels.flatMap((label) => {
      const row = byLabel.get(label.toLowerCase());
      return row ? [{ label, row }] : [];
    }).sort((a, b) => a.row - b.row);
    w.dates.forEach((date, i) => {
      const col = cols.get(date);
      if (!col) return;
      let start = 0;
      while (start < positions.length) {
        const first = positions[start];
        if (!first) break;
        const data = w.rows[first.label]?.[i];
        let end = start;
        if (data?.signature) {
          while (end + 1 < positions.length) {
            const next = positions[end + 1], prev = positions[end];
            if (!next || !prev || next.row !== prev.row + 1 || w.rows[next.label]?.[i]?.signature !== data.signature) break;
            end++;
          }
        }
        const last = positions[end];
        if (last && end > start) {
          ws.mergeCells(first.row, col, last.row, col);
          ws.getCell(first.row, col).alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
        }
        start = end + 1;
      }
    });
  }
}

/** Release old vertical space merges before updating, preserving untouched entries. */
function unmergeEventSpaces(ws: XSheet, w: WeekLayout, byLabel: Map<string, number>, cols: Map<string, number>) {
  const roomRows = new Set([...HALL_ROWS, ...BALLROOM_ROWS].map((label) => byLabel.get(label.toLowerCase())).filter((r): r is number => r !== undefined));
  for (const range of [...(ws.model.merges ?? [])]) {
    const [from, to] = range.split(":");
    if (!from || !to) continue;
    const first = ws.getCell(from), last = ws.getCell(to);
    const top = Number(first.row), bottom = Number(last.row), col = Number(first.col);
    if (col !== Number(last.col) || top === bottom) continue;
    const rows = Array.from({ length: bottom - top + 1 }, (_, i) => top + i);
    if (!rows.every((r) => roomRows.has(r))) continue;
    const touched = w.dates.some((date, i) => cols.get(date) === col && Object.entries(w.rows).some(([label, cells]) => cells[i]?.text && rows.includes(byLabel.get(label.toLowerCase()) ?? -1)));
    if (!touched) continue;
    const value = first.value, style = structuredClone(first.style);
    ws.unMergeCells(range);
    for (const row of rows) { const cell = ws.getCell(row, col); cell.value = value; cell.style = structuredClone(style); }
  }
}

function writeWeekSheet(ws: XSheet, w: WeekLayout) {
  const font = { name: "Aptos Narrow", size: 20, bold: true };
  const wrap = { wrapText: true, vertical: "middle" as const, horizontal: "center" as const };
  ws.columns = [{ width: 41 }, ...DAYS.map(() => ({ width: 32 })), { width: 30 }];
  const put = (r: number, vals: (string | number | Date | { formula: string } | null)[], bold = true) => {
    const row = ws.getRow(r);
    vals.forEach((v, c) => { if (v === null) return; const cell = row.getCell(c + 1); cell.value = v as never; cell.font = { ...font, bold: c === 0 || bold }; cell.alignment = wrap; });
    return row;
  };
  ws.mergeCells("A1:I1"); ws.mergeCells("A2:I2");
  put(1, ["COBB GALLERIA CENTRE and COBB ENERGY PERFORMING ARTS CENTRE "]);
  put(2, ["Engineering Schedule (Subject to Change)"]);
  put(3, [null, null, "FROM:", { formula: "B5" }, "TO:", { formula: "H5" }]);
  put(4, ["DAY", ...DAYS, "TOTAL"]);
  put(5, [null, ...w.dates.map(toDate)]);
  for (let c = 2; c <= 8; c++) ws.getRow(5).getCell(c).numFmt = "m/d/yy";
  ws.getRow(3).getCell(4).numFmt = "m/d/yy"; ws.getRow(3).getCell(6).numFmt = "m/d/yy";
  put(6, ["CGC", ...w.cgc], false); put(7, ["CEPAC"]); put(8, ["CGC BARS", null, null, null, null, null, null, null, "CGC BARS"]);
  let r = 9;
  for (const p of ENGINEER_ROSTER) {
    put(r, [p.name]);
    put(r + 1, [/^\d+$/.test(p.badge) ? Number(p.badge) : p.badge, null, null, null, null, null, null, null, { formula: `SUM(B${r + 1}:H${r + 1})` }]);
    put(r + 2, [p.title]);
    r += 3;
  }
  put(r++, ["CCC Escalator and SD", ...DAYS]);
  put(r++, ["Escalator", ...w.escalator], false);
  put(r++, ["Service Desk", ...w.serviceDesk], false);
  const byLabel = new Map<string, number>();
  const section = (title: string, labels: string[]) => {
    put(r++, [title, ...DAYS]);
    for (const label of labels) {
      put(r, [label]);
      byLabel.set(label.toLowerCase(), r);
      (w.rows[label] ?? []).forEach((c, i) => { const cell = ws.getRow(r).getCell(i + 2); cell.value = c.text || null; cell.alignment = wrap; paint(cell, c.codes); });
      r++;
    }
    put(r++, ["Tasks"]);
  };
  section("HALLS", HALL_ROWS);
  section("BALLROOM", BALLROOM_ROWS);
  section("LOCATION", ["CEPAC", "Theatre", "Ballroom", ...w.other.filter((o) => !/^(cepac|theatre|ballroom)$/i.test(o)), "OTHER"]);
  for (let i = 3; i < r; i++) ws.getRow(i).height = 54;
  mergeEventSpaces(ws, w, byLabel, new Map(w.dates.map((d, i) => [d, i + 2])));
}

function cellDate(v: unknown): string | null {
  const x = v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === "number") return serialToIso(x);
  return null;
}

/** Writes event rows into an existing weekly sheet, keeping engineer shifts untouched. Returns false if the week is not on this sheet. */
function mergeWeekSheet(ws: XSheet, w: WeekLayout): boolean {
  let dayRow = 0;
  ws.eachRow((row, n) => { if (!dayRow && String(row.getCell(2).value ?? "").trim().toUpperCase() === "MON") dayRow = n; });
  if (!dayRow) return false;
  const cols = new Map<string, number>();
  for (let c = 2; c <= 8; c++) { const d = cellDate(ws.getRow(dayRow + 1).getCell(c).value); if (d) cols.set(d, c); }
  if (!w.dates.some((d) => cols.has(d))) return false;
  const byLabel = new Map<string, number>();
  ws.eachRow((row, n) => { const l = String(row.getCell(1).value ?? "").trim().toLowerCase(); if (l && !byLabel.has(l)) byLabel.set(l, n); });
  unmergeEventSpaces(ws, w, byLabel, cols);
  const write = (label: string, i: number, text: string, codes?: string[]) => {
    const date = w.dates[i];
    const r = byLabel.get(label.toLowerCase()); const c = date ? cols.get(date) : undefined;
    if (!r || !c || !text) return;
    const cell = ws.getRow(r).getCell(c); cell.value = text; cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    if (codes) paint(cell, codes);
  };
  w.dates.forEach((_, i) => {
    if (w.cgc[i] !== "DARK") write("CGC", i, w.cgc[i]!); write("Escalator", i, w.escalator[i]!); write("Service Desk", i, w.serviceDesk[i]!);
    for (const [label, cells] of Object.entries(w.rows)) write(label, i, cells[i]!.text, cells[i]!.codes);
  });
  mergeEventSpaces(ws, w, byLabel, cols);
  return true;
}

/** Builds the weekly engineering workbook (Week #1, #2 …) or, given an existing schedule, fills its event rows. */
export async function eventsWorkbook(entries: EventEntry[], existing?: File): Promise<Blob> {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const wb: XWorkbook = new ExcelJS.Workbook();
  const weeks = weekLayouts(entries);
  if (existing) await wb.xlsx.load(await existing.arrayBuffer());
  const sheets = wb.worksheets.filter((s) => /week/i.test(s.name));
  let n = sheets.length;
  for (const w of weeks) {
    if (sheets.some((s) => mergeWeekSheet(s, w))) continue;
    writeWeekSheet(wb.addWorksheet(`Week #${++n}`), w);
  }
  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], { type: XLSX_MIME });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
