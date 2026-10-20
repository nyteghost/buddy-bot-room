import { describe, expect, it } from "vitest";
import { cosine, candidateChunks, rerank } from "@/lib/embed-rerank";
import { wantsWeb, webContext } from "@/lib/web-context";
import { bestMatch, parseWrite, pollSeconds, syncBody } from "@/lib/trakt-write";
import { agents, agentPersona, agentName, resolveMention } from "@/lib/agents";
import { eventsText, mailText, parseM365, shapeEvents, shapeMail, summaryPrompt } from "@/lib/m365";
import { appearanceFromWords, formatAppearance, parseAppearance, resolveScheme } from "@/lib/appearance";
import { eventsInRange } from "@/lib/ics";
import { decodeMimeWords, imapQuote, parseFetchHeaders, parseSearch, senderName } from "@/lib/imap";
import { servicesReport } from "@/lib/status";
import { addSchedule, parseScheduleArgs, parseSchedules, removeSchedule, scheduleDue, scheduleList, MAX_SCHEDULES } from "@/lib/schedules";
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
import { cleanKey, detectProvider, keyCount } from "@/lib/key-providers";
import { notesSyncUrl, shareSheetUrl, bearerHeader, isSecure, notesSteps, shareSteps } from "@/lib/iphone-setup";
import { parseNvidiaSmi, modelBudgetGb, describeHardware } from "@/lib/hardware";
import { describeBench, CATALOG, fitFor, needGb, pickModel, pickTask, recommend, isModelName, bestInstalled, parseAutoMarker, taskOfInstalled } from "@/lib/model-catalog";
import { parseLibraryPage, parsePulls, sizeToGb, feedToCatalog, newSuggestions } from "@/lib/model-feed";
import { parseProviderReadme, keyPageFor, isSupported } from "@/lib/provider-feed";
import { validateCustomUrl, isCustomModel, CUSTOM_PRESETS } from "@/lib/custom-provider";
import { estimateTokens, costUsd, summarize, overCap, trim, monthKey, fmtUsd } from "@/lib/usage";
import { chainAfter, fallbackProviders, customProvider, providerForTurn, turnProviders, claudeProvider } from "@/lib/engine";
import { parseNotes, setNote } from "@/lib/agent-notes";
import { applyBackup, buildBackup, BACKUP_KEYS } from "@/lib/settings-io";
import { libraryMarkdown, shapeLibrary } from "@/lib/jellyfin";
import { validRow } from "@/lib/store.server";
import { logServer, serverLogText } from "@/lib/server-log.server";
import { parseSlash } from "@/lib/slash-commands";
import { accountFileName, normalizeAccountData } from "@/lib/local-account";
import { SYNC_KEYS, validSyncData } from "@/lib/settings-io";
import { buildPool, buildReport as noteReport, counts, decide, missingFromNote, needsSearch, norm, parseNote, searchKey, shapeHistory, shapeSearch } from "@/lib/notes-sync";
import { capPerOwner, visibleTo } from "@/lib/store.server";
import { accountsEnabled, checkPassword, checkUsername, hashPassword, hashToken, newToken, readSession, signSession, verifyPassword } from "@/lib/accounts";
import { chunkSpeech, pickVoice, speechText, voiceProfile } from "@/lib/tts";
import { sharedText } from "@/lib/share-prefill";
import { PUBLIC_FILES } from "@/lib/gate.server";
import { buildBrief, dailyPicks, unraidLine } from "@/lib/brief";
import { ageText, isDue, parseHm, validZone, zonedParts } from "@/lib/schedule";
import { backupName, insideData, isBackupName, pruneList } from "@/lib/backup";
import { plexHas } from "@/lib/trakt";
import { isSlug, markWatched, nextTopic, shapeTrakt, shapeTraktLists, traktListsMarkdown, traktMarkdown, watchedMovieIds } from "@/lib/trakt";
import { traktConfig } from "@/lib/trakt.server";
import { plexMarkdown, shapePlex, watchTopic } from "@/lib/plex";
import { buildStatus, diagnoseTopic, eventText, FAILS_BEFORE_DOWN, initialWatch, nextWatch, problemsOf, shapeContainers, shapeDisks, shapeUptime, statusMarkdown } from "@/lib/unraid";
import { parseDice, rollDice, MAX_DICE } from "@/lib/dice";
import { addFact, addRoll, campaignContext, dmTask, emptyCampaign, endCampaign, isDmRole, parseCampaign, removeFact, setCharacter, startCampaign, statusText, MAX_FACTS, MAX_ROLLS } from "@/lib/campaign";

const engineBase = { kind: "ollama" as const, groqKey: "gsk_" + "a".repeat(30), geminiKey: "", openrouterKey: "", nvidiaKey: "", localChat: "qwen2.5:7b", localCode: "", localReasoning: "", localFast: "", localAuto: true, localPals: {} as Record<string, string>, customName: "", customBaseUrl: "", customKey: "", customModel: "", customPaid: false, customMode: "off" as const, spendCapUsd: 0, customPriceIn: 0, customPriceOut: 0, anthropicKey: "", claudeMode: "off" as const, claudeModel: "claude-haiku-5-5", ollamaUrl: "http://x:11434/v1", ollamaModel: "qwen3:8b", replyLength: "short" as const };

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

describe("accounts", () => {
  it("is on only with a data folder, unless switched off", () => {
    expect(accountsEnabled({})).toBe(false);
    expect(accountsEnabled({ BUDDY_DATA_DIR: "/data" })).toBe(true);
    expect(accountsEnabled({ BUDDY_DATA_DIR: "/data", BUDDY_ACCOUNTS: "0" })).toBe(false);
    expect(accountsEnabled({ BUDDY_DATA_DIR: "/data", BUDDY_ACCOUNTS: "1" })).toBe(true);
  });
  it("validates usernames and passwords", () => {
    expect(checkUsername("nyte")).toBeNull();
    expect(checkUsername("a")).not.toBeNull();
    expect(checkUsername("has space")).not.toBeNull();
    expect(checkUsername("../x")).not.toBeNull();
    expect(checkUsername(5)).not.toBeNull();
    expect(checkPassword("longenough")).toBeNull();
    expect(checkPassword("short")).not.toBeNull();
    expect(checkPassword("x".repeat(201))).not.toBeNull();
  });
  it("hashes with a salt and verifies", async () => {
    const a = await hashPassword("correct horse");
    const b = await hashPassword("correct horse");
    expect(a.hash === b.hash).toBe(false);
    expect(a.hash).not.toContain("correct");
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("wrong horse", a)).toBe(false);
    expect(await verifyPassword("", a)).toBe(false);
  });
  it("signs sessions and rejects tampering, other secrets and expiry", async () => {
    const value = await signSession("nyte", "secret", 1_000_000);
    expect(await readSession(value, "secret", 1_000_000)).toBe("nyte");
    expect(await readSession(value, "other", 1_000_000)).toBeNull();
    expect(await readSession(value.replace(/^./, "x"), "secret", 1_000_000)).toBeNull();
    expect(await readSession(value, "secret", 1_000_000 + 31 * 24 * 3600 * 1000)).toBeNull();
    expect(await readSession("junk", "secret")).toBeNull();
    expect(await readSession("", "secret")).toBeNull();
  });
  it("validates the settings snapshot that follows an account", async () => {
    const good = { "pixel-pals-engine-v1": JSON.stringify({ kind: "auto", groqKey: "k" }), "pixel-pals-presets-v1": "[]", "pixel-pals-character-mode-v1": "matrix" };
    expect(validSyncData(good)).toEqual(good);
    expect(normalizeAccountData({ data: good })?.data["pixel-pals-character-mode-v1"]).toBe("matrix");
    expect(validSyncData({ "pixel-pals-engine-v1": "{not json" })).toBeNull();
    expect(validSyncData({ "evil-key": "{}" })).toBeNull();
    expect(validSyncData({ "pixel-pals-character-mode-v1": "x".repeat(301) })).toBeNull();
    expect(validSyncData({ "pixel-pals-docs-v1": JSON.stringify("x".repeat(1_900_000)) })).toBeNull();
    expect(validSyncData([])).toBeNull();
    expect(normalizeAccountData(null)).toBeNull();
    expect(SYNC_KEYS.includes("pixel-pals-saved-discussions-v1")).toBe(false);
    expect(SYNC_KEYS.includes("pixel-pals-agent-notes-v1")).toBe(true);
    const a = await accountFileName("Nyte");
    expect(a).toBe(await accountFileName(" nyte "));
    expect(a).toMatch(/^[0-9a-f]{32}\.json$/);
    expect(a === (await accountFileName("other"))).toBe(false);
  });
});

