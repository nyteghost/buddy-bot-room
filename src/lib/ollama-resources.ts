import type { Hardware } from "./hardware";

/** Pure helpers for running models on one GPU (the RTX 3080 box that hosts Ollama): which machine's GPU counts, whether a model fits,
 *  what to do when it doesn't, and keep-alive handling. No network here; ollama.server.ts feeds these real data. */

/** Hostnames that mean "the Ollama container inside this stack, on this server". Anything else is another machine. */
const STACK_HOSTS = new Set(["ollama", "localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
export function isRemoteOllama(url: string): boolean {
  try { return !STACK_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

export type HostGpu = { gb: number; source: "setting" | "server-gpu" | "observed" | "unknown"; remote: boolean };

/** Which VRAM to plan with. When Ollama runs on another machine the Pixel Pals server's own GPU (if any) is NOT the one that matters:
 *  use OLLAMA_VRAM_GB, otherwise fall back to what loaded models are visibly using (a lower bound), otherwise say it is unknown. */
export function hostGpu(opts: { url: string; settingGb: unknown; server: Hardware; observedGb?: number }): HostGpu {
  const remote = isRemoteOllama(opts.url);
  const set = Number(opts.settingGb);
  if (Number.isFinite(set) && set > 0) return { gb: set, source: "setting", remote };
  if (!remote) {
    const g = Math.max(0, ...opts.server.gpus.map((x) => x.vramGb));
    if (g > 0) return { gb: g, source: "server-gpu", remote };
  }
  if ((opts.observedGb ?? 0) > 0) return { gb: opts.observedGb!, source: "observed", remote };
  return { gb: 0, source: "unknown", remote };
}

/** Hardware as seen by the machine that runs Ollama, for the model recommendations. */
export function hostHardware(server: Hardware, gpu: HostGpu, ramGbSetting?: unknown): Hardware {
  if (!gpu.remote && gpu.source !== "setting") return server;
  const ram = Number(ramGbSetting);
  return {
    ...server,
    ...(gpu.remote && Number.isFinite(ram) && ram > 0 ? { ramGb: ram } : {}),
    gpus: gpu.gb > 0 ? [{ name: "Ollama host GPU", vramGb: gpu.gb }] : [],
    gpuSource: gpu.gb > 0 ? "override" : "none",
  };
}

/** Memory a model needs to run: weights plus working space (same rule as the catalog). */
export const modelNeedGb = (sizeBytes: number): number => Math.round(((sizeBytes / 1024 ** 3) * 1.15 + 0.7) * 10) / 10;

export type Loaded = { name: string; sizeVramBytes: number };
export type Plan = { fits: boolean; needGb: number; freeGb: number; alreadyLoaded: boolean; wouldUnload: string[] };

/** Will `model` fit next to what is loaded? If not, which loaded models would Ollama have to unload (a model switch costs seconds)? */
export function planLoad(opts: { vramGb: number; loaded: Loaded[]; model: string; sizeBytes: number }): Plan {
  const needGb = modelNeedGb(opts.sizeBytes);
  const same = (n: string) => n === opts.model || n === `${opts.model}:latest` || `${n}:latest` === opts.model;
  const alreadyLoaded = opts.loaded.some((m) => same(m.name));
  const used = opts.loaded.filter((m) => !same(m.name)).reduce((s, m) => s + m.sizeVramBytes / 1024 ** 3, 0);
  const freeGb = Math.max(0, opts.vramGb - used);
  if (alreadyLoaded || opts.vramGb <= 0) return { fits: true, needGb, freeGb, alreadyLoaded, wouldUnload: [] };
  const fits = needGb <= freeGb;
  return { fits, needGb, freeGb, alreadyLoaded, wouldUnload: fits ? [] : opts.loaded.filter((m) => !same(m.name)).map((m) => m.name) };
}

const OOM = /out of memory|cuda error|cudamalloc|failed to allocate|insufficient memory|requires more system memory|unable to allocate|memory layout cannot be allocated|exit status 2/i;
/** Did Ollama fail because the model did not fit? */
export const isOutOfMemory = (e: unknown): boolean => OOM.test(typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e ?? ""));

export type Installed = { name: string; gb: number };
/** A smaller installed model to fall back to: never the same one, never more than 70 % of the requested size, the largest that qualifies.
 *  Embedding models are skipped. Returns null when nothing smaller is installed (the caller then says so plainly). */
export function smallerFallback(requested: string, installed: Installed[], maxVramGb?: number): string | null {
  const want = installed.find((m) => m.name === requested || `${m.name}:latest` === requested || m.name === `${requested}:latest`);
  const ceiling = want ? want.gb * 0.7 : maxVramGb ?? Infinity;
  const pool = installed.filter((m) => m !== want && !/embed|nomic|bge|minilm/i.test(m.name) && m.gb < ceiling && (maxVramGb === undefined || modelNeedGb(m.gb * 1024 ** 3) <= maxVramGb));
  return pool.sort((a, b) => b.gb - a.gb)[0]?.name ?? null;
}

/** OLLAMA_KEEP_ALIVE: "5m", "30m", "2h", "24h", "-1" (never unload) or "0" (unload at once). Anything else is ignored. */
export function parseKeepAlive(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^(-1|0|\d{1,4}[smh])$/.test(s) ? s : null;
}
