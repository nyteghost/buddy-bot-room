import { describe, expect, it } from "vitest";
import { cellAt } from "@/lib/doc-viewer/sheet-model";
import { parseCsvFile, parseWorkbook, parseXls, parseXlsx, sheetErrorMessage, sniffSheetKind } from "@/lib/doc-viewer/sheet-parse";

const ab = (b: ArrayBuffer | Uint8Array | Buffer): ArrayBuffer => {
  const u = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return u.slice().buffer as ArrayBuffer;
};
const enc = (s: string) => ab(new TextEncoder().encode(s));

describe("format detection", () => {
  it("uses the first bytes before the extension", () => {
    expect(sniffSheetKind(new Uint8Array([0x50, 0x4b, 3, 4]), "report.csv")).toBe("xlsx");
    expect(sniffSheetKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "x.xlsx")).toBe("xls");
    expect(sniffSheetKind(new Uint8Array([97, 44]), "x.xlsm")).toBe("xlsx");
    expect(sniffSheetKind(new Uint8Array([97, 44]), "x.xls")).toBe("xls");
    expect(sniffSheetKind(new Uint8Array([97, 44]), "x.csv")).toBe("csv");
  });
  it("explains failures in plain words", () => {
    expect(sheetErrorMessage(new Error("File is password-protected"))).toMatch(/password/);
    expect(sheetErrorMessage(new Error("Can't find end of central directory"))).toMatch(/isn't a readable spreadsheet/);
    expect(sheetErrorMessage(new Error("kaboom"))).toBe("Couldn't open this spreadsheet.");
  });
});

describe("CSV files", () => {
  it("opens as one sheet named after the file", () => {
    const wb = parseCsvFile(enc("name,qty\nbolts,10\n"), "parts list.csv");
    expect(wb.sheets).toHaveLength(1);
    expect(wb.sheets[0]!.name).toBe("parts list");
    expect(cellAt(wb.sheets[0]!, 1, 1)?.t).toBe("10");
  });
  it("falls back to Windows-1252 for old exports", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("a,b\n")].concat([0xe9, 0xe9, 0xe9, 0xe9, 0x2c, 0x31]));
    expect(cellAt(parseCsvFile(ab(bytes), "x.csv").sheets[0]!, 1, 0)?.t).toBe("éééé");
  });
  it("refuses files over the size limit", async () => {
    await expect(parseWorkbook(new ArrayBuffer(31_000_000), "big.csv")).rejects.toThrow(/too large/);
  });
});

describe("xlsx files (exceljs)", () => {
  async function sample(): Promise<ArrayBuffer> {
    const ExcelJS = ((await import("exceljs")) as unknown as { default?: typeof import("exceljs") }).default ?? (await import("exceljs"));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Budget", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    ws.columns = [{ header: "Item", key: "i", width: 20 }, { header: "Cost", key: "c", width: 12 }, { header: "Date", key: "d", width: 12 }];
    ws.addRow({ i: "Chairs", c: 1234.5, d: new Date(Date.UTC(2026, 9, 31)) });
    ws.addRow({ i: "Tables", c: 99, d: new Date(Date.UTC(2026, 10, 1)) });
    ws.getCell("B2").numFmt = "$#,##0.00";
    ws.getCell("C2").numFmt = "m/d/yyyy";
    ws.getCell("A1").font = { bold: true, color: { argb: "FFFF0000" } };
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    ws.getCell("B4").value = { formula: "SUM(B2:B3)", result: 1333.5 };
    ws.getCell("B4").numFmt = "#,##0.00";
    ws.mergeCells("A6:C6");
    ws.getCell("A6").value = "Merged title";
    ws.getRow(3).height = 30;
    wb.addWorksheet("Secret").state = "hidden";
    const other = wb.addWorksheet("Other");
    other.getCell("A1").value = true;
    other.getCell("A2").value = { richText: [{ text: "Rich " }, { text: "text" }] } as never;
    return ab(await wb.xlsx.writeBuffer());
  }
  it("reads values, formats, formulas, merges, frozen panes and sizes", async () => {
    const wb = await parseXlsx(await sample());
    expect(wb.sheets.map((s) => s.name)).toEqual(["Budget", "Other"]);
    expect(wb.notes.join(" ")).toMatch(/1 hidden sheet/);
    const s = wb.sheets[0]!;
    expect(cellAt(s, 0, 0)).toMatchObject({ t: "Item", s: expect.any(Number) });
    expect(s.styles[cellAt(s, 0, 0)!.s!]).toMatchObject({ b: true, color: "#FF0000", bg: "#FFFF00" });
    expect(cellAt(s, 1, 0)?.t).toBe("Chairs");
    expect(cellAt(s, 1, 1)?.t).toBe("$1,234.50");
    expect(cellAt(s, 1, 2)?.t).toBe("10/31/2026");
    expect(cellAt(s, 3, 1)).toMatchObject({ t: "1,333.50", f: "SUM(B2:B3)" });
    expect(s.merges).toContainEqual({ r1: 5, c1: 0, r2: 5, c2: 2 });
    expect(s.frozen).toEqual({ rows: 1, cols: 1 });
    expect(s.colWidths[0]).toBeGreaterThan(100);
    expect(s.rowHeights[2]).toBe(40);
    const o = wb.sheets[1]!;
    expect(cellAt(o, 0, 0)?.t).toBe("TRUE");
    expect(cellAt(o, 1, 0)?.t).toBe("Rich text");
  });
  it("works through the single entry point and by content, not name", async () => {
    const wb = await parseWorkbook(await sample(), "renamed.csv");
    expect(wb.sheets[0]!.name).toBe("Budget");
  });
  it("reports junk as an unreadable file", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(parseWorkbook(ab(bytes), "bad.xlsx")).rejects.toBeTruthy();
  });
});

describe("legacy xls safety", () => {
  it("rejects binary workbooks without loading an unsafe parser", async () => {
    await expect(parseXls(new ArrayBuffer(16))).rejects.toThrow(/Save a copy as .xlsx/i);
  });
});
