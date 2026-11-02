import { beforeEach, afterEach, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { currentUser } from "@/lib/accounts.server";
import { handleCaptureInbox, homeOverview } from "@/lib/capture-inbox.server";
import { readCaptures, captureTransaction, handleCapture } from "@/lib/capture.server";
import { keeperSnapshot, keeperTransaction, createMemory } from "@/lib/keeper-store.server";
import { todaySnapshot } from "@/lib/today.server";
import { inboxMeta, parseSuggestions, fallbackSuggestion } from "@/lib/capture-inbox";
vi.mock("@/lib/accounts.server", () => ({
  currentUser: vi.fn(),
  tokenUser: vi.fn(async () => null),
}));
vi.mock("@/lib/memory-keeper.server", () => ({
  scheduleKeeper: vi.fn(),
  foregroundStart: vi.fn(async () => undefined),
  foregroundEnd: vi.fn(),
}));
vi.mock("@/lib/inbox.server", () => ({
  calendarData: vi.fn(async () => ({ configured: false, items: [], errors: [] })),
}));
let dir = "";
const req = (body: unknown) =>
  new Request("http://localhost/api/inbox", { method: "POST", body: JSON.stringify(body) });
const api = async (body?: unknown) => {
  const r = await handleCaptureInbox(body ? req(body) : new Request("http://localhost/api/inbox"));
  return { r, d: await r.json() };
};
beforeEach(async () => {
  dir = await fs.mkdtemp(tmpdir() + "/capture-review-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("MEMORY_KEEPER_ENABLED", "off");
  vi.mocked(currentUser).mockResolvedValue({ username: "owner", owner: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});
it("rejects anonymous capture access before reading or accepting private audio", async () => {
  vi.mocked(currentUser).mockResolvedValue(null);
  expect((await api()).r.status).toBe(403);
  expect((await api({ op: "add", text: "Private thought" })).r.status).toBe(403);
  expect(await fs.readdir(dir)).toEqual([]);
});
it("persists scrubbed captures without creating tasks or memories, keeping legacy take separate", async () => {
  await api({
    op: "add",
    id: "test-capture-0001",
    text: "I need to prepare lunches password=not-a-real-secret",
  });
  const rows = await readCaptures();
  expect(rows[0]!.text).not.toContain("not-a-real-secret");
  expect(rows[0]!.id).toBe("test-capture-0001");
  expect(rows[0]!.inbox!.status).toBe("pending");
  await expect(fs.stat(dir + "/today.json")).rejects.toThrow();
  await expect(fs.stat(dir + "/memory-keeper.json")).rejects.toThrow();
  const taken = await handleCapture(
    new Request("http://localhost/api/capture", {
      method: "POST",
      body: JSON.stringify({ op: "take" }),
    }),
  );
  expect((await taken.json()).items).toEqual([]);
  expect(await readCaptures()).toHaveLength(1);
});
it("makes reviewed task approval durable and idempotent, preserving first steps and estimates", async () => {
  await api({ op: "add", id: "task-source-001", text: "I need to prepare lunches" });
  let row = (await readCaptures())[0]!;
  const body = {
    op: "approve",
    id: row.id,
    revision: row.inbox!.revision,
    suggestion: "s1",
    kind: "task",
    text: "Prepare lunches",
    firstStep: "Get one container",
    minutes: 10,
    materials: ["Container"],
  };
  expect((await api(body)).r.ok).toBe(true);
  row = (await readCaptures())[0]!;
  expect((await api({ ...body, revision: row.inbox!.revision })).r.ok).toBe(true);
  const state = await todaySnapshot();
  expect(state.tasks).toHaveLength(1);
  expect(state.tasks[0]!.notes).toContain("Get one container");
  expect(state.tasks[0]!.mins).toBe(10);
  expect(row.inbox!.status).toBe("reviewed");
});
it("stores reviewed ideas in the central keeper with private scope by default and a capture source", async () => {
  await api({ op: "add", id: "idea-source-001", text: "A new desk idea" });
  const row = (await readCaptures())[0]!;
  await api({
    op: "approve",
    id: row.id,
    revision: row.inbox!.revision,
    suggestion: "s1",
    kind: "idea",
    text: "A new desk idea",
  });
  const memory = (await keeperSnapshot()).records[0]!;
  expect(memory.scope).toBe("private");
  expect(memory.category).toBe("idea");
  expect(memory.origin!.capture).toBe(row.id);
  expect(memory.sources[0]!.message).toBe(row.id);
});
it("refuses stale reviews and unauthorized project associations without modifying capture text", async () => {
  await api({ op: "add", id: "revision-source", text: "A thought" });
  const row = (await readCaptures())[0]!;
  await api({ op: "pause", id: row.id, revision: row.inbox!.revision });
  expect(
    (
      await api({
        op: "approve",
        id: row.id,
        revision: row.inbox!.revision,
        suggestion: "s1",
        kind: "memory",
        text: "A thought",
      })
    ).r.status,
  ).toBe(409);
  const fresh = (await readCaptures())[0]!;
  expect(
    (
      await api({
        op: "approve",
        id: fresh.id,
        revision: fresh.inbox!.revision,
        suggestion: "s1",
        kind: "memory",
        scope: "project",
        project: "missing",
        text: "A thought",
      })
    ).r.status,
  ).toBe(400);
  expect((await readCaptures())[0]!.text).toBe("A thought");
});
it("stores audio privately, returns it only to the owner, and deletes it with the source", async () => {
  const r = await handleCaptureInbox(
    new Request("http://localhost/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: new Uint8Array([1, 2, 3]),
    }),
  );
  expect(r.ok).toBe(true);
  const row = (await readCaptures())[0]!;
  const path = dir + "/capture-audio/" + row.inbox!.audio!.name;
  expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
  expect(row.inbox!.suggestions).toEqual([]);
  const audio = await handleCaptureInbox(new Request("http://localhost/api/inbox?audio=" + row.id));
  expect([...new Uint8Array(await audio.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(
    (await handleCaptureInbox(new Request("http://localhost/api/inbox?audio=../../secret"))).status,
  ).toBe(404);
  await api({ op: "delete", id: row.id, revision: row.inbox!.revision });
  await expect(fs.stat(path)).rejects.toThrow();
});
it("refuses overflow instead of discarding old captures and preserves corrupt input for recovery", async () => {
  await captureTransaction((rows) => {
    for (let i = 0; i < 100; i++)
      rows.push({
        id: "cap" + i,
        kind: "note",
        text: "Thought " + i,
        at: i,
        inbox: inboxMeta("Thought " + i),
      });
  });
  expect((await api({ op: "add", text: "One more" })).r.status).toBe(400);
  expect(await readCaptures()).toHaveLength(100);
  await fs.writeFile(dir + "/capture.json", "corrupt");
  expect((await api()).r.ok).toBe(false);
  expect(await fs.readFile(dir + "/capture.json", "utf8")).toBe("corrupt");
});
it("builds a read-only overview with global ideas while excluding project/private memories", async () => {
  await keeperTransaction((s) => {
    for (const scope of ["global", "private", "project"] as const) {
      const m = createMemory(s, {
        title: "Idea " + scope,
        text: "Saved " + scope + " idea",
        scope,
        project: scope === "project" ? "secret-project" : "",
        verified: true,
      })!;
      m.category = "idea";
    }
  });
  const view = await homeOverview("America/New_York");
  expect(view.idea!.text).toBe("Saved global idea");
  expect(JSON.stringify(view)).not.toContain("Saved private");
  expect(JSON.stringify(view)).not.toContain("Saved project");
  await expect(fs.stat(dir + "/today.json")).rejects.toThrow();
});
it("requires exact evidence and labels durations as bounded suggestions", () => {
  expect(
    parseSuggestions(
      [{ kind: "memory", text: "Invented fact", quote: "never said" }],
      "Original text",
    ),
  ).toEqual([]);
  const parsed = parseSuggestions(
    [
      {
        kind: "task",
        text: "Original text",
        quote: "Original",
        minutes: 99999,
        firstStep: "password=secret",
      },
    ],
    "Original text",
  );
  expect(parsed[0]!.minutes).toBe(180);
  expect(parsed[0]!.firstStep).not.toContain("secret");
  expect(fallbackSuggestion("password=secret")[0]!.text).not.toContain("secret");
});
