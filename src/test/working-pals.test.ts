import { describe, expect, it } from "vitest";
import { canRun, newMission, recoverMission, validMission, type PalMission } from "@/lib/working-pals";
const id="95ae71ab-a302-4d88-99b0-3fca44c6024b";
const now="2026-11-02T22:00:00.000Z";
const one = () => newMission({title:"Summarize my plan",question:"What is the next tiny step?",scope:"personal",project:""},id,now)!;
describe("Working Pals approval-first mission records",()=>{
  it("requires clear scope and bounded read-only job",()=>{
    expect(newMission({title:"x",question:"y",scope:"project",project:""},id,now)).toBeNull();
    expect(newMission({title:"x",question:"y",scope:"personal",project:"private"},id,now)).toBeNull();
    expect(newMission({title:"x",question:"y".repeat(1201),scope:"personal",project:""},id,now)).toBeNull();
    expect(validMission(one())).toBe(true);
  });
  it("never runs proposals, revoked jobs or unapproved interrupted jobs",()=>{
    const m=one();
    expect(canRun(m)).toBe(false);
    const approved:PalMission={...m,status:"approved",approvedAt:now};
    expect(canRun(approved)).toBe(true);
    expect(canRun({...approved,status:"revoked"})).toBe(false);
    expect(canRun({...m,status:"interrupted"})).toBe(false);
  });
  it("holds a crash-interrupted execution for explicit manual retry",()=>{
    const m={...one(),status:"running" as const,approvedAt:now};
    const recovered=recoverMission(m);
    expect(recovered.status).toBe("interrupted");
    expect(recovered.revision).toBe(m.revision+1);
    expect(canRun(recovered)).toBe(true);
  });
});
