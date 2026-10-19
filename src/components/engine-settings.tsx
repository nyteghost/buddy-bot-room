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
import { CLAUDE_MODELS, setEngine, turnProviders, useEngine, type ClaudeMode, type EngineKind, type ReplyLength } from "@/lib/engine";
import { deletePreset, makePreset, presetToEngine, savePreset, updatePresets, usePresets } from "@/lib/presets";
import { useOllamaModels } from "@/lib/ollama-models";
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
import { FreeKeysWizard } from "@/components/free-keys-wizard";
import { LocalAiPanel } from "@/components/local-ai-panel";
import { CUSTOM_PRESETS } from "@/lib/custom-provider";

const options: { kind: EngineKind; label: string; note: string }[] = [
  { kind: "cloud", label: "Free keys", note: "Uses every free key you enter below, sharing turns between them." },
  { kind: "auto", label: "Auto (fastest)", note: "Free keys answer first (about 40× faster); the in-browser model takes over if a key hits its limit." },
  { kind: "local", label: "In-browser (WebGPU)", note: "Runs on your computer. Free and private; downloads once, then loads from cache." },
  { kind: "local-server", label: "Local AI (this server)", note: "Uses the Ollama in your Pixel Pals stack. Nothing to type: models are chosen per task and downloaded from here." },
  { kind: "ollama", label: "Local server / Ollama", note: "Uses Ollama or llama.cpp on your computer for full native GPU speed." },
  { kind: "auto-ollama", label: "Auto (keys + Ollama)", note: "Free keys answer first; your local Ollama server takes over if a key hits its limit or none are set." },
];

export function EngineSettingsDialog() {
  const engine = useEngine();
  const installedModels = useOllamaModels(engine.ollamaUrl, engine.kind === "ollama" || engine.kind === "auto-ollama");
  const [progress, setProgress] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const presets = usePresets();
  const [presetName, setPresetName] = useState("");
  const [presetPick, setPresetPick] = useState("");
  const count = turnProviders(engine).length;
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
        <div className="grid gap-2 text-sm">
          <span className="font-medium">Presets <small className="text-muted-foreground">(engine choice and Ollama settings — never your keys)</small></span>
          {presets.length > 0 && (
            <div className="flex gap-2">
              <select aria-label="Saved presets" className="h-9 flex-1 rounded-md border border-input bg-background px-2" value={presetPick} onChange={(e) => setPresetPick(e.target.value)}>
                <option value="">Choose a preset…</option>
                {presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <Button type="button" size="sm" disabled={!presetPick} onClick={() => { const p = presets.find((x) => x.name === presetPick); if (p) setEngine(presetToEngine(p)); }}>Use</Button>
              <Button type="button" size="sm" variant="ghost" disabled={!presetPick} onClick={() => { updatePresets((l) => deletePreset(l, presetPick)); setPresetPick(""); }}>Delete</Button>
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const p = makePreset(presetName, engine); if (p) { updatePresets((l) => savePreset(l, p)); setPresetPick(p.name); setPresetName(""); } }}>
            <Input aria-label="Preset name" placeholder="Name this setup, e.g. Fast Groq" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            <Button type="submit" size="sm" disabled={!presetName.trim()}>Save current</Button>
          </form>
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
                list="ollama-installed-models"
                value={engine.ollamaModel}
                onChange={(e) => setEngine({ ollamaModel: e.target.value })}
              />
              <datalist id="ollama-installed-models">
                {installedModels.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <span className="text-xs text-muted-foreground">
                {installedModels.length
                  ? `${installedModels.length} installed model${installedModels.length === 1 ? "" : "s"} found — pick one from the list.`
                  : "Couldn't list installed models. Check the URL and that Ollama is running."}
              </span>
            </label>
            <label className="grid gap-1">
              <span className="font-medium">Reply length</span>
              <select
                aria-label="Local reply length"
                className="h-9 rounded-md border border-input bg-background px-2"
                value={engine.replyLength}
                onChange={(e) => setEngine({ replyLength: e.target.value as ReplyLength })}
              >
                <option value="short">Short (fast, ~400 tokens)</option>
                <option value="medium">Medium (~800 tokens)</option>
                <option value="long">Long (~1500 tokens)</option>
              </select>
              <span className="text-xs text-muted-foreground">Thinking models like qwen3 and deepseek-r1 always get at least 1500.</span>
            </label>
            <p className="text-muted-foreground">
              In a terminal run <code>ollama pull {engine.ollamaModel}</code>, then start it with{" "}
              <code>OLLAMA_ORIGINS="*" ollama serve</code> so the browser is allowed to talk to it.
            </p>
          </div>
        )}
        {engine.kind === "local-server" && <LocalAiPanel />}
        {(engine.kind === "cloud" || engine.kind === "auto" || engine.kind === "auto-ollama") && (
          <div className="grid gap-3">
            <FreeKeysWizard />
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
            <div className="grid gap-2 rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">Claude (Anthropic) — paid service</p>
              <p className="text-muted-foreground">
                Unlike the providers above, Claude charges per use on your Anthropic account (Haiku 5.5 is about $0.10 in / $0.50 out per million tokens, so a discussion costs a few cents). It stays <b>off</b> until you choose how to use it. Set a monthly spending limit at console.anthropic.com.
              </p>
              <KeyField
                label="Claude API key"
                value={engine.anthropicKey}
                onChange={(anthropicKey) => setEngine({ anthropicKey })}
                href="https://console.anthropic.com/settings/keys"
                placeholder="sk-ant-..."
              />
              <label className="grid gap-1">
                <span className="font-medium">How to use Claude</span>
                <select
                  className="rounded-md border bg-background px-2 py-2"
                  value={engine.claudeMode}
                  onChange={(e) => setEngine({ claudeMode: e.target.value as ClaudeMode })}
                >
                  <option value="off">Off (never charged)</option>
                  <option value="share">Share turns with my free keys (some replies are paid)</option>
                  <option value="only">Use only Claude (every reply is paid)</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="font-medium">Model</span>
                <select
                  className="rounded-md border bg-background px-2 py-2"
                  value={engine.claudeModel}
                  onChange={(e) => setEngine({ claudeModel: e.target.value })}
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label} · {m.price}</option>
                  ))}
                </select>
              </label>
              {engine.claudeMode !== "off" && !engine.anthropicKey.trim() && <p className="text-destructive">Add a Claude key above, or turn this off.</p>}
              {engine.claudeMode !== "off" && engine.anthropicKey.trim() && <p className="text-amber-600">Claude is ON: replies it writes are billed to your Anthropic account.</p>}
            </div>
            <CustomProviderBox />
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

