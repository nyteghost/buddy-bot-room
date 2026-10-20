import { mkcalendarBody, parseMultistatus, parseVtodo, PROPFIND_BODY, QUERY_BODY, type Vtodo } from "./caldav";
import { validZone } from "./schedule";

/**
 * Talks to a Radicale (CalDAV) server over the stack's private network. RADICALE_PASSWORD (and optionally RADICALE_USER, default
 * "pixelpals", and RADICALE_URL, default http://radicale:5232) turn it on. Nothing here is ever sent to the browser.
 */
export type CaldavConfig = { base: string; user: string; pass: string };
export type Remote = { href: string; raw: string; todo: Vtodo };

export function caldavConfig(env: Record<string, string | undefined> = process.env): CaldavConfig | null {
  const pass = (env["RADICALE_PASSWORD"] ?? "").trim();
  let base = (env["RADICALE_URL"] ?? "").trim().replace(/\/+$/, "") || (pass ? "http://radicale:5232" : "");
  try { const p = new URL(base).protocol; if (p !== "http:" && p !== "https:") base = ""; } catch { base = ""; }
  return base && pass ? { base, user: (env["RADICALE_USER"] ?? "").trim() || "pixelpals", pass } : null;
}

const tzName = () => validZone(process.env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
const made = new Set<string>();

async function dav(cfg: CaldavConfig, method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`, ...(body ? { "Content-Type": "application/xml; charset=utf-8" } : {}), ...headers },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, text: method === "DELETE" || method === "PUT" ? "" : await res.text() };
}

const collectionUrl = (cfg: CaldavConfig, name: string) => `${cfg.base}/${encodeURIComponent(cfg.user)}/${name}/`;

/** Make sure the "tasks" or "reminders" list exists on the server. */
export async function ensureCollection(cfg: CaldavConfig, name: "tasks" | "reminders", title: string): Promise<void> {
  const key = `${cfg.base}|${cfg.user}|${name}`;
  if (made.has(key)) return;
  const url = collectionUrl(cfg, name);
  const probe = await dav(cfg, "PROPFIND", url, PROPFIND_BODY, { Depth: "0" });
  if (probe.status === 401) throw new Error("The calendar server refused the user or password.");
  if (probe.status === 404) {
    const mk = await dav(cfg, "MKCALENDAR", url, mkcalendarBody(title));
    if (![200, 201, 204, 405, 409].includes(mk.status)) throw new Error(`Couldn't create the ${name} list (HTTP ${mk.status}).`);
  } else if (probe.status >= 400) throw new Error(`The calendar server answered ${probe.status}.`);
  made.add(key);
}

export async function listTodos(cfg: CaldavConfig, name: "tasks" | "reminders"): Promise<Remote[]> {
  await ensureCollection(cfg, name, name === "tasks" ? "Pixel Pals Tasks" : "Pixel Pals Reminders");
  const res = await dav(cfg, "REPORT", collectionUrl(cfg, name), QUERY_BODY, { Depth: "1" });
  if (res.status !== 207) throw new Error(`Couldn't read the ${name} list (HTTP ${res.status}).`);
  const tz = tzName();
  return parseMultistatus(res.text).flatMap((r): Remote[] => {
    const todo = parseVtodo(r.data, tz);
    return todo ? [{ href: r.href, raw: r.data, todo }] : [];
  });
}

export async function putTodo(cfg: CaldavConfig, name: "tasks" | "reminders", uid: string, body: string, href?: string): Promise<void> {
  const url = href ? new URL(href, cfg.base).toString() : `${collectionUrl(cfg, name)}${encodeURIComponent(uid)}.ics`;
  const res = await fetch(url, { method: "PUT", headers: { Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.pass}`).toString("base64")}`, "Content-Type": "text/calendar; charset=utf-8" }, body, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Couldn't save to the calendar server (HTTP ${res.status}).`);
}

export async function deleteTodo(cfg: CaldavConfig, href: string): Promise<void> {
  const res = await dav(cfg, "DELETE", new URL(href, cfg.base).toString());
  if (res.status >= 400 && res.status !== 404) throw new Error(`Couldn't delete from the calendar server (HTTP ${res.status}).`);
}

/** For the Setup window's Test button. */
export async function pingCaldav(cfg: CaldavConfig): Promise<{ ok: boolean; note: string }> {
  try {
    await ensureCollection(cfg, "tasks", "Pixel Pals Tasks");
    await ensureCollection(cfg, "reminders", "Pixel Pals Reminders");
    const n = (await listTodos(cfg, "tasks")).length + (await listTodos(cfg, "reminders")).length;
    return { ok: true, note: `Connected. ${n} item${n === 1 ? "" : "s"} on the server.` };
  } catch (e) {
    return { ok: false, note: e instanceof Error ? e.message : "Couldn't connect to the calendar server." };
  }
}
