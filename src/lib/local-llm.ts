import type { UIMessageChunk } from "ai";
import { freeModels } from "./engine";

type Engine = import("@mlc-ai/web-llm").MLCEngineInterface;
let enginePromise: Promise<Engine> | null = null;

export function hasWebGPU() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Downloads (first time) and starts the in-browser model. */
export function loadLocalEngine(onProgress?: (progress: number, text: string) => void) {
  if (!hasWebGPU()) return Promise.reject(new Error("This browser does not support WebGPU."));
  enginePromise ??= import("@mlc-ai/web-llm")
    .then(({ CreateMLCEngine }) =>
      CreateMLCEngine(freeModels.local, {
        initProgressCallback: (p) => onProgress?.(p.progress, p.text),
      }),
    )
    .catch((err) => {
      enginePromise = null;
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

/** Basic WebGPU adapter info for the usage box. */
export async function getGpuInfo(): Promise<string | null> {
  if (!hasWebGPU()) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const info = (adapter as unknown as { info?: { description?: string; vendor?: string; architecture?: string } })?.info;
    if (!info) return "WebGPU adapter available";
    return [info.description, info.vendor, info.architecture].filter(Boolean).join(" · ") || "WebGPU adapter available";
  } catch {
    return null;
  }
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
      try {
        for await (const chunk of chunks) {
          if (signal.aborted) break;
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue({ type: "text-delta", id: "t", delta });
        }
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
