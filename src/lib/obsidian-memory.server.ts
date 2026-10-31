import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { parseMemoryNote, renderMemoryNote } from "./obsidian-memory";
const folder = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim();
const path = () => folder() + "/obsidian/Pixel Pals Memory.md";
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const sha = async (text: string) => (await import(/* @vite-ignore */ "node:" + "crypto") as typeof import("node:crypto")).createHash("sha256").update(text).digest("hex");
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> { const work = chain.then(fn, fn); chain = work.catch(() => undefined); return work; }
async function read(): Promise<string> { try { return await (await fs()).readFile(path(), "utf8"); } catch (e) { if ((e as { code?: string }).code === "ENOENT") return ""; throw e; } }
export async function handleObsidianMemory(request: Request): Promise<Response> {
 if (!folder()) return Response.json({ error: "Persistent data folder unavailable" }, { status: 404 });
 const user = accountsEnabled(process.env) ? await currentUser(request) : null;
 if (accountsEnabled(process.env) && !user?.owner) return Response.json({ error: "Owner only" }, { status: 403 });
 const reply = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
 try {
  if (request.method === "GET") {
   const current = await read();
   return reply({ memories: current ? parseMemoryNote(current) : { memories: [], pal: {}, project: {} }, revision: await sha(current), exists: !!current });
  }
  if (request.method !== "PUT") return reply({ error: "Invalid method" }, 405);
  const raw = await request.text();
  if (raw.length > 150000) return reply({ error: "Too large" }, 413);
  const body = JSON.parse(raw) as { revision?: string; memories?: ReturnType<typeof parseMemoryNote> };
  if (typeof body.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision) || !body.memories || !Array.isArray(body.memories.memories) || body.memories.memories.length > 100) return reply({ error: "Invalid memory payload" }, 400);
  return await locked(async () => {
   const before = await read();
   if (body.revision !== await sha(before)) return reply({ error: "Obsidian was edited since your last load. Reload to avoid overwriting it." }, 409);
   const md = renderMemoryNote(body.memories);
   if (md.length > 150000) return reply({ error: "Memory note too large" }, 413);
   const f = await fs();
   await f.mkdir(folder() + "/obsidian", { recursive: true });
   await f.writeFile(path() + ".tmp", md, { encoding: "utf8", mode: 0o600 });
   await f.rename(path() + ".tmp", path());
   return reply({ revision: await sha(md), ok: true });
  });
 } catch { return reply({ error: "Could not access Obsidian memory vault." }, 500); }
}
