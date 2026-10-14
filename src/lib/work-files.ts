// Browser-only file readers for work tools. Libraries load on demand.
import { DEFAULT_SCHEDULE_NAME, entryLabel, parseShift, reportDateToIso, sheetRowFor, type EventEntry, type EventRow, type Shift } from "./work-tools";

type Item = { str: string; x: number; y: number };

export async function readEventPdf(file: File): Promise<EventRow[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const rows: EventRow[] = [];
  type Cols = { usage: number; start: number; end: number; desc: number; reader: number; space: number; notes: number };
  let cols: Cols | null = null;
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

/** Builds a workbook with hall/ballroom rows and date columns, like the weekly sheet. */
export async function eventsWorkbook(entries: EventEntry[]): Promise<Blob> {
  const XLSX = await import("xlsx");
  const dates = [...new Set(entries.map((e) => e.date))].sort();
  const spaces = [...new Set(entries.map((e) => sheetRowFor(e.space)))].sort();
  const header = ["SPACE", ...dates.map((d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" }))];
  const body = spaces.map((space) => [space, ...dates.map((d) => {
    const list = entries.filter((e) => e.date === d && sheetRowFor(e.space) === space);
    const title = list.find((e) => e.code === "S")?.title ?? list[0]?.title ?? "";
    return list.length ? [title, ...list.map(entryLabel)].join("\n") : "";
  })]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws["!cols"] = [{ wch: 18 }, ...dates.map(() => ({ wch: 24 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Events");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
