import { handleSearch } from "@/lib/search.server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Conversation } from "@/lib/assistant";
import { askDiscordCompanion, handleAssistant } from "@/lib/assistant.server";
import { ownerEngineJson } from "@/lib/ask.server";
import { currentUser, ownerName } from "@/lib/accounts.server";
import { handleChat } from "@/lib/chat.server";
import { readOllamaHealth } from "@/lib/ollama-health.server";
import { keeperSnapshot, keeperTransaction } from "@/lib/keeper-store.server";
import { chatTransaction, readChatRows } from "@/lib/store.server";
vi.mock("@/lib/search.server", () => ({ handleSearch: vi.fn() }));
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn(), ownerName: vi.fn() }));
vi.mock("@/lib/ask.server", () => ({ ownerEngineJson: vi.fn() }));
vi.mock("@/lib/chat.server", () => ({ handleChat: vi.fn() }));
vi.mock("@/lib/ollama-health.server", () => ({ readOllamaHealth: vi.fn() }));
const req = (data: unknown) =>
  new Request("http://localhost/api/assistant", { method: "POST", body: JSON.stringify(data) });
const api = async (data: unknown) => {
  const r = await handleAssistant(req(data));
  const d = await r.json();
  if (!r.ok) throw Object.assign(Error(d.error), { status: r.status });
  return d;
};
let dir = "";
beforeEach(async () => {
  dir = await fs.mkdtemp(tmpdir() + "/pixel-assistant-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("BUDDY_ACCOUNTS", "1");
  vi.stubEnv("MEMORY_KEEPER_ENABLED", "off");
  vi.stubEnv("MEMORY_EMBED_MODEL", "");
  vi.stubEnv("LOCAL_ONLY_AI", "off");
  vi.stubEnv("MEMORY_CLOUD_CONTEXT", "off");
  vi.mocked(currentUser).mockReset().mockResolvedValue({ username: "owner", owner: true });
  vi.mocked(ownerName).mockReset().mockResolvedValue("owner");
  vi.mocked(ownerEngineJson).mockReset().mockResolvedValue(JSON.stringify({ kind: "local-server", localChat: "auto" }));
  vi.mocked(readOllamaHealth)
    .mockReset()
    .mockResolvedValue({
      configured: true,
      reachable: true,
      localOnly: false,
      models: [{ name: "qwen3.5:9b", gb: 5 }],
    } as Awaited<ReturnType<typeof readOllamaHealth>>);
  vi.mocked(handleSearch)
    .mockReset()
    .mockResolvedValue(Response.json({ hits: [] }));
  vi.mocked(handleChat)
    .mockReset()
    .mockImplementation(
      async () =>
        new Response(
          'data: {"type":"text-delta","id":"a","delta":"Working answer"}\n\ndata: [DONE]\n\n',
          { headers: { "x-pixelpals-model": "qwen3.5:9b" } },
        ),
    );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});
const create = async (project = "") => (await api({ op: "create", project })).conversation;
const ask = async (c: Conversation, q = "Explain Ollama", extra = {}) =>
  api({
    op: "ask",
    id: c.id,
    revision: c.assistant.revision,
    question: q,
    engine: { localChat: "auto" },
    ...extra,
  });
it("fails closed without owner sign-in or local accounts", async () => {
  vi.mocked(currentUser).mockResolvedValue(null);
  expect((await handleAssistant(req({ op: "create" }))).status).toBe(403);
  vi.stubEnv("BUDDY_ACCOUNTS", "0");
  expect((await handleAssistant(new Request("http://localhost/api/assistant"))).status).toBe(403);
  expect(handleChat).not.toHaveBeenCalled();
});
it("persists independent conversations, titles, drafts and contextual turns in existing chats.json", async () => {
  const a = await create(),
    b = await create();
  const result = await ask(a);
  const rows = await readChatRows();
  expect(rows.find((r) => r.id === a.id)!.messages).toHaveLength(2);
  expect(rows.find((r) => r.id === b.id)!.messages).toHaveLength(0);
  expect(result.conversation.title).toBe("Explain Ollama");
  expect(JSON.parse(await fs.readFile(dir + "/chats.json", "utf8"))).toHaveLength(2);
  const saved = await api({
    op: "update",
    id: b.id,
    revision: b.assistant.revision,
    patch: { draft: "My unfinished question" },
  });
  expect(saved.conversation.assistant.draft).toBe("My unfinished question");
});
it("makes Discord conversations visible and reusable through the normal General Chat API", async () => {
  const first = await askDiscordCompanion("Hello from Discord", "byte");
  expect(first).toEqual({ ok: true, text: "Working answer" });
  expect((await vi.mocked(handleChat).mock.calls.at(-1)![0].clone().json()).agentId).toBe("byte");
  const response = await handleAssistant(new Request("http://localhost/api/assistant"));
  expect(response.status).toBe(200);
  const listing = (await response.json()) as { conversations: Conversation[] };
  const companion = listing.conversations.find((c) => c.title === "Discord Companion");
  expect(companion?.mode).toBe("discord");
  expect(companion?.assistant.status).toBe("active");
  const detail = await handleAssistant(new Request("http://localhost/api/assistant?id=" + companion!.id));
  expect((await detail.json()).conversation.messages).toHaveLength(2);
  expect((await askDiscordCompanion("One more Discord question")).ok).toBe(true);
  const rows = await readChatRows();
  expect(rows.filter((r) => r.mode === "discord")).toHaveLength(1);
  expect(rows.find((r) => r.id === companion!.id)?.messages).toHaveLength(4);
  expect(vi.mocked(handleChat).mock.calls.at(-1)?.[2]).toBe(true);
});
it("supplies only relevant authorized memories and stores a memory inspector receipt", async () => {
  const home = (await api({ op: "project", name: "Homelab" })).project;
  const food = (await api({ op: "project", name: "Food" })).project;
  const c = await create(home.id);
  await api({
    op: "memory-save",
    title: "Ollama service",
    text: "Ollama runs under systemd on CachyOS",
    scope: "global",
  });
  await api({
    op: "memory-save",
    title: "Food Ollama",
    text: "Ollama food secrets",
    scope: "project",
    project: food.id,
  });
  const fresh = (
    await (await handleAssistant(new Request("http://localhost/api/assistant?id=" + c.id))).json()
  ).conversation;
  const result = await ask(fresh, "How do I restart Ollama?");
  const ctx = vi.mocked(handleChat).mock.calls[0]![1]!;
  expect(ctx).toContain("systemd");
  expect(ctx).not.toContain("food secrets");
  expect(result.conversation.messages.at(-1).metadata.memoryIds).toHaveLength(1);
  const inspector = await api({
    op: "inspect",
    id: c.id,
    messageId: result.conversation.messages.at(-1).id,
  });
  expect(inspector.memories[0].text).toContain("CachyOS");
});
it("requires scope approval for moving chats and explicit grants for private memories", async () => {
  let c = await create();
  const p = (await api({ op: "project", name: "Private project" })).project;
  await expect(
    api({ op: "update", id: c.id, revision: c.assistant.revision, patch: { project: p.id } }),
  ).rejects.toThrow("Approve");
  const privateMemory = (
    await api({
      op: "memory-save",
      title: "Ollama private host",
      text: "Ollama private endpoint details",
      scope: "private",
    })
  ).memory;
  c = (
    await (await handleAssistant(new Request("http://localhost/api/assistant?id=" + c.id))).json()
  ).conversation;
  await ask(c);
  expect(vi.mocked(handleChat).mock.calls.at(-1)![1]).not.toContain("private endpoint");
  c = (
    await (await handleAssistant(new Request("http://localhost/api/assistant?id=" + c.id))).json()
  ).conversation;
  c = (
    await api({
      op: "update",
      id: c.id,
      revision: c.assistant.revision,
      patch: { privateIds: [privateMemory.id] },
      confirmScope: true,
    })
  ).conversation;
  await ask(c);
  expect(vi.mocked(handleChat).mock.calls.at(-1)![1]).toContain("private endpoint");
});
it("corrections override old text and deletion invalidates summary, vectors, source context and receipt content", async () => {
  let c = await create();
  const m = (
    await api({
      op: "memory-save",
      title: "Ollama",
      text: "Ollama old server address",
      scope: "global",
    })
  ).memory;
  c = (
    await (await handleAssistant(new Request("http://localhost/api/assistant?id=" + c.id))).json()
  ).conversation;
  const answered = await ask(c);
  await keeperTransaction((s) => {
    s.vectors[m.id] = { hash: "h", model: "test", values: [1] };
  });
  await api({ op: "memory-action", id: m.id, revision: m.revision, action: "delete" });
  const state = await keeperSnapshot();
  expect(state.records[0]!.text).toBe("");
  expect(state.vectors[m.id]).toBeUndefined();
  expect(state.forgotten).toHaveLength(1);
  const inspect = await api({
    op: "inspect",
    id: c.id,
    messageId: answered.conversation.messages.at(-1).id,
  });
  expect(inspect.memories).toEqual([]);
  c = (
    await (await handleAssistant(new Request("http://localhost/api/assistant?id=" + c.id))).json()
  ).conversation;
  await ask(c, "Continue troubleshooting Ollama");
  await expect(
    vi.mocked(handleChat).mock.calls.at(-1)![0].clone().json(),
  ).resolves.not.toMatchObject({
    messages: expect.arrayContaining([
      expect.objectContaining({ id: answered.conversation.messages.at(-1).id }),
    ]),
  });
});
it("automatically scrubs credentials before chat inference and persistence, without touching provider credentials", async () => {
  const c = await create();
  await ask(c, "Please help with API_KEY=supersecret123");
  expect(await fs.readFile(dir + "/chats.json", "utf8")).not.toContain("supersecret123");
  const sent = await vi.mocked(handleChat).mock.calls[0]![0].clone().json();
  expect(JSON.stringify(sent.messages)).not.toContain("supersecret123");
  expect(JSON.stringify(sent.messages)).toContain("[hidden]");
  const fresh = (
    await (await handleAssistant(new Request("http://localhost/api/assistant?id=" + c.id))).json()
  ).conversation;
  await api({
    op: "update",
    id: fresh.id,
    revision: fresh.assistant.revision,
    patch: { draft: "password is supersecret123" },
  });
  expect(await fs.readFile(dir + "/chats.json", "utf8")).not.toContain("supersecret123");
});

it("archives, trashes and restores chats without losing messages or modifying legacy records", async () => {
  let c = (await ask(await create())).conversation;
  c = (
    await api({
      op: "update",
      id: c.id,
      revision: c.assistant.revision,
      patch: { status: "deleted" },
    })
  ).conversation;
  expect(c.messages).toHaveLength(2);
  await expect(ask(c)).rejects.toThrow("Restore");
  c = (
    await api({
      op: "update",
      id: c.id,
      revision: c.assistant.revision,
      patch: { status: "active" },
    })
  ).conversation;
  expect(c.messages).toHaveLength(2);
});
it("keeps unavailable providers readable, respects manual choice and Local-Only with no cloud call", async () => {
  const c = await create();
  vi.mocked(readOllamaHealth).mockResolvedValue({
    configured: true,
    reachable: false,
    state: "offline",
    remote: true,
    models: [],
    localOnly: true,
  } as Awaited<ReturnType<typeof readOllamaHealth>>);
  vi.stubEnv("LOCAL_ONLY_AI", "on");
  await expect(ask(c, "Hi", { engine: { groqKey: "fake-key" }, provider: "groq" })).rejects.toThrow(
    "Local-Only",
  );
  expect(handleChat).not.toHaveBeenCalled();
});
it("requires confirmation to carry restricted context into a fresh continuation", async () => {
  const p = (await api({ op: "project", name: "Homelab" })).project;
  const c = (await ask(await create(p.id))).conversation;
  await expect(api({ op: "continue", id: c.id })).rejects.toThrow("Approve");
  const next = (await api({ op: "continue", id: c.id, confirmScope: true })).conversation;
  expect(next.messages).toHaveLength(0);
  expect(next.assistant.continuation.id).toBe(c.id);
  expect(next.assistant.project).toBe(p.id);
});
it("rejects stale concurrent edits rather than overwriting a newer draft", async () => {
  const c = await create();
  await api({ op: "update", id: c.id, revision: c.assistant.revision, patch: { draft: "first" } });
  await expect(
    api({ op: "update", id: c.id, revision: c.assistant.revision, patch: { draft: "second" } }),
  ).rejects.toThrow("changed");
});
it("withholds vault memory when cloud fallback is used without permission", async () => {
  let c = await create();
  await api({
    op: "memory-save",
    title: "Ollama",
    text: "Ollama sensitive private setup",
    scope: "global",
  });
  c = (
    await (await handleAssistant(new Request("http://localhost/api/assistant?id=" + c.id))).json()
  ).conversation;
  vi.mocked(readOllamaHealth).mockResolvedValue({
    configured: true,
    reachable: false,
    state: "offline",
    remote: true,
    models: [],
    localOnly: false,
  } as Awaited<ReturnType<typeof readOllamaHealth>>);
  await ask(c, "Ollama?", { engine: { groqKey: "fake-key" }, provider: "auto" });
  expect(vi.mocked(handleChat).mock.calls[0]![1]).not.toContain("private setup");
});

it("scrubs live historical messages and memory versions, clears stale checkpoints and keeps non-chat configuration untouched", async () => {
  const c = await create();
  await fs.writeFile(
    dir + "/chats.json",
    JSON.stringify([
      {
        ...c,
        messages: [
          {
            id: "old-user",
            role: "user",
            parts: [{ type: "text", text: "password=old-secret-not-real" }],
          },
        ],
        assistant: { ...c.assistant, summary: "token=old-summary-secret" },
      },
    ]),
  );
  await keeperTransaction((s) => {
    const stamp = new Date().toISOString();
    s.records.push({
      id: "old-memory",
      title: "Test",
      text: "token=old-memory-secret",
      scope: "global",
      project: "",
      conversation: "",
      status: "active",
      pinned: false,
      verified: true,
      confidence: 1,
      created: stamp,
      updated: stamp,
      revision: 1,
      key: "test",
      sources: [],
      conflicts: [],
      versions: [
        {
          text: "password=old-version-secret",
          at: stamp,
          scope: "global",
          project: "",
          conversation: "",
        },
      ],
    });
  });
  await fs.writeFile(dir + "/app-secrets.json", '{"key":"intentional-settings-secret"}');
  await api({ op: "scrub-history" });
  const persisted =
    (await fs.readFile(dir + "/chats.json", "utf8")) +
    (await fs.readFile(dir + "/memory-keeper.json", "utf8"));
  for (const secret of [
    "old-secret-not-real",
    "old-summary-secret",
    "old-memory-secret",
    "old-version-secret",
  ])
    expect(persisted).not.toContain(secret);
  expect(await fs.readFile(dir + "/app-secrets.json", "utf8")).toContain(
    "intentional-settings-secret",
  );
  expect((await keeperSnapshot()).records[0]!.status).toBe("pending");
});

it("rejects missing manually assigned models without silently replacing the assignment", async () => {
  const c = await create();
  await expect(
    ask(c, "Hello", { provider: "ollama-server", model: "not-installed:7b" }),
  ).rejects.toThrow(/installed|unavailable/);
  expect(handleChat).not.toHaveBeenCalled();
});

it("restores an exported conversation as archived, collection off and without private grants", async () => {
  const c = (await ask(await create())).conversation;
  const archive = await api({ op: "export" });
  const copy = {
    ...archive,
    conversations: [
      {
        ...c,
        id: "restored-conversation",
        assistant: { ...c.assistant, privateIds: ["private-test"] },
      },
    ],
  };
  await api({ op: "restore", archive: copy, confirm: true });
  const restored = (
    await (
      await handleAssistant(new Request("http://localhost/api/assistant?id=restored-conversation"))
    ).json()
  ).conversation;
  expect(restored.messages).toHaveLength(2);
  expect(restored.assistant).toMatchObject({ status: "archived", collect: "off", privateIds: [] });
});

it("includes assistant conversations and the central memory database in the existing backup/restore path", async () => {
  const { runBackup, restoreBackup } = await import("@/lib/backup.server");
  const c = (await ask(await create())).conversation;
  await api({
    op: "memory-save",
    title: "Backup preference",
    text: "Prefers a short summary before details",
    scope: "global",
  });
  const backup = await fs.mkdtemp(tmpdir() + "/pixel-assistant-backup-");
  try {
    const cfg = { dataDir: dir, dir: backup, keep: 2, time: "03:30", tz: "UTC" };
    const made = await runBackup(cfg, new Date("2026-11-01T03:30:00Z"));
    expect(made.ok).toBe(true);
    await fs.writeFile(dir + "/chats.json", "[]");
    await fs.writeFile(dir + "/memory-keeper.json", "corrupt");
    expect((await restoreBackup(cfg, made.name!, new Date("2026-11-01T04:00:00Z"))).ok).toBe(true);
    expect((await readChatRows()).find((r) => r.id === c.id)!.messages).toHaveLength(2);
    expect((await keeperSnapshot()).records[0]!.title).toBe("Backup preference");
  } finally {
    await fs.rm(backup, { recursive: true, force: true });
  }
});

it("prevents the legacy store from forging, publishing, replacing or deleting assistant rows", async () => {
  const { handleStore } = await import("@/lib/store.server");
  const c = await create();
  const forged = await handleStore(
    new Request("http://localhost/api/store", {
      method: "PUT",
      body: JSON.stringify({ ...c, id: "forged-chat-123" }),
    }),
  );
  expect(forged.status).toBe(400);
  const overwritten = await handleStore(
    new Request("http://localhost/api/store", {
      method: "PUT",
      body: JSON.stringify({
        id: c.id,
        title: "Replacement",
        messages: [],
        theme: "normal",
        mode: "direct",
        updatedAt: new Date().toISOString(),
      }),
    }),
  );
  expect(overwritten.status).toBe(409);
  const shared = await handleStore(
    new Request("http://localhost/api/store", {
      method: "POST",
      body: JSON.stringify({ id: c.id, shared: true }),
    }),
  );
  expect(shared.status).toBe(403);
  const deleted = await handleStore(
    new Request("http://localhost/api/store?id=" + c.id, { method: "DELETE" }),
  );
  expect(deleted.status).toBe(403);
  const list = await (await handleStore(new Request("http://localhost/api/store"))).json();
  expect(list.rows).toHaveLength(0);
  expect(await readChatRows()).toHaveLength(1);
});

it("falls back from an unavailable local answer to a configured permitted key provider in Auto", async () => {
  const c = await create();
  vi.mocked(handleChat).mockResolvedValueOnce(
    Response.json({ error: "Fixture model unavailable" }, { status: 503 }),
  );
  const result = await ask(c, "Hello", { engine: { groqKey: "fixture-only-not-a-real-key" } });
  expect(result.route.provider).toBe("groq");
  expect(handleChat).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(await readChatRows())).not.toContain("fixture-only-not-a-real-key");
});

