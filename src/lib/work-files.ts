// Browser-only file readers for work tools. Libraries load on demand.
import { planWeeks, airwallHolds, needText, shiftText, workedHours, readAvail, SHOW_STAFF, ON_CALL, type Avail, type DayPlan } from "./staffing";
import { BALLROOM_ROWS, ENGINEER_ROSTER, HALL_ROWS, weekLayouts, type WeekLayout, type TaskNote, DEFAULT_SCHEDULE_NAME, parseShift, reportDateToIso, type EventEntry, type EventRow, type Shift } from "./work-tools";

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
      if (/^\s*Start Time\b/.test(text) && /\bEvent\b/.test(text) && (/\bLevel\b/.test(text) || (/\bDescription\b/.test(text) && /\bSpace\b/.test(text)))) {
        // The newer report adds an "Event ID" column at the far right: keep it apart from the Event column.
        const heads: { name: string; x: number }[] = [];
        for (const i of line) {
          const name = i.str.trim();
          if (/^ID$/i.test(name)) continue;
          heads.push({ name: name === "Event" && heads.some((h) => h.name === "Event") ? "Event ID" : name, x: i.x });
        }
        sched = heads;
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
          if (last && cell["Space"] && !/^\d/.test(cell["Space"])) last.space += ` ${cell["Space"]}`;
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
          ...((cell["Event ID"] ?? "").match(/\d{3,}/) ? { eventId: (cell["Event ID"] ?? "").match(/\d{3,}/)![0] } : {}),
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

const clock = (v: unknown): string => {
  let min: number | null = null;
  if (v instanceof Date) min = v.getUTCHours() * 60 + v.getUTCMinutes();
  else if (typeof v === "number") min = Math.round((v % 1) * 1440);
  else if (typeof v === "string" && /\d{1,2}:\d{2}\s*[AP]M/i.test(v)) return v.trim();
  if (min === null) return "";
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

/** Reads the For Scheduling report exported to Excel. Returns null when the workbook is some other sheet (a monthly schedule). */
export async function readEventSheet(file: File): Promise<EventRow[] | null> {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return null;
  const text = (v: unknown) => (v && typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result ?? "") : v === null || v === undefined ? "" : String(v)).trim();
  if (!/^for scheduling$/i.test(text(ws.getRow(1).getCell(1).value))) return null;
  const head = ws.getRow(2);
  const col = (name: string) => { for (let c = 1; c <= 15; c++) if (text(head.getCell(c).value).toLowerCase() === name.toLowerCase()) return c; return 0; };
  const [cStart, cEnd, cEvent, cDesc, cSpace, cId] = [col("Start Time"), col("End Time"), col("Event"), col("Description"), col("Space"), col("Event ID")];
  const cStatus = col("Status - Event");
  if (!cStart || !cEnd || !cDesc || !cSpace) return null;
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const rows: EventRow[] = [];
  let day = "", eventName = "";
  ws.eachRow((row, n) => {
    if (n < 3) return;
    const a = text(row.getCell(1).value);
    const dm = a.match(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
    if (dm) { day = `${dm[3]}-${String(months.indexOf((dm[1] ?? "").toLowerCase()) + 1).padStart(2, "0")}-${(dm[2] ?? "").padStart(2, "0")}`; eventName = ""; return; }
    const start = clock(row.getCell(cStart).value);
    // The line above an event's rows carries its name in column B (e.g. "Georgia Bridal Show").
    const named = text(row.getCell(2).value);
    if (!start && named) { eventName = named; return; }
    if (!day || !start) return;
    const id = text(row.getCell(cId || 99).value).match(/\d{3,}/)?.[0];
    rows.push({ level: 2, usage: "", start, end: clock(row.getCell(cEnd).value), description: text(row.getCell(cDesc).value), space: text(row.getCell(cSpace).value), event: (cEvent ? text(row.getCell(cEvent).value) : "") || eventName, ...(id ? { eventId: id } : {}), ...(cStatus && text(row.getCell(cStatus).value) ? { status: text(row.getCell(cStatus).value) } : {}), date: day });
  });
  return rows;
}

/** A plain-text description of an uploaded workbook, for pasting into a bug report when the Events tab finds nothing. */
export async function describeSheet(file: File): Promise<string> {
  const out = [`file: ${file.name} (${file.size} bytes, ${file.type || "no type"})`];
  try {
    const module = await import("exceljs");
    const ExcelJS = module.default ?? module;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    out.push(`sheets: ${wb.worksheets.map((w) => `${w.name} (${w.rowCount} rows)`).join(", ") || "none"}`);
    const ws = wb.worksheets[0];
    if (ws) {
      const show = (v: unknown) => { const t = v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""); return t.length > 40 ? `${t.slice(0, 40)}…` : t; };
      out.push(`A1: ${show(ws.getRow(1).getCell(1).value)}`);
      out.push(`row 2: ${Array.from({ length: 12 }, (_, i) => show(ws.getRow(2).getCell(i + 1).value)).join(" | ")}`);
      out.push(`row 3: ${Array.from({ length: 12 }, (_, i) => show(ws.getRow(3).getCell(i + 1).value)).join(" | ")}`);
      out.push(`row 4: ${Array.from({ length: 12 }, (_, i) => show(ws.getRow(4).getCell(i + 1).value)).join(" | ")}`);
    }
  } catch (e) { out.push(`could not open as a workbook: ${(e as Error).message}`); }
  return out.join("\n");
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
/** The schedule legend: Move In green, Move In + Show light cyan, Show + Move Out orange, Move Out red, all three blue, non-show event purple. A show day alone is bold with no fill. */
export const LEGEND_FILL = { moveIn: "FF92D050", moveInShow: "FF75FFFF", showMoveOut: "FFFFC000", moveOut: "FFFF0000", allThree: "FF00B0F0", nonShow: "FF7030A0" } as const;
/** Which legend colour (if any) a cell with these activity codes gets. */
export function legendFill(codes: string[]): string | undefined {
  const show = codes.includes("S"), moveIn = codes.includes("MI") || codes.includes("Exmi"), moveOut = codes.includes("MO") || codes.includes("MO?");
  if (show && moveIn && moveOut) return LEGEND_FILL.allThree;
  if (show && moveOut) return LEGEND_FILL.showMoveOut;
  if (show && moveIn) return LEGEND_FILL.moveInShow;
  if (show) return undefined;
  if (moveIn) return LEGEND_FILL.moveIn;
  if (moveOut) return LEGEND_FILL.moveOut;
  return codes.length ? LEGEND_FILL.nonShow : undefined;
}
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

function paint(cell: import("exceljs").Cell, codes: string[]) {
  const color = legendFill(codes);
  cell.fill = color ? { type: "pattern", pattern: "solid", fgColor: { argb: color } } : { type: "pattern", pattern: "none" };
  cell.font = { name: "Aptos Narrow", size: 20, bold: codes.includes("S"), ...(color === LEGEND_FILL.nonShow ? { color: { argb: "FFFFFFFF" } } : {}) };
}

const THICK = { style: "thick" as const, color: { argb: "FF000000" } };
/** A thick black outline around every cell in the block, merged cells included. */
function outline(ws: XSheet, fromRow: number, toRow: number, fromCol: number, toCol: number) {
  for (let r = fromRow; r <= toRow; r++) for (let c = fromCol; c <= toCol; c++) ws.getCell(r, c).border = { top: THICK, left: THICK, bottom: THICK, right: THICK };
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

function writeWeekSheet(ws: XSheet, w: WeekLayout, tasks: TaskNote[] = [], plans: Map<string, DayPlan> = new Map()) {
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
    put(r, [p.name, ...w.dates.map((d) => engineerCell(plans, p.name, d)?.top || null)]);
    put(r + 1, [/^\d+$/.test(p.badge) ? Number(p.badge) : p.badge, ...w.dates.map((d) => engineerCell(plans, p.name, d)?.mid ?? null), { formula: `SUM(B${r + 1}:H${r + 1})` }]);
    put(r + 2, [p.title]);
    r += 3;
  }
  put(r++, ["CCC Escalator and SD", ...DAYS]);
  put(r++, ["Escalator", ...w.escalator], false);
  put(r, ["Service Desk", ...w.serviceDesk], false);
  w.serviceDesk.forEach((t, i) => { if (t) paint(ws.getRow(r).getCell(i + 2), ["MI"]); });
  r++;
  const byLabel = new Map<string, number>();
  const section = (title: string, labels: string[]) => {
    put(r++, [title, ...DAYS]);
    for (const label of labels) {
      put(r, [label]);
      byLabel.set(label.toLowerCase(), r);
      (w.rows[label] ?? []).forEach((c, i) => { const cell = ws.getRow(r).getCell(i + 2); cell.value = c.text || null; cell.alignment = wrap; paint(cell, c.codes); });
      r++;
    }
    const notes = tasks.filter((t) => t.section === title);
    put(r, ["Tasks", ...w.dates.map((d) => notes.filter((t) => t.date === d).map((t) => t.text).join("\n") || null)], false);
    r++;
  };
  section("HALLS", HALL_ROWS);
  section("BALLROOM", BALLROOM_ROWS);
  section("LOCATION", ["CEPAC", "Theatre", "Ballroom", ...w.other.filter((o) => !/^(cepac|theatre|ballroom)$/i.test(o)), "OTHER"]);
  for (let i = 3; i < r; i++) ws.getRow(i).height = 54;
  mergeEventSpaces(ws, w, byLabel, new Map(w.dates.map((d, i) => [d, i + 2])));
  fitRows(ws);
  outline(ws, 4, r - 1, 1, 9);
}

/** Grows row heights so wrapped event text is never cut off (merged cells share their height across the rows they cover). Heights only grow. */
export function fitRows(ws: XSheet) {
  let start = 0;
  ws.eachRow((row, n) => { if (!start && String(row.getCell(1).value ?? "").trim().toLowerCase() === "halls") start = n; });
  if (!start) return;
  const px = (c: number) => (ws.getColumn(c).width ?? 13) * 7 + 5;
  const merges = new Map<string, { top: number; bottom: number }>();
  const covered = new Set<string>();
  for (const range of ws.model.merges ?? []) {
    const [a, b] = range.split(":");
    if (!a || !b) continue;
    const from = ws.getCell(a), to = ws.getCell(b);
    if (Number(from.col) !== Number(to.col) || Number(from.row) < start) continue;
    merges.set(`${from.row},${from.col}`, { top: Number(from.row), bottom: Number(to.row) });
    for (let r = Number(from.row) + 1; r <= Number(to.row); r++) covered.add(`${r},${from.col}`);
  }
  const last = ws.rowCount;
  const height = new Map<number, number>();
  for (let r = start; r <= last; r++) height.set(r, ws.getRow(r).height ?? 15);
  // Word-wrap estimate (generous: wide letters, bold wider) so text is never cut off.
  const lines = (text: string, size: number, width: number, bold: boolean) => {
    const ch = size * (bold ? 0.72 : 0.64);
    const avail = Math.max(40, width - 14);
    let total = 0;
    for (const par of text.split("\n")) {
      let cur = 0, n = 1;
      for (const word of par.split(" ")) {
        const w = word.length * ch;
        if (cur && cur + ch + w > avail) { n++; cur = w; } else cur += (cur ? ch : 0) + w;
        while (cur > avail) { n++; cur -= avail; }
      }
      total += n;
    }
    return total;
  };
  for (let r = start; r <= last; r++) {
    for (let c = 2; c <= 8; c++) {
      if (covered.has(`${r},${c}`)) continue;
      const v = ws.getCell(r, c).value;
      if (typeof v !== "string" || !v) continue;
      const size = ws.getCell(r, c).font?.size ?? 11;
      const need = lines(v, size, px(c), !!ws.getCell(r, c).font?.bold) * size * 1.4 + size * 0.7 + 8;
      const m = merges.get(`${r},${c}`);
      const rows = Array.from({ length: (m ? m.bottom : r) - r + 1 }, (_, i) => r + i);
      const have = rows.reduce((t, x) => t + (height.get(x) ?? 15), 0);
      if (need > have) for (const x of rows) height.set(x, (height.get(x) ?? 15) + (need - have) / rows.length);
    }
  }
  for (const [r, h] of height) if (h > (ws.getRow(r).height ?? 15)) ws.getRow(r).height = Math.round(h * 10) / 10;
}

function cellDate(v: unknown): string | null {
  const x = v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v;
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === "number") return serialToIso(x);
  return null;
}

/** Writes event rows into an existing weekly sheet, keeping engineer shifts untouched. Returns false if the week is not on this sheet. */
/** An engineer's day, as in your sheets: shift on the name row, worked hours (or OFF) on the badge row below it. */
function engineerCell(plans: Map<string, DayPlan>, name: string, date: string): { top: string; mid: string | number } | null {
  const p = plans.get(date);
  if (!p) return null;
  const a = p.assignments.find((x) => x.name === name) ?? (p.desk?.name === name ? p.desk : undefined);
  if (a) return { top: shiftText(a), mid: workedHours(a) };
  const managed = name === "Jacquline Dixon" || [...SHOW_STAFF, ON_CALL].some((s) => s.name === name);
  return managed ? { top: "", mid: "OFF" } : null;
}

function mergeWeekSheet(ws: XSheet, w: WeekLayout, tasks: TaskNote[] = [], plans: Map<string, DayPlan> = new Map()): boolean {
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
    if (w.cgc[i] !== "DARK") write("CGC", i, w.cgc[i]!); write("Escalator", i, w.escalator[i]!); write("Service Desk", i, w.serviceDesk[i]!, ["MI"]);
    for (const [label, cells] of Object.entries(w.rows)) write(label, i, cells[i]!.text, cells[i]!.codes);
  });
  // Task suggestions go in the empty cells of the Tasks row under HALLS and BALLROOM; anything already typed there is kept.
  for (const [section, lastRow] of [["HALLS", "hall d"], ["BALLROOM", "ballroom f"]] as const) {
    const from = byLabel.get(lastRow);
    if (!from) continue;
    let tr = 0;
    for (let n = from + 1; n <= from + 3 && !tr; n++) if (String(ws.getRow(n).getCell(1).value ?? "").trim().toLowerCase() === "tasks") tr = n;
    if (!tr) continue;
    for (const [date, c] of cols) {
      const text = tasks.filter((t) => t.section === section && t.date === date).map((t) => t.text).join("\n");
      const cell = ws.getRow(tr).getCell(c);
      if (text && !String(cell.value ?? "").trim()) { cell.value = text; cell.alignment = { wrapText: true, vertical: "middle", horizontal: "center" }; }
    }
  }
  // Engineer shifts: only empty cells are filled; anything you typed (shift, PTO, OFF) stays.
  for (const p of ENGINEER_ROSTER) {
    const nr = byLabel.get(p.name.toLowerCase());
    if (!nr) continue;
    for (const [date, c] of cols) {
      const top = ws.getRow(nr).getCell(c), mid = ws.getRow(nr + 1).getCell(c);
      const e = engineerCell(plans, p.name, date);
      if (!e || String(top.value ?? "").trim() || String(mid.value ?? "").toString().trim()) continue;
      if (e.top) { top.value = e.top; top.alignment = { vertical: "middle", horizontal: "center" }; }
      mid.value = e.mid; mid.alignment = { vertical: "middle", horizontal: "center" };
    }
  }
  mergeEventSpaces(ws, w, byLabel, cols);
  fitRows(ws);
  outline(ws, dayRow, Math.max(byLabel.get("other") ?? 0, ws.rowCount), 1, 8);
  return true;
}

