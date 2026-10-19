import { logServer } from "./server-log.server";
import { buildStatus, eventText, initialWatch, nextWatch, shapeContainers, shapeDisks, shapeUptime, type ContainerInfo, type UnraidStatus, type WatchEvent, type WatchState } from "./unraid";

/** Unraid address, API key and the optional ntfy topic live only in the server's environment. */
export type UnraidConfig = { base: string; key: string; ntfy: string; intervalSec: number };

export function unraidConfig(env: Record<string, string | undefined> = process.env): UnraidConfig | null {
  const base = (env["UNRAID_URL"] ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const okUrl = (u: string) => { try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; } };
  if (!okUrl(base)) return null;
  const ntfy = (env["NTFY_URL"] ?? "").trim();
  const every = Number(env["UNRAID_CHECK_SECONDS"]);
  return { base, key: (env["UNRAID_API_KEY"] ?? "").trim(), ntfy: okUrl(ntfy) ? ntfy : "", intervalSec: Number.isFinite(every) && every > 0 ? Math.min(3600, Math.max(20, Math.round(every))) : 60 };
}

type Gql = { status: number; data?: Record<string, unknown>; error?: string };
type FetchLike = typeof fetch;

async function gql(cfg: UnraidConfig, query: string, f: FetchLike): Promise<Gql> {
  try {
    const res = await f(`${cfg.base}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.key },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) return { status: res.status, error: "auth" };
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
    const json = (await res.json().catch(() => null)) as { data?: Record<string, unknown>; errors?: { message?: string }[] } | null;
    if (json?.errors?.length && !json.data) {
      const msg = String(json.errors[0]?.message ?? "error");
      return { status: 200, error: /unauthor|forbidden|api key|permission/i.test(msg) ? "auth" : msg.slice(0, 100) };
    }
    return json?.data ? { status: 200, data: json.data } : { status: res.status, error: "empty reply" };
  } catch (e) {
    return { status: 0, error: e instanceof Error ? e.message.slice(0, 80) : "failed" };
  }
}

/** One full check. Never throws; failures become `reachable: false` or notes. */
export async function checkUnraid(cfg: UnraidConfig, now = Date.now(), f: FetchLike = fetch): Promise<UnraidStatus> {
  try {
    await f(`${cfg.base}/`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000) });
  } catch {
    return buildStatus({ now, reachable: false });
  }
  if (!cfg.key) return buildStatus({ now, reachable: true, notes: ["No UNRAID_API_KEY is set, so I can only tell that the server answers."] });
  const notes: string[] = [];
  let authFailed = false;
  let anyData = false;
  const pick = async (label: string, queries: string[]) => {
    for (const q of queries) {
      const r = await gql(cfg, q, f);
      if (r.error === "auth") { authFailed = true; return undefined; }
      if (r.data) { anyData = true; return r.data; }
      if (q === queries[queries.length - 1]) notes.push(`Couldn't read ${label} from the Unraid API (${r.error ?? "unknown"}).`);
    }
    return undefined;
  };
  const diskData = await pick("disks", ["{ array { state disks { name status temp } parities { name status temp } caches { name status temp } } }", "{ array { state disks { name status temp } } }"]);
  const containerData = authFailed ? undefined : await pick("Docker containers", ["{ dockerContainers { names state autoStart } }", "{ docker { containers { names state autoStart } } }"]);
  const infoData = authFailed ? undefined : await pick("uptime", ["{ info { os { uptime } } }"]);
  if (authFailed && !anyData) return buildStatus({ now, reachable: true, apiOk: false });
  const containers: ContainerInfo[] = containerData ? shapeContainers(containerData) : [];
  const uptime = infoData ? shapeUptime(infoData) : undefined;
  return buildStatus({ now, reachable: true, apiOk: anyData, ...(diskData ? { disks: shapeDisks(diskData) } : {}), containers, ...(uptime !== undefined ? { uptimeSeconds: uptime } : {}), notes });
}

// ── watcher ────────────────────────────────────────────────────────────────────────────────────
type Logged = { t: number; title: string; body: string };
type Watcher = { state: WatchState; events: Logged[]; timer?: ReturnType<typeof setInterval>; running: boolean };
const holder = globalThis as unknown as { __buddyUnraid?: Watcher };
const watcher = (): Watcher => (holder.__buddyUnraid ??= { state: initialWatch, events: [], running: false });

async function sendNtfy(cfg: UnraidConfig, e: WatchEvent, f: FetchLike = fetch): Promise<void> {
  if (!cfg.ntfy) return;
  const t = eventText(e);
  try {
    await f(cfg.ntfy, {
      method: "POST",
      headers: { Title: t.title, Priority: t.priority, Tags: e.type === "down" || e.type === "problems" ? "warning" : "white_check_mark" },
      body: t.body,
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    logServer("warn", "ntfy push failed", error);
  }
}

/** Runs one check, updates state and sends alerts for anything that changed. */
export async function tick(cfg: UnraidConfig, f: FetchLike = fetch): Promise<Watcher> {
  const w = watcher();
  if (w.running) return w;
  w.running = true;
  try {
    const status = await checkUnraid(cfg, Date.now(), f);
    const { state, events } = nextWatch(w.state, status);
    w.state = state;
    for (const e of events) {
      const t = eventText(e);
      logServer(e.type === "down" || e.type === "problems" ? "warn" : "info", `Unraid: ${t.title}. ${t.body}`);
      w.events = [{ t: Date.now(), title: t.title, body: t.body }, ...w.events].slice(0, 20);
      await sendNtfy(cfg, e, f);
    }
  } finally {
    w.running = false;
  }
  return w;
}

/** Idempotent. Checks right away, then every UNRAID_CHECK_SECONDS (default 60). */
export function startWatcher(): void {
  const cfg = unraidConfig();
  const w = watcher();
  if (!cfg || w.timer) return;
  logServer("info", `Unraid watcher started for ${cfg.base} (every ${cfg.intervalSec}s${cfg.ntfy ? ", ntfy on" : ""})`);
  void tick(cfg);
  w.timer = setInterval(() => { void tick(cfg); }, cfg.intervalSec * 1000);
  (w.timer as { unref?: () => void }).unref?.();
}

export async function handleUnraid(request: Request) {
  const cfg = unraidConfig();
  if (!cfg) return Response.json({ configured: false });
  startWatcher();
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const w = refresh ? await tick(cfg) : watcher();
  return Response.json({
    configured: true,
    phase: w.state.phase,
    downSince: w.state.downSince,
    status: w.state.last ?? null,
    events: w.events,
    intervalSec: cfg.intervalSec,
    push: !!cfg.ntfy,
  });
}