it("keeps concurrent independent chats isolated and ignores client-supplied privileged context", async () => {
  const a = await create(),
    b = await create();
  await Promise.all([
    ask(a, "Alpha independent topic", { assistantContext: "CLIENT PRIVILEGED OVERRIDE" }),
    ask(b, "Beta independent topic"),
  ]);
  const rows = await readChatRows();
  expect(rows.find((r) => r.id === a.id)!.messages).toHaveLength(2);
  expect(rows.find((r) => r.id === b.id)!.messages).toHaveLength(2);
  expect(JSON.stringify(rows.find((r) => r.id === a.id))).not.toContain("Beta independent topic");
  expect(JSON.stringify(rows.find((r) => r.id === b.id))).not.toContain("Alpha independent topic");
  for (const [, context] of vi.mocked(handleChat).mock.calls)
    expect(context).not.toContain("CLIENT PRIVILEGED OVERRIDE");
});

it("uses current web results in Auto, records real source links and starts health checks while search is pending", async () => {
  const c = await create();
  let release: ((r: Response) => void) | undefined;
  vi.mocked(handleSearch).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const asked = ask(c, "When are the midterms?", { web: "auto", timeZone: "America/New_York" });
  await vi.waitFor(() => expect(release).toBeDefined());
  expect(readOllamaHealth).toHaveBeenCalled();
  release!(
    Response.json({
      hits: [
        {
          title: "Official calendar",
          url: "https://example.test/elections",
          snippet: "Published calendar fixture",
        },
      ],
      cached: false,
    }),
  );
  const result = await asked;
  expect(result.web.state).toBe("connected");
  expect(result.conversation.messages.at(-1).metadata.web.hits[0].url).toBe(
    "https://example.test/elections",
  );
  expect(vi.mocked(handleChat).mock.calls[0]![1]).toContain("Published calendar fixture");
  expect(vi.mocked(handleChat).mock.calls[0]![1]).toContain("currentTime");
});
it("reports a search outage truthfully and keeps explicit Off from making a web request", async () => {
  const c = await create();
  vi.mocked(handleSearch).mockResolvedValue(new Response("{}", { status: 502 }));
  const result = await ask(c, "Latest news", { web: "on" });
  expect(result.web.state).toBe("unavailable");
  expect(vi.mocked(handleChat).mock.calls[0]![1]).toContain("Do not claim current verification");
  vi.mocked(handleSearch).mockClear();
  await ask(result.conversation, "Latest news", { web: "off" });
  expect(handleSearch).not.toHaveBeenCalled();
});

