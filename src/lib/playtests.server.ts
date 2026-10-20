import { currentUser } from "./accounts.server";
import { alertText, cleanSources, cleanStore, DEFAULT_SOURCES, keepByWords, listingId, mergeListings, parseFeed, parseLinks, MAX_SOURCES, type Found, type Source, type Store } from "./playtests";
import { safeProductUrl } from "./vendors";
import { logServer } from "./server-log.server";

/**
 * Playtest and beta watch. Owner only. Checks your sources (feeds and web pages) every few hours, remembers what it found in
 * BUDDY_DATA_DIR/playtests.json, and sends a phone alert (Telegram or ntfy, whichever you set up) when something NEW appears.
 * A source's first check only sets a baseline, so adding one never floods you. Pages are fetched by this server and never from your own network.
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fsp = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/playtests.json`;
const EVERY_MS = 3 * 3600 * 1000;
const UA = "Mozilla/5.0 (compatible; PixelPals/1.0; personal playtest watcher)";

async function load(): Promise<Store> {
  try { return cleanStore(JSON.parse(await (await fsp()).readFile(file(), "utf8"))); } catch { return cleanStore({}); }
}
let chain: Promise<unknown> = Promise.resolve();
async function save(s: Store): Promise<void> {
  const run = async () => {
    const f = await fsp();
    await f.mkdir(dir(), { recursive: true });
    await f.writeFile(`${file()}.tmp`, JSON.stringify(s), "utf8");
    await f.rename(`${file()}.tmp`, file());
  };
  chain = chain.then(run, run);
  await chain;
}

async function read(src: Source): Promise<{ found: Found[] } | { error: string }> {
  let url = src.url;
  for (let hop = 0; hop < 4; hop++) {
    const safe = safeProductUrl(url);
    if (!safe) return { error: "That isn't a public web address." };
    let res: Response;
    try { res = await fetch(safe, { redirect: "manual", headers: { "user-agent": UA, accept: src.kind === "rss" ? "application/atom+xml,application/rss+xml,application/xml,text/xml,*/*" : "text/html,*/*", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(15_000) }); }
    catch (e) { return { error: e instanceof Error && e.name === "TimeoutError" ? "The site didn't answer in time." : "Couldn't reach the site." }; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { error: "Redirected nowhere." };
      try { url = new URL(loc, safe).toString(); } catch { return { error: "Bad redirect." }; }
      continue;
    }
    if (res.status === 403 || res.status === 429) return { error: "The site blocked the automatic check." };
    if (!res.ok) return { error: `The site answered ${res.status}.` };
    const reader = res.body?.getReader();
    if (!reader) return { error: "Empty reply." };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 1_500_000) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); size += value.length; }
    void reader.cancel().catch(() => undefined);
    const text = Buffer.concat(chunks).toString("utf8");
    const raw = src.kind === "rss" ? parseFeed(text) : parseLinks(text, safe, src.match ?? "");
    if (!raw.length) return { error: src.kind === "rss" ? "No entries found in that feed." : "No listings found. The page may load them with JavaScript, which can't be read." };
    return { found: keepByWords(raw, src.keywords) };
  }
  return { error: "Too many redirects." };
}

let running = false;
/** Checks every enabled source, saves, and alerts for new listings. Returns how many were new. */
export async function runCheck(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const s = await load();
    const now = new Date().toISOString();
    const added: import("./playtests").Listing[] = [];
    for (const src of s.sources.filter((x) => x.enabled)) {
      const r = await read(src);
      if ("error" in r) { s.status[src.id] = { at: now, ok: false, count: s.status[src.id]?.count ?? 0, error: r.error }; continue; }
      const baseline = !s.status[src.id]?.ok && !s.items.some((i) => i.source === src.id);
      const m = mergeListings(s.items, src.id, r.found, now, baseline);
      s.items = m.items;
      added.push(...m.added);
      s.status[src.id] = { at: now, ok: true, count: r.found.length };
    }
    s.lastRun = now;
    await save(s);
    if (added.length) {
      try {
        const { pushNotice } = await import(/* @vite-ignore */ "./schedules" + ".server");
        const names = Object.fromEntries(s.sources.map((x) => [x.id, x.name]));
        const a = alertText(added, names);
        await pushNotice(a.title, a.body);
      } catch (e) { logServer("warn", `playtest alert failed: ${e instanceof Error ? e.message : "failed"}`); }
    }
    return added.length;
  } finally { running = false; }
}

/** Called from the scheduler's 30-second tick: a check every three hours, and one soon after start-up. */
export async function tickPlaytests(nowMs: number): Promise<void> {
  if (!dir()) return;
  const s = await load();
  const last = Date.parse(s.lastRun);
  if (Number.isFinite(last) && nowMs - last < EVERY_MS) return;
  if (!s.sources.some((x) => x.enabled)) return;
  await runCheck();
}

export async function handlePlaytests(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user?.owner) return Response.json({ error: "Only the owner account can use Playtests here." }, { status: 403 });
  if (!dir()) return Response.json({ error: "Needs BUDDY_DATA_DIR (the data volume)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { op?: string; source?: Record<string, unknown>; id?: string; enabled?: boolean };
  let s = await load();
  const touched = async () => { await save(s); };
  switch (body.op) {
    case "check": { const n = await runCheck(); s = await load(); return Response.json({ ...reply(s), newCount: n }); }
    case "seen": { s.items = s.items.map((i) => ({ ...i, fresh: false })); await touched(); break; }
    case "addSource": {
      const x = body.source ?? {};
      const url = safeProductUrl(x["url"]);
      if (!url) return Response.json({ error: "Type a public web address (https://…)." }, { status: 400 });
      if (s.sources.length >= MAX_SOURCES) return Response.json({ error: `That's the most sources I'll watch (${MAX_SOURCES}).` }, { status: 400 });
      const made = cleanSources([{ name: x["name"] || new URL(url).hostname, kind: x["kind"], url, keywords: x["keywords"], match: x["match"], enabled: true }])[0];
      if (!made) return Response.json({ error: "Give the source a name." }, { status: 400 });
      made.id = listingId(url + Date.now());
      s.sources.push(made);
      await touched();
      void runCheck();
      break;
    }
    case "removeSource": { s.sources = s.sources.filter((x) => x.id !== body.id); s.items = s.items.filter((i) => i.source !== body.id); delete s.status[String(body.id)]; await touched(); break; }
    case "toggleSource": { const x = s.sources.find((y) => y.id === body.id); if (x) x.enabled = body.enabled !== false; await touched(); break; }
    case "resetSources": { s.sources = DEFAULT_SOURCES.map((x) => ({ ...x })); await touched(); break; }
  }
  return Response.json(reply(s));
}

function reply(s: Store) {
  return { sources: s.sources, items: s.items, status: s.status, lastRun: s.lastRun, alerts: !!(process.env["NTFY_URL"] ?? "").startsWith("http") || !!process.env["TELEGRAM_BOT_TOKEN"] };
}
