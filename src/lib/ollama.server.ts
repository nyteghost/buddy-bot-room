import { readHardware } from "./hardware.server";
import { bestInstalled, isModelName, parseAutoMarker } from "./model-catalog";
import { logServer } from "./server-log.server";
import { isLocalOnly } from "./local-only";
import { currentFeed, feedEnabled, refreshFeed } from "./model-feed.server";
import { hostGpu, hostHardware } from "./ollama-resources";
import { keepAliveSetting } from "./ollama-runtime.server";
import type { Hardware } from "./hardware";
import { accountsEnabled } from "./accounts";
import { addResult, avoidedModels, benchPersistent, clearResults, httpBenchApi, readResults, runSuite, takeBenchLock } from "./ollama-bench.server";
import { avoidModels, measuredBest, summarize } from "./ollama-bench";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The Ollama inside the stack (or any address you give it). Empty means Local AI is not set up. */
export const ollamaBase = (): string => (process.env["OLLAMA_URL"] ?? "").trim().replace(/\/+$/, "");

async function ollama(path: string, init: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 5000, ...rest } = init;
  return fetch(`${ollamaBase()}${path}`, { ...rest, signal: init.signal ?? AbortSignal.timeout(timeout) });
}

type Tag = { name: string; size?: number };

/** The GPU that matters is the one on the machine running Ollama, which is not this server when OLLAMA_URL points elsewhere. */
export function ollamaHost(server: Hardware, observedGb?: number) {
  const gpu = hostGpu({ url: ollamaBase(), settingGb: process.env["OLLAMA_VRAM_GB"], server, ...(observedGb ? { observedGb } : {}) });
  return { gpu, hardware: hostHardware(server, gpu, process.env["OLLAMA_RAM_GB"]) };
}

