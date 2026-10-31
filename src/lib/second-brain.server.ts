import { randomUUID, createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { SECOND_BRAIN_CATEGORIES, brainRelativePath, searchBrainNotes, type BrainNote } from "./second-brain";

const root = () => process.env["OBSIDIAN_VAULT_DIR"]?.trim() ?? "";
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const uid = /^[a-zA-Z0-9_-]{1,64}$/;
type StoredNote = { note: BrainNote; file: string; text: string };
function validNote(value: unknown): value is BrainNote {
  if (!value || typeof value !== "object") return false;
  const n = value as BrainNote;
  return typeof n.id === "string" && uid.test(n.id) && SECOND_BRAIN_CATEGORIES.includes(n.category) &&
    typeof n.title === "string" && !!n.title.trim() && n.title.length <= 100 && !/[\r\n\0]/.test(n.title) &&
    typeof n.body === "string" && n.body.length <= 4000 &&
    typeof n.createdAt === "string" && Number.isFinite(Date.parse(n.createdAt)) &&
    typeof n.updatedAt === "string" && Number.isFinite(Date.parse(n.updatedAt)) &&
    Array.isArray(n.tags) && n.tags.length <= 15 && n.tags.every(t => typeof t === "string" && t.length <= 40) &&
    ["user-confirmed", "explicit-save", "task-progress"].includes(n.source);
}
const stringify = (n: BrainNote) => "---\ntype: pixel-pals-second-brain\nid: " + n.id + "\ncategory: " + JSON.stringify(n.category) +
  "\ncreated: " + JSON.stringify(n.createdAt) + "\nupdated: " + JSON.stringify(n.updatedAt) + "\nsource: " + JSON.stringify(n.source) +
  "\ntags: " + JSON.stringify(n.tags) + "\n---\n# " + n.title + "\n\n" + n.body + "\n";

/** Check each directory before creating children: a symlink must never cause writes outside the vault. */
async function directory(base: string, parts: string[], create = false): Promise<string | null> {
  let dir = base;
  for (const part of parts) {
    dir += "/" + part;
    if (create) { try { await fs.mkdir(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; } }
    let stat;
    try { stat = await fs.lstat(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Unsafe vault directory");
  }
  return dir;
}
async function load(base: string): Promise<StoredNote[]> {
  const rows: StoredNote[] = [];
  for (const category of SECOND_BRAIN_CATEGORIES) {
    const dir = await directory(base, ["PixelPals", category]);
    if (!dir) continue;
    for (const name of (await fs.readdir(dir)).sort().slice(0, 300)) {
      if (!/^[^/\\]+--[a-zA-Z0-9_-]{1,64}\.md$/.test(name)) continue;
      const file = dir + "/" + name;
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 15000) continue;
      const text = (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
      if (!text.startsWith("---\n") || !/^type: pixel-pals-second-brain$/m.test(text)) continue;
      const end = text.indexOf("\n---\n", 4);
      if (end < 0) continue;
      const meta = text.slice(4, end);
      const content = text.slice(end + 5);
      const field = (key: string) => new RegExp("^" + key + ": (.+)$", "m").exec(meta)?.[1];
      try {
        const note: BrainNote = {
          id: field("id") ?? "", category, title: /^# (.+)\n/.exec(content)?.[1] ?? "",
          body: content.replace(/^# [^\n]+\n+/, "").trim(), createdAt: JSON.parse(field("created") ?? '""'),
          updatedAt: JSON.parse(field("updated") ?? '""'), source: JSON.parse(field("source") ?? '""'),
          tags: JSON.parse(field("tags") ?? "[]"), revision: hash(text),
        };
        if (validNote(note)) rows.push({ note, file, text });
      } catch { /* Leave unrelated or malformed Markdown untouched. */ }
      if (rows.length >= 200) return rows;
    }
  }
  return rows;
}
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> { const next = chain.then(fn, fn); chain = next.catch(() => undefined); return next; }
export async function handleSecondBrain(req: Request): Promise<Response> {
  if (!root()) return response({ configured: false, notes: [] }, 404);
  const user = accountsEnabled(process.env) ? await currentUser(req) : null;
  if (accountsEnabled(process.env) && !user?.owner) return response({ error: "Owner only" }, 403);
  if (!["GET", "POST"].includes(req.method)) return response({ error: "Unsupported" }, 405);
  try {
    const base = await fs.realpath(root());
    if (req.method === "GET") {
      const notes = (await load(base)).map(row => row.note);
      const q = new URL(req.url).searchParams.get("q")?.slice(0, 200) ?? "";
      return response({ configured: true, notes: q ? searchBrainNotes(q, notes, 10) : notes });
    }
    const raw = await req.text();
    if (raw.length > 12000) return response({ error: "Request too large" }, 413);
    let data: { op?: string; note?: unknown; id?: string; revision?: string };
    try { data = JSON.parse(raw); } catch { return response({ error: "Invalid JSON" }, 400); }
    if (!data || typeof data !== "object") return response({ error: "Invalid request" }, 400);
    return await locked(async () => {
      const rows = await load(base);
      if (data.op === "save" && validNote(data.note)) {
        const n = data.note;
        const existing = rows.find(row => row.note.id === n.id);
        if ((existing && data.revision !== existing.note.revision) || (!existing && data.revision))
          return response({ error: "Note changed or was removed. Refresh before editing; your draft has been kept." }, 409);
        if (!existing && rows.length >= 200) return response({ error: "Note limit reached" }, 413);
        if (existing && n.category !== existing.note.category) return response({ error: "Keep the existing category when editing." }, 400);
        // Keep the actual filename on edits, including notes renamed in Obsidian.
        const file = existing?.file ?? base + "/" + brainRelativePath(n);
        await directory(base, ["PixelPals", n.category], true);
        const next: BrainNote = { ...n, createdAt: existing?.note.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
        let text = stringify(next);
        if (existing) {
          // Keep custom Obsidian frontmatter while updating only fields owned by Pixel Pals.
          const fields = new Map(text.slice(4, text.indexOf("\n---\n", 4)).split("\n").map(line => [line.split(":")[0], line]));
          const end = existing.text.indexOf("\n---\n", 4);
          const meta = existing.text.slice(4, end).replace(/^(type|id|category|created|updated|source|tags):[^\n]*$/gm, (line, key: string) => fields.get(key) ?? line);
          text = "---\n" + meta + "\n---\n# " + next.title + "\n\n" + next.body + "\n";
        }
        const temp = file + "." + randomUUID() + ".tmp";
        try {
          await fs.writeFile(temp, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
          if (existing) {
            const st = await fs.lstat(file);
            if (!st.isFile() || st.isSymbolicLink() || hash((await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n")) !== data.revision)
              return response({ error: "Note changed. Refresh before editing; your draft has been kept." }, 409);
            await fs.rename(temp, file);
          } else {
            // Exclusive creation cannot overwrite an unrelated Markdown file or a symlink.
            await fs.copyFile(temp, file, (await import("node:fs")).constants.COPYFILE_EXCL);
          }
        } finally { await fs.unlink(temp).catch(() => undefined); }
        return response({ ok: true, note: { ...next, revision: hash(text) } });
      }
      if (data.op === "trash" && typeof data.id === "string") {
        const row = rows.find(row => row.note.id === data.id);
        if (!row) return response({ error: "Note not found" }, 404);
        if (data.revision !== row.note.revision) return response({ error: "Note changed. Refresh before deleting." }, 409);
        const trash = await directory(base, [".trash"], true);
        await fs.rename(row.file, trash + "/" + row.note.id + "-" + randomUUID() + ".md");
        return response({ ok: true });
      }
      return response({ error: "Invalid request" }, 400);
    });
  } catch { return response({ error: "Could not safely access Second Brain. Check the vault mount and folder permissions." }, 500); }
}
