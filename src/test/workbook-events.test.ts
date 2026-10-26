import { describe, expect, it } from "vitest";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import ExcelJS from "exceljs";
import { eventsWorkbook, legendFill, LEGEND_FILL } from "@/lib/work-files";
import { BALLROOM_ROWS, summarizeEvents, type EventCode, type EventEntry } from "@/lib/work-tools";

Object.defineProperty(globalThis, "Blob", { value: NodeBlob, configurable: true });
Object.defineProperty(globalThis, "File", { value: NodeFile, configurable: true });

const event = (space: string, code: EventCode = "S", title = "Shared show", date = "2026-10-12"): EventEntry => ({ date, space, code, start: 480, end: 1020, title });
async function build(entries: EventEntry[], existing?: File) {
  const blob = await eventsWorkbook(entries, existing);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Missing weekly sheet");
  const room = (label: string, col = 2) => {
    let found = 0;
    ws.eachRow((row, n) => { if (row.getCell(1).value === label) found = n; });
    if (!found) throw new Error(`Missing room ${label}`);
    return ws.getCell(found, col);
  };
  return { wb, ws, room };
}

describe("schedule legend colours", () => {
  it("follows the legend: show day alone is bold with no fill", () => {
    expect(legendFill(["S"])).toBeUndefined();
    expect(legendFill(["MI"])).toBe(LEGEND_FILL.moveIn);
    expect(legendFill(["MO?"])).toBe(LEGEND_FILL.moveOut);
    expect(legendFill(["Food"])).toBe(LEGEND_FILL.nonShow);
    expect(legendFill([])).toBeUndefined();
    expect(Object.values(LEGEND_FILL)).toEqual(["FF92D050", "FF75FFFF", "FFFFC000", "FFFF0000", "FF00B0F0", "FF7030A0"]);
  });
  it("makes show days bold", async () => {
    const { room } = await build([event("BallRoom A", "S"), event("BallRoom B", "S")]);
    expect(room("BallRoom A").font?.bold).toBe(true);
    expect(room("BallRoom A").fill).toEqual({ type: "pattern", pattern: "none" });
  });
});

describe("Excel shared event rules", () => {
  it.each([
    { name: "show plus move out is orange", codes: ["S", "MO"], color: "FFFFC000" },
    { name: "move in plus show is light cyan", codes: ["MI", "S"], color: "FF75FFFF" },
    { name: "exhibitor move in plus show is light cyan", codes: ["Exmi", "S"], color: "FF75FFFF" },
    { name: "all three activities are blue", codes: ["MI", "S", "MO"], color: "FF00B0F0" },
    { name: "exhibitor move in with show and move out is blue", codes: ["Exmi", "S", "MO"], color: "FF00B0F0" },
    { name: "move in alone is green", codes: ["MI"], color: "FF92D050" },
    { name: "move out alone is red", codes: ["MO"], color: "FFFF0000" },
    { name: "a non-show event is purple", codes: ["MTG"], color: "FF7030A0" },
  ] as { name: string; codes: EventCode[]; color: string }[])("$name", async ({ codes, color }) => {
    const entries = codes.flatMap((code) => [event("BallRoom A", code), event("BallRoom B", code)]);
    const original = await build(entries);
    const buffer = await original.wb.xlsx.writeBuffer();
    const template = await build(entries, new File([buffer], "schedule.xlsx"));
    for (const result of [original, template]) {
      expect(result.room("BallRoom A").fill).toEqual({ type: "pattern", pattern: "solid", fgColor: { argb: color } });
      expect(result.room("BallRoom B").master.address).toBe(result.room("BallRoom A").address);
    }
  });
  it("merges Ballroom A and B into one event without including E", async () => {
    const { room } = await build([event("BallRoom A"), event("BallRoom B")]);
    expect(room("BallRoom B").master.address).toBe(room("BallRoom A").address);
    expect(room("BallRoom E").isMerged).toBe(false);
  });
  it("merges the full ballroom across all seven template rows", async () => {
    const { room } = await build(BALLROOM_ROWS.map((label) => event(label)));
    for (const label of BALLROOM_ROWS) expect(room(label).master.address).toBe(room("BallRoom A").address);
  });
  it("merges a show across Hall A and B", async () => {
    const { room } = await build([event("Hall A"), event("Hall B")]);
    expect(room("Hall B").master.address).toBe(room("Hall A").address);
  });
  it("keeps different shows and different times separate", async () => {
    const { room } = await build([event("BallRoom A"), event("BallRoom B", "S", "Another show"), { ...event("BallRoom E"), end: 1080 }]);
    expect(room("BallRoom A").isMerged).toBe(false);
    expect(room("BallRoom B").isMerged).toBe(false);
    expect(room("BallRoom E").isMerged).toBe(false);
  });
  it("keeps distinct shows in the same room and date during PDF summarizing", () => {
    const common = { level: 2, usage: "Event (EVT)", start: "08:00 AM", end: "05:00 PM", description: "Show open", space: "Exhibit Hall A", date: "2026-10-12" };
    expect(summarizeEvents([{ ...common, event: "Show One" }, { ...common, event: "Show Two" }]).map((e) => e.title)).toEqual(["Show One", "Show Two"]);
  });
  it("updates an old full-ballroom merge without changing engineer shifts or unrelated dates", async () => {
    const first = await build(BALLROOM_ROWS.flatMap((label) => [event(label), event(label, "S", "Tuesday show", "2026-10-13")]));
    first.ws.getCell("B18").value = "9a-6p";
    const buffer = await first.wb.xlsx.writeBuffer();
    const file = new File([buffer], "schedule.xlsx");
    const updated = await build([event("BallRoom A", "S", "New AB show"), event("BallRoom B", "S", "New AB show")], file);
    expect(updated.room("BallRoom B").master.address).toBe(updated.room("BallRoom A").address);
    expect(updated.room("BallRoom E").isMerged).toBe(false);
    expect(updated.room("BallRoom E").value).toContain("Shared show");
    expect(updated.room("BallRoom F", 3).master.address).toBe(updated.room("BallRoom A", 3).address);
    expect(updated.ws.getCell("B18").value).toBe("9a-6p");
  });
});