const streamAsk = (c: Conversation, extra = {}) =>
  handleAssistant(
    req({
      op: "ask",
      stream: true,
      id: c.id,
      revision: c.assistant.revision,
      question: "Explain Ollama",
      engine: { localChat: "auto" },
      ...extra,
    }),
  );
const events = async (r: Response) =>
  (await r.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
function controlledAnswer() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        writer = c;
      },
    }),
    { headers: { "x-pixelpals-model": "qwen3.5:9b" } },
  );
  const delta = (text: string) =>
    writer.enqueue(
      new TextEncoder().encode(
        "data: " + JSON.stringify({ type: "text-delta", delta: text }) + "\n\n",
      ),
    );
  const finish = () => {
    writer.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    writer.close();
  };
  return { response, delta, finish };
}
it("streams an early scrubbed preview before saving one complete answer and its receipts", async () => {
  const c = await create(),
    upstream = controlledAnswer();
  vi.mocked(handleChat).mockResolvedValue(upstream.response);
  const response = await streamAsk(c);
  expect(response.headers.get("content-type")).toContain("application/x-ndjson");
  expect(response.headers.get("x-accel-buffering")).toBe("no");
  const { responseLines } = await import("@/lib/assistant-stream");
  const iterator = responseLines(response)[Symbol.asyncIterator]();
  expect(JSON.parse((await iterator.next()).value!).type).toBe("status");
  await vi.waitFor(() => expect(handleChat).toHaveBeenCalled());
  upstream.delta("An early useful answer. ");
  let early;
  do {
    early = JSON.parse((await iterator.next()).value!);
  } while (early.type !== "preview" || !early.text);
  expect(early.text).toContain("early useful");
  expect((await readChatRows()).find((r) => r.id === c.id)!.messages).toHaveLength(1);
  upstream.delta("password=private-fixture-value");
  upstream.finish();
  const rest = [];
  for await (const line of { [Symbol.asyncIterator]: () => iterator }) rest.push(JSON.parse(line));
  const done = rest.find((e) => e.type === "done");
  expect(done.result.route.model).toBe("qwen3.5:9b");
  expect(done.result.conversation.messages).toHaveLength(2);
  expect(done.result.conversation.messages[1].parts[0].text).toContain("[hidden]");
  expect(JSON.stringify([early, ...rest])).not.toContain("private-fixture-value");
  expect(JSON.stringify(await readChatRows())).not.toContain("private-fixture-value");
});
it("consumer cancellation aborts inference and releases the conversation without saving a partial answer", async () => {
  const c = await create(),
    upstream = controlledAnswer();
  vi.mocked(handleChat).mockResolvedValue(upstream.response);
  const response = await streamAsk(c);
  const reader = response.body!.getReader();
  await reader.read();
  await vi.waitFor(() => expect(handleChat).toHaveBeenCalled());
  const signal = vi.mocked(handleChat).mock.calls[0]![0].signal;
  await reader.cancel();
  await vi.waitFor(() => expect(signal.aborted).toBe(true));
  const { keeperRuntime } = await import("@/lib/memory-keeper.server");
  await vi.waitFor(() => expect(keeperRuntime().active).toBe(0));
  const saved = (await readChatRows()).find((r) => r.id === c.id)!;
  expect(saved.messages).toHaveLength(1);
  vi.mocked(handleChat).mockResolvedValue(
    new Response('data: {"type":"text-delta","delta":"Retry completed"}\n\ndata: [DONE]\n\n'),
  );
  expect((await ask(saved as Conversation)).conversation.messages).toHaveLength(2);
});
it("rejects incomplete provider streams rather than persisting a partial reply", async () => {
  const c = await create();
  vi.mocked(handleChat).mockResolvedValue(
    new Response('data: {"type":"text-delta","delta":"An unfinished answer "}\n\n'),
  );
  const result = await events(await streamAsk(c, { provider: "ollama-server" }));
  expect(result.at(-1).type).toBe("error");
  expect(result.at(-1).error).toContain("disconnected");
  expect((await readChatRows()).find((r) => r.id === c.id)!.messages).toHaveLength(1);
});
it("rejects a concurrent memory restriction before further preview or final persistence", async () => {
  const c = await create(),
    upstream = controlledAnswer();
  vi.mocked(handleChat).mockResolvedValue(upstream.response);
  const response = await streamAsk(c, { provider: "ollama-server" });
  await vi.waitFor(() => expect(handleChat).toHaveBeenCalled());
  await keeperTransaction((s) => {
    s.epoch++;
  });
  upstream.delta("Restricted context must not appear. ");
  upstream.finish();
  const result = await events(response);
  expect(result.some((e) => e.type === "preview" && e.text?.includes("Restricted"))).toBe(false);
  expect(result.at(-1).type).toBe("error");
  expect((await readChatRows()).find((r) => r.id === c.id)!.messages).toHaveLength(1);
});
it("preserves concurrent conversation changes and never resurrects archived chats", async () => {
  const c = await create(),
    upstream = controlledAnswer();
  vi.mocked(handleChat).mockResolvedValue(upstream.response);
  const response = await streamAsk(c);
  await vi.waitFor(() => expect(handleChat).toHaveBeenCalled());
  const saved = (await readChatRows()).find((r) => r.id === c.id)!;
  await expect(
    api({
      op: "update",
      id: c.id,
      revision: saved.assistant!.revision,
      patch: { status: "archived" },
    }),
  ).rejects.toThrow("Stop or finish");
  // A restore/other process can still change durable state while this worker is active.
  await chatTransaction(async (rows) => {
    const row = rows.find((r) => r.id === c.id)!;
    row.assistant!.status = "archived";
    row.assistant!.revision++;
    return { rows, value: undefined };
  });
  upstream.delta("Answer no longer needed. ");
  upstream.finish();
  expect((await events(response)).at(-1).type).toBe("error");
  const archived = (await readChatRows()).find((r) => r.id === c.id)!;
  expect(archived.assistant!.status).toBe("archived");
  expect(archived.messages).toHaveLength(1);
});
it("keeps streaming owner-only and preserves provider fallback receipts", async () => {
  const c = await create();
  vi.mocked(currentUser).mockResolvedValueOnce(null);
  expect((await streamAsk(c)).status).toBe(403);
  vi.mocked(handleChat).mockResolvedValueOnce(
    Response.json({ error: "Unavailable" }, { status: 503 }),
  );
  const result = await events(await streamAsk(c, { engine: { groqKey: "fixture-only-key" } }));
  expect(result.at(-1).result.route.provider).toBe("groq");
  expect(result.at(-1).result.conversation.messages).toHaveLength(2);
});
it("keeps two active streaming conversations and their final history isolated", async () => {
  const a = await create(),
    b = await create(),
    first = controlledAnswer(),
    second = controlledAnswer();
  vi.mocked(handleChat)
    .mockResolvedValueOnce(first.response)
    .mockResolvedValueOnce(second.response);
  const ra = await streamAsk(a),
    rb = await streamAsk(b);
  await vi.waitFor(() => expect(handleChat).toHaveBeenCalledTimes(2));
  const ea = events(ra),
    eb = events(rb);
  first.delta("Only the first conversation. ");
  second.delta("Only the second conversation. ");
  second.finish();
  first.finish();
  const [doneA, doneB] = await Promise.all([ea, eb]);
  expect(doneA.at(-1).result.conversation.messages.at(-1).parts[0].text).toBe(
    "Only the first conversation.",
  );
  expect(doneB.at(-1).result.conversation.messages.at(-1).parts[0].text).toBe(
    "Only the second conversation.",
  );
});
it("replaces a failed provider preview when Auto falls back rather than combining replies", async () => {
  const c = await create();
  vi.mocked(handleChat).mockResolvedValueOnce(
    new Response(
      'data: {"type":"text-delta","delta":"Discard this failed provider reply. "}\n\ndata: {"type":"error","errorText":"fixture failure"}\n\n',
    ),
  );
  const result = await events(await streamAsk(c, { engine: { groqKey: "fixture-only-key" } }));
  expect(result.at(-1).result.route.provider).toBe("groq");
  expect(result.at(-1).result.conversation.messages.at(-1).parts[0].text).toBe("Working answer");
  const firstPreview = result.findIndex((e) => e.type === "preview" && e.text?.includes("Discard"));
  expect(firstPreview).toBeGreaterThan(0);
  expect(result.slice(firstPreview + 1).some((e) => e.type === "preview" && e.text === "")).toBe(
    true,
  );
});