describe("note sync (Trakt wins, read-only)", () => {
  const list = [
    { title: "Dune", year: 2021, kind: "movie" as const, id: 1 },
    { title: "Severance", year: 2022, kind: "show" as const, id: 2 },
    { title: "Heat", year: 1995, kind: "movie" as const, id: 3 },
    { title: "Andor", year: 2022, kind: "show" as const, id: 4 },
  ];
  const watchedMovies = [{ title: "Heat", year: 1995, kind: "movie" as const, id: 3 }, { title: "Dune", year: 1984, kind: "movie" as const, id: 9 }];
  const watchedShows = [{ title: "Severance", year: 2022, kind: "show" as const, id: 2 }];
  const pool = buildPool(list, watchedMovies, watchedShows);
  const run = (note: string, searched = new Map<string, any[]>(), skip = 0) => { const lines = parseNote(note, skip); return { lines, results: decide(lines, pool, searched) }; };

  it("normalizes titles", () => {
    expect(norm("The Dark Knight")).toBe("dark knight");
    expect(norm("Amélie")).toBe("amelie");
    expect(norm("Fast & Furious!")).toBe("fast and furious");
  });
  it("parses bullets, checkboxes, marks, years and headings", () => {
    const l = parseNote("Movies to watch:\n- Dune (2021)\n[x] Heat\n✓ Andor ▶\n3. The Batman\n\n" + "x".repeat(100));
    expect(l.map((x) => x.item)).toEqual([false, true, true, true, true, false, false]);
    expect(l[1]).toMatchObject({ title: "Dune", year: 2021, marked: false });
    expect(l[2]).toMatchObject({ title: "Heat", marked: true, box: true });
    expect(l[3]).toMatchObject({ title: "Andor", marked: true, started: true });
    expect(l[4]).toMatchObject({ title: "The Batman", bullet: "3. " });
    expect(parseNote("First line\nDune", 1).map((x) => x.item)).toEqual([false, true]);
  });
  it("marks movies Trakt says you watched, keeping the bullet", () => {
    const { results } = run("- Heat\n[ ] Heat (1995)\nHeat");
    expect(results.map((r) => r.status)).toEqual(["watched", "watched", "watched"]);
    expect(results.map((r) => r.newRaw)).toEqual(["- ✓ Heat", "[x] Heat (1995)", "✓ Heat"]);
  });
  it("is stable: syncing an already-synced note changes nothing", () => {
    const first = run("- Heat\n- Severance\n- Dune (2021)").results.map((r) => r.newRaw).join("\n");
    const second = run(first).results;
    expect(second.map((r) => r.newRaw).join("\n")).toBe(first);
    expect(second.map((r) => r.status)).toEqual(["already", "started", "ontrakt"]);
  });
  it("labels started shows with ▶ and never marks them finished", () => {
    const r = run("Severance").results[0]!;
    expect(r.status).toBe("started");
    expect(r.newRaw).toBe("Severance ▶");
  });
  it("prefers the list item when a title is ambiguous, and asks for the year otherwise", () => {
    expect(run("Dune").results[0]?.status).toBe("ontrakt");
    expect(run("Dune").results[0]?.match?.year).toBe(2021);
    const p2 = buildPool([], [{ title: "Dune", year: 1984, kind: "movie", id: 9 }, { title: "Dune", year: 2021, kind: "movie", id: 1 }], []);
    const r = decide(parseNote("Dune"), p2, new Map())[0]!;
    expect(r.status).toBe("ambiguous");
    expect(r.options?.length).toBe(2);
    expect(decide(parseNote("Dune (1984)"), p2, new Map())[0]?.status).toBe("watched");
  });
  it("keeps a ✓ you typed that Trakt doesn't confirm, and flags it", () => {
    const r = run("✓ Andor").results[0]!;
    expect(r.status).toBe("conflict");
    expect(r.newRaw).toBe("✓ Andor");
  });
  it("asks Trakt search only about lines it can't place, then classifies", () => {
    const lines = parseNote("Heat\nThe Batman\nZzzz Unknown\nOppenheimer");
    expect(needsSearch(lines, pool).map((l) => l.title)).toEqual(["The Batman", "Zzzz Unknown", "Oppenheimer"]);
    const searched = new Map([
      [searchKey({ title: "The Batman" }), [{ title: "The Batman", year: 2022, kind: "movie" as const, id: 50 }]],
      [searchKey({ title: "Oppenheimer" }), [{ title: "Oppenheimer", year: 2023, kind: "movie" as const, id: 60 }, { title: "Oppenheimer", year: 1980, kind: "show" as const, id: 61 }]],
    ]);
    const r = decide(lines, pool, searched);
    expect(r.map((x) => x.status)).toEqual(["watched", "found", "nomatch", "ambiguous"]);
  });
  it("lists Trakt-list items missing from the note, and writes a report", () => {
    const lines = parseNote("Dune\nHeat");
    const results = decide(lines, pool, new Map());
    const missing = missingFromNote(lines, pool);
    expect(missing.map((m) => m.title)).toEqual(["Severance", "Andor"]);
    const report = noteReport(results, missing, { date: "2026-10-19", list: "watchlist", historyOk: true });
    expect(report).toContain("Synced with Trakt on 2026-10-19");
    expect(report).toContain("✓ Newly marked watched:\n• Heat (1995)");
    expect(report).toContain("On your Trakt list but not in the note:");
    expect(noteReport([], [], { date: "d", list: "l", historyOk: false })).toContain("Couldn't read your Trakt watch history");
    expect(counts(results).watched).toBe(1);
    expect(noteReport(decide(parseNote("- Zzz Nothing"), pool, new Map()), [], { date: "d", list: "l", historyOk: true })).toContain("• Zzz Nothing");
  });
  it("shapes history and search results", () => {
    expect(shapeHistory([{ plays: 2, movie: { title: "Heat", year: 1995, ids: { trakt: 3 } } }, { movie: {} }], "movie")).toEqual([{ title: "Heat", kind: "movie", year: 1995, id: 3 }]);
    expect(shapeSearch([{ type: "show", score: 9, show: { title: "Andor", year: 2022, ids: { trakt: 4 } } }, { type: "person" }])).toEqual([{ title: "Andor", kind: "show", year: 2022, id: 4 }]);
    expect(shapeSearch(null)).toEqual([]);
  });
  it("makes access tokens that are random, prefixed and stored only hashed", async () => {
    const a = newToken();
    expect(a).toMatch(/^pp_[0-9a-f]{64}$/);
    expect(a === newToken()).toBe(false);
    expect(await hashToken(a)).not.toContain(a);
    expect(await hashToken(a)).toBe(await hashToken(a));
  });
});

describe("per-account chats", () => {
  const row = (id: string, owner?: string, shared?: boolean) => ({ id, title: id, messages: [], theme: "normal", mode: "roundtable", updatedAt: "2026-01-01", ...(owner ? { owner } : {}), ...(shared ? { shared } : {}) });
  it("shows your chats, shared chats and old ownerless chats", () => {
    expect(visibleTo(row("a", "nyte"), "nyte")).toBe(true);
    expect(visibleTo(row("a", "mom"), "nyte")).toBe(false);
    expect(visibleTo(row("a", "mom", true), "nyte")).toBe(true);
    expect(visibleTo(row("a"), "nyte")).toBe(true);
    expect(visibleTo(row("a", "mom"), "")).toBe(true);
  });
  it("caps chats per owner, not overall", () => {
    const rows = [row("1", "a"), row("2", "a"), row("3", "b"), row("4", "a"), row("5", "b")];
    expect(capPerOwner(rows, 2).map((r) => r.id)).toEqual(["1", "2", "3", "5"]);
  });
});

