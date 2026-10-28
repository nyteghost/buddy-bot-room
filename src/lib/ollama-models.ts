import { useEffect, useState } from "react";
import { isTauri, tauriOllamaTags } from "./local-llm";

/** Model names installed on a local Ollama server (empty when it isn't reachable). */
export async function fetchOllamaModels(url: string): Promise<string[]> {
  try {
    if (isTauri()) return await tauriOllamaTags(url);
    const base = url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: { name: string }[] };
    return (json.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export function useOllamaModels(url: string, enabled = true): string[] {
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    void fetchOllamaModels(url).then((list) => {
      if (!stop) setModels(list);
    });
    return () => {
      stop = true;
    };
  }, [url, enabled]);
  return models;
}

/** Native Ollama defaults to 30m. Refresh a little before then, but only when the
 * user returns to the app; never hold VRAM open with a perpetual timer. */
export const OLLAMA_WARM_REFRESH_MS = 25 * 60_000;
const MAX_WARM_ENTRIES = 48;
const warmed = new Map<string, { until: number; pending?: Promise<boolean> }>();

/** Best-effort preload. Reuses concurrent requests, expires old success records and
 * retries on failure. Memory is bounded even if the URL/model settings change often. */
export async function warmOllama(url: string, model: string): Promise<boolean> {
  const base = url.trim().replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const name = model.trim();
  if (!base || !name || isTauri()) return false;
  const key = `${base}|${name}`;
  const now = Date.now();
  const existing = warmed.get(key);
  if (existing?.pending) return existing.pending;
  if (existing && existing.until > now) return false;

  // Remove expired entries and cap successful model records.
  for (const [id, record] of warmed) if (!record.pending && record.until <= now) warmed.delete(id);
  if (warmed.size >= MAX_WARM_ENTRIES) {
    const oldest = [...warmed].find(([, record]) => !record.pending)?.[0];
    if (oldest) warmed.delete(oldest);
  }

  const pending = (async () => {
    try {
      const res = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name, prompt: "", keep_alive: "30m", stream: false }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) {
        warmed.delete(key);
        return false;
      }
      warmed.set(key, { until: Date.now() + OLLAMA_WARM_REFRESH_MS });
      return true;
    } catch {
      warmed.delete(key);
      return false;
    }
  })();
  warmed.set(key, { until: 0, pending });
  return pending;
}
