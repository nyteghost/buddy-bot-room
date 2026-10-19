import { backupConfig, backupText } from "./backup.server";
import { buildBrief, dailyPicks } from "./brief";
import { handlePlex } from "./plex.server";
import { parseHm, validZone, zonedParts } from "./schedule";
import { logServer } from "./server-log.server";
import { handleTrakt } from "./trakt.server";
import type { TraktItem } from "./trakt";
import { unraidSnapshot } from "./unraid.server";

/** Morning brief: one short message each day (health, backup, tonight's pick, what's new in Plex). Needs BRIEF_TIME; sends through NTFY_URL. */
export type BriefConfig = { time: string; tz: string; ntfy: string };

export function briefConfig(env: Record<string, string | undefined> = process.env): BriefConfig | null {
  const t = (env["BRIEF_TIME"] ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return null;
  const ntfy = (env["NTFY_URL"] ?? "").trim();
  let okUrl = "";
  try { const p = new URL(ntfy).protocol; if (p === "http:" || p === "https:") okUrl = ntfy; } catch { /* no ntfy */ }
  return { time: parseHm(t, "08:00"), tz: validZone(env["BUDDY_TZ"]) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC", ntfy: okUrl };
}

const internal = (path: string) => new Request(`http://internal${path}`);
async function json(r: Response): Promise<Record<string, unknown> | null> {
  return r.ok ? ((await r.json().catch(() => null)) as Record<string, unknown> | null) : null;
}

export async function makeBrief(now = new Date()): Promise<{ title: string; body: string }> {
  const tz = briefConfig()?.tz ?? validZone(process.env["BUDDY_TZ"]) ?? "UTC";
  const day = zonedParts(now, tz).day;
  const [trakt, plex] = await Promise.all([
    handleTrakt(internal("/api/trakt?plex=1")).then(json).catch(() => null),
    handlePlex(internal("/api/plex?q=recent")).then(json).catch(() => null),
  ]);
  const bc = backupConfig();
  const backupLine = bc ? (await backupText(bc)).split("\n")[0] : undefined;
  const items = (trakt?.["items"] as TraktItem[] | undefined) ?? [];
  const recent = ((plex?.["items"] as { title: string }[] | undefined) ?? []).map((i) => i.title);
  return buildBrief({
    day,
    ...(process.env["UNRAID_URL"] ? { unraid: unraidSnapshot() } : {}),
    ...(backupLine ? { backup: backupLine } : {}),
    picks: dailyPicks(items, day),
    recent,
  });
}

export async function sendBrief(): Promise<{ ok: boolean; error?: string; text?: string }> {
  const cfg = briefConfig();
  const ntfy = cfg?.ntfy ?? (() => { try { const u = (process.env["NTFY_URL"] ?? "").trim(); return new URL(u).protocol.startsWith("http") ? u : ""; } catch { return ""; } })();
  if (!ntfy) return { ok: false, error: "No push address. Set NTFY_URL to send the brief to your phone." };
  const b = await makeBrief();
  try {
    const res = await fetch(ntfy, { method: "POST", headers: { Title: b.title.replace(/[^\x20-\x7e]/g, "-"), Priority: "default", Tags: "sunrise" }, body: b.body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, error: `The push service answered ${res.status}.`, text: b.body };
    logServer("info", "Morning brief sent");
    return { ok: true, text: b.body };
  } catch (error) {
    logServer("warn", "Morning brief push failed", error);
    return { ok: false, error: "Couldn't reach the push service.", text: b.body };
  }
}
