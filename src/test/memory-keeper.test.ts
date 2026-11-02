import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { newMeta, type Conversation } from "@/lib/assistant";
import { chatTransaction, readChatRows } from "@/lib/store.server";
import { keeperSnapshot, keeperTransaction } from "@/lib/keeper-store.server";
import {
  processKeeperQueue,
  foregroundStart,
  foregroundEnd,
  enqueueKeeper,
} from "@/lib/memory-keeper.server";
import { readOllamaHealth } from "@/lib/ollama-health.server";
vi.mock("@/lib/ollama-health.server", () => ({ readOllamaHealth: vi.fn() }));
let dir = "";
const c: Conversation = {
  id: "chat0001",
  title: "Chat",
  theme: "normal",
  mode: "direct",
  updatedAt: "2026-11-01",
  owner: "owner",
  shared: false,
  assistant: newMeta(),
  messages: [
    {
      id: "message001",
      role: "user",
      parts: [{ type: "text", text: "I prefer dark colours for app interfaces." }],
    },
    { id: "message002", role: "assistant", parts: [{ type: "text", text: "Noted." }] },
  ],
};
const checkpoint = {
  summary: {
    overview: "UI preference discussed",
    decisions: [],
    tasks: ["Review interface"],
    questions: [],
  },
  memories: [
    {
      title: "Colour preference",
      text: "Prefers dark colours in apps",
      quote: "I prefer dark colours",
      key: "ui colours",
    },
  ],
};
function reset() {
  const g = globalThis as typeof globalThis & {
    __pixelKeeper?: { timer?: ReturnType<typeof setTimeout> };
  };
  if (g.__pixelKeeper?.timer) clearTimeout(g.__pixelKeeper.timer);
  delete g.__pixelKeeper;
}
beforeEach(async () => {
  reset();
  dir = await fs.mkdtemp(tmpdir() + "/keeper-worker-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("MEMORY_KEEPER_ENABLED", "on");
  vi.stubEnv("MEMORY_KEEPER_MODEL", "auto");
  vi.stubEnv("MEMORY_OBSIDIAN_SYNC", "off");
  vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:11435");
  vi.mocked(readOllamaHealth).mockResolvedValue({
    configured: true,
    reachable: true,
    state: "connected",
    remote: true,
    localOnly: false,
    models: [
      { name: "small:3b", gb: 2 },
      { name: "big:9b", gb: 6 },
    ],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ response: JSON.stringify(checkpoint) })),
  );
  await chatTransaction(async () => ({ rows: [structuredClone(c)], value: undefined }));
});
afterEach(async () => {
  reset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await fs.rm(dir, { recursive: true, force: true });
});
it("uses one smaller local model and stores an incremental checkpoint plus source-backed review candidates", async () => {
  await enqueueKeeper(c);
  await processKeeperQueue();
  const s = await keeperSnapshot();
  expect(s.records[0]!.status).toBe("pending");
  expect(s.records[0]!.sources[0]!.message).toBe("message001");
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(body.model).toBe("small:3b");
  expect(body.keep_alive).toBe(0);
  expect((await readChatRows())[0]!.assistant!.summary).toContain("Review interface");
  expect((await readChatRows())[0]!.assistant!.processed).toBe(2);
  expect(s.jobs).toHaveLength(0);
});
it("rejects fabricated evidence and never learns facts only asserted by an assistant", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      response: JSON.stringify({
        ...checkpoint,
        memories: [
          { ...checkpoint.memories[0], quote: "A fabricated quote not in the conversation" },
        ],
      }),
    }),
  );
  await processKeeperQueue();
  expect((await keeperSnapshot()).records).toHaveLength(0);
});
it("retains queued work with bounded backoff when Ollama is offline", async () => {
  vi.mocked(readOllamaHealth).mockResolvedValue({
    configured: true,
    reachable: false,
    state: "offline",
    remote: true,
    models: [],
    localOnly: false,
  });
  await processKeeperQueue();
  const s = await keeperSnapshot();
  expect(s.jobs[0]!.state).toBe("pending");
  expect(s.jobs[0]!.next).toBeGreaterThan(Date.now());
  expect(fetch).not.toHaveBeenCalled();
});
it("does not process unchanged conversations again and never creates a worker per chat", async () => {
  await processKeeperQueue();
  await processKeeperQueue();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("foreground answers pause background processing without dropping queued conversation updates", async () => {
  await enqueueKeeper(c);
  await foregroundStart();
  await processKeeperQueue();
  expect(fetch).not.toHaveBeenCalled();
  expect((await keeperSnapshot()).jobs).toHaveLength(1);
  foregroundEnd();
  await processKeeperQueue();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("refuses missing configured memory models instead of silently changing intentional choices", async () => {
  vi.stubEnv("MEMORY_KEEPER_MODEL", "missing:3b");
  await processKeeperQueue();
  expect(fetch).not.toHaveBeenCalled();
  expect((await keeperSnapshot()).jobs[0]!.note).toContain("model unavailable");
});
it("deleted-source and stale memory-derived messages cannot reappear in a new summary prompt", async () => {
  await keeperTransaction((s) => {
    s.epoch = 2;
    s.suppressed = ["chat0001:message001"];
  });
  await chatTransaction(async (rows) => {
    const r = rows[0] as Conversation;
    r.messages[1]!.metadata = { memoryIds: ["deleted"], memoryEpoch: 1 };
    return { rows, value: undefined };
  });
  await processKeeperQueue();
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(JSON.parse(body.prompt).messages).toEqual([]);
});
