import { beforeEach, afterEach, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { adaptiveBrief, adaptiveDefaults, parseAdaptive } from "@/lib/adaptive-today";
import { parseTask, parseState, EMPTY } from "@/lib/today";
import { makeFocusSession } from "@/lib/focus-companion";
import { handleAdaptiveToday } from "@/lib/adaptive-today.server";
import { currentUser } from "@/lib/accounts.server";
vi.mock("@/lib/accounts.server", () => ({ currentUser: vi.fn() }));
let dir = "";
const session = makeFocusSession("Prepare lunch", "Get one container", "byte", "quiet")!;
const api = async (body?: unknown) => {
  const r = await handleAdaptiveToday(
    new Request(
      "http://localhost/api/adaptive-today",
      body ? { method: "POST", body: JSON.stringify(body) } : {},
    ),
  );
  return { r, d: await r.json() };
};
beforeEach(async () => {
  dir = await fs.mkdtemp(tmpdir() + "/adaptive-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.mocked(currentUser).mockResolvedValue({ username: "owner", owner: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});
it("migrates legacy Today without changing its tasks or requiring adaptive data", () => {
  expect(parseState(EMPTY)).toEqual(EMPTY);
  expect(parseAdaptive(undefined)).toEqual(adaptiveDefaults());
});
it("rejects nonowners before reading or writing any work context", async () => {
  vi.mocked(currentUser).mockResolvedValue(null);
  expect((await api()).r.status).toBe(403);
  expect((await api({ op: "checkpoint", session, revision: 0 })).r.status).toBe(403);
  expect(await fs.readdir(dir)).toEqual([]);
});
it("persists preferences and bounded scrubbed checkpoints in the existing store with revision conflicts", async () => {
  await fs.writeFile(
    dir + "/today.json",
    JSON.stringify({ ...EMPTY, tasks: [parseTask({ id: "existing", title: "Existing task" })] }),
  );
  expect(
    (await api({ op: "preferences", revision: 0, patch: { mode: "low", favorite: "echo" } })).r.ok,
  ).toBe(true);
  expect(
    (
      await api({
        op: "checkpoint",
        id: "resume",
        revision: 1,
        session,
        manual: true,
        state: "password=fictional-secret",
      })
    ).r.ok,
  ).toBe(true);
  expect((await api({ op: "preferences", revision: 1, patch: { mode: "focused" } })).r.status).toBe(
    409,
  );
  const stored = JSON.parse(await fs.readFile(dir + "/today.json", "utf8"));
  expect(stored.tasks[0].title).toBe("Existing task");
  expect(stored.adaptive.checkpoints[0].state).not.toContain("fictional-secret");
  expect((await api()).d.adaptive.mode).toBe("low");
  expect(stored.adaptive.revision).toBe(2);
  expect((await fs.stat(dir + "/today.json")).mode & 0o777).toBe(0o600);
  await expect(fs.stat(dir + "/memory-keeper.json")).rejects.toThrow();
});
it("keeps three prior versions and restores an exact next action", async () => {
  for (let i = 0; i < 5; i++)
    expect(
      (
        await api({
          op: "checkpoint",
          id: "resume",
          revision: i,
          session: { ...session, step: "Step " + i },
        })
      ).r.ok,
    ).toBe(true);
  const before = (await api()).d.adaptive.checkpoints[0];
  expect(before.history).toHaveLength(3);
  expect((await api({ op: "restore", id: "resume", revision: 5, index: 0 })).r.ok).toBe(true);
  expect((await api()).d.adaptive.checkpoints[0].session.step).toBe("Step 1");
  expect((await api({ op: "delete", id: "resume", revision: 6 })).r.ok).toBe(true);
  expect((await api()).d.adaptive.checkpoints).toEqual([]);
});
it("refuses unknown projects and preserves malformed persisted data", async () => {
  expect((await api({ op: "checkpoint", revision: 0, session, project: "unknown" })).r.status).toBe(
    400,
  );
  const corrupt = JSON.stringify({ ...EMPTY, adaptive: { version: 99 } });
  await fs.writeFile(dir + "/today.json", corrupt);
  expect((await api({ op: "preferences", revision: 0, patch: { mode: "low" } })).r.ok).toBe(false);
  expect(await fs.readFile(dir + "/today.json", "utf8")).toBe(corrupt);
});
it("offers one fitting low-energy task and at most two alternatives without future-day tasks", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const tasks = [
    parseTask({ id: "long", title: "Long", mins: 90, tier: "must", energy: "high" }),
    parseTask({ id: "short", title: "Short", mins: 5, energy: "low" }),
    parseTask({ id: "future", title: "Tomorrow", at: now + 86400000 }),
    ...Array.from({ length: 4 }, (_, i) =>
      parseTask({ id: "other" + i, title: "Other", mins: 10 }),
    ),
  ].filter((t) => t !== null);
  const brief = adaptiveBrief(
    tasks,
    [
      {
        id: "event",
        title: "Scheduled appointment",
        start: now + 15 * 60000,
        end: now + 30 * 60000,
        allDay: false,
        kind: "calendar",
      },
    ],
    { ...adaptiveDefaults(), mode: "low" },
    now,
    "America/New_York",
  );
  expect(brief.task!.id).toBe("short");
  expect(brief.available).toBe(10);
  expect(brief.later).toHaveLength(2);
  expect(brief.alternatives.some((t) => t.id === "future")).toBe(false);
});
