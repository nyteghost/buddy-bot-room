import { describe, expect, it } from "vitest";
import { clampPage, clampZoom, findMatches, fitScale, layoutPages, matchingItems, pagesToRender, pdfErrorMessage, printablePages, stepIndex, visiblePages, zoomIn, zoomOut } from "@/lib/doc-viewer/pdf-model";
import { buildOffsets, cellKey, colIndex, colName, displayValue, formatDate, formatNumber, indexMerges, isDateFormat, nextHitIndex, parseCsv, parseRef, rangeFor, refOf, searchSheet, serialToDate, sheetFromRows } from "@/lib/doc-viewer/sheet-model";

describe("PDF zoom and pages", () => {
  it("steps through zoom levels and stays in range", () => {
    expect(zoomIn(1)).toBe(1.25); expect(zoomOut(1)).toBe(0.75);
    expect(zoomIn(4)).toBe(4); expect(zoomOut(0.25)).toBe(0.25);
    expect(zoomIn(1.1)).toBe(1.25); expect(zoomOut(1.1)).toBe(1);
    expect(clampZoom(99)).toBe(4); expect(clampZoom(0)).toBe(0.25); expect(clampZoom(NaN)).toBe(1);
  });
  it("clamps page numbers", () => {
    expect(clampPage(0, 10)).toBe(1); expect(clampPage(11, 10)).toBe(10); expect(clampPage(3.6, 10)).toBe(4); expect(clampPage(NaN, 10)).toBe(1); expect(clampPage(5, 0)).toBe(1);
  });
  it("fits width and whole page", () => {
    const page = { w: 600, h: 800 };
    expect(fitScale("width", 1, page, { w: 1224, h: 500 })).toBeCloseTo(2, 5);
    expect(fitScale("page", 1, page, { w: 1224, h: 424 })).toBeCloseTo(0.5, 5);
    expect(fitScale("custom", 1.5, page, { w: 100, h: 100 })).toBe(1.5);
    expect(fitScale("width", 1, { w: 0, h: 0 }, { w: 500, h: 500 })).toBe(1);
  });
  it("lays pages out with unknown sizes using a fallback", () => {
    const l = layoutPages(3, new Map([[2, { w: 100, h: 400 }]]), { w: 100, h: 200 }, 1, 10);
    expect(l.heights).toEqual([200, 400, 200]);
    expect(l.tops).toEqual([10, 220, 630]);
    expect(l.total).toBe(840);
  });
  it("picks the pages in view plus a buffer, and the current page", () => {
    const l = layoutPages(100, new Map(), { w: 100, h: 100 }, 1, 0);
    const v = visiblePages(l, 5000, 300, 100);
    expect(v.first).toBe(49); expect(v.last).toBe(55); expect(v.current).toBe(52);
    expect(visiblePages(l, 0, 250, 0).first).toBe(1);
    expect(visiblePages(layoutPages(0, new Map(), { w: 1, h: 1 }, 1), 0, 100)).toEqual({ first: 1, last: 0, current: 1 });
  });
  it("draws a bounded number of pages, nearest the current one", () => {
    expect(pagesToRender(50, 52, 1000, 51, 9)).toEqual([50, 51, 52]);
    expect(pagesToRender(1, 40, 100, 20, 9)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(pagesToRender(1, 40, 3, 1, 9)).toEqual([1, 2, 3]);
    expect(pagesToRender(5, 4, 10, 5)).toEqual([]);
  });
  it("caps what gets printed", () => {
    expect(printablePages(5)).toEqual([1, 2, 3, 4, 5]);
    expect(printablePages(1000)).toHaveLength(300);
  });
});

describe("PDF search", () => {
  const pages = ["Hello World\nthe  quick brown fox", undefined, "World peace, world cup"];
  it("finds matches ignoring case and spacing, in page order", () => {
    expect(findMatches(pages, "world").map((m) => m.page)).toEqual([1, 3, 3]);
    expect(findMatches(pages, "quick   BROWN")).toHaveLength(1);
    expect(findMatches(pages, "  ")).toEqual([]);
    expect(findMatches(pages, "zebra")).toEqual([]);
  });
  it("stops at the maximum", () => { expect(findMatches(["a a a a a"], "a", 3)).toHaveLength(3); });
  it("steps through matches and wraps", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0); expect(stepIndex(-1, 3, -1)).toBe(2); expect(stepIndex(2, 3, 1)).toBe(0); expect(stepIndex(0, 3, -1)).toBe(2); expect(stepIndex(0, 0, 1)).toBe(-1);
  });
  it("finds the text items to highlight, including a phrase across items", () => {
    expect([...matchingItems(["Hello ", "World", "again"], "world")]).toEqual([1]);
    expect([...matchingItems(["Hello", "big", "World"], "hello big")].sort()).toEqual([0, 1]);
    expect([...matchingItems(["abc"], "")]).toEqual([]);
  });
  it("explains PDF errors without echoing file contents", () => {
    expect(pdfErrorMessage(Object.assign(new Error("No password given"), { name: "PasswordException" }))).toMatch(/password/);
    expect(pdfErrorMessage(Object.assign(new Error("Invalid PDF structure."), { name: "InvalidPDFException" }))).toMatch(/isn't a readable PDF/);
    expect(pdfErrorMessage(new Error("boom"))).toBe("Couldn't open this PDF.");
  });
});

