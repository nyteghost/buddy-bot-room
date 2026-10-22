// Excel crew sheet for Stage Deck Pro: the parts list against the warehouse, plus one row per stage.
export type CrewPartRow = { label: string; need: number; have: number | null };
export type CrewStageRow = { name: string; width: number; length: number; heightIn: number; quantity: number; valid: boolean };

export const crewCheck = (r: CrewPartRow): string => (r.have === null ? "COUNT IT" : r.need > r.have ? `SHORT ${r.need - r.have}` : "ok");

export async function crewWorkbook(eventName: string, parts: CrewPartRow[], stages: CrewStageRow[]): Promise<Blob> {
  const module = await import("exceljs");
  const ExcelJS = module.default ?? module;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Crew parts");
  ws.addRow([eventName.trim() || "Stage Deck Planner"]).font = { bold: true, size: 14 };
  ws.addRow([]);
  ws.addRow(["Part", "Need", "In warehouse", "Check"]).font = { bold: true };
  for (const r of parts) {
    const row = ws.addRow([r.label, r.need, r.have === null ? "not counted" : r.have, crewCheck(r)]);
    if (r.have === null || r.need > r.have) row.getCell(4).font = { bold: true, color: { argb: "FFC00000" } };
  }
  ws.columns = [{ width: 24 }, { width: 10 }, { width: 16 }, { width: 14 }];
  const st = wb.addWorksheet("Stages");
  st.addRow(["Stage", "Width (ft)", "Length (ft)", "Height (in)", "Copies", "Builds from stock"]).font = { bold: true };
  for (const s of stages) st.addRow([s.name, s.width, s.length, s.heightIn, s.quantity, s.valid ? "yes" : "NO"]);
  st.columns = [{ width: 24 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 8 }, { width: 18 }];
  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
