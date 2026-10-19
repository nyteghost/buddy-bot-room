import { describe, expect, it } from "vitest";
import { clampBudget, trimTranscript, DEFAULT_CONTEXT_CHARS, MIN_CONTEXT_CHARS, MAX_CONTEXT_CHARS } from "@/lib/context-trim";
import { TtlCache } from "@/lib/ttl-cache";
import { gate, safeEqual, readCookie } from "@/lib/gate.server";
import { redact, describeError } from "@/lib/redact";
import { pushEntry, formatEntries, buildReport, MAX_ENTRIES, type LogEntry } from "@/lib/debug-log";
import { filterRows, renameChat, sortRows, togglePin, emptyMeta, displayTitle } from "@/lib/chat-meta";
import { deletePreset, makePreset, parsePresets, presetToEngine, savePreset, MAX_PRESETS } from "@/lib/presets";
import { matchShortcut } from "@/lib/shortcuts";
import { friendlyError } from "@/lib/friendly-error";
import { chunkText, docContext, isReadableDoc, retrieve, tokenize } from "@/lib/rag";
import { planAdd } from "@/lib/documents";
import { parseNotes, setNote } from "@/lib/agent-notes";
import { applyBackup, buildBackup, BACKUP_KEYS } from "@/lib/settings-io";
import { libraryMarkdown, shapeLibrary } from "@/lib/jellyfin";
import { validRow } from "@/lib/store.server";
import { logServer, serverLogText } from "@/lib/server-log.server";
import { parseSlash } from "@/lib/slash-commands";
import { isSlug, markWatched, nextTopic, shapeTrakt, shapeTraktLists, traktListsMarkdown, traktMarkdown, watchedMovieIds } from "@/lib/trakt";
import { traktConfig } from "@/lib/trakt.server";
import { plexMarkdown, shapePlex, watchTopic } from "@/lib/plex";
import { buildStatus, diagnoseTopic, eventText, FAILS_BEFORE_DOWN, initialWatch, nextWatch, problemsOf, shapeContainers, shapeDisks, shapeUptime, statusMarkdown } from "@/lib/unraid";
import { parseDice, rollDice, MAX_DICE } from "@/lib/dice";
import { addFact, addRoll, campaignContext, dmTask, emptyCampaign, endCampaign, isDmRole, parseCampaign, removeFact, setCharacter, startCampaign, statusText, MAX_FACTS, MAX_ROLLS } from "@/lib/campaign";

const engineBase = { kind: "ollama" as const, groqKey: "gsk_" + "a".repeat(30), geminiKey: "", openrouterKey: "", nvidiaKey: "", ollamaUrl: "http://x:11434/v1", ollamaModel: "qwen3:8b", replyLength: "short" as const };

describe("context trimming", () => {
  const msgs = (n: number, len: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "x".repeat(len) }));
  it("keeps everything when it fits", () => expect(trimTranscript(msgs(4, 100), 5000)).toEqual({ kept: msgs(4, 100), dropped: 0 }));
  it("drops the oldest first", () => {
    const r = trimTranscript(msgs(10, 1000), 3000);
    expect(r.dropped).toBe(8);
    expect(r.kept.length).toBe(2);
  });
  it("always keeps the newest message even if it is huge", () => {
    const r = trimTranscript(msgs(3, 50000), 2000);
    expect(r.kept.length).toBe(1);
    expect(r.dropped).toBe(2);
  });
  it("handles empty input", () => expect(trimTranscript([], 1000)).toEqual({ kept: [], dropped: 0 }));
  it("clamps the budget", () => {
    expect(clampBudget(undefined)).toBe(DEFAULT_CONTEXT_CHARS);
    expect(clampBudget(5)).toBe(MIN_CONTEXT_CHARS);
    expect(clampBudget(10 ** 9)).toBe(MAX_CONTEXT_CHARS);
    expect(clampBudget("big")).toBe(DEFAULT_CONTEXT_CHARS);
  });
});

describe("ttl cache", () => {
  it("expires entries", () => {
    const c = new TtlCache<number>(1000, 5);
    c.set("a", 1, 0);
    expect(c.get("a", 500)).toBe(1);
    expect(c.get("a", 1500)).toBe(undefined);
  });
  it("evicts the oldest past the cap", () => {
    const c = new TtlCache<number>(1000, 2);
    c.set("a", 1, 0); c.set("b", 2, 0); c.set("c", 3, 0);
    expect(c.get("a", 1)).toBe(undefined);
    expect(c.get("c", 1)).toBe(3);
    expect(c.size).toBe(2);
  });
});

