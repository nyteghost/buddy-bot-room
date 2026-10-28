import { describe, expect, it } from "vitest";
import { scopeShowPilotRows } from "@/lib/showpilot-venue";

describe("ShowPilot event source scoping", () => {
  it("accepts convention center rooms with historical names", () => {
    const rows = [{space:"Exhibit Hall AB (EXAB)"},{space:"Hall D"},{space:"Ballroom C"},{space:"Concourse A"},{space:"Chattahoochee"},{space:"BRFULL"}];
    expect(scopeShowPilotRows(rows).accepted).toEqual(rows);
  });
  it("excludes explicit performing arts center venue labels", () => {
    const rows=[{space:"CEPAC Theatre"},{space:"Cobb Energy Performing Arts Centre"},{space:"Exhibit Hall D"}];
    const res=scopeShowPilotRows(rows);
    expect(res.excluded).toEqual(rows.slice(0,2));
    expect(res.accepted).toEqual([rows[2]]);
  });
  it("quarantines unknown locations instead of assuming they are convention center rooms", () => {
    const rows=[{space:"Meeting Room 100"},{space:""},{space:"Unknown Space"}];
    expect(scopeShowPilotRows(rows).needsReview).toEqual(rows);
  });
  it("does not infer venue from a show title", () => {
    expect(scopeShowPilotRows([{space:"Unknown",event:"Cobb Convention Center-Atlanta"}]).accepted).toHaveLength(0);
  });
});
