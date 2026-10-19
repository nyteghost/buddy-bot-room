import type { UIMessageChunk } from "ai";
import { freeModels } from "./engine";
import { createThinkFilter, maxTokensFor, stripThinking } from "./think-filter";

type Engine = import("@mlc-ai/web-llm").MLCEngineInterface;
let enginePromise: Promise<Engine> | null = null;

export function hasWebGPU() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

const modelKey = "pixel-pals-local-model-v1";
let loadedModel: string | null = null;

export function chosenLocalModel(): string {
  try {
    return localStorage.getItem(modelKey) || freeModels.local;
  } catch {
    return freeModels.local;
  }
}

export function loadedLocalModel() {
  return loadedModel;
}

/** Probes the GPU and returns the best-fitting Hugging Face model. */
export async function detectBestModel() {
  const { modelForProbe } = await import("./gpu-tier");
  const adapter = hasWebGPU() ? await navigator.gpu.requestAdapter() : null;
  if (!adapter) throw new Error("No WebGPU graphics card found in this browser.");
  const info = (adapter as unknown as { info?: { description?: string; vendor?: string; architecture?: string } }).info;
  const description =
    webglRenderer() || [info?.description, info?.vendor, info?.architecture].filter(Boolean).join(" ") || "Unknown GPU";
  const probe = {
    description,
    maxBufferSize: Number(adapter.limits.maxBufferSize),
    deviceMemoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4,
    f16: adapter.features.has("shader-f16"),
  };
  return { gpu: description, ...modelForProbe(probe) };
}

/** Downloads (first time) and starts the in-browser model. Passing a model switches to it. */
export function loadLocalEngine(onProgress?: (progress: number, text: string) => void, model?: string) {
  if (!hasWebGPU()) return Promise.reject(new Error("This browser does not support WebGPU."));
  const target = model ?? chosenLocalModel();
  if (model) {
    try {
      localStorage.setItem(modelKey, model);
    } catch {
      /* ignore */
    }
  }
  if (enginePromise && loadedModel === target) return enginePromise;
  const previous = enginePromise;
  loadedModel = target;
  enginePromise = (async () => {
    if (previous) await previous.then((e) => e.unload()).catch(() => {});
    const { CreateMLCEngine } = await import("@mlc-ai/web-llm");
    return CreateMLCEngine(target, { initProgressCallback: (p) => onProgress?.(p.progress, p.text) });
  })().catch((err) => {
    enginePromise = null;
    loadedModel = null;
    throw err;
  });
  return enginePromise;
}

/** Live usage stats from the running local engine, or null if not started. */
export async function getLocalStats(): Promise<string | null> {
  if (!enginePromise) return null;
  try {
    const engine = await enginePromise;
    return await engine.runtimeStatsText();
  } catch {
    return null;
  }
}

/** WebGL's unmasked renderer often names the GPU when WebGPU blanks it. */
export function webglRenderer(): string | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const name = gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    return name.replace(/^ANGLE \((.*)\)$/, "$1") || null;
  } catch {
    return null;
  }
}

/** Basic WebGPU adapter info for the usage box. */
export async function getGpuInfo(): Promise<string | null> {
  if (!hasWebGPU()) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const info = (adapter as unknown as { info?: { description?: string; vendor?: string; architecture?: string } })?.info;
    const gl = webglRenderer();
    if (gl) return gl;
    if (!info) return "WebGPU adapter available";
    return [info.description, info.vendor, info.architecture].filter(Boolean).join(" · ") || "WebGPU adapter available";
  } catch {
    return null;
  }
}

/** True when the model's weights are already in this browser's cache (no re-download needed). */
export async function isModelCached(model: string): Promise<boolean> {
  try {
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    return await hasModelInCache(model);
  } catch {
    return false;
  }
}

/** True inside the Tauri desktop window, where localhost calls must go through the native side. */
export function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Native Ollama chat via the Rust side (no mixed-content/CORS limits). Returns the full reply. */
async function tauriOllamaChat(
  prompt: { system: string; messages: { role: "user" | "assistant"; content: string }[] },
  server: { url: string; model: string },
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("ollama_chat", {
    url: server.url,
    model: server.model,
    system: prompt.system,
    messages: prompt.messages,
  });
}

