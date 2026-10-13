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
import { getGpuInfo, getLocalStats, hasWebGPU, loadLocalEngine } from "@/lib/local-llm";
import { cn } from "@/lib/utils";

const options: { kind: EngineKind; label: string; note: string }[] = [
  { kind: "cloud", label: "Free keys", note: "Uses every free key you enter below, sharing turns between them." },
  { kind: "local", label: "In-browser (WebGPU)", note: "Runs on your computer. Free and private, ~1 GB first download." },
];

export function EngineSettingsDialog() {
  const engine = useEngine();
  const [progress, setProgress] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const count = availableProviders(engine).length;
  const label = engine.kind === "local" ? "In-browser" : `Free keys (${count})`;
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
        {engine.kind === "cloud" && (
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
            <p className="text-sm text-muted-foreground">
              Keys are saved only in this browser (and encrypted in your account if signed in).
            </p>
          </div>
        )}
        {engine.kind === "local" && (
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
