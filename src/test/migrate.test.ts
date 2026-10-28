import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, migrationText, parseRecord, runMigrations, type KV, type Migration } from "../lib/migrate";
import { dataFolderKV } from "../lib/migrate.server";

const memory = (init: Record<string, string> = {}) => {
  const data = new Map(Object.entries(init));
  const kv: KV = { get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k) };
  return { kv, data };
};
const REC = "version.json";
const rec = (data: Map<string, string>) => parseRecord(data.get(REC) ?? null);

describe("migration runner", () => {
  it("runs pending migrations in order and records them", async () => {
    const { kv, data } = memory({ a: "1" });
    const log: number[] = [];
    const list: Migration[] = [
      { id: 1, name: "one", keys: ["a"], up: (k) => { log.push(1); k.set("a", "2"); } },
      { id: 2, name: "two", keys: ["b"], up: (k) => { log.push(2); k.set("b", "x"); } },
    ];
    const r = await runMigrations(kv, list, REC, () => 5);
    expect(log).toEqual([1, 2]);
    expect(r).toMatchObject({ from: 0, to: 2, ran: [1, 2] });
    expect(data.get("a")).toBe("2");
    expect(rec(data).version).toBe(2);
    expect(rec(data).pending).toBeUndefined();
    // already current: nothing runs again
    expect((await runMigrations(kv, list, REC)).ran).toEqual([]);
  });
  it("undoes a failing migration and keeps the app on the old version", async () => {
    const { kv, data } = memory({ a: "keep", b: "keep" });
    const list: Migration[] = [
      { id: 1, name: "ok", keys: [], up: () => undefined },
      { id: 2, name: "bad", keys: ["a", "b", "c"], up: (k) => { k.set("a", "broken"); k.remove("b"); k.set("c", "new"); throw new Error("disk said no"); } },
      { id: 3, name: "never", keys: ["d"], up: (k) => k.set("d", "x") },
    ];
    const r = await runMigrations(kv, list, REC);
    expect(r.failed).toMatchObject({ id: 2, error: "disk said no" });
    expect(r.to).toBe(1);
    expect(data.get("a")).toBe("keep");
    expect(data.get("b")).toBe("keep");
    expect(data.has("c")).toBe(false);
    expect(data.has("d")).toBe(false);
    expect(rec(data).history.map((h) => h.result)).toEqual(["ok", "failed"]);
    expect(migrationText(r, rec(data))).toMatch(/failed and was undone/);
  });
  it("recovers from a run that was cut off in the middle, then retries once", async () => {
    const { kv, data } = memory({ a: "orig" });
    let crash = true;
    const list: Migration[] = [{ id: 1, name: "half", keys: ["a"], up: (k) => { k.set("a", "half-written"); if (crash) throw new Error("x"); k.set("a", "done"); } }];
    // Simulate a hard kill: the process dies after the pending record and a partial write, so nothing runs the failure path.
    data.set("a", "half-written");
    data.set(REC, JSON.stringify({ version: 0, skipped: [], history: [], pending: { id: 1, startedAt: 1, attempts: 1, saved: { a: "orig" } } }));
    crash = false;
    const r = await runMigrations(kv, list, REC);
    expect(r.recovered).toBe(1);
    expect(r.ran).toEqual([1]);
    expect(data.get("a")).toBe("done");
    expect(rec(data).version).toBe(1);
    expect(rec(data).history.map((h) => h.result)).toEqual(["rolled-back", "ok"]);
  });
  it("gives up on a migration that keeps getting interrupted, instead of looping forever", async () => {
    const { kv, data } = memory({ a: "orig" });
    const list: Migration[] = [
      { id: 1, name: "stuck", keys: ["a"], up: (k) => k.set("a", "x") },
      { id: 2, name: "after", keys: [], up: () => undefined },
    ];
    data.set(REC, JSON.stringify({ version: 0, skipped: [], history: [], pending: { id: 1, startedAt: 1, attempts: MAX_ATTEMPTS, saved: { a: "orig" } } }));
    data.set("a", "garbage");
    const r = await runMigrations(kv, list, REC);
    expect(data.get("a")).toBe("orig");
    expect(r.skipped).toEqual([1]);
    expect(r.ran).toEqual([]);
    expect(rec(data).version).toBe(0);
    expect(migrationText(r, rec(data))).toMatch(/Skipped migration 1/);
    // and the next start does not try again
    expect((await runMigrations(kv, list, REC)).ran).toEqual([]);
  });
  it("rejects bad migration lists and reads damaged records as version 0", async () => {
    await expect(runMigrations(memory().kv, [{ id: 2, name: "a", keys: [], up: () => undefined }, { id: 2, name: "b", keys: [], up: () => undefined }], REC)).rejects.toThrow(/strictly increasing/);
    expect(parseRecord("{not json")).toEqual({ version: 0, skipped: [], history: [] });
    expect(parseRecord(JSON.stringify({ version: -3, skipped: ["x", 4] })).version).toBe(0);
    expect(parseRecord(JSON.stringify({ version: 2, skipped: ["x", 4] })).skipped).toEqual([4]);
  });
});

describe("data folder key-value store", () => {
  it("only accepts plain file names", async () => {
    const kv = dataFolderKV("/nonexistent-root");
    await expect(Promise.resolve().then(() => kv.set("../evil", "x"))).rejects.toThrow(/Not a data file name/);
    await expect(Promise.resolve().then(() => kv.get("a/b"))).resolves.toBeNull();
  });
});

describe("data folder on disk", () => {
  it("writes atomically, reads back, removes, and survives a full migration run", async () => {
    const { mkdtemp, readdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/pp-migrate-`);
    try {
      const kv = dataFolderKV(root);
      await kv.set("x.json", "1");
      expect(await kv.get("x.json")).toBe("1");
      const r = await runMigrations(kv, [{ id: 1, name: "t", keys: ["x.json"], up: (k) => k.set("x.json", "2") }], "data-version.json");
      expect(r.ran).toEqual([1]);
      expect(await kv.get("x.json")).toBe("2");
      expect(JSON.parse((await kv.get("data-version.json")) ?? "{}").version).toBe(1);
      await kv.remove("x.json");
      expect(await kv.get("x.json")).toBeNull();
      expect((await readdir(root)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
