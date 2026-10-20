import { currentUser } from "./accounts.server";
import { askPals } from "./ask.server";
import { logServer } from "./server-log.server";
import { validZone } from "./schedule";
import { M365_SCOPES, eventsText, mailText, parseM365, shapeEvents, shapeMail, summaryPrompt } from "./m365";

/**
 * Read-only Microsoft 365 (work): today's calendar and unread mail subjects through Microsoft Graph, using a device-code login
 * you approve once. Needs an app registration (M365_CLIENT_ID). Tokens stay in the data volume (mode 600). Nothing is ever
 * sent, created or changed, mail bodies are never requested, and summaries use Local AI only so work content stays on your server.
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const clientId = () => (process.env["M365_CLIENT_ID"] ?? "").trim();
const tenant = () => (/^[\w.-]{1,80}$/.test((process.env["M365_TENANT"] ?? "").trim()) ? (process.env["M365_TENANT"] ?? "").trim() : "organizations");
const tz = () => validZone(process.env["BUDDY_TZ"]) ?? "UTC";
const fsp = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const AUTH = "https://login.microsoftonline.com";

type Auth = { access: string; refresh: string; expires: number };
type Holder = { auth?: Auth | null; pending?: string | undefined };
const g = globalThis as unknown as { __buddyM365?: Holder };
const state = (): Holder => (g.__buddyM365 ??= {});

async function load(): Promise<Auth | null> {
  if (state().auth !== undefined) return state().auth ?? null;
  try { state().auth = JSON.parse(await (await fsp()).readFile(`${dir()}/m365-auth.json`, "utf8")) as Auth; } catch { state().auth = null; }
  return state().auth ?? null;
}
async function save(a: Auth | null): Promise<void> {
  state().auth = a;
  const f = await fsp();
  if (!a) { await f.rm(`${dir()}/m365-auth.json`, { force: true }); return; }
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${dir()}/m365-auth.json.tmp`, JSON.stringify(a), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${dir()}/m365-auth.json.tmp`, `${dir()}/m365-auth.json`);
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

async function token(): Promise<string> {
  const a = await load();
  if (!a) return "";
  if (Date.now() < a.expires - 120_000) return a.access;
  try {
    const res = await fetch(`${AUTH}/${tenant()}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ client_id: clientId(), grant_type: "refresh_token", refresh_token: a.refresh, scope: M365_SCOPES }), signal: AbortSignal.timeout(10_000) });
    const j = (await res.json()) as TokenReply;
    if (res.ok && j.access_token) {
      const next = { access: j.access_token, refresh: j.refresh_token ?? a.refresh, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
      await save(next);
      return next.access;
    }
  } catch { /* fall through */ }
  return "";
}

async function connect(): Promise<string> {
  if (!clientId()) return "Set M365_CLIENT_ID (an app registration with 'Allow public client flows' on) and redeploy first. See the README section on Microsoft 365.";
  const res = await fetch(`${AUTH}/${tenant()}/oauth2/v2.0/devicecode`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ client_id: clientId(), scope: M365_SCOPES }), signal: AbortSignal.timeout(10_000) });
  const j = (await res.json()) as { device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error_description?: string };
  if (!res.ok || !j.device_code) return `Microsoft refused the request: ${(j.error_description ?? "").split("\r")[0]?.slice(0, 160) || res.status}`;
  const code = j.device_code;
  state().pending = code;
  const until = Date.now() + (j.expires_in ?? 900) * 1000;
  const wait = Math.max(5, Math.min(30, j.interval ?? 5)) * 1000;
  void (async () => {
    while (state().pending === code && Date.now() < until) {
      await new Promise((r) => setTimeout(r, wait));
      try {
        const t = await fetch(`${AUTH}/${tenant()}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId(), device_code: code }), signal: AbortSignal.timeout(10_000) });
        const k = (await t.json()) as TokenReply;
        if (t.ok && k.access_token) { await save({ access: k.access_token, refresh: k.refresh_token ?? "", expires: Date.now() + (k.expires_in ?? 3600) * 1000 }); state().pending = undefined; logServer("info", "Microsoft 365 connected"); return; }
        if (k.error && k.error !== "authorization_pending" && k.error !== "slow_down") { state().pending = undefined; return; }
      } catch { /* keep trying */ }
    }
  })();
  return `Open ${j.verification_uri ?? "https://microsoft.com/devicelogin"} and enter the code ${j.user_code}, then sign in with your work account. Your organisation may ask an admin to approve the app first. Then run /m365 status.`;
}

async function graph(path: string, access: string): Promise<unknown> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${access}`, Prefer: `outlook.timezone="${tz()}"` }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`Graph ${res.status}`);
  return res.json();
}
async function today(access: string) {
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 0);
  const q = new URLSearchParams({ startDateTime: now.toISOString(), endDateTime: new Date(Math.max(end.getTime(), now.getTime() + 3600_000)).toISOString(), $select: "subject,start,end,location,isAllDay", $orderby: "start/dateTime", $top: "15" });
  return shapeEvents(await graph(`/me/calendarView?${q}`, access));
}
async function unread(access: string) {
  const q = new URLSearchParams({ $filter: "isRead eq false", $select: "subject,from,receivedDateTime", $orderby: "receivedDateTime desc", $top: "10" });
  return shapeMail(await graph(`/me/mailFolders/inbox/messages?${q}`, access));
}

/** POST { op }. Owner only. */
export async function handleM365(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can use Microsoft 365." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { op?: string };
  const op = parseM365(body.op ?? "");
  try {
    if (op === "connect") return Response.json({ text: await connect() });
    if (op === "disconnect") { state().pending = undefined; await save(null); return Response.json({ text: "Disconnected, and the saved sign-in was deleted. (Also remove the app under myapps.microsoft.com if you want it fully revoked.)" }); }
    const access = await token();
    if (op === "status") return Response.json({ text: access ? "Connected (read-only: calendar and unread mail subjects)." : state().pending ? "Waiting for you to approve the code…" : clientId() ? "Not connected. Run /m365 connect." : "Not set up. Add M365_CLIENT_ID first." });
    if (!access) return Response.json({ text: "Not connected to Microsoft 365. Run /m365 connect." });
    if (op === "today") return Response.json({ text: `Work calendar, rest of today:\n${eventsText(await today(access))}` });
    if (op === "mail") return Response.json({ text: mailText(await unread(access)) });
    const [events, mail] = await Promise.all([today(access), unread(access)]);
    const r = await askPals(summaryPrompt(events, mail), { localOnly: true, maxTokens: 400 });
    return Response.json({ text: r.ok ? `${r.text}\n\n— ${r.via} (work data never left your server)` : `${r.error}\n\n${eventsText(events)}\n\n${mailText(mail)}` });
  } catch (e) {
    logServer("warn", `Microsoft 365 call failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`);
    return Response.json({ text: "Microsoft 365 didn't answer. If it keeps happening, run /m365 connect again (your organisation may have revoked the sign-in)." });
  }
}