describe("trakt x plex", () => {
  const found = [{ title: "Dune", kind: "movie" as const, year: 2021 }, { title: "The Bear", kind: "show" as const, year: 2022 }];
  it("matches by name, kind and year within one", () => {
    expect(plexHas({ title: "Dune", kind: "movie", year: 2021 }, found)).toBe(true);
    expect(plexHas({ title: "Dune", kind: "movie", year: 2022 }, found)).toBe(true);
    expect(plexHas({ title: "Dune", kind: "movie", year: 1984 }, found)).toBe(false);
    expect(plexHas({ title: "Dune", kind: "show" }, found)).toBe(false);
    expect(plexHas({ title: "Bear", kind: "show", year: 2022 }, found)).toBe(true);
    expect(plexHas({ title: "Heat", kind: "movie" }, found)).toBe(false);
  });
  it("shows Plex status in the list and tells the pals to prefer what's in Plex", () => {
    const items = [{ title: "Dune", kind: "movie" as const, year: 2021, inPlex: true }, { title: "Heat", kind: "movie" as const, year: 1995, inPlex: false }, { title: "Andor", kind: "show" as const }];
    expect(traktMarkdown("watchlist", items)).toContain("1. **Dune** (2021) · Movie · 📺 in Plex");
    expect(traktMarkdown("watchlist", items)).toContain("· not in Plex");
    const topic = nextTopic("", "watchlist", items);
    expect(topic).toContain("- Dune (2021) — movie [in Plex]");
    expect(topic).toContain("- Heat (1995) — movie [not in Plex]");
    expect(topic).toContain("/request");
    expect(nextTopic("", "watchlist", [{ title: "Andor", kind: "show" as const }])).not.toContain("/request");
  });
  it("has /request", () => {
    expect(parseSlash("/request Dune Part Two")).toEqual({ ok: true, action: { type: "request", title: "Dune Part Two" } });
    expect(parseSlash("/request")?.ok).toBe(false);
  });
});

describe("schedule and backup naming", () => {
  it("reads clock time in a zone, not the machine's", () => {
    const d = new Date("2026-10-19T12:30:00Z");
    expect(zonedParts(d, "America/New_York").hm).toBe("08:30");
    expect(zonedParts(d, "America/New_York").day).toBe("2026-10-19");
    expect(zonedParts(d, "UTC").hm).toBe("12:30");
    expect(zonedParts(new Date("2026-10-20T02:00:00Z"), "America/New_York").day).toBe("2026-10-19");
    expect(zonedParts(d, "Not/AZone").hm).toBe("12:30");
    expect(zonedParts(d, "America/New_York").stamp).toBe("2026-10-19-0830");
  });
  it("validates zones and times", () => {
    expect(validZone("America/New_York")).toBe("America/New_York");
    expect(validZone("nope")).toBeNull();
    expect(validZone(undefined)).toBeNull();
    expect(parseHm("08:05", "03:30")).toBe("08:05");
    expect(parseHm("8:5", "03:30")).toBe("03:30");
    expect(parseHm("25:00", "03:30")).toBe("03:30");
    expect(parseHm(undefined, "03:30")).toBe("03:30");
  });
  it("fires once a day inside a short window after the target", () => {
    const tz = "America/New_York";
    expect(isDue(new Date("2026-10-19T07:30:30Z"), tz, "03:30", "")).toBe(true);
    expect(isDue(new Date("2026-10-19T07:30:30Z"), tz, "03:30", "2026-10-19")).toBe(false);
    expect(isDue(new Date("2026-10-19T07:29:00Z"), tz, "03:30", "")).toBe(false);
    expect(isDue(new Date("2026-10-19T07:45:00Z"), tz, "03:30", "")).toBe(false);
    expect(isDue(new Date("2026-10-19T07:40:00Z"), tz, "03:30", "2026-10-18")).toBe(true);
  });
  it("describes ages", () => {
    expect(ageText(30_000)).toBe("just now");
    expect(ageText(30 * 60_000)).toBe("30 minutes ago");
    expect(ageText(5 * 3600_000)).toBe("5 hours ago");
    expect(ageText(72 * 3600_000)).toBe("3 days ago");
  });
  it("only ever prunes our own backups, oldest first", () => {
    const names = ["pixelpals-2026-10-01-0330", "pixelpals-2026-10-03-0330", "pixelpals-2026-10-02-0330", "notes", ".partial-pixelpals-2026-10-04-0330", "pixelpals-2026-10-04-0330"];
    expect(pruneList(names, 2)).toEqual(["pixelpals-2026-10-01-0330", "pixelpals-2026-10-02-0330"]);
    expect(pruneList(names, 10)).toEqual([]);
    expect(pruneList(names, 0)).toEqual(["pixelpals-2026-10-01-0330", "pixelpals-2026-10-02-0330", "pixelpals-2026-10-03-0330"]);
    expect(isBackupName(backupName("2026-10-19-0330"))).toBe(true);
    expect(isBackupName("pixelpals-x")).toBe(false);
  });
  it("refuses a backup folder inside the data folder", () => {
    expect(insideData("/data/backups", "/data")).toBe(true);
    expect(insideData("/data", "/data/")).toBe(true);
    expect(insideData("/backups", "/data")).toBe(false);
    expect(insideData("/database", "/data")).toBe(false);
  });
});

describe("morning brief", () => {
  const items = [
    { title: "Dune", kind: "movie" as const, year: 2021, inPlex: true },
    { title: "Heat", kind: "movie" as const, year: 1995, inPlex: false },
    { title: "Andor", kind: "show" as const, inPlex: true },
    { title: "Alien", kind: "movie" as const, year: 1979, inPlex: true, watched: true },
    { title: "Fargo", kind: "movie" as const, year: 1996, inPlex: true },
  ];
  it("picks the same titles all day, preferring unwatched ones in Plex", () => {
    const a = dailyPicks(items, "2026-10-19");
    expect(a.map((i) => i.title)).toEqual(dailyPicks(items, "2026-10-19").map((i) => i.title));
    expect(a.length).toBe(3);
    expect(a.every((i) => i.inPlex === true && !i.watched)).toBe(true);
    expect(new Set(a.map((i) => i.title)).size).toBe(3);
    expect(dailyPicks([{ title: "Heat", kind: "movie" as const, inPlex: false }], "x").map((i) => i.title)).toEqual(["Heat"]);
    expect(dailyPicks([], "x")).toEqual([]);
    expect(dailyPicks([{ title: "Alien", kind: "movie" as const, watched: true }], "x")).toEqual([]);
  });
  it("describes Unraid in one line", () => {
    const base = { checkedAt: 0, reachable: true, disks: [{ name: "d1", status: "DISK_OK", tempC: 38 }], containers: [{ name: "a", state: "running" }, { name: "b", state: "exited" }], notes: [], problems: [] as string[], uptimeSeconds: 90000 };
    expect(unraidLine(base)).toBe("Unraid is healthy (1/2 containers running, hottest disk 38°C, up 1d 1h).");
    expect(unraidLine({ ...base, reachable: false })).toContain("unreachable");
    expect(unraidLine({ ...base, problems: ["Disk d2 reports DISK_DSBL."] })).toContain("needs attention: Disk d2 reports DISK_DSBL.");
    expect(unraidLine(undefined)).toBe("");
    expect(unraidLine(null)).toContain("waiting");
  });
  it("builds a readable brief and degrades gracefully", () => {
    const b = buildBrief({ day: "2026-10-19", backup: "Latest backup: pixelpals-2026-10-19-0330 (5 hours ago).", picks: [items[0]!, items[2]!, items[4]!], recent: ["A", "B"] });
    expect(b.title).toBe("Good morning — Mon, Oct 19");
    expect(b.body).toContain("Tonight's pick: Dune (2021) — in Plex");
    expect(b.body).toContain("Or: Andor, Fargo (1996)");
    expect(b.body).toContain("New in Plex: A, B");
    expect(buildBrief({ day: "2026-10-19", picks: [items[1]!] }).body).toContain("not in Plex yet (/request it)");
    expect(buildBrief({ day: "2026-10-19" }).body).toContain("Nothing to report");
  });
  it("has /brief", () => {
    expect(parseSlash("/brief")).toEqual({ ok: true, action: { type: "brief", send: false } });
    expect(parseSlash("/brief send")).toEqual({ ok: true, action: { type: "brief", send: true } });
    expect(parseSlash("/backup now")).toEqual({ ok: true, action: { type: "backup", now: true } });
  });
});