/** Native /api/tags probe for the mascot when running in the desktop app. */
export async function tauriOllamaTags(url: string): Promise<string[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string[]>("ollama_tags", { url });
}

/** Streams one turn from a local OpenAI-compatible server (Ollama, llama.cpp, vLLM). */
export async function ollamaTurn(
  prompt: { system: string; messages: { role: "user" | "assistant"; content: string }[] },
  server: { url: string; model: string },
  metadata: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  if (isTauri()) {
    // The desktop window loads the https site, so browser fetch to http://localhost is blocked.
    // Ask the native side instead and emit the reply as one stream.
    const text = stripThinking(await tauriOllamaChat(prompt, server));
    signal.throwIfAborted();
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        controller.enqueue({ type: "start", messageMetadata: metadata });
        controller.enqueue({ type: "text-start", id: "t" });
        if (text) controller.enqueue({ type: "text-delta", id: "t", delta: text });
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({ type: "finish" });
        controller.close();
      },
    });
  }
  let res: Response;
  try {
    res = await fetch(`${server.url.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        model: server.model,
        stream: true,
        max_tokens: maxTokensFor(server.model),
        messages: [{ role: "system", content: prompt.system }, ...prompt.messages],
      }),
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new Error(
      `Can't reach your local server at ${server.url}. Start it with: OLLAMA_ORIGINS="*" ollama serve`,
    );
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      res.status === 404
        ? `Model "${server.model}" not found. Run: ollama pull ${server.model}`
        : `Local server error ${res.status}: ${detail.slice(0, 200)}`,
    );
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      controller.enqueue({ type: "start", messageMetadata: metadata });
      controller.enqueue({ type: "text-start", id: "t" });
      let buffer = "";
      const thinkFilter = createThinkFilter();
      const send = (raw: string) => {
        const visible = thinkFilter.push(raw);
        if (visible) controller.enqueue({ type: "text-delta", id: "t", delta: visible });
      };
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const data = line.replace(/^data:\s*/, "").trim();
            if (!data || data === "[DONE]" || !line.startsWith("data:")) continue;
            try {
              const delta = JSON.parse(data).choices?.[0]?.delta?.content;
              if (delta) send(delta);
            } catch {
              /* partial line */
            }
          }
        }
        const rest = thinkFilter.flush();
        if (rest) controller.enqueue({ type: "text-delta", id: "t", delta: rest });
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({ type: "finish" });
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}


/** Runs one turn locally and returns it as a UI message stream like /api/chat does. */
export async function localTurn(
  prompt: { system: string; messages: { role: "user" | "assistant"; content: string }[] },
  metadata: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  const engine = await loadLocalEngine();
  signal.throwIfAborted();
  const chunks = await engine.chat.completions.create({
    stream: true,
    max_tokens: 400,
    messages: [{ role: "system", content: prompt.system }, ...prompt.messages],
  });
  const onAbort = () => engine.interruptGenerate();
  signal.addEventListener("abort", onAbort, { once: true });
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      controller.enqueue({ type: "start", messageMetadata: metadata });
      controller.enqueue({ type: "text-start", id: "t" });
      const thinkFilter = createThinkFilter();
      try {
        for await (const chunk of chunks) {
          if (signal.aborted) break;
          const delta = chunk.choices[0]?.delta?.content;
          const visible = delta ? thinkFilter.push(delta) : "";
          if (visible) controller.enqueue({ type: "text-delta", id: "t", delta: visible });
        }
        const rest = thinkFilter.flush();
        if (rest) controller.enqueue({ type: "text-delta", id: "t", delta: rest });
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({ type: "finish" });
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    },
  });
}

/** Free browser voice used when the pals aren't on Lovable AI. */
export function speakFree(text: string, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (typeof speechSynthesis === "undefined") return resolve();
    const utter = new SpeechSynthesisUtterance(text.replace(/[*_#>`]/g, ""));
    utter.onend = utter.onerror = () => resolve();
    signal.addEventListener("abort", () => (speechSynthesis.cancel(), resolve()), { once: true });
    speechSynthesis.speak(utter);
  });
}
