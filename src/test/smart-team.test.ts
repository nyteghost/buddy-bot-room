import { describe, expect, it } from "vitest";
import { buildHandoff, cleanSmartConfig, defaultSmartConfig, isRepeat, outOfTime, planSmartTeam, profileTask, shouldRun, similarity } from "@/lib/smart-team";

const ALL = ["nova", "byte", "sage", "pip", "echo", "rune", "claude", "saiyan"];

describe("profileTask", () => {
  it("treats short everyday questions as simple", () => {
    expect(profileTask("What should I cook tonight?").kind).toBe("simple");
    expect(profileTask("Name my new indie game").kind).toBe("simple");
  });
  it("recognises system, code and risky work", () => {
    const p = profileTask("My Docker container restarts every few minutes and I want to delete the old volume");
    expect(p).toMatchObject({ kind: "system", risky: true, complex: true });
    expect(profileTask("This TypeScript function throws an error on import").kind).toBe("code");
  });
});

describe("planSmartTeam", () => {
  it("uses exactly one pal for a simple question", () => {
    const plan = planSmartTeam({ text: "Best way to learn guitar?", seated: ALL });
    expect(plan.single).toBe(true);
    expect(plan.steps).toHaveLength(1);
  });
  it("runs specialist -> coder -> reviewer -> coordinator for a risky system problem, each a different pal", () => {
    const plan = planSmartTeam({ text: "My Docker container keeps restarting and I may need to prune volumes", seated: ALL });
    expect(plan.steps.map((s) => s.role)).toEqual(["specialist", "coder", "reviewer", "coordinator"]);
    expect(new Set(plan.steps.map((s) => s.agentId)).size).toBe(4);
  });
  it("skips the reviewer for a harmless fix", () => {
    const plan = planSmartTeam({ text: "my plex app keeps buffering on one tv", seated: ALL });
    expect(plan.steps.map((s) => s.role)).not.toContain("reviewer");
    expect(plan.steps.at(-1)?.role).toBe("coordinator");
  });
  it("respects the turn limit, keeping first and last", () => {
    const plan = planSmartTeam({ text: "My Docker container keeps restarting and I may need to prune volumes", seated: ALL, config: { ...defaultSmartConfig, maxTurns: 2 } });
    expect(plan.steps.map((s) => s.role)).toEqual(["specialist", "coordinator"]);
    expect(planSmartTeam({ text: "My Docker container keeps restarting and I may need to prune volumes", seated: ALL, config: { ...defaultSmartConfig, maxTurns: 3 } }).steps).toHaveLength(3);
  });
  it("single-pal setting and one seated pal both give one answer", () => {
    expect(planSmartTeam({ text: "My Docker container keeps restarting forever", seated: ALL, config: { ...defaultSmartConfig, singleOnly: true } }).steps).toHaveLength(1);
    expect(planSmartTeam({ text: "My Docker container keeps restarting forever", seated: ["nova"] }).single).toBe(true);
  });
  it("lets a mentioned pal take the single answer and honours manual assignments", () => {
    expect(planSmartTeam({ text: "hello there", seated: ALL, mentioned: "pip" }).steps[0]?.agentId).toBe("pip");
    const plan = planSmartTeam({ text: "My Docker container keeps restarting and I may need to prune volumes", seated: ALL, config: cleanSmartConfig({ assign: { coder: "claude", reviewer: "auto" } }) });
    expect(plan.steps.find((s) => s.role === "coder")?.agentId).toBe("claude");
  });
  it("only uses pals that are seated, and survives an empty room", () => {
    const plan = planSmartTeam({ text: "My Docker container keeps restarting and I may need to prune volumes", seated: ["pip", "rune"] });
    expect(plan.steps.every((s) => ["pip", "rune"].includes(s.agentId))).toBe(true);
    expect(planSmartTeam({ text: "x", seated: [] }).steps).toEqual([]);
  });
});

describe("shouldRun, repeats, hand-off, limits", () => {
  const plan = planSmartTeam({ text: "My Docker container keeps restarting and I may need to prune volumes", seated: ALL });
  it("runs the reviewer only for risky or code-like proposals, the coordinator only with something to merge", () => {
    const calm = planSmartTeam({ text: "my plex app keeps buffering on one tv", seated: ALL });
    expect(shouldRun({ agentId: "sage", role: "reviewer" }, calm, [{ role: "specialist", text: "Check the network." }])).toBe(false);
    expect(shouldRun({ agentId: "sage", role: "reviewer" }, calm, [{ role: "coder", text: "Run `docker rm -f plex`" }])).toBe(true);
    expect(shouldRun({ agentId: "nova", role: "coordinator" }, plan, [{ role: "specialist", text: "short" }])).toBe(false);
    expect(shouldRun({ agentId: "nova", role: "coordinator" }, plan, [{ role: "specialist", text: "a" }, { role: "coder", text: "b" }])).toBe(true);
  });
  it("detects a pal repeating an earlier answer", () => {
    const a = "Check the container logs first and look for out of memory kills in the kernel log.";
    expect(similarity(a, a)).toBe(1);
    expect(isRepeat("Check the container logs first, look for out of memory kills in the kernel log!", [a])).toBe(true);
    expect(isRepeat("Back up the appdata folder before pruning anything.", [a])).toBe(false);
  });
  it("bounds the hand-off and labels each step", () => {
    const h = buildHandoff([{ role: "specialist", name: "Byte", text: "x".repeat(5000) }, { role: "coder", name: "Pip", text: "do y" }], 1000);
    expect(h.length).toBeLessThanOrEqual(1000);
    expect(h).toContain("[specialist - Byte]");
    expect(h).toContain("[coder - Pip]");
    expect(buildHandoff([])).toBe("");
  });
  it("stops starting turns once the time budget is spent", () => {
    expect(outOfTime(0, 179_000, { maxSeconds: 180 })).toBe(false);
    expect(outOfTime(0, 180_000, { maxSeconds: 180 })).toBe(true);
  });
  it("cleans saved config", () => {
    expect(cleanSmartConfig(null)).toEqual(defaultSmartConfig);
    expect(cleanSmartConfig({ maxTurns: 99, maxSeconds: 1, singleOnly: "yes", assign: { coder: "auto", reviewer: "sage", bogus: "x" } })).toEqual({ maxTurns: 6, maxSeconds: 20, singleOnly: false, assign: { reviewer: "sage" } });
  });
});
