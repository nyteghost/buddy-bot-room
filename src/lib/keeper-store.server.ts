import * as fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import {
  newKeeper,
  normalize,
  words,
  safeId,
  sensitive,
  type KeeperState,
  type Memory,
  type Scope,
} from "./assistant";
export const keeperRoot = () => process.env["BUDDY_DATA_DIR"]?.trim() ?? "";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
let chain: Promise<unknown> = Promise.resolve();
async function load(): Promise<KeeperState> {
  if (!keeperRoot()) throw Error("Persistent data is not configured");
  try {
    const raw = await fs.readFile(keeperRoot() + "/memory-keeper.json", "utf8");
    const state = JSON.parse(raw) as KeeperState;
    if (
      state.version !== 1 ||
      !Array.isArray(state.records) ||
      !Array.isArray(state.jobs) ||
      !Array.isArray(state.suppressed) ||
      !Array.isArray(state.forgotten) ||
      !state.sync
    )
      throw Error("Invalid memory database");
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return newKeeper();
    throw e;
  }
}
export function keeperTransaction<T>(fn: (s: KeeperState) => Promise<T> | T): Promise<T> {
  const work = chain.then(async () => {
    const s = await load();
    const value = await fn(s);
    await fs.mkdir(keeperRoot(), { recursive: true });
    const path = keeperRoot() + "/memory-keeper.json";
    const temporary = path + "." + randomUUID() + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(s), { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, path);
    return value;
  });
  chain = work.catch(() => undefined);
  return work;
}
export function keeperSnapshot(): Promise<KeeperState> {
  const work = chain.then(async () => structuredClone(await load()));
  chain = work.catch(() => undefined);
  return work;
}
export const versionKeep = () =>
  Math.max(1, Math.min(20, Number(process.env["MEMORY_VERSION_KEEP"]) || 20));