describe("share-sheet prefill and public app files", () => {
  it("builds the text from the address", () => {
    expect(sharedText("?q=hello%20world")).toBe("hello world");
    expect(sharedText("?title=Dune&q=Is%20it%20good%3F&url=https%3A%2F%2Fexample.com%2Fdune")).toBe("Dune\nIs it good?\nhttps://example.com/dune");
    expect(sharedText("?q=See%20https%3A%2F%2Fx.com&url=https%3A%2F%2Fx.com")).toBe("See https://x.com");
    expect(sharedText("")).toBe("");
    expect(sharedText("?other=1")).toBe("");
    expect(sharedText("?q=" + "a".repeat(5000)).length).toBe(2000);
  });
  it("lets the manifest and icons through the sign-in, and nothing else", async () => {
    expect(PUBLIC_FILES.has("/manifest.webmanifest")).toBe(true);
    expect(PUBLIC_FILES.has("/api/chat")).toBe(false);
    expect((await gate(new Request("http://x/manifest.webmanifest"), "pw"))).toBe(null);
    expect((await gate(new Request("http://x/apple-touch-icon.png"), "pw"))).toBe(null);
    expect((await gate(new Request("http://x/"), "pw"))?.status).toBe(401);
  });
});

describe("read aloud", () => {
  it("turns markdown into speakable text", () => {
    expect(speechText("## Title\n\n**Bold** and _italic_ with `code`.")).toBe("Title. Bold and italic with code.");
    expect(speechText("See [the docs](https://example.com/x) or https://example.com/y now")).toBe("See the docs or link now");
    expect(speechText("Before\n```js\nconst a = 1;\n```\nAfter")).toBe("Before. (code omitted). After");
    expect(speechText("- one\n- two\n1. three")).toBe("one. two. three");
    expect(speechText("![a cat](http://x/y.png) here")).toBe("a cat here");
    expect(speechText("")).toBe("");
    expect(speechText("x".repeat(9000)).length).toBe(5000);
  });
  it("splits into sentence-sized chunks without losing words", () => {
    const text = "First sentence here. Second one is a little longer than the first. Third!";
    for (const max of [30, 60, 180]) {
      const chunks = chunkSpeech(text, max);
      expect(chunks.every((c) => c.length <= max)).toBe(true);
      expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text);
    }
    const long = "word ".repeat(100).trim() + ".";
    const parts = chunkSpeech(long, 50);
    expect(parts.every((c) => c.length <= 50)).toBe(true);
    expect(parts.join(" ").split(" ").length).toBe(100);
    expect(chunkSpeech("")).toEqual([]);
  });
  it("gives each pal a stable voice and profile", () => {
    const voices = [{ name: "Zoe", lang: "en-US" }, { name: "Alex", lang: "en-GB" }, { name: "Marie", lang: "fr-FR" }, { name: "Sam", lang: "en-US" }];
    const a = pickVoice(voices, "nova", "en-US");
    expect(a).toBe(pickVoice(voices, "nova", "en-US"));
    expect(["Zoe", "Alex", "Sam"].includes(a ?? "")).toBe(true);
    expect(pickVoice(voices, "nova", "fr-CA")).toBe("Marie");
    expect(pickVoice(voices, "nova", "ja-JP") !== undefined).toBe(true);
    expect(pickVoice([], "nova", "en-US")).toBeUndefined();
    const p = voiceProfile("byte");
    expect(p).toEqual(voiceProfile("byte"));
    expect(p.pitch >= 0.78 && p.pitch <= 1.36).toBe(true);
    expect(p.rate >= 0.94 && p.rate <= 1.09).toBe(true);
    expect(new Set(["nova", "byte", "sage", "pip", "echo", "claude"].map((i) => JSON.stringify(voiceProfile(i)))).size).toBeGreaterThan(3);
  });
  it("has /voice", () => {
    expect(parseSlash("/voice")).toEqual({ ok: true, action: { type: "voice", mode: "toggle" } });
    expect(parseSlash("/voice on")).toEqual({ ok: true, action: { type: "voice", mode: "on" } });
    expect(parseSlash("/voice off")).toEqual({ ok: true, action: { type: "voice", mode: "off" } });
  });
});

describe("free key helper", () => {
  it("recognises each provider from a pasted key", () => {
    expect(detectProvider("gsk_" + "a".repeat(40))?.id).toBe("groq");
    expect(detectProvider("AIza" + "b".repeat(35))?.id).toBe("gemini");
    expect(detectProvider("AQ.Ab8RN6" + "x".repeat(30))?.id).toBe("gemini");
    expect(detectProvider("sk-or-v1-" + "c".repeat(30))?.id).toBe("openrouter");
    expect(detectProvider("nvapi-" + "d".repeat(30))?.id).toBe("nvidia");
  });
  it("cleans quotes, spaces and Bearer prefixes", () => {
    expect(cleanKey('  "gsk_abc"  ')).toBe("gsk_abc");
    expect(cleanKey("Bearer nvapi-xyz")).toBe("nvapi-xyz");
  });
  it("ignores things that are not keys", () => {
    expect(detectProvider("hello world")).toBeNull();
    expect(detectProvider("gsk_short")).toBeNull();
  });
  it("counts the keys that are filled in", () => {
    expect(keyCount({ groqKey: "x", geminiKey: " ", openrouterKey: "", nvidiaKey: "y" })).toBe(2);
  });
});

describe("Claude (paid) provider", () => {
  const base = { ...engineBase, kind: "cloud" as const, groqKey: "g", anthropicKey: "sk-ant-" + "x".repeat(30) };
  it("is recognised by its key prefix", () => {
    expect(detectProvider("sk-ant-api03-" + "z".repeat(30))?.id).toBe("anthropic");
    expect(detectProvider("sk-or-v1-" + "z".repeat(30))?.id).toBe("openrouter");
  });
  it("never answers while switched off, even with a key", () => {
    expect(claudeProvider(base)).toBeUndefined();
    expect(turnProviders(base).map((p) => p.kind)).toEqual(["groq"]);
  });
  it("shares turns with free keys only when asked", () => {
    const shared = turnProviders({ ...base, claudeMode: "share" });
    expect(shared.map((p) => p.kind)).toEqual(["groq", "anthropic"]);
    expect(providerForTurn({ ...base, claudeMode: "share" }, 1)?.kind).toBe("anthropic");
  });
  it("can be the only engine, and falls back to Haiku for an unknown model", () => {
    const only = turnProviders({ ...base, claudeMode: "only", claudeModel: "nope" });
    expect(only.length).toBe(1);
    expect(only[0]?.model).toBe("claude-haiku-5-5");
  });
  it("needs a key", () => {
    expect(claudeProvider({ ...base, claudeMode: "only", anthropicKey: " " })).toBeUndefined();
  });
});

describe("Connect iPhone helper", () => {
  it("builds the notes-sync URL from the options", () => {
    expect(notesSyncUrl({ origin: "https://pp.ts.net/" })).toBe("https://pp.ts.net/api/notes-sync?format=report&skip=1");
    expect(notesSyncUrl({ origin: "http://10.0.0.5:8090", format: "note", skipTitle: false, list: "movies to see" })).toBe("http://10.0.0.5:8090/api/notes-sync?format=note&list=movies+to+see");
  });
  it("builds the share-sheet address and bearer header", () => {
    expect(shareSheetUrl("https://pp.ts.net//")).toBe("https://pp.ts.net/?q=");
    expect(bearerHeader(" pp_abc ")).toBe("Bearer pp_abc");
  });
  it("detects secure origins", () => {
    expect(isSecure("https://x")).toBe(true);
    expect(isSecure("http://x")).toBe(false);
  });
  it("gives copyable values in the steps, with a placeholder until a token exists", () => {
    const withToken = notesSteps("https://x/api/notes-sync?format=report", "pp_t", "Watch list");
    const send = withToken.find((s) => s.copy);
    expect(send?.copy?.map((c) => c.value)).toContain("Bearer pp_t");
    expect(notesSteps("u", "", "").find((s) => s.copy)?.copy?.[1]?.value).toContain("create your token");
    expect(shareSteps("https://x/?q=").some((s) => s.copy?.[0]?.value === "https://x/?q=")).toBe(true);
  });
});