function CustomProviderBox() {
  const engine = useEngine();
  const [test, setTest] = useState("");
  async function runTest() {
    setTest("Testing…");
    try {
      const res = await fetch("/api/keytest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "custom", baseUrl: engine.customBaseUrl, key: engine.customKey }) });
      const j = (await res.json()) as { ok?: boolean; message?: string };
      setTest(`${j.ok ? "✓" : "✗"} ${j.message ?? ""}`);
    } catch {
      setTest("✗ Couldn't reach the Pixel Pals server.");
    }
  }
  const active = engine.customMode !== "off";
  return (
    <details className="rounded-lg border p-3 text-sm" open={active}>
      <summary className="cursor-pointer font-medium">Custom provider (any OpenAI-compatible API){active ? " · ON" : ""}</summary>
      <div className="mt-2 grid gap-2">
        <p className="text-muted-foreground">
          For Hugging Face, Mistral, Cerebras, or any provider with an OpenAI-style API. It stays <b>off</b> until you choose how to use it. Some providers are free, some charge: tick the box below if yours charges, and Pixel Pals will warn you when it's on.
        </p>
        <label className="grid gap-1">
          <span className="font-medium">Start from</span>
          <select
            className="rounded-md border bg-background px-2 py-2"
            value=""
            onChange={(e) => {
              const p = CUSTOM_PRESETS.find((x) => x.id === e.target.value);
              if (p) setEngine({ customName: p.label, customBaseUrl: p.baseUrl, customModel: p.model });
            }}
          >
            <option value="">Choose a preset…</option>
            {CUSTOM_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.note})</option>)}
          </select>
        </label>
        {CUSTOM_PRESETS.filter((p) => p.label === engine.customName).map((p) => (
          <a key={p.id} className="text-primary underline" href={p.keyUrl} target="_blank" rel="noreferrer">Get a {p.label} key</a>
        ))}
        <input className="rounded-md border bg-background px-2 py-2" placeholder="Name (for you), e.g. Hugging Face" value={engine.customName} onChange={(e) => setEngine({ customName: e.target.value })} />
        <input className="rounded-md border bg-background px-2 py-2" placeholder="Base URL, e.g. https://router.huggingface.co/v1" autoCapitalize="none" value={engine.customBaseUrl} onChange={(e) => setEngine({ customBaseUrl: e.target.value })} />
        <input className="rounded-md border bg-background px-2 py-2" type="password" placeholder="API key" value={engine.customKey} onChange={(e) => setEngine({ customKey: e.target.value })} />
        <input className="rounded-md border bg-background px-2 py-2" placeholder="Model, e.g. Qwen/Qwen2.5-7B-Instruct" autoCapitalize="none" value={engine.customModel} onChange={(e) => setEngine({ customModel: e.target.value })} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={engine.customPaid} onChange={(e) => setEngine({ customPaid: e.target.checked })} /> This provider charges money (shows a cost warning)</label>
        <label className="grid gap-1">
          <span className="font-medium">How to use it</span>
          <select className="rounded-md border bg-background px-2 py-2" value={engine.customMode} onChange={(e) => setEngine({ customMode: e.target.value as ClaudeMode })}>
            <option value="off">Off</option>
            <option value="share">Share turns with my other keys</option>
            <option value="only">Use only this provider</option>
          </select>
        </label>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="outline" className="h-11 sm:h-8" onClick={() => void runTest()}>Test</Button>
          {test && <span className="text-xs text-muted-foreground">{test}</span>}
        </div>
        {active && engine.customPaid && <p className="rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-amber-600">PAID: replies from {engine.customName || "this provider"} are billed to your account there. Check their pricing and set a spending limit.</p>}
        {active && !engine.customPaid && <p className="text-muted-foreground">Free tiers have rate limits and terms of their own. Replies from {engine.customName || "this provider"} count against your account there.</p>}
        {active && (!engine.customBaseUrl.trim() || !engine.customModel.trim()) && <p className="text-destructive">Enter a base URL and a model, or turn this off.</p>}
      </div>
    </details>
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
