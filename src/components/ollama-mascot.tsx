import { useEffect, useState } from "react";
import { setEngine, useEngine } from "@/lib/engine";
import { isTauri, tauriOllamaTags } from "@/lib/local-llm";
import { cn } from "@/lib/utils";

// Native 32×32 Cyber Llama. w=wool, d=wool shade, v=visor, k=dark, g=gpu core, f=fan, h=hoof
const llama = [
  "................................",
  ".........kk.......kk............",
  "........kwwk.....kwwk...........",
  "........kwdk.....kwdk...........",
  ".........kwwkkkkkwwk............",
  "........kwwwwwwwwwwwk...........",
  ".......kwwwwwwwwwwwwwk..........",
  ".......kkvvvvvvvvvvvkk..........",
  ".......kvvkvvvvvvkvvvk..........",
  ".......kkvvvvvvvvvvvkk..........",
  "........kwwwwwwwwwwwk...........",
  "........kwwwwddwwwwwk...........",
  ".........kwwwkkwwwwk............",
  "..........kwwwwwwwk.............",
  "...........kwwwwwk..............",
  "...........kwwwwwk..............",
  "...........kwwwwwk..............",
  "......kkkkkwwwwwwwkkkkkkk.......",
  ".....kwwwwwwwwwwwwwwwwwwwk......",
  "....kwwdwwwkkkkkkkwwwdwwwwk.....",
  "....kwwwwwwkgggggkwwwwwwwwk.....",
  "....kwdwwwwkgfgfgkwwwwdwwwk.....",
  "....kwwwwwwkgggggkwwwwwwwwk.....",
  "....kwwwdwwkkkkkkkwwdwwwwwk.....",
  ".....kwwwwwwwwwwwwwwwwwwwk......",
  "......kwwkkwwk.....kwwkkwwk.....",
  "......kwwkkwwk.....kwwkkwwk.....",
  "......kwwkkwwk.....kwwkkwwk.....",
  "......kwwkkwwk.....kwwkkwwk.....",
  "......khhkkhhk.....khhkkhhk.....",
  "......kkkkkkkk.....kkkkkkkk.....",
  "................................",
];

type Status = { online: boolean; models: string[]; ping?: number };

/** Probes the configured local Ollama server; the mascot only appears while it answers. */
function useOllamaStatus(url: string): Status {
  const [status, setStatus] = useState<Status>({ online: false, models: [] });
  useEffect(() => {
    let stop = false;
    const base = url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    async function probe() {
      const t = performance.now();
      try {
        let models: string[];
        if (isTauri()) {
          models = await tauriOllamaTags(url);
        } else {
          const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
          if (!res.ok) throw new Error();
          const json = (await res.json()) as { models?: { name: string }[] };
          models = (json.models ?? []).map((m) => m.name);
        }
        if (!stop) setStatus({ online: true, models, ping: Math.round(performance.now() - t) });
      } catch {
        if (!stop) setStatus({ online: false, models: [] });
      }
    }
    void probe();
    const timer = setInterval(probe, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [url]);
  return status;
}

const LAUNCH_CMD = 'OLLAMA_ORIGINS="*" ollama serve';

function OllamaLauncher() {
  const [note, setNote] = useState<string | null>(null);
  const desktop = isTauri();
  async function start() {
    setNote("Starting Ollama…");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ollama_start");
      setNote("Starting… the llama appears in a few seconds.");
    } catch (e) {
      setNote(String(e));
    }
  }
  async function copy() {
    await navigator.clipboard.writeText(LAUNCH_CMD);
    setNote("Copied — paste it into your terminal.");
  }
  return (
    <div className="ollama-mascot" role="status">
      <div className="ollama-info">
        <b>Ollama offline</b>
        <span>{note ?? (desktop ? "Start the local server from here." : `Run: ${LAUNCH_CMD}`)}</span>
      </div>
      <button type="button" className="ollama-switch" onClick={desktop ? start : copy}>
        {desktop ? "Start Ollama" : "Copy launch command"}
      </button>
    </div>
  );
}

export function OllamaMascot({ active = false }: { active?: boolean }) {
  const engine = useEngine();
  const status = useOllamaStatus(engine.ollamaUrl);
  if (!status.online) return engine.kind === "ollama" || engine.kind === "auto-ollama" ? <OllamaLauncher /> : null;
  const using = engine.kind === "ollama" || engine.kind === "auto-ollama";
  const hasModel = status.models.some((m) => m === engine.ollamaModel || m.startsWith(`${engine.ollamaModel}:`));
  return (
    <div className={cn("ollama-mascot", active && "ollama-busy")} role="status">
      <svg viewBox="0 0 32 32" className="ollama-sprite" shapeRendering="crispEdges" aria-label="Cyber Llama, your local Ollama server">
        {llama.flatMap((row, y) =>
          [...row].map((p, x) => (p === "." ? null : <rect key={`${x}-${y}`} className={`llama-${p}`} x={x} y={y} width="1" height="1" />)),
        )}
      </svg>
      <div className="ollama-info">
        <b>Ollama online</b>
        <span>
          {hasModel ? engine.ollamaModel : `Model "${engine.ollamaModel}" not pulled`} · {status.ping}ms
        </span>
        <span>{active ? "Your GPU is thinking…" : using ? "Powering your pals locally" : "Ready for local chat"}</span>
      </div>
      {!using && (
        <button type="button" className="ollama-switch" onClick={() => setEngine({ kind: "ollama" })}>
          Use Ollama
        </button>
      )}
    </div>
  );
}
