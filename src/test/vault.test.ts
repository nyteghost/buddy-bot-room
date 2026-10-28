import { describe, expect, it } from "vitest";
import { cleanFolder, fileNameFor, safeRel, titleOf, uniqueName } from "@/lib/vault";

describe("vault paths", () => {
  it("accepts ordinary notes", () => {
    expect(safeRel("Projects/Plan.md")).toBe("Projects/Plan.md");
    expect(safeRel("a\\b.md")).toBe("a/b.md");
  });
  it("refuses anything that could leave the vault or touch Obsidian's folders", () => {
    for (const bad of ["../x.md", "a/../../x.md", "/etc/x.md", ".obsidian/app.md", ".trash/a.md", "a//b.md", "notes.txt", "", 5, null, "a/.hidden.md"]) expect(safeRel(bad)).toBeNull();
  });
  it("makes safe file names", () => {
    expect(fileNameFor("Plan: v2 / final?")).toBe("Plan v2 final.md");
    expect(fileNameFor("   ")).toBe("Untitled.md");
    expect(fileNameFor("[[Link]] #tag")).toBe("Link tag.md");
    expect(fileNameFor("x".repeat(200)).length).toBe(83);
    expect(titleOf("A/B/Note.md")).toBe("Note");
  });
  it("never reuses a name", () => {
    expect(uniqueName("Note.md", [])).toBe("Note.md");
    expect(uniqueName("Note.md", ["note.md"])).toBe("Note 2.md");
    expect(uniqueName("Note.md", ["Note.md", "Note 2.md"])).toBe("Note 3.md");
  });
  it("cleans the new-notes folder", () => {
    expect(cleanFolder("Pixel Pals")).toBe("Pixel Pals");
    expect(cleanFolder("/Inbox//Pixel Pals/")).toBe("Inbox/Pixel Pals");
    expect(cleanFolder("../out")).toBe("");
    expect(cleanFolder(".obsidian")).toBe("");
    expect(cleanFolder("")).toBe("");
  });
});