/** Builds the weekly engineering workbook (Week #1, #2 …) or, given an existing schedule, fills its event rows. */
export async function eventsWorkbook(entries: EventEntry[], existing?: File, tasks: TaskNote[] = []): Promise<Blob> {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const wb: XWorkbook = new ExcelJS.Workbook();
  const weeks = weekLayouts(entries);
  if (existing) await wb.xlsx.load(await existing.arrayBuffer());
  const sheets = wb.worksheets.filter((s) => /week/i.test(s.name));
  // PTO and shifts you already typed into the engineer rows are read first, so the plan works around them.
  const avail: Record<string, Record<string, Avail>> = {};
  for (const ws of sheets) {
    let dayRow = 0;
    ws.eachRow((row, i) => { if (!dayRow && String(row.getCell(2).value ?? "").trim().toUpperCase() === "MON") dayRow = i; });
    if (!dayRow) continue;
    const cols = new Map<string, number>();
    for (let c = 2; c <= 8; c++) { const d = cellDate(ws.getRow(dayRow + 1).getCell(c).value); if (d) cols.set(d, c); }
    ws.eachRow((row, i) => {
      const name = String(row.getCell(1).value ?? "").trim();
      if (!ENGINEER_ROSTER.some((p) => p.name === name)) return;
      for (const [d, c] of cols) {
        const t = (x: { text?: string; value?: unknown }) => x.text ?? String(x.value ?? "");
        const a = readAvail(t(row.getCell(c))) ?? (/^[a-z]/i.test(t(ws.getRow(i + 1).getCell(c)).trim()) && !/^off$/i.test(t(ws.getRow(i + 1).getCell(c)).trim()) ? readAvail(t(ws.getRow(i + 1).getCell(c))) : null);
        if (a) (avail[name] ??= {})[d] = a;
      }
    });
  }
  const dates = [...new Set(entries.map((e) => e.date))].sort();
  const plans = new Map(planWeeks(dates, entries, avail, undefined, airwallHolds(tasks, entries)).map((p) => [p.date, p] as const));
  let n = sheets.length;
  for (const w of weeks) {
    if (sheets.some((s) => mergeWeekSheet(s, w, tasks, plans))) continue;
    writeWeekSheet(wb.addWorksheet(`Week #${++n}`), w, tasks, plans);
  }
  addStaffingSheets(wb, [...plans.values()]);
  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], { type: XLSX_MIME });
}