/** QA: AI SDK places Strata's truncated metadata inline on finish. */
const strataFixture = () => new Response(
  'data: {"type":"text-delta","id":"reply","delta":"Only part of the local answer"}\n\n' +
  'data: {"type":"finish","finishReason":"length","messageMetadata":{"truncated":true,"finishReason":"length"}}\n\n' +
  'data: [DONE]\n\n',
  { headers: { "x-pixelpals-model": "qa-loaded-strata-model" } },
);
const useStrataQaSettings = () => {
  vi.stubEnv("STRATA_ENABLED", "on");
  vi.stubEnv("STRATA_URL", "http://100.80.10.20:8090/v1");
  vi.stubEnv("STRATA_API_KEY", "FAKE-TEST-KEY");
  vi.stubEnv("STRATA_MODEL", "qa-loaded-strata-model");
  vi.stubEnv("STRATA_FALLBACK", "off");
};
it("Strata QA P2: persists and displays truncation from inline finish metadata", async () => {
  useStrataQaSettings();
  const c = await create();
  vi.mocked(handleChat).mockResolvedValueOnce(strataFixture());
  const result = await ask(c, "Please finish this", { provider: "strata-server", engine: { kind: "strata-server" } });
  expect(result.route.provider).toBe("strata-server");
  expect(result.route.model).toBe("qa-loaded-strata-model");
  const returned = result.conversation as Conversation;
  const text = returned.messages.at(-1)!.parts[0]!.text;
  expect(text).toContain("Only part of the local answer");
  expect(text).toMatch(/token limit.*incomplete/i);
  const saved = (await readChatRows()).find(row => row.id === c.id)!;
  expect(saved.messages.at(-1)!.parts[0]).toMatchObject({ type: "text", text });
  expect(handleChat).toHaveBeenCalledTimes(1);

  const second = await create();
  vi.mocked(handleChat).mockResolvedValueOnce(strataFixture());
  const receipt = await events(await streamAsk(second, {
    provider: "strata-server", engine: { kind: "strata-server" },
  }));
  const done = receipt.at(-1);
  expect(done.type).toBe("done");
  const streamed = done.result.conversation as Conversation;
  expect(streamed.messages.at(-1)!.parts[0]!.text).toMatch(/token limit.*incomplete/i);
  expect((await readChatRows()).find(row => row.id === second.id)!.messages.at(-1)!.parts[0].text)
    .toMatch(/token limit.*incomplete/i);
});

it("Strata QA P2: General Chat preserves safe typed pre-stream auth/model/busy/offline errors", async () => {
  useStrataQaSettings();
  for (const [status, code, message] of [
    [401, "strata-auth", "Strata rejected the configured API key."],
    [409, "strata-model", "Configured Strata model is not loaded."],
    [429, "strata-busy", "Strata local inference queue is full."],
    [503, "strata-offline", "Strata is unreachable from the application server."],
  ] as const) {
    const c = await create();
    vi.mocked(handleChat).mockResolvedValueOnce(Response.json({ code, error: message }, { status }));
    const response = await handleAssistant(req({
      op: "ask", id: c.id, revision: c.assistant.revision, question: "Local private request",
      provider: "strata-server", engine: { kind: "strata-server" },
    }));
    expect(response.status).toBe(503);
    const data = (await response.json()) as { error: string };
    expect(data.error).toContain(message);
    expect(handleChat).toHaveBeenCalledTimes(1 + [401, 409, 429, 503].indexOf(status));
    expect((await readChatRows()).find(row => row.id === c.id)!.messages).toHaveLength(1);
  }
});
