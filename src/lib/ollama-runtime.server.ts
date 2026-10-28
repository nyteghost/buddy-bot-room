import { isOutOfMemory, parseKeepAlive, planLoad, smallerFallback, type Installed, type Loaded, type Plan } from "./ollama-resources";

/**
 * What happens between "a pal wants to answer with model X" and the first word: is X already loaded, will it fit, did it load,
 * and if the GPU ran out of memory, is there a smaller downloaded model to use instead. The network part is injected (`OllamaApi`)
 * so this logic is tested without an Ollama. Local replies stay local: a fallback is always another model on the same Ollama.
 */
export type OllamaApi = {
  installed: () => Promise<Installed[]>;
  loaded: () => Promise<Loaded[]>;
  /** Load `model` and keep it for `keepAlive`. Rejects with Ollama's own message when it cannot (for example out of memory). */
  load: (model: string, keepAlive: string | null) => Promise<void>;
};

export type Prepared =
  | { ok: true; model: string; requested: string; fellBack: boolean; plan: Plan | null; reason?: string }
  | { ok: false; requested: string; message: string };

const sameModel = (a: string, b: string) => a === b || `${a}:latest` === b || a === `${b}:latest`;

/** Make `requested` ready. Never throws: a problem that is not about memory is left for the real reply to report in Ollama's own words. */
export async function prepareModel(api: OllamaApi, o: { requested: string; vramGb: number; keepAlive: string | null; allowFallback?: boolean }): Promise<Prepared> {
  const { requested, vramGb, keepAlive } = o;
  let installed: Installed[] = [];
  let loaded: Loaded[] = [];
  try { [installed, loaded] = await Promise.all([api.installed(), api.loaded().catch(() => [])]); } catch { return { ok: true, model: requested, requested, fellBack: false, plan: null }; }
  const mine = installed.find((m) => sameModel(m.name, requested));
  if (!mine) return { ok: true, model: requested, requested, fellBack: false, plan: null }; // not downloaded: Ollama says so itself
  const plan = planLoad({ vramGb, loaded, model: requested, sizeBytes: mine.gb * 1024 ** 3 });
  if (plan.alreadyLoaded) return { ok: true, model: requested, requested, fellBack: false, plan };
  try {
    await api.load(requested, keepAlive);
    return { ok: true, model: requested, requested, fellBack: false, plan };
  } catch (e) {
    if (!isOutOfMemory(e)) return { ok: true, model: requested, requested, fellBack: false, plan }; // slow or odd, not memory: let the reply decide
    const reason = `${requested} did not fit in memory`;
    const smaller = o.allowFallback === false ? null : smallerFallback(requested, installed, vramGb > 0 ? vramGb : undefined);
    if (smaller) {
      try {
        await api.load(smaller, keepAlive);
        return { ok: true, model: smaller, requested, fellBack: true, plan, reason };
      } catch (e2) {
        if (!isOutOfMemory(e2)) return { ok: true, model: smaller, requested, fellBack: true, plan, reason };
      }
    }
    return {
      ok: false,
      requested,
      message: `${requested} doesn't fit in this machine's memory${smaller ? `, and neither did ${smaller}` : ", and no smaller downloaded model could take over"}. Download a smaller model in the Local AI panel, or pick one in AI engine settings.`,
    };
  }
}

/** Real Ollama behind `base` (for example http://ollama:11434). */
export function ollamaApi(base: string, f: typeof fetch = fetch): OllamaApi {
  const get = async <T>(path: string, ms: number): Promise<T> => {
    const res = await f(`${base}${path}`, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    installed: async () => ((await get<{ models?: { name: string; size?: number }[] }>("/api/tags", 4000)).models ?? []).map((m) => ({ name: m.name, gb: (m.size ?? 0) / 1024 ** 3 })),
    loaded: async () => ((await get<{ models?: { name: string; size_vram?: number }[] }>("/api/ps", 3000)).models ?? []).map((m) => ({ name: m.name, sizeVramBytes: m.size_vram ?? 0 })),
    load: async (model, keepAlive) => {
      // The OpenAI-style /v1 endpoint ignores keep_alive, so the native endpoint does the loading and the keeping.
      const res = await f(`${base}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: "", stream: false, ...(keepAlive ? { keep_alive: /^-?\d+$/.test(keepAlive) ? Number(keepAlive) : keepAlive } : {}) }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Ollama answered ${res.status}`);
    },
  };
}

/** How long Ollama keeps a model after the last reply (OLLAMA_KEEP_ALIVE, default 30 minutes so the next message is quick). */
export const keepAliveSetting = (env: Record<string, string | undefined> = process.env): string | null => {
  const raw = (env["OLLAMA_KEEP_ALIVE"] ?? "").trim();
  return raw ? parseKeepAlive(raw) : "30m";
};

/** After a reply: push the unload timer out again. /v1 requests reset it to Ollama's own default, so without this the keep-alive would be lost. Best effort. */
export async function touchKeepAlive(api: OllamaApi, model: string, keepAlive: string | null): Promise<void> {
  if (!keepAlive || keepAlive === "0") return;
  try { await api.load(model, keepAlive); } catch { /* the reply already succeeded; the model just unloads on Ollama's schedule */ }
}
