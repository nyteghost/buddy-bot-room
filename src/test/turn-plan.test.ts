import { describe, expect, it } from "vitest";
import { planTurns } from "@/lib/turn-plan";
import { defaultSmartConfig } from "@/lib/smart-team";

const pals = (...ids: string[]) => ids.map((id) => ({ id }));
const base = { mode: "roundtable" as const, direct: false, rounds: 2, judgeOn: false, campaignActive: false, summary: false, topic: "hello", smart: defaultSmartConfig };
const shape = (r: ReturnType<typeof planTurns>) => r.turns.map((t) => `${t.agent.id}:${t.round}${t.verdict ? ":verdict" : ""}${t.role ? ":" + t.role : ""}${t.side ? ":" + t.side : ""}${t.dmRole ? ":" + t.dmRole : ""}${t.summary ? ":summary" : ""}`);

describe("turn planning (behaviour kept from before the extraction)", () => {
  it("roundtable: everyone each round, then the lead gives the verdict", () => {
    expect(shape(planTurns({ ...base, seated: pals("a", "b", "c") }))).toEqual(["a:1", "b:1", "c:1", "a:2", "b:2", "c:2", "a:2:verdict"]);
  });
  it("roundtable with one pal has no verdict; direct is one pass with no verdict", () => {
    expect(shape(planTurns({ ...base, seated: pals("a") }))).toEqual(["a:1", "a:2"]);
    expect(shape(planTurns({ ...base, seated: pals("a", "b"), direct: true }))).toEqual(["a:1", "b:1"]);
  });
  it("broadcast: no verdict unless the judge is on", () => {
    expect(shape(planTurns({ ...base, mode: "broadcast", rounds: 1, seated: pals("a", "b") }))).toEqual(["a:1", "b:1"]);
    expect(shape(planTurns({ ...base, mode: "broadcast", rounds: 1, judgeOn: true, seated: pals("a", "b") }))).toEqual(["a:1", "b:1", "a:1:verdict"]);
  });
  it("solve: Diagnoser, Fixer, Skeptic by seat, repeating, then a final plan", () => {
    expect(shape(planTurns({ ...base, mode: "solve", rounds: 1, seated: pals("a", "b", "c", "d") }))).toEqual(["a:1:diagnoser", "b:1:fixer", "c:1:skeptic", "d:1:diagnoser", "a:1:verdict"]);
  });
  it("debate: two sides per round and a third pal judges (the first, with only two)", () => {
    expect(shape(planTurns({ ...base, mode: "debate", rounds: 2, seated: pals("a", "b", "c") }))).toEqual(["a:1:for", "b:1:against", "a:2:for", "b:2:against", "c:2:verdict"]);
    expect(shape(planTurns({ ...base, mode: "debate", rounds: 1, seated: pals("a", "b") }))).toEqual(["a:1:for", "b:1:against", "a:1:verdict"]);
    expect(shape(planTurns({ ...base, mode: "debate", rounds: 1, seated: pals("a") }))).toEqual(["a:1:for"]);
  });
  it("a summary request is one turn by the first pal, and wins over everything else", () => {
    expect(shape(planTurns({ ...base, summary: true, campaignActive: true, seated: pals("a", "b") }))).toEqual(["a:1:summary"]);
  });
  it("a Dungeon Master campaign: first pal narrates, the others are the party", () => {
    expect(shape(planTurns({ ...base, campaignActive: true, seated: pals("a", "b", "c") }))).toEqual(["a:1:dm", "b:1:party", "c:1:party"]);
  });
  it("no pals seated means no turns", () => {
    expect(planTurns({ ...base, seated: [] }).turns).toEqual([]);
    expect(planTurns({ ...base, summary: true, seated: [] }).turns).toEqual([]);
  });
});

describe("smart team turns", () => {
  it("one pal for a simple question, with no role label", () => {
    const r = planTurns({ ...base, mode: "smart", topic: "What should I cook tonight?", seated: pals("nova", "byte", "sage", "pip") });
    expect(r.turns).toHaveLength(1);
    expect(r.turns[0]?.role).toBeUndefined();
    expect(r.smartPlan?.single).toBe(true);
  });
  it("a hard question is a sequence of roles, ending with the coordinator", () => {
    const r = planTurns({ ...base, mode: "smart", topic: "My Docker container keeps restarting and I may need to prune volumes", seated: pals("nova", "byte", "sage", "pip") });
    expect(r.turns.map((t) => t.role)).toEqual(["specialist", "coder", "reviewer", "coordinator"]);
  });
  it("one-on-one or @mention in smart mode is just a direct answer", () => {
    const r = planTurns({ ...base, mode: "smart", direct: true, topic: "My Docker container keeps restarting and I may need to prune volumes", seated: pals("byte") });
    expect(shape(r)).toEqual(["byte:1"]);
    expect(r.smartPlan).toBeNull();
  });
});
