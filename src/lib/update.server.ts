import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { logServer } from "./server-log.server";
import { pushNotice } from "./schedules.server";
import { TtlCache } from "./ttl-cache";
import { isKnownBuild, parseCompare, updateText, type UpdateInfo } from "./update";

/**
 * Is a newer version on GitHub than the one running? Compares the commit this build was made from with the repository's main branch.
 * UPDATE_CHECK=0 turns it off; UPDATE_REPO changes the repository (default nyteghost/buddy-bot-room). Only the commit id and a public GitHub address are used.
 */
const cache = new TtlCache<UpdateInfo>(60 * 60_000, 2);
const repo = (): string => ((process.env["UPDATE_REPO"] ?? "").trim() || "nyteghost/buddy-bot-room").replace(/[^\w./-]/g, "");
const me = (): string => (typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "local");

export const updateCheckEnabled = (): boolean => (process.env["UPDATE_CHECK"] ?? "").trim() !== "0";

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const current = me();
  if (!isKnownBuild(current)) return { current, latest: current, behind: 0, changes: [], note: "I can't tell which version this is (it was built without a commit stamp), so I can't check for updates." };
  const hit = force ? undefined : cache.get("u");
  if (hit) return hit;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo()}/compare/${current}...main`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "pixel-pals" }, signal: AbortSignal.timeout(8000) });
    if (res.status === 404) return { current, latest: current, behind: 0, changes: [], note: "GitHub doesn't know this build's commit (a local or unpushed build), so I can't compare." };
    if (!res.ok) return { current, latest: current, behind: 0, changes: [], note: `GitHub answered ${res.status} (it limits unsigned requests; try again later).` };
    const info = parseCompare(await res.json(), current) ?? { current, latest: current, behind: 0, changes: [], note: "GitHub sent something unexpected." };
    if (!info.note) cache.set("u", info);
    return info;
  } catch {
    return { current, latest: current, behind: 0, changes: [], note: "Couldn't reach GitHub to check for updates." };
  }
}

/** GET → the current answer (cached for an hour); POST → check again now. Owner only when accounts are on. */
export async function handleUpdate(request: Request): Promise<Response> {
  if (!updateCheckEnabled()) return Response.json({ enabled: false });
  if (accountsEnabled(process.env) && !(await currentUser(request))?.owner) return Response.json({ error: "Only the owner can check for updates." }, { status: 403 });
  const info = await checkForUpdate(request.method === "POST");
  return Response.json({ enabled: true, ...info, text: updateText(info) });
}

const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const state = globalThis as unknown as { __buddyUpdateAt?: number };

/** Hourly from the scheduler: tell your phone once per new version. */
export async function tickUpdate(now = Date.now()): Promise<void> {
  if (!updateCheckEnabled() || !dir()) return;
  if (now - (state.__buddyUpdateAt ?? 0) < 60 * 60_000) return;
  state.__buddyUpdateAt = now;
  const info = await checkForUpdate();
  if (info.note || info.behind <= 0) return;
  const f = await fs();
  const file = `${dir()}/update-notified.txt`;
  const seen = await f.readFile(file, "utf8").catch(() => "");
  if (seen.trim() === info.latest) return;
  const phone = (process.env["NTFY_URL"] ?? "").trim().startsWith("http") || !!process.env["TELEGRAM_BOT_TOKEN"];
  if (phone) await pushNotice("Pixel Pals update available", updateText(info));
  await f.writeFile(file, info.latest, "utf8").catch(() => undefined);
  logServer("info", `Update available: ${info.behind} new change(s), latest ${info.latest}`);
}
