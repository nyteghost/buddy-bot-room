import { currentUser } from "./accounts.server";
import { authUrl, buildEvent, cleanOrigin, clean, EVENT_ID, explainGoogle, parseTokenResponse, redirectUri, validShift, type ShiftInput } from "./gcal";
import { logServer } from "./server-log.server";
import { validZone } from "./schedule";

/**
 * Google Calendar for the shifts, using your own Google Cloud client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in Settings).
 * Owner only. The refresh token lives in BUDDY_DATA_DIR/google-token.json (mode 600, left out of backups) and never reaches the browser.
 * Only the calendar.events scope is requested: it can add, change and delete events, and nothing else.
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const tokenFile = () => `${dir()}/google-token.json`;
const tz = () => validZone(process.env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
const cfg = () => {
  const id = (process.env["GOOGLE_CLIENT_ID"] ?? "").trim();
  const secret = (process.env["GOOGLE_CLIENT_SECRET"] ?? "").trim();
  return id && secret ? { id, secret } : null;
};

const pending = new Map<string, { origin: string; exp: number }>();
let access: { token: string; exp: number } | null = null;

async function readRefresh(): Promise<string> {
  if (!dir()) return "";
  try { const j = JSON.parse(await (await fs()).readFile(tokenFile(), "utf8")) as { refresh_token?: unknown }; return typeof j.refresh_token === "string" ? j.refresh_token : ""; } catch { return ""; }
}
async function saveRefresh(token: string): Promise<void> {
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${tokenFile()}.tmp`, JSON.stringify({ refresh_token: token }), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${tokenFile()}.tmp`, tokenFile());
}
async function forget(): Promise<void> {
  access = null;
  try { await (await fs()).unlink(tokenFile()); } catch { /* already gone */ }
}

async function tokenCall(params: Record<string, string>): Promise<{ ok: true; json: unknown } | { ok: false; error: string; revoked: boolean }> {
  const c = cfg();
  if (!c) return { ok: false, error: "Google Calendar isn't set up in Settings.", revoked: false };
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }), signal: AbortSignal.timeout(12_000) });
    const text = await res.text();
    if (!res.ok) { let code = ""; try { code = String((JSON.parse(text) as { error?: unknown }).error ?? ""); } catch { /* not json */ } return { ok: false, error: explainGoogle(res.status, text), revoked: code === "invalid_grant" }; }
    return { ok: true, json: JSON.parse(text) };
  } catch (e) { return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "Google didn't answer in time." : "Couldn't reach Google.", revoked: false }; }
}

async function accessToken(): Promise<{ token: string } | { error: string; reconnect?: boolean }> {
  if (access && access.exp > Date.now() + 60_000) return { token: access.token };
  const refresh = await readRefresh();
  if (!refresh) return { error: "Google Calendar isn't connected yet.", reconnect: true };
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh });
  if (!r.ok) { if (r.revoked) { await forget(); return { error: "Google turned the connection off. Connect again.", reconnect: true }; } return { error: r.error }; }
  const t = parseTokenResponse(r.json);
  if (!t) return { error: "Google's answer wasn't understood." };
  access = { token: t.access, exp: Date.now() + t.expiresIn * 1000 };
  return { token: t.access };
}

async function owner(request: Request): Promise<Response | null> {
  const user = await currentUser(request);
  return user?.owner ? null : Response.json({ error: "Only the owner account can use Google Calendar here." }, { status: 403 });
}

export const gcalStatus = async (): Promise<{ configured: boolean; connected: boolean }> => ({ configured: !!cfg(), connected: !!cfg() && !!(await readRefresh()) });

/** Events from the primary Google calendar between two instants (epoch ms), or null when Google isn't connected. Throws a short message on failure. */
export async function googleRange(from: number, to: number): Promise<{ title: string; start: number; end: number; allDay: boolean; location: string }[] | null> {
  if (!cfg() || !(await readRefresh())) return null;
  const t = await accessToken();
  if ("error" in t) throw new Error(t.error);
  const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "100", fields: "items(summary,location,status,start,end)" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, { headers: { authorization: `Bearer ${t.token}` }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(explainGoogle(res.status, await res.text()));
  const json = (await res.json()) as { items?: { summary?: string; location?: string; status?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string } }[] };
  return (json.items ?? []).filter((e) => e.status !== "cancelled").flatMap((e) => {
    const allDay = !e.start?.dateTime;
    // All-day events carry plain dates; read them at UTC midnight like the calendar feeds do.
    const start = Date.parse(e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : ""));
    const end = Date.parse(e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : ""));
    return Number.isFinite(start) && Number.isFinite(end) ? [{ title: clean(e.summary || "(no title)", 120), start, end, allDay, location: clean(e.location, 80) }] : [];
  });
}

export const gcalReady = async (): Promise<boolean> => !!cfg() && !!(await readRefresh());

/** POST { op: "status" | "push" | "disconnect" }. */
export async function handleGoogle(request: Request): Promise<Response> {
  const denied = await owner(request);
  if (denied) return denied;
  if (!dir()) return Response.json({ configured: false, connected: false, error: "Needs BUDDY_DATA_DIR (the data volume)." });
  const body = (await request.json().catch(() => ({}))) as { op?: string; shifts?: ShiftInput[]; title?: string; remove?: string[] };
  if (body.op === "disconnect") { await forget(); (await import(/* @vite-ignore */ "./inbox" + ".server")).clearMailCache(); return Response.json({ ok: true }); }
  if (body.op === "push") return push(body);
  return Response.json({ configured: !!cfg(), connected: !!(await readRefresh()) });
}