describe("password gate", () => {
  const req = (path: string, init?: RequestInit & { cookie?: string }) => new Request(`http://box:8090${path}`, { ...init, headers: { ...(init?.cookie ? { cookie: init.cookie } : {}), ...(init?.headers as Record<string, string> | undefined) } });
  it("does nothing when no password is set", async () => {
    expect(await gate(req("/"), undefined)).toBe(null);
    expect(await gate(req("/"), "")).toBe(null);
  });
  it("shows a login page without the cookie and 401s API calls", async () => {
    const page = await gate(req("/"), "pw");
    expect(page?.status).toBe(401);
    expect(await page?.text()).toContain("<form");
    const api = await gate(req("/api/chat", { method: "POST" }), "pw");
    expect(api?.status).toBe(401);
  });
  it("rejects a wrong password and accepts the right one with a cookie", async () => {
    const bad = await gate(req("/__login", { method: "POST", body: new URLSearchParams({ password: "nope" }) }), "pw");
    expect(bad?.status).toBe(401);
    const good = await gate(req("/__login", { method: "POST", body: new URLSearchParams({ password: "pw" }) }), "pw");
    expect(good?.status).toBe(303);
    const cookie = good?.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("buddy_auth=");
    const value = cookie.split(";")[0] ?? "";
    expect(await gate(req("/", { cookie: value }), "pw")).toBe(null);
    expect((await gate(req("/", { cookie: "buddy_auth=wrong" }), "pw"))?.status).toBe(401);
  });
  it("never puts the password itself in the cookie", async () => {
    const good = await gate(req("/__login", { method: "POST", body: new URLSearchParams({ password: "hunter2hunter2" }) }), "hunter2hunter2");
    expect((good?.headers.get("set-cookie") ?? "").includes("hunter2")).toBe(false);
  });
  it("locks out after too many wrong tries from one address", async () => {
    let last = 0;
    for (let i = 0; i < 10; i++) {
      const r = await gate(req("/__login", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: new URLSearchParams({ password: "x" + i }) }), "pw");
      last = r?.status ?? 0;
    }
    expect(last).toBe(401);
    const locked = await gate(req("/__login", { method: "POST", headers: { "x-forwarded-for": "9.9.9.9" }, body: new URLSearchParams({ password: "pw" }) }), "pw");
    expect(await locked?.text()).toContain("Too many");
  });
  it("helpers", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(readCookie("a=1; buddy_auth=zzz; b=2", "buddy_auth")).toBe("zzz");
    expect(readCookie(null, "x")).toBe("");
  });
});

describe("redaction and logs", () => {
  it("hides keys, tokens and passwords", () => {
    const text = "key gsk_" + "A".repeat(30) + " and AIza" + "B".repeat(35) + " Bearer abcdefghijklmnop1234 password=hunter2hunter x-api-key: 1234567890abcdef";
    const out = redact(text);
    expect(out.includes("AAAAAAAAAA")).toBe(false);
    expect(out.includes("BBBBBBBBBB")).toBe(false);
    expect(out.includes("hunter2hunter")).toBe(false);
    expect(out.includes("1234567890abcdef")).toBe(false);
    expect(out).toContain("[hidden]");
  });
  it("keeps normal text", () => expect(redact("Can't reach SearXNG at http://10.200.1.5:8081")).toBe("Can't reach SearXNG at http://10.200.1.5:8081"));
  it("describes errors", () => {
    expect(describeError(new Error("boom"))).toContain("Error: boom");
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ a: 1 })).toBe('{"a":1}');
  });
  it("caps the ring buffer, newest last", () => {
    let list: LogEntry[] = [];
    for (let i = 0; i < MAX_ENTRIES + 25; i++) list = pushEntry(list, { t: String(i), level: "info", msg: "m" + i });
    expect(list.length).toBe(MAX_ENTRIES);
    expect(list[list.length - 1]?.msg).toBe("m" + (MAX_ENTRIES + 24));
  });
  it("formats and builds a redacted report", () => {
    expect(formatEntries([])).toContain("nothing logged");
    const report = buildReport({ app: "1.0.1 · abc", context: ["engine: cloud"], server: "SEERR_API_KEY: set", client: [{ t: "T", level: "error", msg: "failed with gsk_" + "Z".repeat(30) }] });
    expect(report).toContain("Pixel Pals debug report");
    expect(report).toContain("engine: cloud");
    expect(report.includes("ZZZZZZZZZZ")).toBe(false);
  });
  it("server log redacts and lists", () => {
    logServer("warn", "token=abcdefgh12345678 bad");
    const text = serverLogText();
    expect(text).toContain("WARN");
    expect(text.includes("abcdefgh12345678")).toBe(false);
  });
});

