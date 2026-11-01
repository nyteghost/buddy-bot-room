import { currentUser } from "./accounts.server";
import { ensureSettings } from "./settings.server";
import { isLocalOnly } from "./local-only";
import { isModelName } from "./model-catalog";
import { isRemoteOllama } from "./ollama-resources";
import type { OllamaHealth } from "./ollama-health";
/** No caller-supplied addresses, hardware probes, inference, or secrets. */
export async function readOllamaHealth(signal?: AbortSignal): Promise<OllamaHealth> {
  await ensureSettings();
  const base = (process.env["OLLAMA_URL"] ?? "").trim().replace(/\/+$/, "");
  const common = {
    configured: !!base,
    reachable: false,
    remote: isRemoteOllama(base),
    localOnly: isLocalOnly(process.env["LOCAL_ONLY_AI"]),
    models: [],
  };
  if (!base) return { ...common, state: "configuration", note: "Connect Ollama in Settings." };
  try {
    const timeout = AbortSignal.timeout(6000);
    const response = await fetch(`${base}/api/tags`, {
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error();
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let text = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 200000) throw new Error();
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const data = JSON.parse(text) as { models?: unknown };
    if (!Array.isArray(data.models)) throw new Error();
    const models = data.models
      .slice(0, 300)
      .flatMap((m: { name?: unknown; size?: unknown; remote_host?: unknown }) =>
        m && isModelName(m.name) && !m.remote_host && !/(?:[:-]cloud)$/i.test(m.name)
          ? [
              {
                name: m.name,
                gb:
                  typeof m.size === "number" && Number.isFinite(m.size) && m.size > 0
                    ? m.size / 1024 ** 3
                    : 0,
              },
            ]
          : [],
      );
    return { ...common, state: "connected", reachable: true, models };
  } catch {
    return {
      ...common,
      state: "offline",
      note: "Pixel Pals cannot reach the configured Ollama host. Check its availability in Settings; this is a server-side check.",
    };
  }
}
export async function handleOllamaHealth(request: Request): Promise<Response> {
  if (!(await currentUser(request))?.owner)
    return Response.json(
      { error: "Owner sign-in required" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const result = await readOllamaHealth(request.signal);
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