async function push(body: { shifts?: ShiftInput[]; title?: string; remove?: string[] }): Promise<Response> {
  const t = await accessToken();
  if ("error" in t) return Response.json({ connected: false, error: t.error, reconnect: t.reconnect === true });
  const title = clean(body.title, 120) || "Work";
  const zone = tz();
  let added = 0, updated = 0, removed = 0, skipped = 0;
  const reasons: string[] = [];
  const call = (path: string, method: string, json?: unknown) => fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events${path}`, { method, headers: { authorization: `Bearer ${t.token}`, ...(json ? { "content-type": "application/json" } : {}) }, ...(json ? { body: JSON.stringify(json) } : {}), signal: AbortSignal.timeout(15_000) });
  try {
    for (const id of (body.remove ?? []).filter((x) => EVENT_ID.test(x)).slice(0, 60)) {
      const res = await call(`/${id}`, "DELETE");
      if (res.ok || res.status === 404 || res.status === 410) removed++;
      else { skipped++; reasons.push(`remove ${id}: ${explainGoogle(res.status, await res.text())}`); }
    }
    for (const s of (body.shifts ?? []).slice(0, 60)) {
      if (!validShift(s)) { skipped++; reasons.push(`${clean(s.date, 12)}: that shift has a bad date or time`); continue; }
      const event = buildEvent(s, title, zone);
      // A shift with an id is created under that id, so pushing again after an edit updates the same event instead of adding a copy.
      let res = await call("", "POST", s.id ? { ...event, id: s.id } : event);
      let wasUpdate = false;
      if (res.status === 409 && s.id) { res = await call(`/${s.id}`, "PUT", event); wasUpdate = true; }
      if (res.ok) { wasUpdate ? updated++ : added++; }
      else { skipped++; reasons.push(`${clean(s.date, 12)} ${clean(s.raw, 20)}: ${explainGoogle(res.status, await res.text())}`); }
    }
  } catch (e) { logServer("warn", `Google Calendar push failed: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`); return Response.json({ connected: true, added, updated, removed, skipped: skipped + 1, reasons: [...reasons, "Couldn't reach Google Calendar."] }); }
  return Response.json({ connected: true, added, updated, removed, skipped, reasons });
}

/** GET /api/google/start?origin=https://your-address: sends the browser to Google's consent screen. */
export async function handleGoogleStart(request: Request): Promise<Response> {
  const denied = await owner(request);
  if (denied) return denied;
  const c = cfg();
  if (!c) return page("Google Calendar isn't set up", "Open Settings → Google Calendar, enter the Client ID and Client secret, and Save. Then try again.");
  const origin = cleanOrigin(new URL(request.url).searchParams.get("origin"));
  if (!origin) return page("That address can't be used", "Google needs an https:// address (or http://localhost). Open Pixel Pals through your https address and try again.");
  const state = crypto.randomUUID().replace(/-/g, "");
  const now = Date.now();
  for (const [k, v] of pending) if (v.exp < now) pending.delete(k);
  pending.set(state, { origin, exp: now + 10 * 60_000 });
  return new Response(null, { status: 302, headers: { location: authUrl(c.id, redirectUri(origin), state) } });
}

/** GET /api/google/callback: Google sends the browser back here with a code. */
export async function handleGoogleCallback(request: Request): Promise<Response> {
  const denied = await owner(request);
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const rec = pending.get(q.get("state") ?? "");
  pending.delete(q.get("state") ?? "");
  if (q.get("error")) return page("Google Calendar wasn't connected", q.get("error") === "access_denied" ? "You chose not to allow access." : `Google said: ${String(q.get("error")).slice(0, 80)}`);
  if (!rec || rec.exp < Date.now() || !q.get("code")) return page("That sign-in expired", "Start again from Work tools → My shifts.");
  const r = await tokenCall({ grant_type: "authorization_code", code: String(q.get("code")), redirect_uri: redirectUri(rec.origin) });
  if (!r.ok) return page("Google Calendar wasn't connected", r.error);
  const t = parseTokenResponse(r.json);
  if (!t?.refresh) return page("Google didn't give a long-lived key", "Remove Pixel Pals at myaccount.google.com/permissions and connect again.");
  await saveRefresh(t.refresh);
  (await import(/* @vite-ignore */ "./inbox" + ".server")).clearMailCache();
  access = { token: t.access, exp: Date.now() + t.expiresIn * 1000 };
  return page("Google Calendar is connected", "You can close this tab and go back to Pixel Pals.", true);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
function page(title: string, text: string, ok = false): Response {
  const script = ok ? `<script>try{window.opener&&window.opener.postMessage({pixelpals:"google-connected"},location.origin)}catch(e){}setTimeout(function(){window.close()},1200)</script>` : "";
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;background:#111;color:#eee"><h1>${esc(title)}</h1><p>${esc(text)}</p>${script}`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
