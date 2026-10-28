import { currentUser } from "./accounts.server";
import { cleanFolder, fileNameFor, safeRel, titleOf, uniqueName } from "./vault";

const fail = (error: string, status = 400) => Response.json({ error }, { status });
const root = () => (process.env["OBSIDIAN_VAULT_DIR"] ?? "").trim().replace(/\/+$/, "");
const newFolder = () => cleanFolder(process.env["OBSIDIAN_NEW_FOLDER"] ?? "Pixel Pals");
const MAX_LIST = 2000;
const MAX_READ = 1_000_000;
const MAX_WRITE = 200_000;

type Entry = { path: string; title: string; mtime: number; size: number };

async function walk(fs: typeof import("node:fs/promises"), base: string, dir: string, out: Entry[]): Promise<void> {
  if (out.length >= MAX_LIST) return;
  for (const d of await fs.readdir(`${base}/${dir}`.replace(/\/$/, ""), { withFileTypes: true })) {
    if (d.name.startsWith(".") || out.length >= MAX_LIST) continue; // .obsidian, .trash, .git…
    const rel = dir ? `${dir}/${d.name}` : d.name;
    if (d.isDirectory()) await walk(fs, base, rel, out);
    else if (d.isFile() && /\.md$/i.test(d.name)) {
      const st = await fs.stat(`${base}/${rel}`);
      out.push({ path: rel, title: titleOf(rel), mtime: Math.round(st.mtimeMs), size: st.size });
    }
  }
}

/** Resolves a vault path and makes sure symlinks can't lead outside the vault. */
async function inside(fs: typeof import("node:fs/promises"), base: string, rel: string, mustExist: boolean): Promise<string | null> {
  const realBase = await fs.realpath(base);
  const full = `${base}/${rel}`;
  try {
    const real = await fs.realpath(full);
    return real.startsWith(`${realBase}/`) ? full : null;
  } catch {
    if (mustExist) return null;
    const dir = full.slice(0, full.lastIndexOf("/"));
    await fs.mkdir(dir, { recursive: true });
    const realDir = await fs.realpath(dir);
    return realDir === realBase || realDir.startsWith(`${realBase}/`) ? full : null;
  }
}

/**
 * Your Obsidian vault, mounted into the container (OBSIDIAN_VAULT_DIR). Owner only.
 * GET ?op=status | list | read&path=…     POST {op:"save", path?, title, text, mtime?} | {op:"delete", path}
 * Delete moves the note to the vault's .trash folder (Obsidian's own), it never removes it for good.
 */
export async function handleVault(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return fail("Only the owner account can use the Obsidian link.", 403);
  const base = root();
  if (!base) return Response.json({ configured: false });
  const fs = await import("node:fs/promises");
  try {
    await fs.access(base);
  } catch {
    return Response.json({ configured: true, reachable: false, error: `The vault folder ${base} isn't there. Mount your vault into the container at that path (see Settings → Obsidian).` });
  }
  try {
    if (request.method === "GET") {
      const u = new URL(request.url);
      const op = u.searchParams.get("op") ?? "list";
      if (op === "read") {
        const rel = safeRel(u.searchParams.get("path"));
        const full = rel && (await inside(fs, base, rel, true));
        if (!rel || !full) return fail("That isn't a note in the vault.", 404);
        const st = await fs.stat(full);
        if (st.size > MAX_READ) return fail("That note is too large to open here (over 1 MB).", 413);
        return Response.json({ path: rel, title: titleOf(rel), text: await fs.readFile(full, "utf8"), mtime: Math.round(st.mtimeMs) });
      }
      const notes: Entry[] = [];
      await walk(fs, base, "", notes);
      notes.sort((a, b) => b.mtime - a.mtime);
      return Response.json({ configured: true, reachable: true, newFolder: newFolder(), truncated: notes.length >= MAX_LIST, notes });
    }
    if (request.method !== "POST") return fail("Unsupported.", 405);
    const body = (await request.json().catch(() => ({}))) as { op?: unknown; path?: unknown; title?: unknown; text?: unknown; mtime?: unknown };
    if (body.op === "save") {
      const text = typeof body.text === "string" ? body.text : "";
      if (text.length > MAX_WRITE) return fail("That note is too long (200,000 characters at most).", 413);
      if (body.path) {
        const rel = safeRel(body.path);
        const full = rel && (await inside(fs, base, rel, true));
        if (!rel || !full) return fail("That isn't a note in the vault.", 404);
        const st = await fs.stat(full);
        if (typeof body.mtime === "number" && Math.abs(st.mtimeMs - body.mtime) > 1) return fail("This note changed in Obsidian after you opened it. Reopen it so nothing gets overwritten.", 409);
        await fs.writeFile(`${full}.pp-tmp`, text, "utf8");
        await fs.rename(`${full}.pp-tmp`, full);
        return Response.json({ ok: true, path: rel, mtime: Math.round((await fs.stat(full)).mtimeMs) });
      }
      const title = typeof body.title === "string" ? body.title : "";
      if (!title.trim() && !text.trim()) return fail("Give the note a title or some text.");
      const folder = newFolder();
      await fs.mkdir(folder ? `${base}/${folder}` : base, { recursive: true });
      const existing = (await fs.readdir(folder ? `${base}/${folder}` : base)).filter((n) => /\.md$/i.test(n));
      const name = uniqueName(fileNameFor(title.trim() || text.trim().split("\n")[0] || ""), existing);
      const rel = folder ? `${folder}/${name}` : name;
      const full = await inside(fs, base, rel, false);
      if (!full) return fail("That folder isn't inside the vault.", 400);
      await fs.writeFile(full, text, { encoding: "utf8", flag: "wx" });
      return Response.json({ ok: true, path: rel, mtime: Math.round((await fs.stat(full)).mtimeMs) });
    }
    if (body.op === "delete") {
      const rel = safeRel(body.path);
      const full = rel && (await inside(fs, base, rel, true));
      if (!rel || !full) return fail("That isn't a note in the vault.", 404);
      const trash = `${base}/.trash`;
      await fs.mkdir(trash, { recursive: true });
      const existing = await fs.readdir(trash);
      await fs.rename(full, `${trash}/${uniqueName(rel.split("/").pop()!, existing)}`);
      return Response.json({ ok: true });
    }
    return fail("Unknown request.");
  } catch (e) {
    return fail(`The vault couldn't be used: ${e instanceof Error ? e.message : "unknown error"}. Check the folder is mounted read-write.`, 500);
  }
}
