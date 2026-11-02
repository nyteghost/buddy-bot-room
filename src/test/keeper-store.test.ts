import { beforeEach, afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createMemory,
  keeperTransaction,
  keeperSnapshot,
  syncKeeper,
  recoverKeeperMarkdown,
  invalidate,
  fingerprint,
} from "@/lib/keeper-store.server";
let dir = "",
  vault = "";
beforeEach(async () => {
  dir = await fs.mkdtemp(tmpdir() + "/keeper-");
  vault = await fs.mkdtemp(tmpdir() + "/keeper-vault-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("OBSIDIAN_VAULT_DIR", vault);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(vault, { recursive: true, force: true });
});
const save = async (scope: "global" | "private" = "global") =>
  keeperTransaction((s) =>
    createMemory(s, {
      title: "Ollama service",
      text: "Ollama runs under systemd",
      scope,
      verified: true,
    })!,
  );
it("serializes concurrent writes and reloads durable state without relying on in-memory records", async () => {
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      keeperTransaction((s) =>
        createMemory(s, {
          title: "Preference " + i,
          text: "Distinct preference " + i,
          scope: "global",
          verified: true,
        }),
      ),
    ),
  );
  const raw = JSON.parse(await fs.readFile(dir + "/memory-keeper.json", "utf8"));
  expect(raw.records).toHaveLength(20);
  expect((await keeperSnapshot()).records).toHaveLength(20);
  expect((await fs.stat(dir + "/memory-keeper.json")).mode & 0o777).toBe(0o600);
});
it("deduplicates scoped facts and holds contradictions for explicit approval", async () => {
  const a = await save();
  await save();
  await keeperTransaction((s) =>
    createMemory(s, {
      title: "Ollama service",
      text: "Ollama runs as a container",
      scope: "global",
      verified: false,
    }),
  );
  const state = await keeperSnapshot();
  expect(state.records).toHaveLength(2);
  expect(state.records[1]!.status).toBe("pending");
  expect(state.records[1]!.conflicts).toEqual([a.id]);
});
it("mirrors managed Markdown while excluding private memory and leaving existing notes alone", async () => {
  const a = await save();
  await save("private");
  await fs.writeFile(vault + "/Existing.md", "Untouched");
  await syncKeeper();
  const md = await fs.readFile(vault + "/Pixel Pals/Memory/Global/" + a.id + ".md", "utf8");
  expect(md).toContain("type: pixel-pals-memory-keeper");
  expect(md).toContain("systemd");
  expect(await fs.readFile(vault + "/Existing.md", "utf8")).toBe("Untouched");
  expect(await fs.readdir(vault + "/Pixel Pals/Memory/Conversations")).toHaveLength(0);
});
it("detects manual edits without overwrite and imports them only as pending review", async () => {
  const a = await save();
  await syncKeeper();
  const path = vault + "/Pixel Pals/Memory/Global/" + a.id + ".md";
  const manual = (await fs.readFile(path, "utf8")).replace("systemd", "a manually updated service");
  await fs.writeFile(path, manual);
  await syncKeeper();
  expect(await fs.readFile(path, "utf8")).toBe(manual);
  await syncKeeper(true);
  const state = await keeperSnapshot();
  expect(state.records[0]!.status).toBe("pending");
  expect(state.records[0]!.verified).toBe(false);
  expect(state.records[0]!.text).toContain("manually updated");
  expect(state.records[0]!.versions).toHaveLength(1);
});
it("removes unchanged mirrored files on restriction but preserves a conflicting manual note", async () => {
  const a = await save();
  await syncKeeper();
  await keeperTransaction((s) => {
    const m = s.records[0]!;
    invalidate(s, m);
    m.scope = "private";
  });
  await syncKeeper();
  await expect(fs.stat(vault + "/Pixel Pals/Memory/Global/" + a.id + ".md")).rejects.toThrow();
});
it("refuses directory and file symlinks rather than writing outside the vault", async () => {
  await fs.symlink(dir, vault + "/Pixel Pals");
  await save();
  await expect(syncKeeper()).rejects.toThrow("Unsafe");
  expect(await fs.readdir(dir)).toEqual(["memory-keeper.json"]);
});
it("can recover Markdown after database loss as private pending records, with no assumed old permissions", async () => {
  await save();
  await syncKeeper();
  await fs.unlink(dir + "/memory-keeper.json");
  expect(await recoverKeeperMarkdown()).toBe(1);
  const s = await keeperSnapshot();
  expect(s.records[0]!.scope).toBe("private");
  expect(s.records[0]!.status).toBe("pending");
});
it("does not resurrect forgotten text on automatic extraction or Markdown recovery", async () => {
  const m = await save();
  await syncKeeper();
  await keeperTransaction((s) => {
    const r = s.records[0]!;
    invalidate(s, r);
    s.forgotten.push(fingerprint(r.text));
    r.status = "deleted";
    r.text = "";
    r.versions = [];
  });
  await keeperTransaction((s) => {
    expect(
      createMemory(s, { title: "Same fact", text: m.text, scope: "global", verified: false }),
    ).toBeNull();
  });
  expect(await recoverKeeperMarkdown()).toBe(0);
});
it("filesystem failure preserves the previous database and does not reset it to an empty store", async () => {
  await save();
  await fs.writeFile(dir + "/memory-keeper.json", "corrupt");
  await expect(keeperSnapshot()).rejects.toThrow();
  expect(await fs.readFile(dir + "/memory-keeper.json", "utf8")).toBe("corrupt");
});

it("adds same-scope Obsidian backlinks without linking private or other-project notes", async () => {
  const a = await save();
  await keeperTransaction((s) => {
    createMemory(s, {
      title: "Ollama daemon",
      text: "Ollama daemon uses systemd",
      scope: "global",
      verified: true,
    });
    createMemory(s, {
      title: "Private Ollama daemon",
      text: "Ollama daemon private detail",
      scope: "private",
      verified: true,
    });
    createMemory(s, {
      title: "Project Ollama daemon",
      text: "Ollama daemon project detail",
      scope: "project",
      project: "other",
      verified: true,
    });
  });
  await syncKeeper();
  const md = await fs.readFile(vault + "/Pixel Pals/Memory/Global/" + a.id + ".md", "utf8");
  expect(md).toContain("Related notes:");
  expect(md).not.toContain("Private Ollama");
  expect(md).not.toContain("Project Ollama");
});