describe("saved chat pins, titles, search", () => {
  const rows = [
    { id: "a", title: "old chat", updatedAt: "2026-01-01", messages: [{ parts: [{ type: "text", text: "talking about unraid" }] }] },
    { id: "b", title: "new chat", updatedAt: "2026-03-01", messages: [{ parts: [{ type: "text", text: "plex setup" }] }] },
    { id: "c", title: "mid chat", updatedAt: "2026-02-01", messages: [{ parts: [] }] },
  ];
  it("sorts newest first, pinned on top", () => {
    expect(sortRows(rows, emptyMeta).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, togglePin(emptyMeta, "a")).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
  it("toggles pins off again", () => expect(togglePin(togglePin(emptyMeta, "a"), "a").pins).toEqual([]));
  it("renames and resets titles", () => {
    const m = renameChat(emptyMeta, "a", "  My   Unraid\nnotes ");
    expect(displayTitle(m, "a", "old chat")).toBe("My Unraid notes");
    expect(displayTitle(renameChat(m, "a", "   "), "a", "old chat")).toBe("old chat");
  });
  it("searches titles and message text, all words required", () => {
    expect(filterRows(rows, emptyMeta, "unraid").map((r) => r.id)).toEqual(["a"]);
    expect(filterRows(rows, emptyMeta, "PLEX chat").map((r) => r.id)).toEqual(["b"]);
    expect(filterRows(rows, emptyMeta, "plex unraid")).toEqual([]);
    expect(filterRows(rows, emptyMeta, "  ").length).toBe(3);
    expect(filterRows(rows, renameChat(emptyMeta, "c", "Zebra"), "zebra").map((r) => r.id)).toEqual(["c"]);
  });
});

describe("engine presets", () => {
  it("never stores keys", () => {
    const p = makePreset("  Deep   Ollama ", engineBase);
    expect(p?.name).toBe("Deep Ollama");
    expect(JSON.stringify(p).includes("gsk_")).toBe(false);
    expect(makePreset("   ", engineBase)).toBe(null);
  });
  it("replaces same-name presets and caps the list", () => {
    const p = makePreset("Fast", engineBase)!;
    expect(savePreset(savePreset([], p), { ...p, replyLength: "long" }).length).toBe(1);
    let list: ReturnType<typeof savePreset> = [];
    for (let i = 0; i < MAX_PRESETS + 4; i++) list = savePreset(list, { ...p, name: "p" + i });
    expect(list.length).toBe(MAX_PRESETS);
    expect(deletePreset(list, "p5").length).toBe(MAX_PRESETS - 1);
  });
  it("applies only engine fields", () => expect(Object.keys(presetToEngine(makePreset("x", engineBase)!)).sort()).toEqual(["kind", "ollamaModel", "ollamaUrl", "replyLength"]));
  it("ignores junk when loading", () => {
    expect(parsePresets("nope")).toEqual([]);
    expect(parsePresets([{ name: 1 }, { name: "ok", kind: "ollama", ollamaUrl: "u", ollamaModel: "m", replyLength: "short" }, { name: "bad", kind: "wat", ollamaUrl: "u", ollamaModel: "m", replyLength: "short" }]).length).toBe(1);
  });
});

describe("keyboard shortcuts", () => {
  const k = (key: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
  it("maps the combos", () => {
    expect(matchShortcut(k("k", { ctrlKey: true }), false, false)).toBe("palette");
    expect(matchShortcut(k("K", { metaKey: true }), false, false)).toBe("palette");
    expect(matchShortcut(k("O", { ctrlKey: true, shiftKey: true }), false, false)).toBe("newChat");
    expect(matchShortcut(k("/", { ctrlKey: true }), false, false)).toBe("focusComposer");
    expect(matchShortcut(k("b", { ctrlKey: true }), false, false)).toBe("toggleSidebar");
    expect(matchShortcut(k("L", { ctrlKey: true, shiftKey: true }), false, false)).toBe("debugLog");
  });
  it("Escape only stops a running discussion with no dialog open", () => {
    expect(matchShortcut(k("Escape"), true, false)).toBe("stop");
    expect(matchShortcut(k("Escape"), false, false)).toBe(null);
    expect(matchShortcut(k("Escape"), true, true)).toBe(null);
  });
  it("leaves plain typing and other combos alone", () => {
    expect(matchShortcut(k("k"), false, false)).toBe(null);
    expect(matchShortcut(k("c", { ctrlKey: true }), false, false)).toBe(null);
    expect(matchShortcut(k("k", { ctrlKey: true, altKey: true }), false, false)).toBe(null);
  });
});

describe("friendly errors", () => {
  const ollama = { engine: "ollama", ollamaUrl: "http://localhost:11434/v1", ollamaModel: "qwen3:8b" };
  it("explains an unreachable Ollama", () => expect(friendlyError("Failed to fetch", ollama)).toContain("OLLAMA_ORIGINS"));
  it("explains a bad key and rate limits", () => {
    expect(friendlyError("Incorrect API key provided", { engine: "cloud" })).toContain("rejected your API key");
    expect(friendlyError("429 Too Many Requests", { engine: "cloud" })).toContain("free-tier limit");
  });
  it("does not mistake a port number for a status code", () => expect(friendlyError("Can't reach http://10.0.0.4:4010", { engine: "cloud" })).toBe("Can't reach http://10.0.0.4:4010"));
  it("explains missing Ollama models", () => expect(friendlyError('model "qwen3:8b" not found', ollama)).toContain("ollama pull qwen3:8b"));
  it("falls back to the raw text, never empty", () => {
    expect(friendlyError("Weird thing", { engine: "cloud" })).toBe("Weird thing");
    expect(friendlyError("  ", { engine: "cloud" })).toContain("Debug log");
  });
});

describe("document chat", () => {
  const text = "Unraid is a NAS operating system.\n\nPlex streams media to your TV.\n\n" + "filler words here. ".repeat(80) + "\n\nThe projector in the East Lot needs a new lamp before the Friday show.";
  it("chunks on paragraphs and numbers them", () => {
    const chunks = chunkText("notes.md", text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.n).toBe(1);
    expect(chunks.every((c) => c.text.length <= 900 + 4)).toBe(true);
  });
  it("cuts a giant paragraph", () => expect(chunkText("a.txt", "z".repeat(5000)).length).toBe(6));
  it("retrieves the passage that matches the question", () => {
    const chunks = chunkText("notes.md", text);
    const top = retrieve(chunks, "which projector needs a lamp?");
    expect(top[0]?.text).toContain("East Lot");
  });
  it("returns nothing for stop-word or unmatched queries", () => {
    const chunks = chunkText("notes.md", text);
    expect(retrieve(chunks, "the of and")).toEqual([]);
    expect(retrieve(chunks, "zebra giraffe")).toEqual([]);
    expect(retrieve([], "anything")).toEqual([]);
  });
  it("labels context with file and section and respects the cap", () => {
    const chunks = chunkText("notes.md", text);
    const ctx = docContext(retrieve(chunks, "projector lamp"), 3600);
    expect(ctx).toContain("[notes.md §");
    expect(docContext(chunks, 100).length).toBeLessThan(101);
  });
  it("tokenizes without stop words", () => expect(tokenize("The Plex server is fast")).toEqual(["plex", "server", "fast"]));
  it("accepts only text-like files", () => {
    expect(isReadableDoc("a.md")).toBe(true);
    expect(isReadableDoc("a.PDF")).toBe(false);
    expect(isReadableDoc("a.exe")).toBe(false);
  });
  it("plans adds: type, empty, truncation, total cap, replace", () => {
    expect(planAdd([], "a.pdf", "x")).toMatchObject({ ok: false });
    expect(planAdd([], "a.txt", "   ")).toMatchObject({ ok: false });
    const big = planAdd([], "a.txt", "y".repeat(130000));
    expect(big).toMatchObject({ ok: true, truncated: true, chars: 120000 });
    const full = [{ name: "1.txt", text: "z".repeat(120000) }, { name: "2.txt", text: "z".repeat(120000) }, { name: "3.txt", text: "z".repeat(120000) }];
    expect(planAdd(full, "4.txt", "z".repeat(100000))).toMatchObject({ ok: false });
    const same = planAdd(full, "1.txt", "short");
    expect(same.ok && same.docs?.length).toBe(3);
  });
});

describe("pal instructions", () => {
  it("sets, trims and clears notes", () => {
    const n = setNote({}, "nova", "  keep   it short ");
    expect(n).toEqual({ nova: "keep it short" });
    expect(setNote(n, "nova", "")).toEqual({});
    expect(setNote({}, "nova", "x".repeat(900))["nova"]?.length).toBe(400);
  });
  it("parses junk safely", () => {
    expect(parseNotes(null)).toEqual({});
    expect(parseNotes([1, 2])).toEqual({});
    expect(parseNotes({ a: "ok", b: 5, c: "  " })).toEqual({ a: "ok" });
  });
});

describe("settings backup", () => {
  const store = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
  };
  const live = store({ "pixel-pals-engine-v1": JSON.stringify(engineBase), "pixel-pals-workbench-v1": '{"memories":[]}', "unrelated-key": "x" });
  it("exports only known keys and strips API keys by default", () => {
    const b = buildBackup(live, false);
    expect(Object.keys(b.data).sort()).toEqual(["pixel-pals-engine-v1", "pixel-pals-workbench-v1"]);
    expect(b.data["pixel-pals-engine-v1"]?.includes("gsk_")).toBe(false);
    expect(buildBackup(live, true).data["pixel-pals-engine-v1"]).toContain("gsk_");
  });
  it("round-trips, and a key-less backup keeps the keys already on the machine", () => {
    const backup = JSON.stringify(buildBackup(live, false));
    const target = store({ "pixel-pals-engine-v1": JSON.stringify({ ...engineBase, groqKey: "mine-123" }) });
    const r = applyBackup(target, backup);
    expect(r.ok).toBe(true);
    expect(JSON.parse(target.m.get("pixel-pals-engine-v1") ?? "{}").groqKey).toBe("mine-123");
    expect(target.m.get("pixel-pals-workbench-v1")).toBe('{"memories":[]}');
  });
  it("a backup with keys restores them", () => {
    const target = store({});
    applyBackup(target, JSON.stringify(buildBackup(live, true)));
    expect(JSON.parse(target.m.get("pixel-pals-engine-v1") ?? "{}").groqKey).toContain("gsk_");
  });
  it("rejects bad files and never writes unknown keys", () => {
    const t = store({});
    expect(applyBackup(t, "not json")).toMatchObject({ ok: false });
    expect(applyBackup(t, '{"app":"other"}')).toMatchObject({ ok: false });
    expect(applyBackup(t, JSON.stringify({ app: "pixel-pals", version: 99, exportedAt: "", includesKeys: false, data: {} }))).toMatchObject({ ok: false });
    const sneaky = applyBackup(t, JSON.stringify({ app: "pixel-pals", version: 1, exportedAt: "", includesKeys: false, data: { "evil-key": "{}", "pixel-pals-compare-v1": "{}", "pixel-pals-presets-v1": "not json" } }));
    expect(sneaky).toMatchObject({ ok: true });
    expect(t.m.has("evil-key")).toBe(false);
    expect(t.m.has("pixel-pals-presets-v1")).toBe(false);
    expect(t.m.has("pixel-pals-compare-v1")).toBe(true);
    expect(BACKUP_KEYS.length).toBeGreaterThan(5);
  });
});

describe("jellyfin", () => {
  const json = { Items: [{ Id: "1", Name: "Dune", ProductionYear: 2021, Type: "Movie", CommunityRating: 8.04, Overview: " Spice. " }, { Id: 2 }, { Id: "3", Name: "Severance", Type: "Series" }] };
  it("shapes results and skips junk", () => {
    const items = shapeLibrary(json);
    expect(items.length).toBe(2);
    expect(items[0]).toEqual({ id: "1", title: "Dune", year: 2021, kind: "Movie", rating: 8, overview: "Spice." });
    expect(shapeLibrary(null)).toEqual([]);
    expect(shapeLibrary({ Items: "x" })).toEqual([]);
  });
  it("writes markdown, with links only when a public URL is given", () => {
    const items = shapeLibrary(json);
    expect(libraryMarkdown("dune", items)).toContain("**Dune** (Movie · 2021 · ★ 8)");
    expect(libraryMarkdown("dune", items, "http://jf:8096/")).toContain("(http://jf:8096/web/index.html#!/details?id=1)");
    expect(libraryMarkdown("zzz", [])).toContain("@seerr zzz");
    expect(libraryMarkdown("recent", [])).toContain("Nothing in your library yet");
  });
  it("has a /library command", () => {
    expect(parseSlash("/library Dune")).toEqual({ ok: true, action: { type: "library", query: "Dune" } });
    expect(parseSlash("/library")).toEqual({ ok: true, action: { type: "library", query: "recent" } });
  });
});

describe("server chat store validation", () => {
  const row = { id: "12345678-aaaa", title: "t", messages: [], theme: "normal", mode: "roundtable", updatedAt: "2026-01-01" };
  it("accepts a good row", () => expect(validRow(row)).toBe(true));
  it("rejects path-like ids and wrong shapes", () => {
    expect(validRow({ ...row, id: "../../etc/passwd" })).toBe(false);
    expect(validRow({ ...row, id: "short" })).toBe(false);
    expect(validRow({ ...row, messages: "no" })).toBe(false);
    expect(validRow(null)).toBe(false);
  });
});

describe("dice", () => {
  const seq = (...n: number[]) => { let i = 0; return () => n[i++ % n.length] ?? 0; };
  it("parses common forms", () => {
    expect(parseDice("d20")).toEqual({ ok: true, count: 1, sides: 20, mod: 0, mode: "normal" });
    expect(parseDice("2d6+3")).toEqual({ ok: true, count: 2, sides: 6, mod: 3, mode: "normal" });
    expect(parseDice(" 4D8 - 1 ")).toEqual({ ok: true, count: 4, sides: 8, mod: -1, mode: "normal" });
    expect(parseDice("d20 adv")).toMatchObject({ ok: true, mode: "adv" });
    expect(parseDice("d20+5 disadvantage")).toMatchObject({ ok: true, mode: "dis", mod: 5 });
  });
  it("rejects nonsense and absurd sizes", () => {
    for (const bad of ["", "hello", "d", "2d", "0d6", "d1", "d1001", `${MAX_DICE + 1}d6`, "2d6 adv", "d20+", "-d6"]) expect(parseDice(bad)).toMatchObject({ ok: false });
  });
  it("rolls within range and adds the modifier", () => {
    const spec = parseDice("2d6+3");
    if (!spec.ok) throw new Error("parse");
    const r = rollDice(spec, seq(0, 0.999));
    expect(r.rolls).toEqual([1, 6]);
    expect(r.total).toBe(10);
    expect(r.text).toContain("**10**");
  });
  it("never rolls outside 1..sides, even for rng values at the edges", () => {
    const spec = parseDice("100d20");
    if (!spec.ok) throw new Error("parse");
    const r = rollDice(spec, seq(0, 0.9999999999, 0.5));
    expect(r.rolls.every((x) => x >= 1 && x <= 20)).toBe(true);
  });
  it("advantage keeps the high roll, disadvantage the low, and flags naturals", () => {
    const adv = parseDice("d20 adv"); const dis = parseDice("d20 dis");
    if (!adv.ok || !dis.ok) throw new Error("parse");
    const a = rollDice(adv, seq(0.1, 0.99));
    expect(a.rolls).toEqual([3, 20]);
    expect(a.kept).toEqual([20]);
    expect(a.nat20).toBe(true);
    const d = rollDice(dis, seq(0.99, 0));
    expect(d.kept).toEqual([1]);
    expect(d.nat1).toBe(true);
    expect(d.text).toContain("natural 1");
  });
  it("is roughly fair", () => {
    const spec = parseDice("d6");
    if (!spec.ok) throw new Error("parse");
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6000; i++) counts[rollDice(spec, Math.random).rolls[0]! - 1]!++;
    expect(counts.every((c) => c > 800 && c < 1200)).toBe(true);
  });
});

describe("campaign", () => {
  it("starts with a title from the premise", () => {
    const c = startCampaign("  a haunted lighthouse   on a stormy coast ");
    expect(c.active).toBe(true);
    expect(c.premise).toBe("a haunted lighthouse on a stormy coast");
    expect(startCampaign("x".repeat(100)).title.length).toBe(48);
  });
  it("keeps facts unique, capped and removable by number", () => {
    let c = startCampaign("p");
    c = addFact(addFact(c, "The keeper vanished"), "the KEEPER vanished");
    expect(c.facts.length).toBe(1);
    for (let i = 0; i < MAX_FACTS + 5; i++) c = addFact(c, "fact " + i);
    expect(c.facts.length).toBe(MAX_FACTS);
    expect(removeFact(c, 0)).toBe(c);
    expect(removeFact(c, 1).facts.length).toBe(MAX_FACTS - 1);
  });
  it("keeps only the latest rolls and strips bold marks", () => {
    let c = startCampaign("p");
    for (let i = 0; i < MAX_ROLLS + 3; i++) c = addRoll(c, `🎲 d20 = **${i}**`);
    expect(c.rolls.length).toBe(MAX_ROLLS);
    expect(c.rolls[MAX_ROLLS - 1]?.includes("**")).toBe(false);
  });
  it("builds prompt context only while active, and caps it", () => {
    expect(campaignContext(emptyCampaign)).toBe("");
    let c = setCharacter(startCampaign("a haunted lighthouse"), "a nervous halfling");
    c = addFact(c, "The keeper vanished");
    c = addRoll(c, "🎲 d20 → [14] = 14");
    const ctx = campaignContext(c);
    expect(ctx).toContain("haunted lighthouse");
    expect(ctx).toContain("nervous halfling");
    expect(ctx).toContain("keeper vanished");
    expect(ctx).toContain("= 14");
    expect(campaignContext(endCampaign(c))).toBe("");
    expect(campaignContext({ ...c, premise: "z".repeat(300), facts: Array.from({ length: 30 }, (_, i) => "f".repeat(190) + i) }, 500).length).toBeLessThan(501);
  });
  it("describes status", () => {
    expect(statusText(emptyCampaign)).toContain("/dm start");
    expect(statusText(startCampaign("p"))).toContain("in progress");
  });
  it("loads junk safely", () => {
    expect(parseCampaign(null)).toEqual(emptyCampaign);
    expect(parseCampaign({ active: "yes", facts: [1, "ok"], rolls: "no" })).toEqual({ ...emptyCampaign, facts: ["ok"] });
  });
  it("gives different instructions to the DM and the party", () => {
    expect(isDmRole("dm") && isDmRole("party") && !isDmRole("x")).toBe(true);
    expect(dmTask("dm")).toContain("Dungeon Master");
    expect(dmTask("dm")).toContain("never roll for the player");
    expect(dmTask("party")).toContain("companion");
    expect(dmTask("party")).toContain("Do not narrate outcomes");
  });
});

describe("dm and roll commands", () => {
  it("parses /roll", () => {
    expect(parseSlash("/roll 2d6+3")).toEqual({ ok: true, action: { type: "roll", expr: "2d6+3" } });
    expect(parseSlash("/roll")).toEqual({ ok: true, action: { type: "roll", expr: "d20" } });
    expect(parseSlash("/roll banana")).toMatchObject({ ok: false });
  });
  it("parses /dm subcommands with original case", () => {
    expect(parseSlash("/dm start A Haunted Lighthouse")).toEqual({ ok: true, action: { type: "dm", sub: "start", text: "A Haunted Lighthouse" } });
    expect(parseSlash("/dm end")).toEqual({ ok: true, action: { type: "dm", sub: "end", text: "" } });
    expect(parseSlash("/dm")).toEqual({ ok: true, action: { type: "dm", sub: "status", text: "" } });
    expect(parseSlash("/dm character Mira the Bold")).toEqual({ ok: true, action: { type: "dm", sub: "character", text: "Mira the Bold" } });
    expect(parseSlash("/dm forget 2")).toEqual({ ok: true, action: { type: "dm", sub: "unfact", text: "", n: 2 } });
  });
  it("rejects missing arguments", () => {
    for (const bad of ["/dm start", "/dm character", "/dm fact", "/dm forget", "/dm forget x", "/dm dance"]) expect(parseSlash(bad)).toMatchObject({ ok: false });
  });
});

describe("unraid shaping", () => {
  it("reads disks across parity, data and cache and ignores unnamed ones", () => {
    const r = shapeDisks({ array: { state: "STARTED", parities: [{ name: "parity", status: "DISK_OK", temp: 34 }], disks: [{ name: "disk1", status: "DISK_OK", temp: 0 }, { status: "DISK_OK" }], caches: [{ name: "cache", status: "DISK_DSBL", temp: 41 }] } });
    expect(r.state).toBe("STARTED");
    expect(r.disks).toEqual([{ name: "parity", status: "DISK_OK", tempC: 34 }, { name: "disk1", status: "DISK_OK" }, { name: "cache", status: "DISK_DSBL", tempC: 41 }]);
    expect(shapeDisks(null)).toEqual({ disks: [] });
  });
  it("reads containers from either API shape", () => {
    const a = shapeContainers({ dockerContainers: [{ names: ["/plex"], state: "RUNNING", autoStart: true }, { names: ["deluge"], state: "EXITED", autoStart: false }] });
    expect(a).toEqual([{ name: "plex", state: "running", autoStart: true }, { name: "deluge", state: "exited", autoStart: false }]);
    expect(shapeContainers({ docker: { containers: [{ names: ["/sonarr"], state: "paused" }] } })).toEqual([{ name: "sonarr", state: "paused" }]);
    expect(shapeContainers({})).toEqual([]);
  });
  it("reads uptime as seconds or a boot time, and ignores nonsense", () => {
    expect(shapeUptime({ info: { os: { uptime: 3600 } } })).toBe(3600);
    const boot = new Date(Date.now() - 7200_000).toISOString();
    expect(Math.abs((shapeUptime({ info: { os: { uptime: boot } } }) ?? 0) - 7200) < 5).toBe(true);
    expect(shapeUptime({ info: { os: { uptime: "soon" } } })).toBe(undefined);
    expect(shapeUptime(null)).toBe(undefined);
  });
});

describe("unraid problems", () => {
  it("is quiet when all is well", () => expect(problemsOf({ arrayState: "STARTED", disks: [{ name: "d1", status: "DISK_OK", tempC: 38 }, { name: "d2", status: "DISK_NP" }], containers: [{ name: "plex", state: "running", autoStart: true }, { name: "x", state: "exited", autoStart: false }] })).toEqual([]));
  it("flags a stopped array, bad disks, heat and dead auto-start containers", () => {
    const p = problemsOf({ arrayState: "STOPPED", disks: [{ name: "d1", status: "DISK_DSBL" }, { name: "d2", status: "DISK_OK", tempC: 52 }, { name: "d3", status: "DISK_OK", tempC: 63 }], containers: [{ name: "plex", state: "exited", autoStart: true }] });
    expect(p.length).toBe(5);
    expect(p.join(" ")).toContain("not started");
    expect(p.join(" ")).toContain("very hot");
    expect(p.join(" ")).toContain("running warm");
    expect(p.join(" ")).toContain("auto-start");
  });
  it("an unreachable server has no disk problems to report", () => expect(buildStatus({ now: 1, reachable: false }).problems).toEqual([]));
  it("writes readable summaries", () => {
    expect(statusMarkdown(buildStatus({ now: 1, reachable: false }))).toContain("unreachable");
    const ok = buildStatus({ now: 1, reachable: true, apiOk: true, disks: { state: "STARTED", disks: [{ name: "d1", status: "DISK_OK", tempC: 30 }] }, containers: [{ name: "a", state: "running" }], uptimeSeconds: 90000 });
    expect(statusMarkdown(ok)).toContain("healthy");
    expect(statusMarkdown(ok)).toContain("1/1 containers running");
    expect(statusMarkdown(ok)).toContain("up 1d 1h");
    expect(statusMarkdown(buildStatus({ now: 1, reachable: true, apiOk: false }))).toContain("rejected the key");
    expect(diagnoseTopic(buildStatus({ now: 1, reachable: false }))).toContain("NOT reachable");
  });
});

describe("unraid watcher state machine", () => {
  const up = (t: number, problems: string[] = []) => ({ ...buildStatus({ now: t, reachable: true }), problems });
  const down = (t: number) => buildStatus({ now: t, reachable: false });
  it("needs two failed checks before saying down, then alerts once", () => {
    expect(FAILS_BEFORE_DOWN).toBe(2);
    let r = nextWatch(initialWatch, up(0));
    expect(r.events).toEqual([]);
    r = nextWatch(r.state, down(60_000));
    expect(r.events).toEqual([]);
    expect(r.state.phase).toBe("up");
    r = nextWatch(r.state, down(120_000));
    expect(r.events).toEqual([{ type: "down", since: 120_000 }]);
    r = nextWatch(r.state, down(180_000));
    expect(r.events).toEqual([]);
    expect(r.state.downSince).toBe(120_000);
  });
  it("a single blip does not alert and resets the count", () => {
    let r = nextWatch(initialWatch, up(0));
    r = nextWatch(r.state, down(1));
    r = nextWatch(r.state, up(2));
    expect(r.events).toEqual([]);
    expect(r.state.fails).toBe(0);
    r = nextWatch(r.state, down(3));
    expect(r.events).toEqual([]);
  });
  it("says back with how long it was down", () => {
    let r = nextWatch(initialWatch, down(0));
    r = nextWatch(r.state, down(60_000));
    r = nextWatch(r.state, up(360_000));
    expect(r.events).toEqual([{ type: "up", downFor: 300 }]);
    expect(r.state.phase).toBe("up");
  });
  it("alerts on new problems once, and when they clear", () => {
    let r = nextWatch(initialWatch, up(0, ["Disk d1 reports DISK_DSBL."]));
    expect(r.events).toEqual([{ type: "problems", problems: ["Disk d1 reports DISK_DSBL."] }]);
    r = nextWatch(r.state, up(60, ["Disk d1 reports DISK_DSBL."]));
    expect(r.events).toEqual([]);
    r = nextWatch(r.state, up(120, ["Disk d1 reports DISK_DSBL.", "Disk d2 is very hot (61°C)."]));
    expect(r.events.length).toBe(1);
    r = nextWatch(r.state, up(180));
    expect(r.events).toEqual([{ type: "cleared" }]);
  });
  it("describes events for notifications", () => {
    expect(eventText({ type: "down", since: 0 }).priority).toBe("urgent");
    expect(eventText({ type: "up", downFor: 300 }).body).toContain("5m");
    expect(eventText({ type: "problems", problems: ["a", "b"] }).body).toBe("a b");
  });
  it("has /server and /diagnose commands", () => {
    expect(parseSlash("/server")).toEqual({ ok: true, action: { type: "server" } });
    expect(parseSlash("/diagnose")).toEqual({ ok: true, action: { type: "diagnose" } });
    expect(parseSlash("/whatswrong")).toEqual({ ok: true, action: { type: "diagnose" } });
  });
});

describe("plex", () => {
  const recent = { MediaContainer: { Metadata: [
    { type: "movie", title: "Dune", year: 2021, audienceRating: 8.04, summary: "  Spice.  ", Genre: [{ tag: "Sci-Fi" }, { tag: "Adventure" }] },
    { type: "episode", title: "Pilot", grandparentTitle: "Severance", year: 2022 },
    { type: "episode", title: "Half Loop", grandparentTitle: "Severance" },
    { type: "season", title: "Season 2", parentTitle: "Andor" },
    { type: "show", title: "Ted Lasso", year: 2020, rating: 8.6 },
    { type: "album", title: "Some Album" },
    { type: "movie" },
  ] } };
  it("shapes recently added: episodes and seasons become their show, duplicates merge, other types are skipped", () => {
    const items = shapePlex(recent);
    expect(items.map((i) => i.title)).toEqual(["Dune", "Severance", "Andor", "Ted Lasso"]);
    expect(items[0]).toEqual({ title: "Dune", kind: "movie", year: 2021, rating: 8, genres: ["Sci-Fi", "Adventure"], summary: "Spice." });
    expect(items[1]?.kind).toBe("show");
    expect(items[1]?.year).toBe(undefined);
  });
  it("shapes grouped search results", () => {
    const search = { MediaContainer: { Hub: [{ type: "movie", Metadata: [{ type: "movie", title: "Dune", year: 2021 }] }, { type: "show", Metadata: [{ type: "show", title: "Dune: Prophecy", year: 2024 }] }, { type: "actor", Metadata: [{ type: "person", title: "Zendaya" }] }] } };
    expect(shapePlex(search).map((i) => i.title)).toEqual(["Dune", "Dune: Prophecy"]);
  });
  it("copes with junk and honours the limit", () => {
    expect(shapePlex(null)).toEqual([]);
    expect(shapePlex({ MediaContainer: {} })).toEqual([]);
    expect(shapePlex(recent, 2).length).toBe(2);
  });
  it("writes markdown and a watch topic", () => {
    const items = shapePlex(recent);
    expect(plexMarkdown("dune", items)).toContain("**Dune** (Movie · 2021 · ★ 8 · Sci-Fi/Adventure)");
    expect(plexMarkdown("zzz", [])).toContain("@seerr zzz");
    const topic = watchTopic("something cozy", items);
    expect(topic).toContain("something cozy");
    expect(topic).toContain("Only suggest titles from the list");
    expect(topic).toContain("- Ted Lasso (2020) — show");
    expect(watchTopic("", items)).toContain("haven't decided");
    const short = watchTopic("", items, 60);
    expect(short).toContain("- Dune");
    expect(short.includes("Ted Lasso")).toBe(false);
  });
  it("has /plex and /watch commands", () => {
    expect(parseSlash("/plex Dune")).toEqual({ ok: true, action: { type: "plex", query: "Dune" } });
    expect(parseSlash("/plex")).toEqual({ ok: true, action: { type: "plex", query: "recent" } });
    expect(parseSlash("/watch cozy comedy")).toEqual({ ok: true, action: { type: "watch", mood: "cozy comedy" } });
    expect(parseSlash("/watch")).toEqual({ ok: true, action: { type: "watch", mood: "" } });
  });
});

describe("trakt", () => {
  const list = [
    { rank: 1, type: "movie", movie: { title: "Dune", year: 2021, ids: { trakt: 11 } } },
    { rank: 2, type: "show", show: { title: "Severance", year: 2022, ids: { trakt: 22 } } },
    { rank: 3, type: "season", season: { number: 1 } },
    { rank: 4, type: "movie", movie: { title: "Dune", year: 2021, ids: { trakt: 11 } } },
    { rank: 5, type: "movie", movie: { title: "Heat", year: 1995, ids: { trakt: 33 } } },
  ];
  it("shapes list items, skipping seasons and duplicates", () => {
    expect(shapeTrakt(list).map((i) => i.title)).toEqual(["Dune", "Severance", "Heat"]);
    expect(shapeTrakt(null)).toEqual([]);
    expect(shapeTrakt(list, 1).length).toBe(1);
  });
  it("marks watched movies only", () => {
    const seen = watchedMovieIds([{ movie: { ids: { trakt: 11 } } }, { movie: { ids: {} } }]);
    const items = markWatched(shapeTrakt(list), seen);
    expect(items.map((i) => !!i.watched)).toEqual([true, false, false]);
  });
  it("shapes lists and rejects bad slugs", () => {
    expect(shapeTraktLists([{ name: "Movie Night", item_count: 4, ids: { slug: "movie-night" } }, { name: "x", ids: { slug: "../etc" } }])).toEqual([{ name: "Movie Night", slug: "movie-night", count: 4 }]);
    expect(isSlug("movie-night_2")).toBe(true);
    expect(isSlug("a/b")).toBe(false);
    expect(isSlug("")).toBe(false);
  });
  it("writes markdown and the pals topic, leaving watched out", () => {
    const items = markWatched(shapeTrakt(list), new Set([11]));
    expect(traktMarkdown("watchlist", items)).toContain("1. **Dune** (2021) · Movie · ✓ watched");
    expect(traktMarkdown("watchlist", items)).toContain("2 unwatched");
    const topic = nextTopic("cozy", "watchlist", items);
    expect(topic).toContain("Severance (2022)");
    expect(topic).not.toContain("- Dune");
    expect(topic).toContain("cozy");
    expect(traktListsMarkdown([])).toContain("TRAKT_ACCESS_TOKEN");
  });
  it("reads its config from the environment", () => {
    expect(traktConfig({})).toBeNull();
    expect(traktConfig({ TRAKT_CLIENT_ID: "abc" })).toBeNull();
    expect(traktConfig({ TRAKT_CLIENT_ID: "abc", TRAKT_USER: "@nyte" })).toEqual({ clientId: "abc", user: "nyte", list: "watchlist", token: "" });
    expect(traktConfig({ TRAKT_CLIENT_ID: "abc", TRAKT_USER: "nyte", TRAKT_LIST: "bad/list" })?.list).toBe("watchlist");
  });
  it("has /trakt and /next commands", () => {
    expect(parseSlash("/trakt lists")).toEqual({ ok: true, action: { type: "trakt", list: "lists" } });
    expect(parseSlash("/next")).toEqual({ ok: true, action: { type: "next", list: "", mood: "" } });
    expect(parseSlash("/next cozy comedy")).toEqual({ ok: true, action: { type: "next", list: "", mood: "cozy comedy" } });
    expect(parseSlash("/next list:movie-night something short")).toEqual({ ok: true, action: { type: "next", list: "movie-night", mood: "something short" } });
  });
});
