import { describe, expect, it } from "vitest";
import { agentName, agentPersona, agents } from "../lib/agents";
import { cleanOverrides, LIMITS, mayUseRealData, memoryAccess, setOverride, withOverride } from "../lib/character-overrides";
import { visibleMemories, pickMemories } from "../lib/memory-rank";
import { promptContextFor, type Workbench } from "../lib/workbench";

const ids = agents.map((a) => a.id);
const wb = (): Workbench => ({
  memories: [{ id: "s1", text: "Lives in Ohio", at: 1 }],
  todos: [{ id: "t1", text: "Buy milk", done: false, at: 1 }],
  notes: [],
  pal: { nova: [{ id: "p1", text: "Likes dark roast", at: 1 }] },
  project: { home: [{ id: "j1", text: "Server is called tower", at: 1 }] },
} as unknown as Workbench);

describe("character overrides", () => {
  it("keeps only known pals, known fields and sane values", () => {
    const o = cleanOverrides({ nova: { name: "  Ada\n", role: 5, tone: "x".repeat(900), memory: "own", realData: false, evil: 1 }, ghost: { name: "Nope" }, byte: "str" }, ids);
    expect(Object.keys(o)).toEqual(["nova"]);
    expect(o["nova"]).toEqual({ name: "Ada", tone: "x".repeat(LIMITS.tone), memory: "own", realData: false });
  });
  it("drops defaults and rubbish input", () => {
    expect(cleanOverrides({ nova: { memory: "all", realData: true, name: "  " } }, ids)).toEqual({});
    expect(cleanOverrides(null, ids)).toEqual({});
    expect(cleanOverrides([1], ids)).toEqual({});
    expect(cleanOverrides("x", ids)).toEqual({});
  });
  it("merges wording over the built-in and leaves missing fields alone", () => {
    const base = { name: "Nova", role: "Mail", tone: "calm" };
    expect(withOverride(base, { name: "Ada" })).toEqual({ name: "Ada", role: "Mail", tone: "calm" });
    expect(withOverride(base, undefined)).toBe(base);
    expect(withOverride(base, { memory: "none" })).toBe(base);
  });
  it("defaults to full access and set/reset round-trips", () => {
    expect(memoryAccess({}, "nova")).toBe("all");
    expect(mayUseRealData({}, "nova")).toBe(true);
    const a = setOverride({}, "nova", { name: "Ada", realData: false });
    expect(mayUseRealData(a, "nova")).toBe(false);
    expect(setOverride(a, "nova", null)).toEqual({});
    expect(setOverride(a, "nova", {})).toEqual({});
  });
  it("applies in the normal theme only", () => {
    const o = cleanOverrides({ nova: { name: "Ada", role: "Planner", tone: "brisk" } }, ids);
    expect(agentName("nova", false, false, "normal", o)).toBe("Ada");
    expect(agentPersona("nova", false, false, "normal", false, o).role).toBe("Planner");
    expect(agentName("nova", true, false, "hellraiser", o)).not.toBe("Ada");
    expect(agentName("nova", false, true, "horror", o)).not.toBe("Ada");
    expect(agentName("nova", false, false, "dcc", o)).not.toBe("Ada");
    expect(agentName("byte", false, false, "normal", o)).toBe(agents.find((a) => a.id === "byte")!.name);
  });
});

describe("memory access", () => {
  it("all sees shared, own and project; own skips shared; none sees nothing", () => {
    const w = wb();
    const texts = (access: "all" | "own" | "none") => visibleMemories(w, { pal: "nova", project: "home", access }).map((v) => v.entry.text);
    expect(texts("all")).toEqual(["Lives in Ohio", "Likes dark roast", "Server is called tower"]);
    expect(texts("own")).toEqual(["Likes dark roast", "Server is called tower"]);
    expect(texts("none")).toEqual([]);
  });
  it("the prompt text follows the access level", () => {
    const w = wb();
    expect(promptContextFor(w, "hi", { pal: "nova", access: "none" })).toBe("");
    const own = promptContextFor(w, "hi", { pal: "nova", access: "own" });
    expect(own).toContain("dark roast");
    expect(own).not.toContain("Ohio");
    expect(promptContextFor(w, "hi", { pal: "nova" })).toContain("Ohio");
    expect(pickMemories(w, "hi", { pal: "byte", access: "own" }).text).toBe("");
  });
});
