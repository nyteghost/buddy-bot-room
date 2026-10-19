import { useCallback, useEffect, useState } from "react";
import { Download, Trash2, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setEngine, useEngine } from "@/lib/engine";
import { describeHardware, modelBudgetGb, type Hardware } from "@/lib/hardware";
import { agents } from "@/lib/agents";
import { newSuggestions, type FeedModel } from "@/lib/model-feed";
import { describeBench, CATALOG, TASKS, fitFor, fitLabel, recommend, type TaskKey } from "@/lib/model-catalog";

type Status = {
  configured: boolean;
  reachable?: boolean;
  error?: string;
  hardware?: Hardware;
  models?: { name: string; gb: number }[];
  loaded?: { name: string; onGpu: boolean }[];
  feed?: { fetchedAt: string; models: FeedModel[]; error?: string } | null;
  feedEnabled?: boolean;
};

const FIELD: Record<TaskKey, "localChat" | "localCode" | "localReasoning" | "localFast"> = { chat: "localChat", code: "localCode", reasoning: "localReasoning", fast: "localFast" };

/** Local AI on the Ollama inside the stack: hardware, recommendations, downloads and per-task model choice. */
export function LocalAiPanel() {
  const engine = useEngine();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    fetch("/api/ollama").then((r) => r.json()).then((j) => setStatus(j as Status)).catch(() => setStatus({ configured: true, reachable: false, error: "Couldn't reach the Pixel Pals server." }));
  }, []);
  useEffect(load, [load]);

  async function pull(model: string, task?: TaskKey) {
    setBusy((b) => ({ ...b, [model]: "Starting…" }));
    setNote("");
    try {
      const res = await fetch("/api/ollama", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pull", model }) });
      if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Download failed.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failed = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string };
          if (j.error) failed = j.error;
          const pct = j.total && j.completed ? ` ${Math.round((j.completed / j.total) * 100)}%` : "";
          setBusy((b) => ({ ...b, [model]: `${j.status ?? "Downloading"}${pct}` }));
        }
      }
      if (failed) throw new Error(failed);
      setNote(`${model} is ready.`);
      if (task) {
        const field = FIELD[task];
        if (task === "chat" || !engine[field]) setEngine({ [field]: model });
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[model]; return n; });
      load();
    }
  }

  async function refreshFeed() {
    setNote("Checking Ollama for new models…");
    const res = await fetch("/api/ollama", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "refresh-feed", model: "x" }) });
    const j = (await res.json().catch(() => ({}))) as { feed?: Status["feed"]; error?: string };
    setNote(j.feed?.error ? `Couldn't update the list: ${j.feed.error}` : j.error ?? "Model list updated.");
    load();
  }

  async function bench(model: string) {
    setBusy((b) => ({ ...b, [`bench:${model}`]: "Testing…" }));
    try {
      const res = await fetch("/api/ollama", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "bench", model }) });
      const j = (await res.json()) as { tokensPerSec?: number; loadSeconds?: number; gpuPercent?: number | null; error?: string };
      setNote(j.error ?? `${model}: ${describeBench(j.tokensPerSec ?? 0, j.gpuPercent ?? null)}${j.loadSeconds ? ` (first load took ${j.loadSeconds}s)` : ""}`);
    } catch {
      setNote("The speed test failed.");
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[`bench:${model}`]; return n; });
      load();
    }
  }

  async function remove(model: string) {
    if (!window.confirm(`Remove ${model} from this server?`)) return;
    const res = await fetch("/api/ollama", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", model }) });
    setNote(res.ok ? `Removed ${model}.` : "Couldn't remove it.");
    load();
  }

  if (!status) return <p className="text-sm text-muted-foreground">Checking the Local AI server…</p>;
  if (!status.configured)
    return (
      <p className="rounded-md border p-3 text-sm text-muted-foreground">
        Local AI isn't set up on this server. Use the Portainer stack (<code>docker-compose.portainer.yml</code>), which includes Ollama, or set <code>OLLAMA_URL</code> to an Ollama address.
      </p>
    );
  const hw = status.hardware;
  const installed = status.models ?? [];
  const names = new Set(installed.map((m) => m.name));
  const has = (id: string) => names.has(id) || names.has(`${id}:latest`);
  const rec = hw ? recommend(hw) : [];
  const onGpu = hw ? modelBudgetGb(hw).onGpu : false;
  const newOnes = hw && status.feed?.models.length ? newSuggestions(status.feed.models, hw, names as Set<string>, new Set<string>(CATALOG.map((c) => c.id))) : [];
  const choices = (current: string) => (current && !names.has(current) ? [current, ...installed.map((m) => m.name)] : installed.map((m) => m.name));

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex items-start gap-2 rounded-md border p-3">
        <Cpu className="mt-0.5 size-4 shrink-0" />
        <div className="grid gap-1">
          <span className="font-medium">{status.reachable ? "Local AI is running" : "Local AI isn't answering"}</span>
          {hw && <span className="text-muted-foreground">{describeHardware(hw)}</span>}
          {hw && !hw.gpus.length && <span className="text-xs text-muted-foreground">No GPU is visible to Pixel Pals, so suggestions assume CPU. With an NVIDIA GPU, set <code>OLLAMA_RUNTIME=nvidia</code> on the stack, or <code>LOCAL_VRAM_GB</code> to your card's memory.</span>}
          {status.error && <span className="text-destructive">{status.error}</span>}
          {status.loaded?.map((m) => <span key={m.name} className="text-xs text-muted-foreground">{m.name} is loaded {m.onGpu ? "on the GPU" : "on the CPU (slower)"}.</span>)}
        </div>
      </div>

      {status.reachable && (
        <>
          <div className="grid gap-2">
            <span className="font-medium">Suggested for this machine</span>
            {rec.map((r) => (
              <div key={r.task} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="min-w-0">
                  <div><b>{TASKS.find((t) => t.key === r.task)?.label}:</b> {r.model.id} <span className="text-xs text-muted-foreground">({r.model.gb} GB)</span></div>
                  <div className="text-xs text-muted-foreground">{r.model.note} · {fitLabel(r.fit, onGpu)}</div>
                </div>
                {has(r.model.id)
                  ? <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={engine[FIELD[r.task]] === r.model.id} onClick={() => setEngine({ [FIELD[r.task]]: r.model.id })}>{engine[FIELD[r.task]] === r.model.id ? "In use" : "Use"}</Button>
                  : <Button size="sm" className="h-11 sm:h-8" disabled={!!busy[r.model.id]} onClick={() => void pull(r.model.id, r.task)}><Download className="size-4" /> {busy[r.model.id] ?? "Download"}</Button>}
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <span className="font-medium">Model per task</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={engine.localAuto} onChange={(e) => setEngine({ localAuto: e.target.checked })} /> Choose automatically from what each message looks like</label>
            {TASKS.map((t) => (
              <label key={t.key} className="grid gap-1">
                <span>{t.label} <span className="text-xs text-muted-foreground">{t.hint}</span></span>
                <select className="rounded-md border bg-background px-2 py-2" value={engine[FIELD[t.key]]} onChange={(e) => setEngine({ [FIELD[t.key]]: e.target.value })}>
                  {t.key !== "chat" && <option value="">Same as Chat</option>}
                  {choices(engine[FIELD[t.key]]).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ))}
            <span className="text-xs text-muted-foreground">Switching between models makes the first reply after a switch slower while it loads. GPUs with less memory reload models when they change.</span>
          </div>

          <div className="grid gap-2">
            <span className="font-medium">Model per pal <span className="text-xs font-normal text-muted-foreground">(optional, overrides the task choice above)</span></span>
            {agents.map((a) => {
              const current = engine.localPals[a.id] ?? "";
              return (
                <label key={a.id} className="flex items-center justify-between gap-2">
                  <span>{a.name}</span>
                  <select
                    className="min-w-0 flex-1 rounded-md border bg-background px-2 py-2 sm:max-w-[60%]"
                    value={current}
                    onChange={(e) => {
                      const next = { ...engine.localPals };
                      if (e.target.value) next[a.id] = e.target.value; else delete next[a.id];
                      setEngine({ localPals: next });
                    }}
                  >
                    <option value="">Automatic (by task)</option>
                    {choices(current).map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              );
            })}
          </div>

          <div className="grid gap-2">
            <span className="font-medium">Installed ({installed.length})</span>
            {installed.length === 0 && <span className="text-muted-foreground">Nothing yet. The stack downloads the models in <code>OLLAMA_MODELS</code> on first start, or use Download above.</span>}
            {installed.map((m) => (
              <div key={m.name} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span>{m.name} <span className="text-xs text-muted-foreground">{m.gb} GB</span></span>
                <span className="flex gap-1">
                <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={!!busy[`bench:${m.name}`]} onClick={() => void bench(m.name)}>{busy[`bench:${m.name}`] ?? "Speed test"}</Button>
                <Button size="sm" variant="ghost" className="h-11 sm:h-8" aria-label={`Remove ${m.name}`} onClick={() => void remove(m.name)}><Trash2 className="size-4" /></Button>
                </span>
              </div>
            ))}
          </div>

          {status.feedEnabled !== false && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">New on Ollama <span className="text-xs font-normal text-muted-foreground">{status.feed?.fetchedAt ? `checked ${new Date(status.feed.fetchedAt).toLocaleDateString()}` : "not checked yet"}</span></span>
                <Button size="sm" variant="ghost" className="h-11 sm:h-8" onClick={() => void refreshFeed()}>Check now</Button>
              </div>
              {status.feed?.error && <span className="text-xs text-destructive">Last update failed: {status.feed.error}</span>}
              {newOnes.length === 0 && !status.feed?.error && <span className="text-xs text-muted-foreground">Nothing new that fits this machine. The list refreshes itself about once a day from ollama.com.</span>}
              {newOnes.map(({ model: m, fit }) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <div>{m.id} <span className="text-xs text-muted-foreground">({m.gb} GB, about {m.task})</span></div>
                    <div className="text-xs text-muted-foreground">{m.note} · {fitLabel(fit, onGpu)}. Not tested by Pixel Pals.</div>
                  </div>
                  <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={!!busy[m.id]} onClick={() => void pull(m.id)}>{busy[m.id] ?? "Download"}</Button>
                </div>
              ))}
            </div>
          )}

          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer">More models</summary>
            <div className="mt-2 grid gap-2">
              {hw && CATALOG.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{m.id} <span className="text-xs text-muted-foreground">{m.gb} GB · {m.task} · {fitLabel(fitFor(m, hw), onGpu)}</span></span>
                  {has(m.id) ? <span className="text-xs text-muted-foreground">Installed</span> : <Button size="sm" variant="outline" className="h-11 sm:h-8" disabled={!!busy[m.id]} onClick={() => void pull(m.id)}>{busy[m.id] ?? "Download"}</Button>}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
      {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