export function activity(s: KeeperState, text: string) {
  s.activity.unshift({ at: new Date().toISOString(), text });
  s.activity = s.activity.slice(0, 60);
}
export function fingerprint(text: string) {
  return hash(normalize(text));
}
export function invalidate(s: KeeperState, m: Memory) {
  s.epoch++;
  delete s.vectors[m.id];
  for (const src of m.sources) {
    const key = src.conversation + ":" + src.message;
    if (!s.suppressed.includes(key)) s.suppressed.push(key);
  }
  s.jobs = s.jobs.filter((j) => j.epoch === s.epoch);
}
export function validMemory(v: unknown): v is Memory {
  if (!v || typeof v !== "object") return false;
  const m = v as Memory;
  return (
    safeId(m.id) &&
    (m.category === undefined || ["fact", "idea"].includes(m.category)) &&
    (m.origin === undefined || (safeId(m.origin.capture) && safeId(m.origin.suggestion))) &&
    typeof m.title === "string" &&
    m.title.length > 0 &&
    m.title.length <= 120 &&
    typeof m.text === "string" &&
    m.text.length <= 2400 &&
    ["global", "project", "conversation", "private"].includes(m.scope) &&
    typeof m.project === "string" &&
    (!m.project || safeId(m.project)) &&
    typeof m.conversation === "string" &&
    (!m.conversation || safeId(m.conversation)) &&
    ["pending", "active", "archived", "deleted"].includes(m.status) &&
    Array.isArray(m.sources) &&
    m.sources.length <= 10 &&
    m.sources.every(
      (x) =>
        safeId(x.conversation) &&
        safeId(x.message) &&
        typeof x.quote === "string" &&
        x.quote.length <= 1000,
    ) &&
    Array.isArray(m.versions) &&
    m.versions.length <= 20 &&
    Array.isArray(m.conflicts) &&
    m.conflicts.every(safeId) &&
    typeof m.created === "string" &&
    typeof m.updated === "string" &&
    typeof m.pinned === "boolean" &&
    typeof m.verified === "boolean" &&
    typeof m.revision === "number" &&
    Number.isFinite(m.confidence) &&
    typeof m.key === "string" &&
    m.key.length <= 120
  );
}
export function createMemory(
  s: KeeperState,
  input: {
    title: string;
    text: string;
    scope: Scope;
    project?: string;
    conversation?: string;
    verified: boolean;
    sources?: Memory["sources"];
    key?: string;
    pending?: boolean;
  },
): Memory | null {
  const text = input.text.trim().slice(0, 2400),
    key = normalize(input.key ?? input.title).slice(0, 120);
  if (!text || sensitive(text) || (!input.verified && s.forgotten.includes(fingerprint(text))))
    return null;
  if (input.verified) s.forgotten = s.forgotten.filter((h) => h !== fingerprint(text));
  const duplicate = s.records.find(
    (m) =>
      m.status !== "deleted" &&
      normalize(m.text) === normalize(text) &&
      m.scope === input.scope &&
      m.project === (input.project ?? "") &&
      m.conversation === (input.conversation ?? ""),
  );
  if (duplicate) {
    if (input.verified && !input.pending && !duplicate.conflicts.length) {
      duplicate.verified = true;
      duplicate.confidence = 1;
      duplicate.status = "active";
      duplicate.revision++;
    }
    return duplicate;
  }
  if (s.records.length >= 2000) throw Error("Memory limit reached; export or remove records first");
  const conflicts = s.records
    .filter(
      (m) =>
        m.status === "active" &&
        m.key === key &&
        m.scope === input.scope &&
        m.project === (input.project ?? "") &&
        m.conversation === (input.conversation ?? ""),
    )
    .map((m) => m.id);
  const now = new Date().toISOString();
  const m: Memory = {
    id: randomUUID(),
    title: input.title.trim().slice(0, 120) || "Memory",
    text,
    scope: input.scope,
    project: input.project ?? "",
    conversation: input.conversation ?? "",
    status: input.pending || conflicts.length ? "pending" : "active",
    pinned: false,
    verified: input.verified,
    confidence: input.verified ? 1 : 0.5,
    created: now,
    updated: now,
    revision: 1,
    key,
    sources: input.sources ?? [],
    conflicts,
    versions: [],
  };
  s.records.push(m);
  activity(s, input.verified ? "Saved a user memory" : "Memory candidate ready for review");
  return m;
}
async function vaultPermissions(path: string, directory = false) {
  const raw = process.env["MEMORY_VAULT_GID"]?.trim();
  if (!raw) return;
  if (!/^\d+$/.test(raw) || +raw > 2147483647) throw Error("Invalid vault group");
  await fs.chown(path, -1, +raw);
  await fs.chmod(path, directory ? 0o2770 : 0o660);
}
export async function safeDirectory(base: string, parts: string[]): Promise<string> {
  let path = await fs.realpath(base);
  for (const part of parts) {
    if (!safeId(part) && !["Pixel Pals", "Memory"].includes(part))
      throw Error("Invalid managed folder");
    path += "/" + part;
    try {
      await fs.mkdir(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const stat = await fs.lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe managed folder");
    await vaultPermissions(path, true);
  }
  return path;
}
function markdown(m: Memory, related: Memory[] = []): string {
  return (
    "---\ntype: pixel-pals-memory-keeper\nid: " +
    m.id +
    "\ncategory: " +
    (m.category ?? "fact") +
    "\nscope: " +
    m.scope +
    "\nproject: " +
    JSON.stringify(m.project) +
    "\nconversation: " +
    JSON.stringify(m.conversation) +
    "\nverified: " +
    m.verified +
    "\nupdated: " +
    JSON.stringify(m.updated) +
    "\n---\n# " +
    m.title.replace(/[\r\n]/g, " ") +
    "\n\n" +
    m.text +
    "\n\n<!-- pixel-pals-links -->\n" +
    (m.origin
      ? "Source: Capture Inbox record `" + m.origin.capture + "`.\n"
      : m.sources
          .map(
            (src) =>
              "Source conversation `" + src.conversation + "`, message `" + src.message + "`.",
          )
          .join("\n")) +
    (related.length
      ? "\nRelated notes:\n" +
        related
          .map(
            (other) => "- [[" + other.id + "|" + other.title.replace(/[[\]|<>\r\n]/g, " ") + "]]",
          )
          .join("\n")
      : "") +
    "\n<!-- /pixel-pals-links -->\n"
  );
}
export async function syncKeeper(importEdits = false): Promise<{ note: string; count: number }> {
  const root = process.env["OBSIDIAN_VAULT_DIR"]?.trim();
  if (!root)
    return { note: "Obsidian is not mounted/configured. Memory remains on Unraid.", count: 0 };
  return keeperTransaction(async (s) => {
    let count = 0,
      conflicts = 0;
    const base = await safeDirectory(root, ["Pixel Pals", "Memory"]);
    for (const folder of [
      "Global",
      "Projects",
      "Conversations",
      "Decisions",
      "Summaries",
      "Archive",
    ])
      await safeDirectory(base, [folder]);
    const links = new Map<string, Memory[]>();
    const linkKey = (m: Memory, word: string) =>
      [m.scope, m.project, m.conversation, word].join("|");
    for (const memory of s.records) {
      if (memory.status !== "active" || memory.scope === "private") continue;
      for (const word of new Set(words(memory.title + " " + memory.text).slice(0, 50))) {
        const key = linkKey(memory, word);
        const bucket = links.get(key) ?? [];
        bucket.push(memory);
        links.set(key, bucket);
      }
    }
    const relatedFor = (memory: Memory) => {
      const related: Memory[] = [];
      const seen = new Set([memory.id]);
      for (const word of new Set(words(memory.title + " " + memory.text).slice(0, 50))) {
        for (const other of links.get(linkKey(memory, word)) ?? []) {
          if (seen.has(other.id)) continue;
          related.push(other);
          seen.add(other.id);
          if (related.length === 3) return related;
        }
      }
      return related;
    };
    for (const m of s.records) {
      const folder =
        m.status === "archived"
          ? "Archive"
          : m.scope === "global"
            ? "Global"
            : m.scope === "project"
              ? "Projects"
              : "Conversations";
      const desired = folder + "/" + m.id + ".md";
      // Remove only unchanged, application-managed copies when deleted/restricted/moved. Never follow links.
      for (const [relative, expected] of Object.entries(s.sync.hashes).filter(
        ([p]) =>
          p.endsWith("/" + m.id + ".md") &&
          (m.status === "deleted" || m.scope === "private" || p !== desired),
      )) {
        const file = base + "/" + relative;
        const stat = await fs.lstat(file).catch(() => null);
        if (stat?.isSymbolicLink()) throw Error("Unsafe memory file");
        if (stat?.isFile()) {
          const current = await fs.readFile(file, "utf8");
          if (hash(current) !== expected) {
            conflicts++;
            continue;
          }
          await fs.unlink(file);
        }
        delete s.sync.hashes[relative];
      }
      if (m.status === "deleted" || m.scope === "private") continue;
      const path = base + "/" + desired,
        stat = await fs.lstat(path).catch(() => null);
      if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw Error("Unsafe memory file");
      const current = stat ? await fs.readFile(path, "utf8") : null,
        known = s.sync.hashes[desired];
      if (current !== null && (!known || hash(current) !== known)) {
        conflicts++;
        if (importEdits && known && current.length <= 12000) {
          const body = current
            .replace(/^---\n[\s\S]*?\n---\n/, "")
            .replace(/^# [^\n]*\n\s*/, "")
            .replace(/<!-- pixel-pals-links -->[\s\S]*?<!-- \/pixel-pals-links -->/g, "")
            .trim();
          if (body && !sensitive(body) && !s.forgotten.includes(fingerprint(body))) {
            m.versions.unshift({
              text: m.text,
              at: m.updated,
              scope: m.scope,
              project: m.project,
              conversation: m.conversation,
            });
            m.versions = m.versions.slice(0, versionKeep());
            invalidate(s, m);
            m.text = body.slice(0, 2400);
            m.status = "pending";
            m.verified = false;
            m.revision++;
            m.updated = new Date().toISOString();
            s.sync.hashes[desired] = hash(current);
            activity(s, "Manual Obsidian edit imported for review");
          }
        }
        continue;
      }
      const next = markdown(m, relatedFor(m));
      if (current !== next) {
        if (current === null) await fs.writeFile(path, next, { flag: "wx", mode: 0o600 });
        else {
          const temporary = path + "." + randomUUID() + ".tmp";
          await fs.writeFile(temporary, next, { mode: 0o600, flag: "wx" });
          await fs.rename(temporary, path);
        }
        count++;
      }
      await vaultPermissions(path);
      s.sync.hashes[desired] = hash(next);
    }
    s.sync.at = new Date().toISOString();
    s.sync.note = conflicts
      ? `${conflicts} manually edited note(s) kept; review/import before overwriting.`
      : `Obsidian synced (${count} updated). Private records are not exported.`;
    return { note: s.sync.note, count };
  });
}
/** Recover readable records as private pending candidates; never guess lost permissions. */
export async function recoverKeeperMarkdown(): Promise<number> {
  const root = process.env["OBSIDIAN_VAULT_DIR"]?.trim();
  if (!root) throw Error("Obsidian unavailable");
  const base = await safeDirectory(root, ["Pixel Pals", "Memory"]);
  return keeperTransaction(async (s) => {
    let added = 0;
    for (const folder of ["Global", "Projects", "Conversations", "Decisions", "Archive"]) {
      const dir = await safeDirectory(base, [folder]);
      for (const name of (await fs.readdir(dir)).slice(0, 2000)) {
        if (!/^[a-zA-Z0-9_-]{1,80}\.md$/.test(name) || s.records.length >= 2000) continue;
        const id = name.slice(0, -3);
        if (s.records.some((m) => m.id === id && m.status === "deleted")) continue;
        const file = dir + "/" + name,
          stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 12000) continue;
        const raw = await fs.readFile(file, "utf8");
        if (!/^type: pixel-pals-memory-keeper$/m.test(raw)) continue;
        const content = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
        const title = /^# (.+)/.exec(content)?.[1] ?? "Recovered memory";
        const body = content.replace(/^# [^\n]+\n\s*/, "").trim();
        if (body && !sensitive(body) && !s.forgotten.includes(fingerprint(body))) {
          const prior = s.records.length;
          createMemory(s, {
            title,
            text: body,
            scope: "private",
            verified: false,
            pending: true,
            key: "recovered " + id,
          });
          if (s.records.length > prior) added++;
        }
      }
    }
    s.vectors = {};
    activity(s, "Managed Markdown recovered as private review candidates");
    return added;
  });
}
