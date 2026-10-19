import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { logServer } from "./server-log.server";

/**
 * Server-side saved chats for the self-hosted build: one JSON file in BUDDY_DATA_DIR (a Docker volume).
 * Only active when BUDDY_DATA_DIR is set, so Lovable's cloud build never touches the filesystem.
 * node:fs is loaded lazily through a computed specifier so bundlers don't try to resolve it for other targets.
 */
const MAX_CHATS = 300;
const MAX_ROW_BYTES = 2_000_000;
const ID = /^[A-Za-z0-9-]{8,64}$/;
type Row = { id: string; title: string; messages: unknown[]; theme: string; mode: string; updatedAt: string; owner?: string; shared?: boolean };

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

const lower = (s: string) => s.trim().toLowerCase();

/** With accounts on, chats belong to the account that saved them. Chats saved before accounts existed have no owner and stay visible to everyone. */
export function visibleTo(row: Row, me: string): boolean {
  return !me || !row.owner || row.owner === me || row.shared === true;
}
/** Keep at most `max` chats per owner, newest first (rows are stored newest first). */
export function capPerOwner(rows: Row[], max: number): Row[] {
  const seen = new Map<string, number>();
  return rows.filter((r) => {
    const key = r.owner ?? "";
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n <= max;
  });
}

export async function handleStore(request: Request) {
  if (!storeEnabled()) return Response.json({ enabled: false }, { status: 404 });
  try {
    const accounts = accountsEnabled(process.env);
    const user = accounts ? await currentUser(request) : null;
    if (accounts && !user) return Response.json({ error: "Sign in first." }, { status: 401 });
    const me = user ? lower(user.username) : "";
    const url = new URL(request.url);
    if (request.method === "GET") {
      const rows = (await locked(load)).filter((r) => visibleTo(r, me)).map((r) => (accounts ? { ...r, mine: !r.owner || r.owner === me, ownerName: r.owner ?? "", shared: r.shared === true } : r));
      return Response.json({ enabled: true, rows });
    }
    if (request.method === "PUT") {
      const text = await request.text();
      if (text.length > MAX_ROW_BYTES) return Response.json({ error: "That chat is too large to save." }, { status: 413 });
      const incoming: unknown = JSON.parse(text);
      if (!validRow(incoming)) return Response.json({ error: "That chat wasn't valid." }, { status: 400 });
      // The browser never decides who owns a chat or whether it is shared.
      const { owner: _o, shared: _s, ...row } = incoming as Row;
      const result = await locked(async () => {
        const all = await load();
        const existing = all.find((r) => r.id === row.id);
        if (me && existing?.owner && existing.owner !== me) return "forbidden";
        const next: Row = me ? { ...row, owner: me, shared: existing ? existing.shared === true || !existing.owner : false } : row;
        await save(capPerOwner([next, ...all.filter((r) => r.id !== row.id)], MAX_CHATS));
        return "ok";
      });
      return result === "forbidden" ? Response.json({ error: "That chat belongs to someone else. Open it and keep chatting to save your own copy." }, { status: 403 }) : Response.json({ ok: true });
    }
    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { id?: unknown; shared?: unknown };
      const id = typeof body.id === "string" ? body.id : "";
      if (!ID.test(id) || typeof body.shared !== "boolean") return Response.json({ error: "That request wasn't valid." }, { status: 400 });
      if (!me) return Response.json({ error: "Sharing needs accounts." }, { status: 400 });
      const found = await locked(async () => {
        const all = await load();
        const i = all.findIndex((r) => r.id === id && (r.owner === me || !r.owner));
        const row = all[i];
        if (!row) return false;
        all[i] = { ...row, owner: me, shared: body.shared as boolean };
        await save(all);
        return true;
      });
      return found ? Response.json({ ok: true }) : Response.json({ error: "You can only share your own chats." }, { status: 403 });
    }
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id") ?? "";
      if (!ID.test(id)) return Response.json({ error: "That id wasn't valid." }, { status: 400 });
      const result = await locked(async () => {
        const all = await load();
        const existing = all.find((r) => r.id === id);
        if (!existing) return "ok";
        if (me && existing.owner && existing.owner !== me && !user?.owner) return "forbidden";
        await save(all.filter((r) => r.id !== id));
        return "ok";
      });
      return result === "forbidden" ? Response.json({ error: "That chat belongs to someone else." }, { status: 403 }) : Response.json({ ok: true });
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    logServer("error", "chat store failed", error);
    return Response.json({ error: "The server couldn't read or write saved chats. Check the buddy-data volume." }, { status: 500 });
  }
}