describe("Local AI: hardware, recommendations and routing", () => {
  const gpu3080 = { cpu: "Ryzen 7", cores: 16, ramGb: 32, gpus: [{ name: "RTX 3080", vramGb: 10 }], gpuSource: "nvidia-smi" as const };
  const cpuOnly = { cpu: "Intel i5", cores: 8, ramGb: 16, gpus: [], gpuSource: "none" as const };
  it("reads nvidia-smi output", () => {
    expect(parseNvidiaSmi("NVIDIA GeForce RTX 3080, 10240\n")).toEqual([{ name: "NVIDIA GeForce RTX 3080", vramGb: 10 }]);
    expect(parseNvidiaSmi("garbage")).toEqual([]);
  });
  it("budgets VRAM when a GPU exists, otherwise a slice of RAM", () => {
    expect(modelBudgetGb(gpu3080)).toEqual({ gb: 10, onGpu: true });
    expect(modelBudgetGb(cpuOnly)).toEqual({ gb: 6, onGpu: false });
    expect(describeHardware(cpuOnly)).toContain("no GPU");
  });
  it("recommends models that fit a 10 GB GPU, one per task", () => {
    const rec = recommend(gpu3080);
    const by = Object.fromEntries(rec.map((r) => [r.task, r.model.id]));
    expect(by["chat"]).toBe("gemma2:9b");
    expect(by["code"]).toBe("qwen2.5-coder:7b");
    for (const r of rec) expect(needGb(r.model) <= 10).toBe(true);
    expect(rec.length).toBe(4);
  });
  it("recommends small models on a CPU-only machine", () => {
    for (const r of recommend(cpuOnly)) expect(r.model.gb <= 5).toBe(true);
  });
  it("reports fit honestly", () => {
    const big = CATALOG.find((m) => m.id === "llama3.3:70b")!;
    expect(fitFor(big, gpu3080)).toBe("no");
    const mid = CATALOG.find((m) => m.id === "qwen2.5:14b")!;
    expect(fitFor(mid, gpu3080)).toBe("cpu");
  });
  it("routes by task", () => {
    expect(pickTask({ text: "why is my python function throwing an exception?" })).toBe("code");
    expect(pickTask({ mode: "solve", text: "What should we do about the budget for the next quarter please" })).toBe("reasoning");
    expect(pickTask({ text: "hi" })).toBe("fast");
    expect(pickTask({ text: "Tell me about the history of the lighthouse at Alexandria please" })).toBe("chat");
  });
  it("falls back to the chat model, and routing can be switched off", () => {
    const s = { localChat: "qwen2.5:7b", localCode: "qwen2.5-coder:7b", localReasoning: "", localFast: "", localAuto: true };
    expect(pickModel(s, { text: "fix this bug in my regex" })).toBe("qwen2.5-coder:7b");
    expect(pickModel(s, { mode: "solve", text: "prove it step by step" })).toBe("qwen2.5:7b");
    expect(pickModel({ ...s, localAuto: false }, { text: "fix this bug in my regex" })).toBe("qwen2.5:7b");
  });
  it("lets a pal's own model override task routing", () => {
    const s = { localChat: "qwen2.5:7b", localCode: "qwen2.5-coder:7b", localReasoning: "", localFast: "", localAuto: true, localPals: { tux: "deepseek-r1:7b" } };
    expect(pickModel(s, { agentId: "tux", text: "fix this bug in my regex" })).toBe("deepseek-r1:7b");
    expect(pickModel(s, { agentId: "nova", text: "fix this bug in my regex" })).toBe("qwen2.5-coder:7b");
    expect(pickModel({ ...s, localAuto: false }, { agentId: "tux", text: "hello there" })).toBe("deepseek-r1:7b");
  });
  it("validates model names", () => {
    expect(isModelName("qwen2.5-coder:7b")).toBe(true);
    expect(isModelName("hf.co/user/model:Q4_K_M")).toBe(true);
    expect(isModelName("../etc/passwd")).toBe(false);
    expect(isModelName("a b")).toBe(false);
  });
  it("uses the Local AI server as the provider when selected", () => {
    const p = providerForTurn({ ...engineBase, kind: "local-server" as const, localCode: "qwen2.5-coder:7b" }, 0, { text: "refactor this function" });
    expect(p?.kind).toBe("ollama-server");
    expect(p?.model).toBe("qwen2.5-coder:7b");
  });
});

describe("Focus mode", () => {
  it("parses /focus", () => {
    expect(parseSlash("/focus")).toEqual({ ok: true, action: { type: "focus", mode: "toggle" } });
    expect(parseSlash("/focus on")).toEqual({ ok: true, action: { type: "focus", mode: "on" } });
    expect(parseSlash("/calm off")).toEqual({ ok: true, action: { type: "focus", mode: "off" } });
  });
  it("has the Ctrl+Shift+F shortcut", () => {
    expect(matchShortcut({ key: "F", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }, false, false)).toBe("focusMode");
    expect(matchShortcut({ key: "f", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }, false, false)).toBeNull();
  });
});

describe("Ollama library feed", () => {
  const li = (name: string, sizes: string[], caps: string[], pulls: string, updated: string) =>
    `<li x-test-model class="x"><a href="/library/${name}"><span x-test-model-title>${name}</span>` +
    sizes.map((z) => `<span x-test-size class="a">${z}</span>`).join("") +
    caps.map((c) => `<span x-test-capability>${c}</span>`).join("") +
    `<span x-test-pull-count>${pulls}</span><span x-test-updated>${updated}</span></a></li>`;
  const page = `<ul>${li("alpha-coder", ["7b", "14b"], ["tools"], "52.1K", "2 days ago")}${li("deep-think", ["8b", "32b"], ["thinking", "tools"], "1.2M", "3 days ago")}${li("embedder", ["300m"], ["embedding"], "90K", "1 day ago")}${li("tiny-new", ["1b"], [], "20K", "yesterday")}${li("obscure", ["7b"], [], "800", "yesterday")}${li("cloudy", [], ["cloud"], "50K", "1 day ago")}</ul>`;
  const hw = { cpu: "x", cores: 8, ramGb: 32, gpus: [{ name: "GPU", vramGb: 10 }], gpuSource: "nvidia-smi" as const };
  it("reads pull counts and sizes", () => {
    expect(parsePulls("21.5K")).toBe(21500);
    expect(parsePulls("1.2M")).toBe(1200000);
    expect(parsePulls("1,081")).toBe(1081);
    expect(sizeToGb("7b")).toBe(4.6);
    expect(sizeToGb("270m")).toBe(0.5);
    expect(sizeToGb("30b-a3b")).toBeNull();
  });
  it("parses the library listing", () => {
    const feed = parseLibraryPage(page);
    expect(feed.map((m) => m.name)).toEqual(["alpha-coder", "deep-think", "embedder", "tiny-new", "obscure", "cloudy"]);
    expect(feed[0]?.sizes).toEqual(["7b", "14b"]);
    expect(feed[1]?.pulls).toBe(1200000);
  });
  it("returns nothing when the layout is not recognised", () => {
    expect(parseLibraryPage("<html><body>nothing here</body></html>")).toEqual([]);
  });
  it("skips embedding, cloud-only and rarely used models and infers tasks", () => {
    const cat = feedToCatalog(parseLibraryPage(page));
    const ids = cat.map((c) => c.id);
    expect(ids).toContain("alpha-coder:7b");
    expect(ids).not.toContain("embedder:300m");
    expect(ids).not.toContain("obscure:7b");
    expect(cat.find((c) => c.id === "alpha-coder:7b")?.task).toBe("code");
    expect(cat.find((c) => c.id === "deep-think:8b")?.task).toBe("reasoning");
    expect(cat.find((c) => c.id === "tiny-new:1b")?.task).toBe("fast");
  });
  it("suggests only new models that fit, skipping installed and already-known ones", () => {
    const feed = parseLibraryPage(page);
    const out = newSuggestions(feed, hw, new Set(["deep-think:8b"]), new Set());
    const ids = out.map((o) => o.model.id);
    expect(ids).toContain("alpha-coder:7b");
    expect(ids).not.toContain("alpha-coder:14b");
    expect(ids).not.toContain("deep-think:8b");
    expect(out.every((o) => o.fit !== "no")).toBe(true);
  });
});

