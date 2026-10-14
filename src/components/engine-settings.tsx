import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { availableProviders, setEngine, useEngine, type EngineKind } from "@/lib/engine";
import {
  chosenLocalModel,
  detectBestModel,
  getGpuInfo,
  getLocalStats,
  hasWebGPU,
  isModelCached,
  loadLocalEngine,
} from "@/lib/local-llm";
import { cn } from "@/lib/utils";
import { localModelChoices } from "@/lib/gpu-tier";

const options: { kind: EngineKind; label: string; note: string }[] = [
  { kind: "cloud", label: "Free keys", note: "Uses every free key you enter below, sharing turns between them." },
  { kind: "auto", label: "Auto (fastest)", note: "Free keys answer first (about 40× faster); the in-browser model takes over if a key hits its limit." },
  { kind: "local", label: "In-browser (WebGPU)", note: "Runs on your computer. Free and private; downloads once, then loads from cache." },
  { kind: "ollama", label: "Local server / Ollama", note: "Uses Ollama or llama.cpp on your computer for full native GPU speed." },
  { kind: "auto-ollama", label: "Auto (keys + Ollama)", note: "Free keys answer first; your local Ollama server takes over if a key hits its limit or none are set." },
];

export function EngineSettingsDialog() {
  const engine = useEngine();
  const [progress, setProgress] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const count = availableProviders(engine).length;
  const label =
    engine.kind === "local"
      ? "In-browser"
      : engine.kind === "auto"
        ? `Auto (${count} + GPU)`
        : engine.kind === "auto-ollama"
          ? `Auto (${count} + Ollama)`
          : engine.kind === "ollama"
          ? `Ollama (${engine.ollamaModel})`
          : `Free keys (${count})`;
  async function prepareLocal() {
    setLoading(true);
    try {
      await loadLocalEngine((p, text) => setProgress(`${Math.round(p * 100)}% — ${text}`));
      setProgress("Ready! The pals now think on your computer.");
    } catch (err) {
      setProgress(err instanceof Error ? err.message : "Could not start the local model.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="AI engine" className="engine-trigger">
          <Cpu /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI engine</DialogTitle>
          <DialogDescription>
            All options are free. Voices use your browser's built-in speech.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {options.map((o) => (
            <button
              key={o.kind}
              type="button"
              onClick={() => setEngine({ kind: o.kind })}
              className={cn(
                "rounded-md border border-border p-3 text-left",
                engine.kind === o.kind && "border-primary bg-accent",
              )}
            >
              <div className="font-semibold">{o.label}</div>
              <div className="text-sm text-muted-foreground">{o.note}</div>
            </button>
          ))}
        </div>
        {(engine.kind === "ollama" || engine.kind === "auto-ollama") && (
          <div className="grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="font-medium">Server URL</span>
              <Input
                aria-label="Local server URL"
                value={engine.ollamaUrl}
                onChange={(e) => setEngine({ ollamaUrl: e.target.value })}
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Model name</span>
              <Input
                aria-label="Local server model"
                value={engine.ollamaModel}
                onChange={(e) => setEngine({ ollamaModel: e.target.value })}
              />
            </label>
            <p className="text-muted-foreground">
              In a terminal run <code>ollama pull {engine.ollamaModel}</code>, then start it with{" "}
              <code>OLLAMA_ORIGINS="*" ollama serve</code> so the browser is allowed to talk to it.
            </p>
          </div>
        )}
        {(engine.kind === "cloud" || engine.kind === "auto" || engine.kind === "auto-ollama") && (
          <div className="grid gap-3">
            <KeyField
              label="Groq (GPT-OSS 120B)"
              value={engine.groqKey}
              onChange={(groqKey) => setEngine({ groqKey })}
              href="https://console.groq.com/keys"
              placeholder="gsk_..."
            />
            <KeyField
              label="Gemini (2.5 Flash)"
              value={engine.geminiKey}
              onChange={(geminiKey) => setEngine({ geminiKey })}
              href="https://aistudio.google.com/apikey"
              placeholder="AIza..."
            />
            <KeyField
              label="OpenRouter (Llama 3.3 70B free)"
              value={engine.openrouterKey}
              onChange={(openrouterKey) => setEngine({ openrouterKey })}
              href="https://openrouter.ai/keys"
              placeholder="sk-or-..."
            />
            <KeyField
              label="NVIDIA NIM (Llama 3.1 70B)"
              value={engine.nvidiaKey}
              onChange={(nvidiaKey) => setEngine({ nvidiaKey })}
              href="https://build.nvidia.com/settings/api-keys"
              placeholder="nvapi-..."
            />
            <p className="text-sm text-muted-foreground">
              Keys are saved only in this browser (and encrypted in your account if signed in).
            </p>
          </div>
        )}
        {(engine.kind === "local" || engine.kind === "auto") && (
          <div className="grid gap-2 text-sm">
            {hasWebGPU() ? (
              <Button onClick={prepareLocal} disabled={loading}>
                {loading ? "Downloading…" : "Download & start local model"}
              </Button>
            ) : (
              <p className="text-destructive">
                Your browser doesn't support WebGPU. Try a recent Chrome or Edge on desktop.
              </p>
            )}
            {progress && <p className="text-muted-foreground">{progress}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WebGpuUsageBox({ active }: { active: boolean }) {
  const [gpu, setGpu] = useState<string | null>(null);
  const [stats, setStats] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    getGpuInfo().then((info) => !stop && setGpu(info));
    const tick = async () => {
      const text = await getLocalStats();
      if (!stop) setStats(text);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [active]);
  return (
    <div className="rounded-md border border-border p-3 text-xs" aria-label="WebGPU usage">
      <div className="font-semibold">WebGPU usage</div>
      <div className="text-muted-foreground">{gpu ?? "Checking your graphics card…"}</div>
      {stats ? (
        <pre className="mt-1 whitespace-pre-wrap font-mono text-muted-foreground">{stats}</pre>
      ) : (
        <div className="mt-1 text-muted-foreground">
          Start the local model to see memory and speed here.
        </div>
      )}
    </div>
  );
}

function KeyField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  href: string;
  placeholder: string;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{props.label}</span>
        <a className="text-primary underline" href={props.href} target="_blank" rel="noreferrer">
          Get a free key
        </a>
      </div>
      <Input
        type="password"
        aria-label={`${props.label} key`}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/** Main-screen one-click: detect the GPU, pick the best model, download it so Auto/local is ready. */
export function AutoModelDownload() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<string | null>(null);
  const [gpu, setGpu] = useState<string | null>(null);
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<string>("auto");
  useEffect(() => {
    let stop = false;
    if (!hasWebGPU()) {
      setGpu("No WebGPU graphics card found");
      return;
    }
    getGpuInfo().then((info) => !stop && setGpu(info));
    (async () => {
      // Find models already saved in this browser so nothing re-downloads.
      const ids = localModelChoices.flatMap((m) => [m.f16, m.f32]);
      const found = new Set<string>();
      for (const id of ids) if (await isModelCached(id)) found.add(id);
      if (stop) return;
      setCached(found);
      const last = chosenLocalModel();
      const pick = found.has(last) ? last : [...found][0];
      if (!pick) return;
      const choice = localModelChoices.find((m) => m.f16 === pick || m.f32 === pick);
      const label = choice?.label ?? pick;
      setStatus(`${label} already downloaded — loading onto your GPU…`);
      setBusy(true);
      try {
        await loadLocalEngine(undefined, pick);
        if (!stop) {
          setReady(label);
          setStatus("");
        }
      } catch (err) {
        if (!stop) setStatus(err instanceof Error ? err.message : "Could not start the local model.");
      } finally {
        if (!stop) setBusy(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, []);
  async function run() {
    setBusy(true);
    try {
      const detected = await detectBestModel();
      setGpu(detected.gpu);
      const choice = localModelChoices.find((m) => m.tier === manual);
      const f16 = detected.id.includes("q4f16");
      const pick = choice ? { ...detected, id: f16 ? choice.f16 : choice.f32, label: choice.label, size: choice.size } : detected;
      const already = cached.has(pick.id) || (await isModelCached(pick.id));
      setStatus(already ? `${pick.label} already downloaded — loading…` : `${choice ? "Your pick" : "Best fit"}: ${pick.label} (${pick.size})`);
      await loadLocalEngine(
        (p) => setStatus(`${pick.label}: ${Math.round(p * 100)}% ${already ? "loaded" : "downloaded"}`),
        pick.id,
      );
      setCached((s) => new Set(s).add(pick.id));
      setReady(pick.label);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not start the local model.");
    } finally {
      setBusy(false);
    }
  }
  const isCached = (m: (typeof localModelChoices)[number]) => cached.has(m.f16) || cached.has(m.f32);
  return (
    <div className="auto-model-download">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={run} disabled={busy || !hasWebGPU()}>
          <Cpu /> {ready ? `Local model ready (${ready})` : busy ? "Preparing…" : manual === "auto" ? "Detect GPU & download best model" : "Download selected model"}
        </Button>
        <select
          aria-label="Local model"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          value={manual}
          disabled={busy}
          onChange={(e) => {
            setManual(e.target.value);
            setReady(null);
          }}
        >
          <option value="auto">Auto-detect</option>
          {localModelChoices.map((m) => (
            <option key={m.tier} value={m.tier}>
              {m.label} ({isCached(m) ? "downloaded" : m.size})
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-muted-foreground">GPU found: {gpu ?? "Checking…"}</p>
      {gpu?.includes("Unknown") && manual === "auto" && (
        <p className="text-xs text-muted-foreground">Name hidden by your browser — pick a model above (7B for RTX 3080-class cards).</p>
      )}
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}
