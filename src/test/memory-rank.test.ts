import { describe, expect, it } from "vitest";
import { condenseOld, consolidate, explainPick, overlap, pickMemories, rankMemories, visibleMemories } from "@/lib/memory-rank";
import { addEntry, addPalMemory, addProjectMemory, addTodo, editEntry, emptyWorkbench, MAX_ITEMS, promptContext, promptContextFor, togglePin, type Entry, type Workbench } from "@/lib/workbench";

const NOW = Date.UTC(2026, 9, 28);
const e = (id: string, text: string, daysAgo = 0, extra: Partial<Entry> = {}): Entry => ({ id, text, at: NOW - daysAgo * 86_400_000, ...extra });
const wb = (memories: Entry[], more: Partial<Workbench> = {}): Workbench => ({ ...emptyWorkbench, memories, ...more });

describe("what goes into a prompt", () => {
  it("sends everything, in stored order, when it all fits (same as before)", () => {
    const w = wb([e("1", "Runs Unraid on a 3080"), e("2", "Prefers short answers")], { pal: { byte: [e("3", "Uses Arch btw")] }, todos: [{ ...e("t", "Fix plex"), done: false }] });
    const p = pickMemories(w, "anything", { pal: "byte", now: NOW });
    expect(p.ranked).toBe(false);
    expect(p.used).toHaveLength(3);
    expect(promptContextFor(w, "anything", { pal: "byte" })).toBe(promptContext(w, 1500, "byte"));
  });
  it("keeps the relevant memories when there are more than fit, and says why", () => {
    const filler = Array.from({ length: 30 }, (_, i) => e(`f${i}`, `Unrelated fact number ${i} about gardening and tomatoes in the backyard`, 5));
    const w = wb([...filler, e("d", "Docker compose files live in /mnt/user/appdata/stacks", 40)]);
    const p = pickMemories(w, "my docker container will not start", { maxChars: 300, now: NOW });
    expect(p.ranked).toBe(true);
    expect(p.used.map((s) => s.entry.id)).toContain("d");
    expect(p.used.find((s) => s.entry.id === "d")?.reasons.join()).toContain("matches: docker");
    expect(p.text.length).toBeLessThanOrEqual(300 + 80);
    expect(explainPick(p).join("\n")).toMatch(/left out/);
  });
  it("never drops a pinned memory to make room", () => {
    const w = wb([e("pin", "Never restart the array without asking", 400, { pinned: true }), ...Array.from({ length: 20 }, (_, i) => e(`x${i}`, `Docker note ${i} about containers and compose`, 1))]);
    expect(pickMemories(w, "docker containers", { maxChars: 200, now: NOW }).used.map((s) => s.entry.id)).toContain("pin");
  });
  it("prefers the newest memories when nothing matches (instead of cutting off the end)", () => {
    const w = wb([e("old", "Old fact about printers and ink cartridges", 300), ...Array.from({ length: 10 }, (_, i) => e(`m${i}`, `Middle fact ${i} about printers and ink cartridges`, 100)), e("new", "Newest fact about printers and ink cartridges", 0)]);
    const p = pickMemories(w, "zebra", { maxChars: 120, now: NOW });
    expect(p.used.map((s) => s.entry.id)).toContain("new");
    expect(p.used.map((s) => s.entry.id)).not.toContain("old");
  });
  it("lets a meaning score lift a memory with no shared words", () => {
    const w = wb([e("a", "Storage pool uses ZFS mirrors", 10), e("b", "Likes jazz", 10), e("c", "Owns two cats", 10)]);
    const boosted = rankMemories(w, "which filesystem", { now: NOW, boost: new Map([["a", 0.9]]) });
    expect(boosted.sort((x, y) => y.score - x.score)[0]?.entry.id).toBe("a");
    expect(boosted.find((s) => s.entry.id === "a")?.reasons).toContain("related to your question");
  });
  it("is deterministic", () => {
    const w = wb(Array.from({ length: 12 }, (_, i) => e(`m${i}`, `Fact ${i} about servers`, i)));
    expect(pickMemories(w, "servers", { maxChars: 150, now: NOW }).text).toBe(pickMemories(w, "servers", { maxChars: 150, now: NOW }).text);
  });
});