/** "Staffing" (who works when) and "Staffing Why" (the reasoning behind every pick) sheets. */
function addStaffingSheets(wb: XWorkbook, plans: DayPlan[]) {
  if (!plans.length) return;
  for (const name of ["Staffing", "Staffing Why"]) { const old = wb.getWorksheet(name); if (old) wb.removeWorksheet(old.id); }
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
  const plan = wb.addWorksheet("Staffing");
  plan.addRow(["Date", "Needed (people: hours)", "Engineers", "Service Desk (Jacquline)", "Gaps"]).font = { bold: true };
  const why = wb.addWorksheet("Staffing Why");
  why.addRow(["Date", "Who", "Shift", "Why"]).font = { bold: true };
  for (const p of plans) {
    const row = plan.addRow([day(p.date), needText(p.need), p.assignments.map((a) => `${a.name.split(" ")[0]} ${shiftText(a)}`).join("\n"), p.desk ? shiftText(p.desk) : "", p.gaps.map((g) => `${shiftText(g)} short ${g.short}`).join(", ")]);
    row.alignment = { wrapText: true, vertical: "top" };
    if (p.gaps.length) row.getCell(5).font = { bold: true, color: { argb: "FFC00000" } };
    for (const a of p.assignments) why.addRow([day(p.date), a.name, shiftText(a), a.reason]);
    if (p.desk) why.addRow([day(p.date), p.desk.name, shiftText(p.desk), p.desk.reason]);
    for (const n of p.notUsed) why.addRow([day(p.date), n.name, "Off", n.why]);
    for (const n of p.notes) why.addRow([day(p.date), "Note", "", n]);
  }
  const total = new Map<string, { days: number; hours: number }>();
  for (const p of plans) for (const a of p.assignments) { const t = total.get(a.name) ?? { days: 0, hours: 0 }; t.days++; t.hours += workedHours(a); total.set(a.name, t); }
  plan.addRow([]);
  plan.addRow(["Totals", "Days", "Worked hrs (8.5 scheduled = 8 after lunch)"]).font = { bold: true };
  for (const [name, t] of total) plan.addRow([name, t.days, t.hours]);
  plan.columns = [{ width: 12 }, { width: 34 }, { width: 28 }, { width: 22 }, { width: 30 }];
  why.columns = [{ width: 12 }, { width: 22 }, { width: 14 }, { width: 110 }];
  why.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
