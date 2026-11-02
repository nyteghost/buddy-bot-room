import { handleSearch } from "@/lib/search.server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Conversation } from "@/lib/assistant";
import { handleAssistant } from "@/lib/assistant.server";
import { currentUser } from "@/lib/accounts.server";
import { handleChat } from "@/lib/chat.server";
import { readOllamaHealth } from "@/lib/ollama-health.server";
import { keeperSnapshot, keeperTransaction } from "@/lib/keeper-store.server";
import { readChatRows } from "@/lib/store.server";
vi.mock("@/lib/search.server", () => ({ handleSearch: vi.fn() }));
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
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
