import { parseProviderReadme, type FeedProvider } from "./provider-feed";
import { logServer } from "./server-log.server";

export type ProviderFeed = { fetchedAt: string; providers: FeedProvider[]; error?: string };
const DAY = 24 * 3600 * 1000;
const SOURCE = "https://raw.githubusercontent.com/cheahjs/free-llm-api-resources/main/README.md";
const holder = globalThis as unknown as { __buddyProviders?: ProviderFeed; __buddyProvidersBusy?: Promise<ProviderFeed> | undefined };

/** Set PROVIDER_FEED=0 to never fetch the community list. */
export const providerFeedEnabled = () => (process.env["PROVIDER_FEED"] ?? "1") !== "0";
const file = () => {
  const dir = (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
  return dir ? `${dir}/provider-feed.json` : "";
};
const fsp = () => import(/* @vite-ignore */ "node:" + "fs/promises");

async function load(): Promise<ProviderFeed | null> {
  if (holder.__buddyProviders) return holder.__buddyProviders;
  const path = file();
  if (!path) return null;
  try {
    const parsed = JSON.parse(await (await fsp()).readFile(path, "utf8")) as ProviderFeed;
    if (Array.isArray(parsed.providers) && typeof parsed.fetchedAt === "string") return (holder.__buddyProviders = parsed);
  } catch { /* nothing saved yet */ }
  return null;
}

export async function refreshProviders(): Promise<ProviderFeed> {
  if (holder.__buddyProvidersBusy) return holder.__buddyProvidersBusy;
  holder.__buddyProvidersBusy = (async () => {
    const previous = holder.__buddyProviders ?? (await load());
    try {
      const res = await fetch(SOURCE, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "pixel-pals" } });
      if (!res.ok) throw new Error(`the list answered ${res.status}`);
      const providers = parseProviderReadme(await res.text());
      if (!providers.length) throw new Error("couldn't read the list (its layout may have changed)");
      const feed: ProviderFeed = { fetchedAt: new Date().toISOString(), providers };
      holder.__buddyProviders = feed;
      const path = file();
      if (path) await (await fsp()).writeFile(path, JSON.stringify(feed)).catch(() => undefined);
      logServer("info", `provider list updated: ${providers.length} providers`);
      return feed;
    } catch (e) {
      const message = e instanceof Error ? e.message : "failed";
      logServer("warn", `provider list not updated: ${message}`);
      const kept: ProviderFeed = previous ? { ...previous, error: message } : { fetchedAt: "", providers: [], error: message };
      holder.__buddyProviders = kept;
      return kept;
    } finally {
      holder.__buddyProvidersBusy = undefined;
    }
  })();
  return holder.__buddyProvidersBusy;
}

export async function currentProviders(): Promise<ProviderFeed | null> {
  if (!providerFeedEnabled()) return null;
  const have = await load();
  const age = have?.fetchedAt ? Date.now() - Date.parse(have.fetchedAt) : Infinity;
  if (age > DAY) void refreshProviders();
  return have;
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startProviderTimer(): void {
  if (timer || !providerFeedEnabled()) return;
  timer = setInterval(() => { void currentProviders(); }, 6 * 3600 * 1000);
  (timer as { unref?: () => void }).unref?.();
  const first = setTimeout(() => { void currentProviders(); }, 120_000);
  (first as { unref?: () => void }).unref?.();
}
