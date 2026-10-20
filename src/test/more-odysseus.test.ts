import { describe, expect, it } from "vitest";
import { parseSlash, slashSuggestions } from "@/lib/slash-commands";
import { addEntry, addTodo, clearDone, listText, promptContext, removeAt, toggleTodo, emptyWorkbench, MAX_TEXT } from "@/lib/workbench";
import { BLIND_LABELS, buildContestants, leaderboard, recordVote, shuffled } from "@/lib/compare";
import { hitsMarkdown, researchTopic, shapeResults } from "@/lib/search";
import { parseSeerr, shapeSeerr, statusOf } from "@/lib/seerr";
import { palEngineLabel, type EngineSettings } from "@/lib/engine";

describe("new slash commands", () => {
  it("keeps the original case of text arguments", () => {
    expect(parseSlash("/remember I run Unraid")).toEqual({ ok: true, action: { type: "remember", text: "I run Unraid" } });
    expect(parseSlash("/note Call the Venue")).toEqual({ ok: true, action: { type: "note", text: "Call the Venue" } });
    expect(parseSlash("/search Best 4K projector")).toEqual({ ok: true, action: { type: "search", query: "Best 4K projector" } });
  });
  it("parses numbers and keywords", () => {
    expect(parseSlash("/forget 2")).toEqual({ ok: true, action: { type: "forget", target: 2 } });
    expect(parseSlash("/forget all")).toEqual({ ok: true, action: { type: "forget", target: "all" } });
    expect(parseSlash("/done 3")).toEqual({ ok: true, action: { type: "done", n: 3 } });
    expect(parseSlash("/todo clear")).toEqual({ ok: true, action: { type: "clearDone" } });
    expect(parseSlash("/todos")).toEqual({ ok: true, action: { type: "tasks" } });
    expect(parseSlash("/compare")).toEqual({ ok: true, action: { type: "compare", question: "" } });
  });
  it("rejects missing or bad arguments", () => {
    for (const bad of ["/remember", "/forget", "/forget 0", "/forget x", "/done", "/note", "/todo", "/search", "/research"])
      expect(parseSlash(bad)).toMatchObject({ ok: false });
  });
  it("suggests the new commands", () => {
    expect(slashSuggestions("/rem").map((s) => s.insert)).toEqual(["/remember ", "/remind "]);
    expect(slashSuggestions("/sea").map((s) => s.insert)).toEqual(["/search "]);
  });
});

describe("workbench", () => {
  it("adds, dedupes and trims", () => {
    let list = addEntry([], "  I run   Unraid ");
    expect(list.map((e) => e.text)).toEqual(["I run Unraid"]);
    list = addEntry(list, "i run unraid");
    expect(list.length).toBe(1);
    expect(addEntry(list, "   ")).toBe(list);
    expect(addEntry([], "x".repeat(1000))[0]?.text.length).toBe(MAX_TEXT);
  });
  it("removes and toggles by 1-based number, ignoring bad numbers", () => {
    const todos = addTodo(addTodo([], "a"), "b");
    expect(removeAt(todos, 1).map((t) => t.text)).toEqual(["b"]);
    expect(removeAt(todos, 3)).toBe(todos);
    expect(removeAt(todos, 0)).toBe(todos);
    const toggled = toggleTodo(todos, 2);
    expect(toggled.map((t) => t.done)).toEqual([false, true]);
    expect(clearDone(toggled).map((t) => t.text)).toEqual(["a"]);
  });
  it("builds prompt context from memories and open to-dos only", () => {
    const w = {
      ...emptyWorkbench,
      memories: addEntry([], "Has a 3080"),
      notes: addEntry([], "private note"),
      todos: toggleTodo(addTodo(addTodo([], "order cable"), "done thing"), 2),
    };
    const text = promptContext(w);
    expect(text).toContain("Has a 3080");
    expect(text).toContain("order cable");
    expect(text.includes("done thing")).toBe(false);
    expect(text.includes("private note")).toBe(false);
    expect(promptContext(emptyWorkbench)).toBe("");
    expect(promptContext(w, 20).length).toBeLessThan(21);
  });
  it("numbers lists", () => {
    expect(listText("T", [{ text: "a" }, { text: "b", done: true }], "none")).toBe("T\n1. a\n2. ~~b~~ ✓");
    expect(listText("T", [], "none")).toBe("none");
  });
});

