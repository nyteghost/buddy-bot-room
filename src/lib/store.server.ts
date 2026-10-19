import { logServer } from "./server-log.server";

/**
 * Server-side saved chats for the self-hosted build: one JSON file in BUDDY_DATA_DIR (a Docker volume).
 * Only active when BUDDY_DATA_DIR is set, so Lovable's cloud build never touches the filesystem.
 * node:fs is loaded lazily through a computed specifier so bundlers don't try to resolve it for other targets.
 */
const MAX_CHATS = 300;
const MAX_ROW_BYTES = 2_000_000;
const ID = /^[A-Za-z0-9-]{8,64}$/;
type Row = { id: string; title: string; messages: unknown[]; theme: string; mode: string; updatedAt: string };

async function fs() {
  return (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
}
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim();
export const storeEnabled = () => !!dir();
const file = () => `${dir().replace(/\/+$/, "")}/chats.json`;

let chain: Promise<unknown> = Promise.resolve();
/** Serialize all reads/writes so concurrent saves can't clobber each other. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function load(): Promise<Row[]> {
  const f = await fs();
  try {
    const parsed: unknown = JSON.parse(await f.readFile(file(), "utf8"));
    return Array.isArray(parsed) ? (parsed as Row[]) : [];
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return [];
    throw e;
  }
}
async function save(rows: Row[]) {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  await f.writeFile(tmp, JSON.stringify(rows), "utf8");
  await f.rename(tmp, file());
}

export function validRow(v: unknown): v is Row {
  const r = v as Row | null;
  return !!r && typeof r.id === "string" && ID.test(r.id) && typeof r.title === "string" && typeof r.theme === "string" && typeof r.mode === "string" && typeof r.updatedAt === "string" && Array.isArray(r.messages);
}

export async function handleStore(request: Request) {
  if (!storeEnabled()) return Response.json({ enabled: false }, { status: 404 });
  try {
    const url = new URL(request.url);
    if (request.method === "GET") return Response.json({ enabled: true, rows: await locked(load) });
    if (request.method === "PUT") {
      const text = await request.text();
      if (text.length > MAX_ROW_BYTES) return Response.json({ error: "That chat is too large to save." }, { status: 413 });
      const row: unknown = JSON.parse(text);
      if (!validRow(row)) return Response.json({ error: "That chat wasn't valid." }, { status: 400 });
      await locked(async () => {
        const rows = (await load()).filter((r) => r.id !== row.id);
        rows.unshift(row);
        await save(rows.slice(0, MAX_CHATS));
      });
      return Response.json({ ok: true });
    }
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      if (!ID.test(id)) return Response.json({ error: "That id wasn't valid." }, { status: 400 });
      await locked(async () => save((await load()).filter((r) => r.id !== id)));
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    logServer("error", "chat store failed", error);
    return Response.json({ error: "The server couldn't read or write saved chats. Check the buddy-data volume." }, { status: 500 });
  }
}