describe("cell references", () => {
  it("converts columns both ways", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    expect(["A", "Z", "AA", "ZZ", "AAA", "aa"].map(colIndex)).toEqual([0, 25, 26, 701, 702, 26]);
    expect(colIndex("A1")).toBe(-1);
  });
  it("parses references", () => {
    expect(parseRef("B7")).toEqual({ r: 6, c: 1 }); expect(parseRef(" $c$12 ")).toEqual({ r: 11, c: 2 }); expect(refOf(0, 0)).toBe("A1"); expect(refOf(99, 27)).toBe("AB100");
    for (const bad of ["", "7B", "A0", "AAAA1", "A", "A1:B2"]) expect(parseRef(bad)).toBeNull();
  });
});

describe("number and date formats", () => {
  it("General", () => {
    expect(formatNumber(1234.5)).toBe("1234.5"); expect(formatNumber(0.1 + 0.2)).toBe("0.3"); expect(formatNumber(1e20)).toBe("1.0E+20".replace(".0", ""));
    expect(formatNumber(-5)).toBe("-5");
  });
  it("fixed decimals, thousands, percent, currency", () => {
    expect(formatNumber(3.14159, "0.00")).toBe("3.14");
    expect(formatNumber(1234567.891, "#,##0.00")).toBe("1,234,567.89");
    expect(formatNumber(1234567, "#,##0")).toBe("1,234,567");
    expect(formatNumber(0.256, "0%")).toBe("26%");
    expect(formatNumber(0.2567, "0.0%")).toBe("25.7%");
    expect(formatNumber(1234.5, "$#,##0.00")).toBe("$1,234.50");
    expect(formatNumber(-1234.5, "$#,##0.00")).toBe("-$1,234.50");
    expect(formatNumber(7, "00")).toBe("07");
    expect(formatNumber(5, '0" pcs"')).toBe("5 pcs");
    expect(formatNumber(1500, '"USD "#,##0')).toBe("USD 1,500");
    expect(formatNumber(2.5, "0.0#")).toBe("2.5");
    expect(formatNumber(-1234, "#,##0;(#,##0)")).toBe("(1,234)");
    expect(formatNumber(12345.678, "0.00E+00")).toBe("1.23E+04");
  });
  it("detects date formats", () => {
    for (const f of ["m/d/yyyy", "yyyy-mm-dd", "dd-mmm-yy", "h:mm AM/PM", "[h]:mm:ss", "mmmm d, yyyy"]) expect(isDateFormat(f)).toBe(true);
    for (const f of ["General", "0.00", "#,##0", "0%", '"days"0', "0.00E+00", undefined]) expect(isDateFormat(f)).toBe(false);
  });
  it("formats dates and times", () => {
    const d = new Date(Date.UTC(2026, 9, 31, 14, 5, 9));
    expect(formatDate(d, "yyyy-mm-dd")).toBe("2026-10-31");
    expect(formatDate(d, "m/d/yyyy")).toBe("10/31/2026");
    expect(formatDate(d, "mmmm d, yyyy")).toBe("October 31, 2026");
    expect(formatDate(d, "dddd")).toBe("Saturday");
    expect(formatDate(d, "h:mm AM/PM")).toBe("2:05 PM");
    expect(formatDate(d, "hh:mm:ss")).toBe("14:05:09");
    expect(formatDate(d, "dd-mmm-yy")).toBe("31-Oct-26");
  });
  it("converts Excel serial numbers", () => {
    expect(serialToDate(45000).toISOString().slice(0, 10)).toBe("2023-03-15");
    expect(serialToDate(1).toISOString().slice(0, 10)).toBe("1900-01-01");
    expect(displayValue(45000, "yyyy-mm-dd").t).toBe("2023-03-15");
    expect(displayValue(45000.5, "h:mm AM/PM").t).toBe("12:00 PM");
  });
  it("displays values by kind", () => {
    expect(displayValue(null)).toEqual({ t: "", n: "s" }); expect(displayValue(true).t).toBe("TRUE"); expect(displayValue("#DIV/0!").n).toBe("e");
    expect(displayValue(new Date(Date.UTC(2020, 0, 2))).t).toBe("2020-01-02"); expect(displayValue(12.5, "0.0").t).toBe("12.5");
  });
});