/** GET: status, installed models and the machine's hardware. POST {action:"pull"|"delete", model}: download or remove a model. */
export async function handleOllamaApi(request: Request): Promise<Response> {
  const localOnly = isLocalOnly(process.env["LOCAL_ONLY_AI"]);
  if (!ollamaBase()) return json({ configured: false, localOnly });
  if (request.method === "GET") {
    const serverHardware = await readHardware();
    let hardware = ollamaHost(serverHardware).hardware;
    try {
      const [tags, ps] = await Promise.all([ollama("/api/tags"), ollama("/api/ps").catch(() => null)]);
      if (!tags.ok) return json({ configured: true, localOnly, reachable: false, hardware, error: `Ollama answered ${tags.status}.` });
      const models = ((await tags.json()) as { models?: Tag[] }).models ?? [];
      const loaded = ps?.ok ? (((await ps.json()) as { models?: { name: string; size_vram?: number; size?: number }[] }).models ?? []) : [];
      const observedGb = Math.max(0, ...loaded.map((m) => (m.size_vram ?? 0) / 1024 ** 3));
      const host = ollamaHost(serverHardware, observedGb);
      hardware = host.hardware;
      return json({
        configured: true,
        reachable: true,
        hardware,
        host: { vramGb: host.gpu.gb, source: host.gpu.source, remote: host.gpu.remote },
        keepAlive: keepAliveSetting(),
        models: models.map((m) => ({ name: m.name, gb: Math.round(((m.size ?? 0) / 1024 ** 3) * 10) / 10 })),
        feed: await currentFeed(),
        feedEnabled: feedEnabled(),
        loaded: loaded.map((m) => ({ name: m.name, onGpu: (m.size_vram ?? 0) > 0 })),
      });
    } catch {
      return json({ configured: true, localOnly, reachable: false, hardware, error: "Couldn't reach Ollama. Is the ollama container running?" });
    }
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  let body: { action?: unknown; model?: unknown } = {};
  try { body = (await request.json()) as typeof body; } catch { return json({ error: "Bad request." }, 400); }
  if (body.action === "refresh-feed") return feedEnabled() ? json({ feed: await refreshFeed() }) : json({ error: "Model list updates are turned off (MODEL_FEED=0)." }, 400);
  if (body.action === "bench-results") {
    const summary = summarize(await readResults());
    return json({ summary, best: measuredBest(summary), avoid: [...avoidModels(summary)], persistent: benchPersistent() });
  }
  if (!isModelName(body.model) && body.action !== "bench-clear") return json({ error: "That isn't a valid model name." }, 400);
  // Running or deleting benchmarks changes the shared record and loads the GPU, so with accounts on only the owner may.
  if ((body.action === "bench-clear" || body.action === "bench-suite") && accountsEnabled(process.env)) {
    const user = await (await import("./accounts.server")).currentUser(request);
    if (!user?.owner) return json({ error: "Only the owner account can run or delete benchmarks." }, 403);
  }
  if (body.action === "bench-clear") {
    await clearResults(isModelName(body.model) && body.model !== "x" ? body.model : undefined);
    return json({ ok: true });
  }
  if (body.action === "bench-suite") {
    const release = takeBenchLock();
    if (!release) return json({ error: "A benchmark is already running. Wait for it to finish." }, 409);
    const model = body.model as string;
    const api = httpBenchApi(ollamaBase());
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let gone = false;
        // If the browser went away the run still finishes and is stored; only the progress lines stop.
        const send = (o: unknown) => { if (gone) return; try { controller.enqueue(encoder.encode(JSON.stringify(o) + "\n")); } catch { gone = true; } };
        try {
          for await (const ev of runSuite(api, model, keepAliveSetting())) {
            if (ev.type === "result") await addResult(ev.result);
            send(ev);
          }
        } catch (e) {
          send({ type: "error", message: e instanceof Error ? e.message : "The benchmark stopped." });
        } finally {
          release();
          try { controller.close(); } catch { /* already closed */ }
        }
      },
    });
    logServer("info", `ollama benchmark started: ${model}`);
    return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
  }
  if (body.action === "pull") {
    try {
      const res = await ollama("/api/pull", { method: "POST", body: JSON.stringify({ model: body.model, stream: true }), headers: { "content-type": "application/json" }, timeout: 60 * 60_000 });
      if (!res.ok || !res.body) return json({ error: `Ollama couldn't download ${body.model} (${res.status}).` }, 502);
      logServer("info", `ollama pull started: ${body.model}`);
      return new Response(res.body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
    } catch {
      return json({ error: "Couldn't reach Ollama." }, 502);
    }
  }
  if (body.action === "bench") {
    try {
      const res = await ollama("/api/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: body.model, prompt: "Write three sentences about the ocean.", stream: false, options: { num_predict: 80 } }), timeout: 180_000 });
      if (!res.ok) return json({ error: `Ollama couldn't run ${body.model} (${res.status}). Is it downloaded?` }, 502);
      const r = (await res.json()) as { eval_count?: number; eval_duration?: number; load_duration?: number };
      const ps = await ollama("/api/ps").then((p) => (p.ok ? (p.json() as Promise<{ models?: { name: string; size_vram?: number; size?: number }[] }>) : null)).catch(() => null);
      const loaded = ps?.models?.find((m) => m.name === body.model || m.name === `${body.model}:latest`);
      const tps = r.eval_count && r.eval_duration ? Math.round((r.eval_count / (r.eval_duration / 1e9)) * 10) / 10 : 0;
      const share = loaded && loaded.size ? Math.round(((loaded.size_vram ?? 0) / loaded.size) * 100) : null;
      return json({ tokensPerSec: tps, loadSeconds: Math.round(((r.load_duration ?? 0) / 1e9) * 10) / 10, gpuPercent: share });
    } catch {
      return json({ error: "The speed test timed out or Ollama couldn't be reached." }, 502);
    }
  }
  if (body.action === "delete") {
    try {
      const res = await ollama("/api/delete", { method: "DELETE", body: JSON.stringify({ model: body.model }), headers: { "content-type": "application/json" } });
      return res.ok ? json({ ok: true }) : json({ error: `Ollama couldn't remove ${body.model}.` }, 502);
    } catch {
      return json({ error: "Couldn't reach Ollama." }, 502);
    }
  }
  return json({ error: "Unknown action." }, 400);
}

/** Turns "auto:code" into the best model that is actually installed for this machine right now. Plain names pass through. */
export async function resolveLocalModel(model: string): Promise<string | null> {
  const task = parseAutoMarker(model);
  if (!task) return model;
  try {
    const [tags, server] = await Promise.all([ollama("/api/tags"), readHardware()]);
    if (!tags.ok) return null;
    const hardware = ollamaHost(server).hardware;
    const list = (((await tags.json()) as { models?: Tag[] }).models ?? []).map((m) => ({ name: m.name, gb: (m.size ?? 0) / 1024 ** 3 }));
    return bestInstalled(task, list, hardware, await avoidedModels());
  } catch {
    return null;
  }
}
