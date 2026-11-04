import { useCallback, useEffect, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type State = {
  config: { enabled: boolean; localAi: boolean; time: string; tz: string };
  lastRun: string;
  lastResult: string;
  changed: number;
  errors: string[];
  running: boolean;
  tracked: string[];
  vaultReady: boolean;
  checkpoints: number;
  error?: string;
};

export function GitHubJournalPanel() {
  const [state, setState] = useState<State | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [localAi, setLocalAi] = useState(false);
  const [time, setTime] = useState("03:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const read = useCallback(async () => {
    try {
      const res = await fetch("/api/github-journal", { cache: "no-store" });
      const data = await res.json() as State;
      if (!res.ok || data.error) throw Error(data.error ?? "Cannot read journal status");
      setState(data);
      setEnabled(data.config.enabled);
      setLocalAi(data.config.localAi);
      setTime(data.config.time);
      setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Cannot reach server"); }
  }, []);

  useEffect(() => { void read(); }, [read]);

  const post = async (body: object) => {
    setBusy(true);
    try {
      const res = await fetch("/api/github-journal", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await res.json() as State;
      if (!res.ok || result.error) throw Error(result.error ?? "Journal request failed");
      await read();
    } catch (e) { setError(e instanceof Error ? e.message : "Journal request failed"); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border border-border p-3 space-y-2" aria-label="GitHub to Obsidian journal">
      <div className="flex items-center gap-2 font-medium text-sm">
        <BookOpen className="size-4" /> GitHub → Obsidian Journal
      </div>
      <p className="text-xs text-muted-foreground">
        Optional daily read-only monitoring of your Repo Watch list and beta branches. Writes dated project notes in your existing Obsidian vault; never replaces existing notes.
      </p>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable daily journal
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={localAi} onChange={(e) => setLocalAi(e.target.checked)} />
          Allow local Ollama summaries
        </label>
        <label className="inline-flex items-center gap-2">
          Scan at (Eastern)
          <Input className="h-8 w-28" type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Daily GitHub scan time Eastern" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !state} onClick={() => void post({ op: "configure", enabled, localAi, time, confirm: true })}>
          Save journal settings
        </Button>
        <Button size="sm" variant="outline" disabled={busy || !state?.config.enabled || state.running}
          onClick={() => void post({ op: "scan" })}>
          <RefreshCw className="size-4" /> Scan Now
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void read()}>Refresh status</Button>
      </div>
      {state && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p>Saved status: {state.config.enabled ? "Enabled" : "Off"} · Vault: {state.vaultReady ? "Configured" : "Needs OBSIDIAN_VAULT_DIR"} · Selected repos: {state.tracked.length} · Branch checkpoints: {state.checkpoints}</p>
          <p>{state.running ? "Scanning…" : state.lastResult} · Last scan: {state.lastRun ? new Date(state.lastRun).toLocaleString() : "never"} · Changed branches last run: {state.changed}</p>
          {!state.vaultReady && <p className="text-amber-600">A writable Obsidian vault mount is required before notes can be created.</p>}
          {state.errors.map((e, i) => <p key={i} className="text-destructive">{e}</p>)}
        </div>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </section>
  );
}