describe("compare", () => {
  it("lists providers, every Ollama model once, and WebGPU", () => {
    const list = buildContestants({ providers: ["groq"], ollamaModels: ["a", "b", "a"], webgpu: true });
    expect(list.map((c) => c.id)).toEqual(["groq", "ollama:a", "ollama:b", "webgpu"]);
  });
  it("shuffles without losing items, deterministically for a given rand", () => {
    const seq = [0.9, 0.1, 0.5];
    let i = 0;
    const out = shuffled([1, 2, 3, 4], () => seq[i++ % 3] ?? 0);
    expect([...out].sort()).toEqual([1, 2, 3, 4]);
    expect(shuffled([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
  });
  it("scores votes and ties", () => {
    let s = recordVote({}, "a", ["a", "b"]);
    s = recordVote(s, "b", ["a", "b"]);
    s = recordVote(s, "a", ["a", "b"]);
    s = recordVote(s, null, ["a", "b"]);
    expect(s).toEqual({ a: { wins: 2, games: 4 }, b: { wins: 1, games: 4 } });
    expect(leaderboard(s).map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("has a label for every contestant slot", () => expect(BLIND_LABELS.length).toBe(3));
});

describe("search helpers", () => {
  const data = {
    results: [
      { title: "Good", url: "https://example.com/a", content: "A  snippet\nwith space" },
      { title: "Bad scheme", url: "javascript:alert(1)", content: "x" },
      { url: "http://example.org/b" },
    ],
  };
  it("keeps only http(s) links and tidies text", () => {
    const hits = shapeResults(data);
    expect(hits.map((h) => h.url)).toEqual(["https://example.com/a", "http://example.org/b"]);
    expect(hits[0]?.snippet).toBe("A snippet with space");
    expect(hits[1]?.title).toBe("http://example.org/b");
  });
  it("copes with junk", () => {
    expect(shapeResults(null)).toEqual([]);
    expect(shapeResults({ results: "no" })).toEqual([]);
  });
  it("formats results and research topics", () => {
    const hits = shapeResults(data);
    expect(hitsMarkdown("q", hits)).toContain("[Good](https://example.com/a)");
    expect(hitsMarkdown("q", [])).toContain("No results");
    expect(researchTopic("q", hits)).toContain("[1] Good");
  });
});

describe("seerr", () => {
  it("parses titles and resolution", () => {
    expect(parseSeerr("@seerr Dune Part Two 4k")).toEqual({ title: "Dune Part Two", is4k: true });
    expect(parseSeerr("@Seerr the bear 1080p")).toEqual({ title: "the bear", is4k: false });
    expect(parseSeerr("@seerr UHD alien")).toEqual({ title: "alien", is4k: true });
    expect(parseSeerr("@seerr")).toEqual({ title: "", is4k: false });
    expect(parseSeerr("hello @seerr")).toBeNull();
    expect(parseSeerr("@seerrfoo bar")).toBeNull();
  });
  it("maps media status", () => {
    expect(statusOf(5)).toBe("available");
    expect(statusOf(3)).toBe("requested");
    expect(statusOf(undefined)).toBe("none");
  });
  it("shapes results and skips people", () => {
    const out = shapeSeerr({
      results: [
        { id: 1, mediaType: "movie", title: "Dune", releaseDate: "2021-10-22", mediaInfo: { status: 5 } },
        { id: 2, mediaType: "person", name: "Someone" },
        { id: 3, mediaType: "tv", name: "The Bear", firstAirDate: "2022-06-23", mediaInfo: { status4k: 2 } },
        { id: "x", mediaType: "movie", title: "Bad id" },
      ],
    });
    expect(out.map((r) => r.title)).toEqual(["Dune", "The Bear"]);
    expect(out[0]).toMatchObject({ year: "2021", status: "available", status4k: "none" });
    expect(out[1]).toMatchObject({ mediaType: "tv", status4k: "requested" });
  });
});

describe("which AI each pal uses", () => {
  const base = { kind: "auto", groqKey: "", geminiKey: "", openrouterKey: "", nvidiaKey: "", anthropicKey: "", claudeMode: "off", customMode: "off", customBaseUrl: "", customModel: "", ollamaModel: "qwen2.5:7b" } as unknown as EngineSettings;
  it("rotates pals across the keys that are set", () => {
    const s = { ...base, groqKey: "g", geminiKey: "k" } as EngineSettings;
    expect(palEngineLabel(s, 0)).toBe("Groq · gpt-oss-120b");
    expect(palEngineLabel(s, 1)).toBe("Gemini · gemini-2.5-flash");
    expect(palEngineLabel(s, 2)).toBe("Groq · gpt-oss-120b");
  });
  it("describes the other engines", () => {
    expect(palEngineLabel({ ...base, kind: "local" } as EngineSettings, 0)).toBe("In-browser model");
    expect(palEngineLabel({ ...base, kind: "ollama" } as EngineSettings, 3)).toBe("Ollama · qwen2.5:7b");
    expect(palEngineLabel({ ...base, kind: "local-server" } as EngineSettings, 3)).toBe("Ollama on your server");
    expect(palEngineLabel({ ...base, kind: "auto-ollama" } as EngineSettings, 0)).toBe("Ollama");
    expect(palEngineLabel(base, 0)).toBe("In-browser model");
  });
});