describe("Free provider list", () => {
  const md = [
    "# Free LLM API resources", "intro", "## Free Providers", "",
    "### [OpenRouter](https://openrouter.ai)", "<a id=x></a>", "", "**Limits:**", "", "- [Some Model](https://openrouter.ai/m:free)", "",
    "### [Mistral (La Plateforme)](https://console.mistral.ai/)", "**Limits:** 1 request/second, 500,000 tokens/minute", "",
    "### [Tiny Co](https://tiny.example)", "**Limits:**", "| a | b |", "Free for **20 requests/day**", "",
    "## Providers with trial credits", "", "### [Fireworks](https://fireworks.ai)", "**Credits:** $1 for new accounts", "**Models:** lots", "",
    "## About", "### [Not A Provider](https://nope.example)", "**Limits:** none",
  ].join("\n");
  it("reads free and trial providers with their limits", () => {
    const list = parseProviderReadme(md);
    expect(list.map((p) => p.name)).toEqual(["OpenRouter", "Mistral (La Plateforme)", "Tiny Co", "Fireworks"]);
    expect(list[0]?.kind).toBe("free");
    expect(list[0]?.summary).toBe("Some Model");
    expect(list[1]?.summary).toBe("1 request/second, 500,000 tokens/minute");
    expect(list[2]?.summary).toBe("Free for 20 requests/day");
    expect(list[3]).toMatchObject({ kind: "trial", summary: "$1 for new accounts" });
  });
  it("ignores sections that are not provider lists and unknown layouts", () => {
    expect(parseProviderReadme("## About\n### [X](https://x.example)")).toEqual([]);
    expect(parseProviderReadme("nothing")).toEqual([]);
  });
  it("links known providers to their key page and others to their site", () => {
    expect(keyPageFor({ name: "OpenRouter", site: "https://openrouter.ai" })).toEqual({ url: "https://openrouter.ai/keys", isKeyPage: true });
    expect(keyPageFor({ name: "Tiny Co", site: "https://tiny.example" })).toEqual({ url: "https://tiny.example", isKeyPage: false });
  });
  it("marks the providers Pixel Pals can already use", () => {
    expect(isSupported("Groq")).toBe(true);
    expect(isSupported("Google AI Studio")).toBe(true);
    expect(isSupported("Cerebras")).toBe(false);
  });
});

describe("Custom OpenAI-compatible provider", () => {
  const base = { ...engineBase, kind: "cloud" as const, groqKey: "g", customBaseUrl: "https://api.example.com/v1/", customModel: "m-1", customKey: "k" };
  it("accepts public https addresses and tidies them", () => {
    expect(validateCustomUrl("https://router.huggingface.co/v1/")).toEqual({ ok: true, url: "https://router.huggingface.co/v1" });
    for (const p of CUSTOM_PRESETS) expect(validateCustomUrl(p.baseUrl).ok).toBe(true);
  });
  it("refuses private, local and unsafe addresses by default", () => {
    for (const bad of ["http://api.example.com/v1", "https://localhost:11434/v1", "https://10.0.0.5/v1", "https://192.168.1.2/v1", "https://169.254.169.254/", "https://[::1]/v1", "https://myserver/v1", "https://box.local/v1", "https://user:pw@api.example.com/v1", "not a url", ""])
      expect(validateCustomUrl(bad).ok).toBe(false);
  });
  it("lets the server owner allow a LAN endpoint", () => {
    expect(validateCustomUrl("http://10.0.0.5:1234/v1", true)).toEqual({ ok: true, url: "http://10.0.0.5:1234/v1" });
  });
  it("validates model names", () => {
    expect(isCustomModel("Qwen/Qwen2.5-7B-Instruct")).toBe(true);
    expect(isCustomModel("llama3.1-8b:free")).toBe(true);
    expect(isCustomModel("a b")).toBe(false);
    expect(isCustomModel("")).toBe(false);
  });
  it("is never used while off, and joins the rotation or runs alone when asked", () => {
    expect(customProvider(base)).toBeUndefined();
    expect(turnProviders(base).map((p) => p.kind)).toEqual(["groq"]);
    expect(turnProviders({ ...base, customMode: "share" }).map((p) => p.kind)).toEqual(["groq", "custom"]);
    const only = turnProviders({ ...base, customMode: "only" });
    expect(only.length).toBe(1);
    expect(only[0]).toMatchObject({ kind: "custom", model: "m-1" });
  });
  it("needs a base URL and a model", () => {
    expect(customProvider({ ...base, customMode: "only", customModel: "" })).toBeUndefined();
    expect(customProvider({ ...base, customMode: "only", customBaseUrl: " " })).toBeUndefined();
  });
});

describe("fallback chain and spend tracking", () => {
  const base = { ...engineBase, kind: "cloud" as const, groqKey: "g", geminiKey: "m", anthropicKey: "sk-ant-" + "x".repeat(30) };
  const groq = { kind: "groq" as const, apiKey: "g" };
  it("tries the other free keys first, then paid fallback providers", () => {
    const s = { ...base, claudeMode: "fallback" as const };
    expect(chainAfter(s, groq).map((p) => p.kind)).toEqual(["gemini", "anthropic"]);
    expect(fallbackProviders(s).map((p) => p.kind)).toEqual(["anthropic"]);
  });
  it("never uses a fallback provider in the normal rotation", () => {
    expect(turnProviders({ ...base, claudeMode: "fallback" as const }).map((p) => p.kind)).toEqual(["groq", "gemini"]);
  });
  it("drops paid providers when over the cap, but keeps free ones and a free custom provider", () => {
    const s = { ...base, claudeMode: "share" as const, customMode: "share" as const, customBaseUrl: "https://x.example/v1", customModel: "m", customPaid: false };
    expect(turnProviders(s, true).map((p) => p.kind)).toEqual(["groq", "gemini", "custom"]);
    expect(turnProviders({ ...s, customPaid: true }, true).map((p) => p.kind)).toEqual(["groq", "gemini"]);
    expect(fallbackProviders({ ...base, claudeMode: "fallback" as const }, true)).toEqual([]);
  });
  it("falls back to the free keys when Claude-only is over the cap", () => {
    expect(turnProviders({ ...base, claudeMode: "only" as const }, true).map((p) => p.kind)).toEqual(["groq", "gemini"]);
  });
  it("does not chain the local server", () => {
    expect(chainAfter(base, { kind: "ollama-server", apiKey: "" })).toEqual([]);
  });
  it("estimates tokens and Claude cost", () => {
    expect(estimateTokens(400)).toBe(100);
    const e = { t: Date.UTC(2026, 9, 5), kind: "anthropic", model: "claude-haiku-5-5", inTok: 1_000_000, outTok: 1_000_000 };
    expect(costUsd(e)).toBeCloseTo(0.6, 5);
    expect(costUsd({ ...e, kind: "groq" })).toBe(0);
    expect(costUsd({ ...e, kind: "custom", model: "m" }, { inPerM: 1, outPerM: 2 })).toBeCloseTo(3, 5);
  });
  it("sums this month only and applies the cap", () => {
    const now = new Date(Date.UTC(2026, 9, 20));
    const entries = [
      { t: Date.UTC(2026, 9, 5), kind: "anthropic", model: "claude-sonnet-5-5", inTok: 1_000_000, outTok: 0 },
      { t: Date.UTC(2026, 8, 5), kind: "anthropic", model: "claude-sonnet-5-5", inTok: 9_000_000, outTok: 0 },
      { t: Date.UTC(2026, 9, 6), kind: "groq", model: "g", inTok: 10, outTok: 10 },
    ];
    const sum = summarize(entries, now);
    expect(sum.usd).toBeCloseTo(2, 5);
    expect(sum.rows.map((r) => r.kind)).toEqual(["anthropic", "groq"]);
    expect(overCap(entries, now, 2)).toBe(true);
    expect(overCap(entries, now, 2.01)).toBe(false);
    expect(overCap(entries, now, 0)).toBe(false);
    expect(monthKey(now)).toBe("2026-10");
    expect(fmtUsd(0.004)).toBe("<$0.01");
    expect(fmtUsd(1.5)).toBe("$1.50");
    expect(trim(entries, now).length).toBe(3);
  });
});

describe("speed test wording", () => {
  it("explains speed and GPU share", () => {
    expect(describeBench(42, 100)).toBe("42 tokens/second (very fast). Entirely on the GPU.");
    expect(describeBench(4, 40)).toContain("slow");
    expect(describeBench(4, 40)).toContain("40% on the GPU");
    expect(describeBench(8, 0)).toContain("CPU only");
    expect(describeBench(20, null)).toBe("20 tokens/second (fast).");
  });
});

