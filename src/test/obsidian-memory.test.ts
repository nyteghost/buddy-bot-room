import { describe, expect, it } from "vitest";
import { parseMemoryNote, renderMemoryNote } from "@/lib/obsidian-memory";
describe("Obsidian memory format", () => {
 const data = { memories: [{ id:"shared-one",text:"One task at a time",at:100,pinned:true }], pal:{ saiyan:[{id:"personal-one",text:"Gentle encouragement",at:200}] }, project:{ ShowPilot:[{id:"project-one",text:"CGC only",at:300}] } };
 it("exports portable Markdown and restores scoped memories", () => {
  const md = renderMemoryNote(data);
  expect(md).toContain("## Project: ShowPilot");
  expect(parseMemoryNote(md)).toEqual(data);
 });
 it("accepts manual changes made in Obsidian", () => {
  const changed = renderMemoryNote(data).replace("Gentle encouragement", "Quiet encouragement");
  expect(parseMemoryNote(changed).pal?.saiyan?.[0]?.text).toBe("Quiet encouragement");
 });
});
