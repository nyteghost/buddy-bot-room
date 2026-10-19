import { parseLibraryPage, type FeedModel } from "./model-feed";
import { logServer } from "./server-log.server";

export type Feed = { fetchedAt: string; models: FeedModel[]; error?: string };
const DAY = 24 * 3600 * 1000;
const holder = globalThis as unknown as { __buddyFeed?: Feed; __buddyFeedBusy?: Promise<Feed> | undefined };

/** Set MODEL_FEED=0 to never contact ollama.com. */
export const feedEnabled = () => (process.env["MODEL_FEED"] ?? "1") !== "0";
const file = () => {
  const dir = (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
  return dir ? `${dir}/model-feed.json` : "";
};
const fsp = () => import(/* @vite-ignore */ "node:" + "fs/promises");

async function load(): Promise<Feed | null> {
  if (holder.__buddyFeed) return holder.__buddyFeed;
  const path = file();
  if (!path) return null;
  try {
    const parsed = JSON.parse(await (await fsp()).readFile(path, "utf8")) as Feed;
    if (Array.isArray(parsed.models) && typeof parsed.fetchedAt === "string") return (holder.__buddyFeed = parsed);
  } catch { /* no saved feed yet */ }
  return null;
}

/** Downloads the library listing (newest first) and keeps it in memory and in the data folder. */
export async function refreshFeed(): Promise<Feed> {
  if (holder.__buddyFeedBusy) return holder.__buddyFeedBusy;
  holder.__buddyFeedBusy = (async () => {
    const previous = holder.__buddyFeed ?? (await load());
    try {
      const res = await fetch("https://ollama.com/library?sort=newest", { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "pixel-pals" } });
      if (!res.ok) throw new Error(`ollama.com answered ${res.status}`);
      const models = parseLibraryPage(await res.text());
      if (!models.length) throw new Error("couldn't read the library page (its layout may have changed)");
      const feed: Feed = { fetchedAt: new Date().toISOString(), models };
      holder.__buddyFeed = feed;
      const path = file();
      if (path) await (await fsp()).writeFile(path, JSON.stringify(feed)).catch(() => undefined);
      logServer("info", `model feed updated: ${models.length} models`);
      return feed;
    } catch (e) {
      const message = e instanceof Error ? e.message : "failed";
      logServer("warn", `model feed not updated: ${message}`);
      const kept: Feed = previous ? { ...previous, error: message } : { fetchedAt: "", models: [], error: message };
      holder.__buddyFeed = kept;
      return kept;
    } finally {
      holder.__buddyFeedBusy = undefined;
    }
  })();
  return holder.__buddyFeedBusy;
}

/** What we have now; starts a refresh in the background when it is missing or over a day old. */
export async function currentFeed(): Promise<Feed | null> {
  if (!feedEnabled()) return null;
  const have = await load();
  const age = have?.fetchedAt ? Date.now() - Date.parse(have.fetchedAt) : Infinity;
  if (age > DAY) void refreshFeed();
  return have;
}

let timer: ReturnType<typeof setInterval> | undefined;
/** Checks every 6 hours and refreshes when the saved list is over a day old. */
export function startFeedTimer(): void {
  if (timer || !feedEnabled()) return;
  timer = setInterval(() => { void currentFeed(); }, 6 * 3600 * 1000);
  (timer as { unref?: () => void }).unref?.();
  const first = setTimeout(() => { void currentFeed(); }, 90_000);
  (first as { unref?: () => void }).unref?.();
}
