import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { File as NodeFile } from "node:buffer";
import { readScheduleWorkbook } from "@/lib/work-files";

describe("readScheduleWorkbook (ExcelJS)", () => {
  it("reads shift rows, week tabs, and employee labels without SheetJS", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Week 1");
    sheet.getCell("B1").value = "MON";
    sheet.getCell("B2").value = 46323; // 2026-10-28
    sheet.getCell("C2").value = 46324;
    sheet.getCell("A3").value = "Madjid";
    sheet.getCell("B3").value = "6a-2:30p";
    sheet.getCell("C3").value = "OFF";
    sheet.getCell("A4").value = "101";
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new NodeFile([buffer], "schedule.xlsx");
    const result = await readScheduleWorkbook(file as unknown as File, "Madjid");
    expect(result.people).toContain("Madjid");
    expect(result.shifts).toHaveLength(1);
    expect(result.shifts[0]?.raw).toBe("6a-2:30p");
  });

  it("rejects legacy binary .xls files instead of parsing them with an unsafe library", async () => {
    const file = { name: "legacy.xls", size: 10, arrayBuffer: async () => { throw new Error("must not read"); } } as unknown as File;
    await expect(readScheduleWorkbook(file)).rejects.toThrow(/save a copy as \.xlsx/i);
  });

  it("rejects oversized workbooks before parsing", async () => {
    const file = { size: 20_000_001, arrayBuffer: async () => { throw new Error("must not read"); } } as unknown as File;
    await expect(readScheduleWorkbook(file)).rejects.toThrow(/too large/);
  });
});
