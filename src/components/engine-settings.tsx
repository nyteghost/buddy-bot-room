import { useState } from "react";
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
import { setEngine, useEngine, type EngineKind } from "@/lib/engine";
import { hasWebGPU, loadLocalEngine } from "@/lib/local-llm";
import { cn } from "@/lib/utils";

const options: { kind: EngineKind; label: string; note: string }[] = [
  { kind: "lovable", label: "Lovable AI", note: "Each pal's own model. Uses workspace AI credits." },
  { kind: "groq", label: "Groq (free key)", note: "GPT-OSS 120B on your free Groq key. No credits." },
  { kind: "gemini", label: "Gemini (free key)", note: "Gemini 2.5 Flash on your free Google key. No credits." },
  { kind: "local", label: "In-browser (WebGPU)", note: "Runs on your computer. Free and private, ~1 GB first download." },
];

export function EngineSettingsDialog() {
  const engine = useEngine();
  const [progress, setProgress] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const current = options.find((o) => o.kind === engine.kind)!;
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
          <Cpu /> {current.label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI engine</DialogTitle>
          <DialogDescription>
            Choose what powers the pals. Free options keep their personalities; voices use your
            browser's built-in speech.
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
        {engine.kind === "groq" && (
          <KeyField
            value={engine.groqKey}
            onChange={(groqKey) => setEngine({ groqKey })}
            href="https://console.groq.com/keys"
            placeholder="gsk_..."
          />
        )}
        {engine.kind === "gemini" && (
          <KeyField
            value={engine.geminiKey}
            onChange={(geminiKey) => setEngine({ geminiKey })}
            href="https://aistudio.google.com/apikey"
            placeholder="AIza..."
          />
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

function KeyField(props: {
  value: string;
  onChange: (v: string) => void;
  href: string;
  placeholder: string;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <Input
        type="password"
        aria-label="Your free API key"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <span className="text-muted-foreground">
        Saved only in this browser.{" "}
        <a className="text-primary underline" href={props.href} target="_blank" rel="noreferrer">
          Get a free key
        </a>
      </span>
    </div>
  );
}
