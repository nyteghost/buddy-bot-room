import { useOllamaHealth } from "@/lib/ollama-health-store";
import { serverOllamaTransport, modelProblem, preferredInstalled } from "@/lib/ollama-health";
import { useEffect, useState } from "react";
import { startPolling } from "@/lib/poll";
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

type Status = { checking?: boolean; online: boolean; models: string[]; ping?: number };

/** Probes the configured local Ollama server; the mascot only appears while it answers. */
function useOllamaStatus(url: string, enabled: boolean): Status {
  const [status, setStatus] = useState<Status>({ checking: true, online: false, models: [] });
  useEffect(() => {
    if (!enabled) return;
    setStatus({ checking: true, online: false, models: [] });
    let stop = false;
    const base = url.replace(/\/v1\/?$/, "").replace(/\/$/, "");
    async function probe(): Promise<boolean> {
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
        return true;
      } catch {
        if (!stop) setStatus({ online: false, models: [] });
        return false; // offline: ask less and less often (up to once a minute)
      }
    }
    // Every 5 s while the tab is visible; not at all while hidden.
    const off = startPolling(probe, 5000, { maxMs: 60_000 });
    return () => {
      stop = true;
      off();
    };
  }, [url, enabled]);
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
        <b>Local AI — Offline</b>
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
  const health = useOllamaHealth();
  const server = serverOllamaTransport(engine.ollamaTransport, health) || engine.kind === "local-server";
  const using = ["ollama", "auto-ollama", "local-server"].includes(engine.kind) || health.localOnly;
  const direct = useOllamaStatus(engine.ollamaUrl, using && !server);
  if (!using) return null;
  if (!server && !direct.online && !direct.checking) return <OllamaLauncher />;
  const model = server ? engine.localChat : engine.ollamaModel;
  const names = server ? health.models.map(m => m.name) : direct.models;
  const online = server ? health.reachable : direct.online;
  const defaultProblem = online ? modelProblem(model, names) : null;
  const palProblem = online ? Object.entries(engine.localPals ?? {}).find(([, assigned]) => assigned && modelProblem(assigned, names)) : undefined;
  const problem = defaultProblem ?? (palProblem ? `Pal ${palProblem[0]}: ${modelProblem(palProblem[1], names)}` : null);
  const title = problem ? "Model unavailable" : (server && health.state === "checking") || (!server && direct.checking) ? "Checking" : online ? "Connected" : server && health.state === "configuration" ? "Configuration required" : "Offline";
  const replacement = preferredInstalled(names);
  const displayModel = model === "auto" || model.startsWith("auto:") ? replacement || "Automatic installed model" : model;
  return (
    <div className={cn("ollama-mascot", active && "ollama-busy")} role="status">
      <svg viewBox="0 0 32 32" className="ollama-sprite" shapeRendering="crispEdges" aria-label="Cyber Llama, your local Ollama server">
        {llama.flatMap((row, y) =>
          [...row].map((p, x) => (p === "." ? null : <rect key={`${x}-${y}`} className={`llama-${p}`} x={x} y={y} width="1" height="1" />)),
        )}
      </svg>
      <div className="ollama-info">
        <b>Local AI — {title}</b>
        <span>
          {online ? `${displayModel} · ${server ? health.remote ? "Remote Ollama via Pixel Pals" : "Ollama via Pixel Pals" : "Browser-direct Ollama"}` : server ? health.note ?? "Checking from Pixel Pals…" : "Browser-direct connection unavailable. Use Connect Ollama in Settings."}
        </span>
        <span>{problem ?? (active ? "Local AI is answering…" : "No browser access to the remote PC is needed in server mode.")}</span>
      </div>
      {defaultProblem && replacement && (
        <button type="button" className="ollama-switch" onClick={() => setEngine({ localChat: replacement, ollamaModel: replacement, localAuto: false })}>
          Use {replacement} as default
        </button>
      )}
    </div>
  );
}
