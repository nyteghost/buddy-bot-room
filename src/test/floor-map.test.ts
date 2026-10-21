import { describe, expect, it } from "vitest";
import { buildEntries, cellAround, classify, drawFor, locate, mergeTexts, parseBooth, parseWorkOrderLines, planKey, resolve, type Prims, type TextBit } from "@/lib/floor-map";

const t = (s: string, x: number, y: number): TextBit => ({ s, x, y, w: s.length * 3, h: 5 });
/** A 3-booth plan drawn with plain lines: 101 | 102 on top, 103 below, each 20 x 20. */
const lines = (x: number, y: number) => [
  { x1: x, y1: y, x2: x + 20, y2: y }, { x1: x, y1: y + 20, x2: x + 20, y2: y + 20 },
  { x1: x, y1: y, x2: x, y2: y + 20 }, { x1: x + 20, y1: y, x2: x + 20, y2: y + 20 },
];
const plan = (): Prims => ({
  width: 400, height: 300,
  texts: [t("101", 102, 114), t("102", 122, 114), t("103", 102, 134), t("T", 200, 50), t("5", 205, 50)],
  segs: [...lines(100, 110), ...lines(120, 110), ...lines(100, 130)],
  boxes: [{ x: 200, y: 52, w: 9, h: 3 }],
});
const wo = (rows: string[]) => parseWorkOrderLines(rows.map((r) => `${r} 04/23/25 298243 Completed (C)`));

describe("floor map: booth names", () => {
  it("reads the odd ways booths get typed", () => {
    expect(parseBooth("803ASPIRE").ids).toEqual(["803"]);
    expect(parseBooth("D01").ids).toEqual(["D1"]);
    expect(parseBooth("Mo1").ids).toEqual(["M1"]);
    expect(parseBooth("H14H13").ids).toEqual(["H14", "H13"]);
    expect(parseBooth("N9and10").ids).toEqual(["N9", "N10"]);
    expect(parseBooth("m6-7").ids).toEqual(["M6", "M7"]);
    expect(parseBooth("Q08/09").ids).toEqual(["Q8", "Q9"]);
    expect(parseBooth("T-18").ids).toEqual(["T18"]);
    expect(parseBooth("336-A").ids).toEqual(["336A"]);
    expect(parseBooth("K905kitche").ids).toEqual(["K905"]);
    expect(parseBooth("TBD").ids).toEqual([]);
  });
  it("tells a small run from a block", () => {
    expect(parseBooth("412-414").ids).toEqual(["412", "413", "414"]);
    expect(parseBooth("823-5").ids).toEqual(["823", "824", "825"]);
    expect(parseBooth("929-1028").note).toBe("range");
  });
});

describe("floor map: work order", () => {
  it("sorts items into kinds", () => {
    expect(classify("10 amp - 120v: (25' Extension Cord)").kind).toBe("a10");
    expect(classify("20amp - 120v: Exhibit (Extension Cord & Tri Tap)").kind).toBe("a20");
    expect(classify("20 amp - 120v: BR/MR FIRST FREE").kind).toBe("a20");
    expect(classify("Power for (4) Showcases")).toEqual({ kind: "showcase", mult: 4 });
    expect(classify("Cobb Galleria Centre Package B: 4' Track with 3 Lights").kind).toBe("trackB");
    expect(classify("100amp - 208v Three Phase").kind).toBe("big");
    expect(classify("Sink Rental").kind).toBe("other");
  });
  it("adds up an exhibitor's lines and keeps blank booths apart by name", () => {
    const e = buildEntries(wo(["Acme Acme 101 2.00 10 amp - 120v: (x)", "Acme Acme 101 1.00 20amp - 120v: Exhibit (x)", "Bennett Events 3.00 10 amp - 120v: (x)", "Other Co Other Co TBD 1.00 10 amp - 120v: (x)"]));
    expect(e).toHaveLength(3);
    expect(e[0]!.counts).toMatchObject({ a10: 2, a20: 1 });
    expect(e[1]!.booth).toBe("");
  });
});

describe("floor map: finding booths", () => {
  it("draws the booth around its number", () => {
    const p = plan();
    expect(cellAround(p, 110, 120)).toMatchObject({ x: 100, y: 110, w: 20, h: 20 });
    expect(locate(p, mergeTexts(p.texts), "103")).toMatchObject({ x: 100, y: 130 });
  });
  it("joins a letter and its number, and finds thin tables beside them", () => {
    const p = plan();
    expect(locate(p, mergeTexts(p.texts), "T5")).toMatchObject({ w: 9, h: 3 });
  });
  it("colors what it can and asks about the rest", () => {
    const p = plan();
    const e = buildEntries(wo(["Acme Acme 101 2.00 10 amp - 120v: (x)", "Zed Zed 999 1.00 20amp - 120v: Exhibit (x)", "Nobody Nobody TBD 1.00 10 amp - 120v: (x)", "Big Co Big Co 102 1.00 100amp - 208v Three Phase"]));
    const r = resolve(p, e);
    expect(r.placed.map((x) => x.entry.booth)).toEqual(["101"]);
    expect(r.questions.map((q) => q.kind).sort()).toEqual(["no-booth", "not-found", "other-lines"]);
  });
  it("uses an answer you gave before", () => {
    const p = plan();
    const e = buildEntries(wo(["Zed Zed 999 1.00 20amp - 120v: Exhibit (x)"]));
    const r = resolve(p, e, { [e[0]!.key]: { cells: [{ x: 100, y: 130, w: 20, h: 20 }] } });
    expect(r.placed).toHaveLength(1);
    expect(r.questions).toHaveLength(0);
    expect(resolve(p, e, { [e[0]!.key]: { skip: true } }).placed).toHaveLength(0);
  });
});

describe("floor map: what gets drawn", () => {
  it("follows the rules", () => {
    const p = plan();
    const e = buildEntries(wo(["A A 101 3.00 10 amp - 120v: (x)", "A A 101 1.00 20amp - 120v: Exhibit (x)", "A A 101 1.00 30 amp - 208v", "A A 101 2.00 Cobb Galleria Centre Package B: 4' Track", "A A 101 1.00 Power for (4) Showcases"]));
    const d = drawFor(resolve(p, e).placed[0]!);
    expect(d.fill).toBe("yo");
    expect(d.squares).toEqual(["red"]);
    expect(d.tag).toEqual(["x3", "SCase x4", "B x2"]);
  });
  it("remembers answers per plan file", () => expect(planKey("ASM.pdf", plan())).toBe("asm|400x300|5"));
});
