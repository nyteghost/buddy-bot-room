import { currentUser } from "./accounts.server";
import { logServer } from "./server-log.server";
import { traktConfig } from "./trakt.server";
import { bestMatch, describeMatch, parseWrite, pollSeconds, syncBody } from "./trakt-write";

const API = "https://api.trakt.tv";
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fsp = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const secret = () => (process.env["TRAKT_CLIENT_SECRET"] ?? "").trim();
const clientId = () => (process.env["TRAKT_CLIENT_ID"] ?? "").trim();

type Auth = { access: string; refresh: string; expires: number };
type Holder = { auth?: Auth | null; pending?: { code: string; until: number } | undefined };
const h = globalThis as unknown as { __buddyTrakt?: Holder };
const state = (): Holder => (h.__buddyTrakt ??= {});

async function load(): Promise<Auth | null> {
  if (state().auth !== undefined) return state().auth ?? null;
  try { state().auth = JSON.parse(await (await fsp()).readFile(`${dir()}/trakt-auth.json`, "utf8")) as Auth; } catch { state().auth = null; }
  return state().auth ?? null;
}
async function save(a: Auth): Promise<void> {
  state().auth = a;
  const f = await fsp();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${dir()}/trakt-auth.json.tmp`, JSON.stringify(a), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${dir()}/trakt-auth.json.tmp`, `${dir()}/trakt-auth.json`);
}

/** The stored login token, for read calls that need it (private lists). Refreshes it when it is about to expire. */
export async function storedTraktToken(): Promise<string> {
  const a = await load();
  if (!a) return "";
  if (Date.now() < a.expires - 3600_000) return a.access;
  if (!secret() || !a.refresh) return a.access;
  try {
    const res = await fetch(`${API}/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: a.refresh, client_id: clientId(), client_secret: secret(), redirect_uri: "urn:ietf:wg:oauth:2.0:oob", grant_type: "refresh_token" }), signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
      const next = { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + j.expires_in * 1000 };
      await save(next);
      return next.access;
    }
  } catch { /* use the old token */ }
  return a.access;
}

const headers = (token: string) => ({ "content-type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId(), Authorization: `Bearer ${token}` });

async function connect(): Promise<string> {
  if (!clientId() || !secret()) return "Add TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET (both from your app at trakt.tv/oauth/applications) and redeploy first.";
  const res = await fetch(`${API}/oauth/device/code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId() }), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return `Trakt refused the request (${res.status}). Check TRAKT_CLIENT_ID.`;
  const j = (await res.json()) as { device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number };
  state().pending = { code: j.device_code, until: Date.now() + j.expires_in * 1000 };
  const wait = pollSeconds(j.interval) * 1000;
  void (async () => {
    while (state().pending?.code === j.device_code && Date.now() < (state().pending?.until ?? 0)) {
      await new Promise((r) => setTimeout(r, wait));
      try {
        const t = await fetch(`${API}/oauth/device/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: j.device_code, client_id: clientId(), client_secret: secret() }), signal: AbortSignal.timeout(10_000) });
        if (t.status === 200) {
          const k = (await t.json()) as { access_token: string; refresh_token: string; expires_in: number };
          await save({ access: k.access_token, refresh: k.refresh_token, expires: Date.now() + k.expires_in * 1000 });
          state().pending = undefined;
          logServer("info", "Trakt connected");
          return;
        }
        if (t.status !== 400) { state().pending = undefined; return; } // 400 = still waiting; anything else is final (denied, expired, used)
      } catch { /* keep trying until the code expires */ }
    }
  })();
  return `Open ${j.verification_url} on any device, sign in to Trakt and enter the code ${j.user_code}. It expires in ${Math.round(j.expires_in / 60)} minutes. Then run /trakt status to confirm.`;
}

async function lookup(text: string, token: string) {
  const res = await fetch(`${API}/search/movie,show?${new URLSearchParams({ query: text, limit: "5" })}`, { headers: headers(token), signal: AbortSignal.timeout(10_000) });
  return res.ok ? bestMatch(await res.json()) : null;
}

/** POST { op, text }. Owner only: writes to your Trakt account. */
export async function handleTraktWrite(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can change Trakt." }, { status: 403 });
  if (!traktConfig() && !clientId()) return Response.json({ text: "Trakt isn't set up. Add TRAKT_CLIENT_ID, TRAKT_CLIENT_SECRET and TRAKT_USER first." });
  const body = (await request.json().catch(() => ({}))) as { op?: string; text?: string };
  const p = parseWrite(`${body.op ?? ""} ${body.text ?? ""}`);
  if (!p) return Response.json({ text: "Use /trakt connect, /trakt status, /trakt add <title>, /trakt watched <title> or /trakt remove <title>." });
  try {
    if (p.op === "connect") return Response.json({ text: await connect() });
    const token = await storedTraktToken();
    if (p.op === "status") return Response.json({ text: token ? "Connected: the pals can add to your watchlist and mark things watched." : state().pending ? "Waiting for you to approve the code on trakt.tv…" : "Not connected. Run /trakt connect." });
    if (!token) return Response.json({ text: "Not connected to Trakt yet. Run /trakt connect first." });
    if (!p.text) return Response.json({ text: `Which title? /trakt ${p.op} The Matrix` });
    const match = await lookup(p.text, token);
    if (!match) return Response.json({ text: `I couldn't find "${p.text}" on Trakt.` });
    const path = p.op === "add" ? "/sync/watchlist" : p.op === "remove" ? "/sync/watchlist/remove" : "/sync/history";
    const res = await fetch(`${API}${path}`, { method: "POST", headers: headers(token), body: JSON.stringify(syncBody(match)), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return Response.json({ text: res.status === 401 ? "Trakt refused the saved login. Run /trakt connect again." : `Trakt answered ${res.status}.` });
    const verb = p.op === "add" ? "Added to your watchlist" : p.op === "remove" ? "Removed from your watchlist" : "Marked as watched";
    return Response.json({ text: `${verb}: ${describeMatch(match)}. (Wrong one? Try a more exact title, then /trakt remove.)` });
  } catch (e) {
    logServer("warn", `Trakt write failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`);
    return Response.json({ text: "Can't reach Trakt right now." });
  }
}