describe("who can see what", () => {
  const w = wb([e("s", "shared fact")], { pal: { byte: [e("b", "byte secret")], sage: [e("g", "sage secret")] }, project: { Homelab: [e("p", "project fact")], Other: [e("o", "other project fact")] } });
  it("shows a pal only shared + its own + the active project's", () => {
    const ids = (o: { pal?: string; project?: string }) => visibleMemories(w, o).map((v) => v.entry.id).sort();
    expect(ids({})).toEqual(["s"]);
    expect(ids({ pal: "byte" })).toEqual(["b", "s"]);
    expect(ids({ pal: "byte", project: "Homelab" })).toEqual(["b", "p", "s"]);
    expect(pickMemories(w, "secret", { pal: "byte", now: NOW }).text).not.toContain("sage secret");
    expect(pickMemories(w, "project", { project: "Homelab", now: NOW }).text).not.toContain("other project");
  });
  it("puts project memories under their own heading", () => {
    expect(pickMemories(w, "x", { project: "Homelab", now: NOW }).text).toContain('Remembered for the project "Homelab":');
  });
});

describe("keeping the list tidy", () => {
  it("treats a reworded fact as the same memory and refreshes it", () => {
    const first = addEntry([], "I run Unraid on an RTX 3080 box", NOW - 1000);
    const again = addEntry(first, "I run Unraid on an RTX 3080 box now", NOW);
    expect(again).toHaveLength(1);
    expect(again[0]?.at).toBe(NOW);
    expect(addEntry(first, "My cat is diabetic")).toHaveLength(2);
    expect(overlap("a b c d", "e f g h")).toBe(0);
  });
  it("drops the oldest unpinned memory when full, never a pinned one", () => {
    let list: Entry[] = [e("keep", "pinned one", 0, { pinned: true })];
    for (let i = 0; i < MAX_ITEMS + 5; i++) list = addEntry(list, `unique topic ${"abcdefghijklmnopqrstuvwxyz"[i % 26]}${i} zz${i}`, NOW + i);
    expect(list).toHaveLength(MAX_ITEMS);
    expect(list.some((m) => m.id === "keep")).toBe(true);
  });
  it("edits wording in place and toggles pinning", () => {
    const list = [e("1", "old wording"), e("2", "other")];
    expect(editEntry(list, "1", "  new   wording ", NOW)[0]).toMatchObject({ id: "1", text: "new wording" });
    expect(editEntry(list, "1", "   ")).toBe(list);
    const pinned = togglePin(list, "2");
    expect(pinned[1]?.pinned).toBe(true);
    expect(togglePin(pinned, "2")[1]?.pinned).toBeUndefined();
  });
  it("consolidates near-duplicates keeping the newest, and keeps pinned entries", () => {
    const list = [e("a", "Plex runs on the Unraid server", 30), e("b", "Plex runs on the Unraid server box", 1), e("c", "Cat takes insulin", 5), e("d", "Plex runs on the Unraid server machine", 100, { pinned: true })];
    const r = consolidate(list);
    expect(r.list.map((m) => m.id).sort()).toEqual(["b", "c", "d"]);
    expect(r.merged).toBe(1);
  });
  it("condenses the oldest unpinned memories into one labelled line without inventing anything", () => {
    const list = [...Array.from({ length: 10 }, (_, i) => e(`m${i}`, `Memory number ${i} with some words`, 100 - i)), e("p", "pinned", 500, { pinned: true })];
    const r = condenseOld(list, 6, NOW);
    expect(r.folded).toBeGreaterThan(0);
    expect(r.list.length).toBeLessThan(list.length);
    expect(r.list.find((m) => m.digest)?.text).toMatch(/^Older \(\d+\): Memory number 0/);
    expect(r.list.some((m) => m.id === "p")).toBe(true);
    expect(condenseOld(list.slice(0, 3), 6).folded).toBe(0);
  });
  it("project memories add to the right project and ignore blank names", () => {
    const w = addProjectMemory(addProjectMemory(emptyWorkbench, "Homelab", "Uses Tailscale"), "  ", "ignored");
    expect(Object.keys(w.project ?? {})).toEqual(["Homelab"]);
    expect(addTodo([], "x")).toHaveLength(1);
    expect(addPalMemory(emptyWorkbench, "byte", "x").pal?.["byte"]).toHaveLength(1);
  });
});
