import { describe, expect, it } from "vitest";
import { addDecision, addTask, canDepend, cleanProjects, isBlocked, logRun, newProject, progress, projectBrief, readyTasks, removeTask, resumeLine, setDependency, toggleTask, PLIMITS, type Project } from "../lib/projects";

const pals = ["nova", "byte", "sage"];
const fresh = (): Project => newProject("Home lab")!;
const withTasks = () => {
  let p = fresh();
  p = addTask(p, "Back up shares");
  p = addTask(p, "Upgrade Unraid");
  p = addTask(p, "Verify restore");
  const [a, b, c] = p.tasks.map((t) => t.id) as [string, string, string];
  p = setDependency(p, b, a, true);
  p = setDependency(p, c, b, true);
  return { p, a, b, c };
};

describe("projects", () => {
  it("creates a project only for a usable name", () => {
    expect(newProject("  ")).toBeNull();
    expect(newProject("__proto__")).toBeNull();
    expect(newProject("  Home   lab ")!.name).toBe("Home lab");
    expect(newProject("x".repeat(200))!.name.length).toBe(PLIMITS.name);
  });
  it("tracks dependencies: a task waits until what it follows is done", () => {
    const { p, a, b, c } = withTasks();
    expect(readyTasks(p).map((t) => t.id)).toEqual([a]);
    expect(isBlocked(p, p.tasks.find((t) => t.id === c)!)).toBe(true);
    const done = toggleTask(p, a);
    expect(readyTasks(done).map((t) => t.id)).toEqual([b]);
    expect(progress(done)).toEqual({ done: 1, total: 3 });
  });
  it("refuses loops and self-dependencies", () => {
    const { p, a, c } = withTasks();
    expect(canDepend(p, a, c)).toBe(false);
    expect(setDependency(p, a, c, true)).toBe(p);
    expect(canDepend(p, a, a)).toBe(false);
  });
  it("removing a task frees whatever waited on it", () => {
    const { p, a, b } = withTasks();
    const q = removeTask(p, a);
    expect(q.tasks.find((t) => t.id === b)!.after).toEqual([]);
    expect(readyTasks(q).map((t) => t.id)).toEqual([b]);
  });
  it("saves decisions and caps the history", () => {
    let p = addDecision(fresh(), "Use ZFS", 5);
    expect(p.decisions.map((d) => d.text)).toEqual(["Use ZFS"]);
    expect(addDecision(p, "  ")).toBe(p);
    for (let i = 0; i < PLIMITS.history + 5; i++) p = logRun(p, { topic: `q${i}`, mode: "smart", pals: ["Nova"], gist: "ok" }, i + 1);
    expect(p.history.length).toBe(PLIMITS.history);
    expect(p.history.at(-1)!.topic).toBe(`q${PLIMITS.history + 4}`);
  });
  it("summarises where you left off and gives pals a short brief", () => {
    const { p } = withTasks();
    const q = logRun({ ...p, next: "Run the restore test", agents: ["nova", "byte"], objective: "Safer storage" }, { topic: "Which backup tool?", mode: "smart", pals: ["Nova"], gist: "Restic" });
    expect(resumeLine(q)).toContain("Which backup tool?");
    expect(resumeLine(q)).toContain("ready now: Back up shares");
    const brief = projectBrief(q, (x) => x.toUpperCase());
    expect(brief).toContain("Active project: Home lab");
    expect(brief).toContain("NOVA, BYTE");
    expect(brief).toContain("Upgrade Unraid (waiting on another task)");
    expect(brief.length).toBeLessThanOrEqual(800);
    expect(projectBrief({ ...q, objective: "y".repeat(400), decisions: Array.from({ length: 9 }, (_, i) => ({ id: String(i), text: "d".repeat(100), at: 0 })) }, undefined, 300).length).toBeLessThanOrEqual(300);
  });
  it("rebuilds stored data safely", () => {
    const { p, a, b } = withTasks();
    const dirty = {
      "Home lab": { ...p, status: "weird", agents: ["nova", "ghost", "nova"], tasks: [...p.tasks.map((t) => (t.id === a ? { ...t, after: [b] } : t)), { id: "z", text: "", done: true }, null], docs: ["a.md", 5], history: [{ topic: "" }, "x"], evil: 1 },
      bad: "nope",
      "": { name: "" },
    };
    const out = cleanProjects(dirty, pals);
    const c = out["Home lab"]!;
    expect(Object.keys(out)).toEqual(["Home lab"]);
    expect(c.status).toBe("active");
    expect(c.agents).toEqual(["nova"]);
    expect(c.docs).toEqual(["a.md"]);
    expect(c.history).toEqual([]);
    expect(c.tasks.length).toBe(3);
    // a -> b -> a would be a loop; the loop members lose their dependencies
    expect(c.tasks.find((t) => t.id === a)!.after).toEqual([]);
    expect(cleanProjects(null, pals)).toEqual({});
    expect(cleanProjects([1], pals)).toEqual({});
  });
});