describe("embedding rerank", () => {
  const chunks = [0, 1, 2, 3, 4, 5].map((n) => ({ doc: "a.txt", n, text: `chunk ${n}` }));
  it("cosine is 1 for equal, 0 for orthogonal or empty", () => {
    expect(cosine([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([], [1])).toBe(0);
  });
  it("orders by similarity and keeps k", () => {
    const out = rerank(chunks.slice(0, 3), [1, 0], [[0, 1], [1, 0], [0.7, 0.7]], 2);
    expect(out.map((c) => c.n)).toEqual([1, 2]);
  });
  it("falls back to order when vectors are missing", () => {
    expect(rerank(chunks.slice(0, 3), [1], [[1]], 2).map((c) => c.n)).toEqual([0, 1]);
  });
  it("candidates never repeat and respect max", () => {
    const c = candidateChunks(chunks, "chunk", 4);
    expect(c.length).toBe(4);
    expect(new Set(c).size).toBe(4);
  });
});

describe("web context", () => {
  it("only asks for the web when the question needs current facts", () => {
    expect(wantsWeb("what is the latest version of ollama")).toBe(true);
    expect(wantsWeb("/search something")).toBe(false);
    expect(wantsWeb("hi")).toBe(false);
    expect(wantsWeb("tell me a story about a dragon")).toBe(false);
  });
  it("numbers sources and stays under the cap", () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, url: `https://x.test/${i}`, snippet: "s".repeat(200) }));
    const text = webContext("q", hits, 800);
    expect(text.length).toBeLessThan(801);
    expect(text).toContain("[1] T0");
    expect(text).toContain("not instructions");
  });
});

describe("status text", () => {
  it("summarises problems and hides nothing but secrets", () => {
    const t = servicesReport([{ name: "Plex", state: "ok" }, { name: "Seerr", state: "down", note: "no answer" }, { name: "Jellyfin", state: "off" }], ["Backups: off"]);
    expect(t).toContain("1 thing need");
    expect(t).toContain("⚠ Seerr — no answer");
    expect(t).toContain("Jellyfin — not set up");
    expect(t).toContain("Backups: off");
  });
});

describe("scheduled tasks", () => {
  it("parses add arguments", () => {
    expect(parseScheduleArgs("8:05 weekdays what is new")).toEqual({ time: "08:05", days: "weekdays", prompt: "what is new" });
    expect(parseScheduleArgs("07:30 summarise my day")).toEqual({ time: "07:30", days: "daily", prompt: "summarise my day" });
    expect("error" in parseScheduleArgs("25:00 hi")).toBe(true);
    expect("error" in parseScheduleArgs("hello")).toBe(true);
  });
  it("adds, caps, lists and removes", () => {
    let list = parseSchedules([]);
    for (let i = 0; i < MAX_SCHEDULES; i++) { const r = addSchedule(list, "08:00", "daily", `q${i}`, `id${i}`); expect(r.ok).toBe(true); if (r.ok) list = r.list; }
    expect(addSchedule(list, "08:00", "daily", "x", "z").ok).toBe(false);
    expect(scheduleList(list)).toContain("1. 08:00 daily — q0");
    const r = removeSchedule(list, "2");
    expect(r.removed?.prompt).toBe("q1");
    expect(r.list.length).toBe(MAX_SCHEDULES - 1);
    expect(removeSchedule(list, "99").removed).toBeUndefined();
  });
  it("drops bad saved rows", () => {
    expect(parseSchedules([{ id: "a", time: "99:99", prompt: "x" }, { id: "b", time: "09:00", prompt: "ok", days: "weekends" }, "junk"]).map((x) => x.id)).toEqual(["b"]);
  });
  it("runs once per day, only on matching days", () => {
    const s = { id: "a", time: "08:00", days: "weekdays" as const, prompt: "p", last: "", lastResult: "" };
    const mon = new Date("2026-10-19T12:02:00Z"); // 08:02 Monday in New York
    const sat = new Date("2026-10-24T12:02:00Z");
    expect(scheduleDue(s, mon, "America/New_York")).toBe(true);
    expect(scheduleDue({ ...s, last: "2026-10-19" }, mon, "America/New_York")).toBe(false);
    expect(scheduleDue(s, sat, "America/New_York")).toBe(false);
    expect(scheduleDue(s, new Date("2026-10-19T12:40:00Z"), "America/New_York")).toBe(false);
  });
});

describe("Trakt write-back", () => {
  it("parses write commands but leaves list names alone", () => {
    expect(parseWrite("add The Matrix")).toEqual({ op: "add", text: "The Matrix" });
    expect(parseWrite("seen Dune")).toEqual({ op: "watched", text: "Dune" });
    expect(parseWrite("rm Dune")).toEqual({ op: "remove", text: "Dune" });
    expect(parseWrite("connect")).toEqual({ op: "connect", text: "" });
    expect(parseWrite("watchlist")).toBeNull();
    expect(parseWrite("lists")).toBeNull();
    expect(parseWrite("")).toBeNull();
  });
  it("picks the first usable search result and builds the body", () => {
    const m = bestMatch([{ type: "person" }, { type: "movie", movie: { title: "Dune", year: 2021, ids: { trakt: 123 } } }]);
    expect(m).toEqual({ kind: "movie", title: "Dune", year: 2021, id: 123 });
    expect(syncBody(m!)).toEqual({ movies: [{ ids: { trakt: 123 } }] });
    expect(syncBody({ kind: "show", title: "x", id: 9 })).toEqual({ shows: [{ ids: { trakt: 9 } }] });
    expect(bestMatch([])).toBeNull();
    expect(bestMatch("nope")).toBeNull();
  });
  it("keeps the poll interval sane", () => {
    expect(pollSeconds(1)).toBe(5);
    expect(pollSeconds(500)).toBe(60);
    expect(pollSeconds(undefined)).toBe(5);
  });
});

describe("Saiyan, the eighth pal", () => {
  it("is a pal with a persona in every theme", () => {
    expect(agents.some((a) => a.id === "saiyan")).toBe(true);
    for (const mode of ["normal", "hellraiser", "horror", "matrix", "finalfantasy", "devteam", "cyberpunk", "dcc", "linux", "assistant"] as const) {
      const p = agentPersona("saiyan", mode === "hellraiser", mode === "horror", mode);
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.tone.length).toBeGreaterThan(20);
    }
    expect(agentName("saiyan", false, false, "cyberpunk")).toBe("Saiyan");
  });
  it("can be @mentioned", () => {
    expect(resolveMention("@saiyan help me plan", "normal")).toBe("saiyan");
    expect(resolveMention("@goals set a target", "linux")).toBe("saiyan");
  });
});

describe("Microsoft 365 (read-only)", () => {
  it("understands the commands", () => {
    expect(parseM365("connect")).toBe("connect");
    expect(parseM365("calendar")).toBe("today");
    expect(parseM365("inbox")).toBe("mail");
    expect(parseM365("")).toBe("status");
    expect(parseM365("something odd")).toBe("status");
  });
  it("shapes events and mail and never asks for bodies", () => {
    const ev = shapeEvents({ value: [{ subject: "Standup", start: { dateTime: "2026-10-20T09:30:00.0000000" }, end: { dateTime: "2026-10-20T09:45:00.0000000" }, location: { displayName: "Teams" }, isAllDay: false }, { subject: "Offsite", start: { dateTime: "2026-10-20T00:00:00" }, end: { dateTime: "2026-10-21T00:00:00" }, isAllDay: true }] });
    expect(eventsText(ev)).toBe("• 09:30–09:45  Standup (Teams)\n• All day  Offsite");
    const mail = shapeMail({ value: [{ subject: "Invoice", from: { emailAddress: { name: "Ann", address: "a@x.test" } }, body: { content: "SECRET" } }] });
    expect(mailText(mail)).toContain("Ann: Invoice");
    expect(JSON.stringify(mail)).not.toContain("SECRET");
    expect(shapeEvents(null)).toEqual([]);
    expect(eventsText([])).toContain("Nothing");
    expect(summaryPrompt(ev, mail)).toContain("Standup");
  });
});

