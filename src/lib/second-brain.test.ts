import { describe, expect, it } from "vitest";
import { brainRelativePath, makeMemoryProposal, renderMemoryContext, searchBrainNotes, type BrainNote } from "./second-brain";

const note: BrainNote = {
  id: "memory_1", category: "Focus Sessions", title: "Build the swingset",
  body: "Next tiny step: lay out the pieces", source: "task-progress",
  createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z", tags: ["ADHD", "swingset"],
};
describe("Second Brain helpers", () => {
  it("writes only under the fixed PixelPals namespace", () => {
    expect(brainRelativePath({...note, title:"../swing/set"})).toBe("PixelPals/Focus Sessions/-swing-set--memory_1.md");
    expect(() => brainRelativePath({...note,id:"../../showpilot"})).toThrow();
  });
  it("finds relevant notes offline", () => {
    expect(searchBrainNotes("swingset progress", [note])).toEqual([note]);
    expect(searchBrainNotes("ballroom", [note])).toEqual([]);
  });
  it("treats remembered text as untrusted data", () => {
    expect(renderMemoryContext([note])).toContain("UNTRUSTED DATA");
    expect(renderMemoryContext([])).toBe("");
  });
  it("requires a usable memory proposal", () => {
    expect(makeMemoryProposal({category:"Preferences",title:"Short steps",body:"One task at a time",source:"user-confirmed",sensitive:false}).title).toBe("Short steps");
    expect(() => makeMemoryProposal({category:"Preferences",title:"",body:"test",source:"explicit-save",sensitive:false})).toThrow();
  });
});
