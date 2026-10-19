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