describe("appearance", () => {
  it("round-trips and falls back safely", () => {
    expect(parseAppearance("light:large")).toEqual({ scheme: "light", size: "large" });
    expect(parseAppearance("nonsense")).toEqual({ scheme: "dark", size: "normal" });
    expect(parseAppearance(null)).toEqual({ scheme: "dark", size: "normal" });
    expect(formatAppearance({ scheme: "auto", size: "small" })).toBe("auto:small");
  });
  it("reads typed words", () => {
    const cur = { scheme: "dark" as const, size: "normal" as const };
    expect(appearanceFromWords("light", cur)).toEqual({ scheme: "light", size: "normal" });
    expect(appearanceFromWords("large, auto", cur)).toEqual({ scheme: "auto", size: "large" });
    expect(appearanceFromWords("purple", cur)).toBeNull();
    expect(appearanceFromWords("", cur)).toBeNull();
  });
  it("auto follows the device", () => {
    expect(resolveScheme("auto", true)).toBe("light");
    expect(resolveScheme("auto", false)).toBe("dark");
    expect(resolveScheme("dark", true)).toBe("dark");
  });
});

describe("Automatic model per task", () => {
  const gpu = { cpu: "Ryzen 7", cores: 16, ramGb: 32, gpus: [{ name: "RTX 3080", vramGb: 10 }], gpuSource: "nvidia-smi" as const };
  const cpu = { cpu: "i5", cores: 8, ramGb: 16, gpus: [], gpuSource: "none" as const };
  const have = [
    { name: "llama3.2:3b", gb: 2 }, { name: "qwen2.5:7b", gb: 4.7 }, { name: "qwen2.5:14b", gb: 9 }, { name: "qwen2.5:32b", gb: 20 },
    { name: "qwen2.5-coder:7b", gb: 4.7 }, { name: "deepseek-r1:7b", gb: 4.7 }, { name: "nomic-embed-text:latest", gb: 0.3 },
  ];
  it("chooses the largest model that fits the GPU, per task", () => {
    expect(bestInstalled("chat", have, gpu)).toBe("qwen2.5:7b"); // 14b needs ~11 GB, over the 10 GB card
    expect(bestInstalled("code", have, gpu)).toBe("qwen2.5-coder:7b");
    expect(bestInstalled("reasoning", have, gpu)).toBe("deepseek-r1:7b");
  });
  it("uses the smallest quick model for short messages and never the embedding model", () => {
    expect(bestInstalled("fast", have, gpu)).toBe("llama3.2:3b");
    expect(bestInstalled("fast", [{ name: "nomic-embed-text", gb: 0.3 }], gpu)).toBeNull();
  });
  it("falls back to the chat choice when a task has no model", () => {
    const onlyChat = [{ name: "qwen2.5:7b", gb: 4.7 }];
    expect(bestInstalled("code", onlyChat, gpu)).toBe("qwen2.5:7b");
    expect(bestInstalled("reasoning", onlyChat, gpu)).toBe("qwen2.5:7b");
    expect(bestInstalled("chat", [], gpu)).toBeNull();
  });
  it("is conservative on a CPU-only machine and handles unknown names", () => {
    expect(bestInstalled("chat", have, cpu)).toBe("llama3.2:3b"); // a 7B needs ~6.1 GB, just over the 6 GB CPU budget
    expect(taskOfInstalled({ name: "my-coder-model:q4", gb: 5 })).toBe("code");
    expect(taskOfInstalled({ name: "mystery:1b", gb: 1 })).toBe("fast");
    expect(parseAutoMarker("auto:code")).toBe("code");
    expect(parseAutoMarker("auto:nonsense")).toBeNull();
    expect(parseAutoMarker("qwen2.5:7b")).toBeNull();
  });
  it("pickModel turns an automatic choice into a marker the server resolves", () => {
    const base = { localChat: "auto", localCode: "auto", localReasoning: "", localFast: "qwen2.5:3b", localAuto: true, localPals: {} };
    expect(pickModel(base, { text: "fix this bug in my function" })).toBe("auto:code");
    expect(pickModel(base, { mode: "solve", text: "a question that is long enough to not be quick" })).toBe("auto:chat"); // reasoning blank = same as chat
    expect(pickModel(base, { text: "hi" })).toBe("qwen2.5:3b");
    expect(pickModel({ ...base, localAuto: false }, { text: "fix this bug in my function" })).toBe("auto:chat");
    expect(pickModel({ ...base, localPals: { nova: "phi4:14b" } }, { agentId: "nova", text: "hello there friend, how is it going today" })).toBe("phi4:14b");
  });
});

describe("calendar feeds (.ics)", () => {
  const ics = [
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:a", "SUMMARY:Standup", "DTSTART;TZID=America/New_York:20261019T093000", "DTEND;TZID=America/New_York:20261019T094500",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE", "EXDATE;TZID=America/New_York:20261021T093000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:b", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261020", "DTEND;VALUE=DATE:20261021", "END:VEVENT",
    "BEGIN:VEVENT", "UID:c", "SUMMARY:Call\\, with Ann", "DTSTART:20261020T180000Z", "DURATION:PT1H", "LOCATION:Teams", "END:VEVENT",
    "BEGIN:VEVENT", "UID:d", "SUMMARY:Cancelled", "STATUS:CANCELLED", "DTSTART:20261020T180000Z", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const from = Date.UTC(2026, 9, 19, 4);
  const to = Date.UTC(2026, 9, 27, 4);
  it("expands repeats, honours EXDATE, converts time zones and skips cancelled events", () => {
    const ev = eventsInRange(ics, from, to, "America/New_York");
    expect(ev.map((e) => e.title)).toEqual(["Standup", "Holiday", "Call, with Ann", "Standup"]);
    expect(new Date(ev[0]!.start).toISOString()).toBe("2026-10-19T13:30:00.000Z"); // 9:30 New York (EDT)
    expect(new Date(ev[3]!.start).toISOString()).toBe("2026-10-26T13:30:00.000Z"); // the Wednesday is excluded
    expect(ev[1]!.allDay).toBe(true);
    expect(ev[2]!.location).toBe("Teams");
    expect(ev[2]!.end - ev[2]!.start).toBe(3600000);
  });
  it("keeps a 9:30 meeting at 9:30 across the daylight-saving change", () => {
    const rule = ["BEGIN:VEVENT", "UID:z", "SUMMARY:Daily", "DTSTART;TZID=America/New_York:20261101T093000", "RRULE:FREQ=DAILY;COUNT=3", "END:VEVENT"].join("\n");
    const ev = eventsInRange(rule, Date.UTC(2026, 9, 31), Date.UTC(2026, 10, 5), "America/New_York");
    expect(ev.length).toBe(3);
    expect(new Date(ev[0]!.start).toISOString()).toBe("2026-11-01T14:30:00.000Z"); // 9:30 EST after the clocks change
  });
  it("ignores junk", () => {
    expect(eventsInRange("not a calendar", from, to, "UTC")).toEqual([]);
  });
});

describe("IMAP header reading", () => {
  it("decodes encoded words and sender names", () => {
    expect(decodeMimeWords("=?UTF-8?B?Q2Fmw6k=?=")).toBe("Café");
    expect(decodeMimeWords("=?ISO-8859-1?Q?Caf=E9_Noir?=")).toBe("Café Noir");
    expect(senderName('"Ann Lee" <ann@x.test>')).toBe("Ann Lee");
    expect(senderName("bob@x.test")).toBe("bob@x.test");
  });
  it("parses a FETCH reply with literals and a SEARCH reply", () => {
    const h1 = "From: Ann <a@x.test>\r\nSubject: Hello\r\n continued\r\nDate: Mon, 19 Oct 2026 10:00:00 +0000\r\n\r\n";
    const raw = `* 3 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${h1.length}}\r\n${h1})\r\n* 4 FETCH (BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {20}\r\nSubject: Two\r\n\r\n)\r\nok OK done\r\n`;
    const items = parseFetchHeaders(raw);
    expect(items.length).toBe(2);
    expect(items[0]).toEqual({ from: "Ann", subject: "Hello continued", date: "Mon, 19 Oct 2026 10:00:00 +0000" });
    expect(parseSearch("* SEARCH 4 9 12\r\nx OK\r\n")).toEqual([4, 9, 12]);
    expect(parseSearch("* SEARCH\r\n")).toEqual([]);
  });
  it("quotes credentials safely", () => {
    expect(imapQuote('pa"ss\\w')).toBe('"pa\\"ss\\\\w"');
    expect(imapQuote("bad\r\nline")).toBeNull();
  });
});