describe("CSV", () => {
  it("reads quotes, embedded commas and newlines", () => {
    const { rows } = parseCsv('a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n');
    expect(rows).toEqual([["a", "b", "c"], ["x, y", 'he said "hi"', "line1\nline2"]]);
  });
  it("detects semicolons and tabs and strips a BOM", () => {
    expect(parseCsv("﻿a;b\n1;2").rows).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2").rows).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty fields and a missing final newline", () => { expect(parseCsv("a,,c\n,,").rows).toEqual([["a", "", "c"], ["", "", ""]]); });
  it("truncates huge input instead of growing without limit", () => {
    const r = parseCsv(Array.from({ length: 50 }, (_, i) => `${i},x`).join("\n"), 10);
    expect(r.rows).toHaveLength(10); expect(r.truncated).toBe(true);
    expect(parseCsv("a,b,c,d,e", 10, 3).rows[0]).toEqual(["a", "b", "c"]);
  });
  it("builds a sheet from rows", () => {
    const s = sheetFromRows("Data", [["n", "v"], ["a", 1.5], ["", ""]]);
    expect(s.rows).toBe(3); expect(s.cols).toBe(2);
    expect(s.cells.get(cellKey(1, 1))).toMatchObject({ t: "1.5", v: 1.5, n: "n" });
    expect(s.cells.has(cellKey(2, 0))).toBe(false);
  });
});

describe("virtual window and merges", () => {
  it("finds the rows in view with overscan", () => {
    const o = buildOffsets(1000, () => 20);
    expect(rangeFor(o, 0, 100, 0)).toEqual({ first: 0, last: 5 });
    expect(rangeFor(o, 2000, 100, 2)).toEqual({ first: 98, last: 107 });
    expect(rangeFor(o, 999_999, 100, 2).last).toBe(999);
    expect(rangeFor(buildOffsets(0, () => 1), 0, 10)).toEqual({ first: 0, last: -1 });
  });
  it("handles variable sizes", () => {
    const o = buildOffsets(4, (i) => [10, 100, 10, 10][i]!);
    expect(rangeFor(o, 50, 10, 0)).toEqual({ first: 1, last: 1 });
  });
  it("indexes merged blocks", () => {
    const { master, covered } = indexMerges([{ r1: 0, c1: 0, r2: 1, c2: 2 }]);
    expect(master.has(cellKey(0, 0))).toBe(true);
    expect(covered.has(cellKey(0, 0))).toBe(false);
    expect([...covered].sort((a, b) => a - b)).toEqual([cellKey(0, 1), cellKey(0, 2), cellKey(1, 0), cellKey(1, 1), cellKey(1, 2)]);
  });
  it("won't expand a hostile merge without limit", () => {
    const { covered } = indexMerges([{ r1: 0, c1: 0, r2: 1_000_000, c2: 10_000 }]);
    expect(covered.size).toBeLessThanOrEqual(200_000);
  });
});

describe("sheet search", () => {
  const s = sheetFromRows("S", [["apple", "Banana"], ["cherry", "apple pie"], ["x", "y"]]);
  it("finds cells row by row, ignoring case", () => {
    expect(searchSheet(s, "APPLE")).toEqual([{ r: 0, c: 0 }, { r: 1, c: 1 }]);
    expect(searchSheet(s, "")).toEqual([]);
    expect(searchSheet(s, "zzz")).toEqual([]);
  });
  it("finds in formulas too", () => {
    const f = sheetFromRows("F", [[1]]); f.cells.set(cellKey(0, 0), { t: "3", f: "SUM(A2:A3)" });
    expect(searchSheet(f, "sum(")).toEqual([{ r: 0, c: 0 }]);
  });
  it("steps through hits and wraps", () => {
    const hits = [{ r: 0, c: 0 }, { r: 1, c: 1 }, { r: 4, c: 0 }];
    expect(nextHitIndex(hits, null, 1)).toBe(0); expect(nextHitIndex(hits, null, -1)).toBe(2);
    expect(nextHitIndex(hits, { r: 4, c: 0 }, 1)).toBe(0); expect(nextHitIndex(hits, { r: 0, c: 0 }, -1)).toBe(2);
    expect(nextHitIndex(hits, { r: 2, c: 2 }, 1)).toBe(2); expect(nextHitIndex(hits, { r: 2, c: 2 }, -1)).toBe(1);
    expect(nextHitIndex([], null, 1)).toBe(-1);
  });
});
