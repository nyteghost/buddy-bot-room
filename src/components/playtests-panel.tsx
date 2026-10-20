import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, ExternalLink, FlaskConical, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ago } from "@/lib/repos";
import type { Listing, Source, SourceStatus } from "@/lib/playtests";

type Reply = { sources?: Source[]; items?: Listing[]; status?: Record<string, SourceStatus>; lastRun?: string; alerts?: boolean; newCount?: number; error?: string };
const call = async (body: object): Promise<Reply> => {
  try { return (await (await fetch("/api/playtests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Reply; }
  catch { return { error: "Couldn't reach the server." }; }
};

export function PlaytestsPanel() {
  const [data, setData] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [only, setOnly] = useState("");
  const [showSources, setShowSources] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", kind: "rss", keywords: "", skip: "" });

  const apply = useCallback((r: Reply, ok = "") => { if (r.error) { setNote(r.error); return; } setData(r); setNote(ok); }, []);
  const run = useCallback(async (body: object, ok = "") => { setBusy(true); apply(await call(body), ok); setBusy(false); }, [apply]);
  useEffect(() => { void run({ op: "list" }); }, [run]);

  if (!data) return <p className="p-3 text-sm text-muted-foreground">{note || "Loading…"}</p>;
  const names = Object.fromEntries((data.sources ?? []).map((s) => [s.id, s.name]));
  const items = (data.items ?? []).filter((i) => !only || i.source === only);
  const fresh = (data.items ?? []).filter((i) => i.fresh).length;
  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); const r = await call({ op: "check" }); apply(r, r.newCount ? `${r.newCount} new.` : "Checked. Nothing new."); setBusy(false); }}><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Check now</Button>
        {fresh > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => run({ op: "seen" })}>Mark {fresh} as seen</Button>}
        <select className="rounded-md border border-border bg-background px-2 py-1 text-xs" value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Show one source">
          <option value="">All sources</option>
          {(data.sources ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={() => setShowSources((v) => !v)}>{showSources ? "Hide sources" : "Sources"}</Button>
      </div>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {data.alerts ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
        {data.alerts ? "New listings are sent to your phone." : "Set NTFY_URL or a Telegram bot in Settings to get phone alerts."}
        {data.lastRun ? ` Checked ${ago(data.lastRun)}, then every few hours.` : " Checks every few hours."}
      </p>
      {note && <p className="text-xs" role="status">{note}</p>}

      {showSources && (
        <div className="space-y-2 rounded-md border border-border p-2">
          {(data.sources ?? []).map((s) => {
            const st = data.status?.[s.id];
            return (
              <div key={s.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <a className="font-medium text-primary underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a> <span className="text-muted-foreground">· {s.kind === "rss" ? "feed" : "web page"}{s.keywords ? ` · words: ${s.keywords}` : ""}{s.skip ? ` · skips: ${s.skip}` : ""}</span>
                  <div className={st && !st.ok ? "text-destructive" : "text-muted-foreground"}>{!st ? "Not checked yet" : st.ok ? `${st.count} listing${st.count === 1 ? "" : "s"} read ${ago(st.at)}` : `${st.error ?? "Failed"} (${ago(st.at)})`}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={s.enabled} onChange={(e) => run({ op: "toggleSource", id: s.id, enabled: e.target.checked })} /> on</label>
                  <Button size="icon" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => run({ op: "removeSource", id: s.id })}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            );
          })}
          <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" aria-label="Source name" />
            <select className="rounded-md border border-border bg-background px-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Source type"><option value="rss">Feed (RSS/Atom, like a subreddit .rss)</option><option value="page">Web page (links on it)</option></select>
            <Input className="sm:col-span-2" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://… (for Reddit add /new/.rss to the subreddit)" aria-label="Source address" />
            <Input className="sm:col-span-2" value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="Only keep titles with these words (optional): beta, playtest, alpha" aria-label="Keywords" />
            <Input className="sm:col-span-2" value={form.skip} onChange={(e) => setForm({ ...form, skip: e.target.value })} placeholder="Skip titles starting with (optional): sponsored, giveaway" aria-label="Skip titles" />
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" disabled={busy || !form.url.trim()} onClick={async () => { await run({ op: "addSource", source: form }, "Added. Its first check sets a baseline, so only later listings count as new."); setForm({ name: "", url: "", kind: "rss", keywords: "", skip: "" }); }}><Plus className="size-4" /> Add source</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run({ op: "resetSources" }, "Back to the starting sources. Checking them again as a fresh baseline.")}>Reset to starting sources</Button>
            </div>
          </div>
        </div>
      )}

      {!items.length && <p className="text-muted-foreground"><FlaskConical className="mr-1 inline size-4" />Nothing yet. Press Check now; the first check just records what's already open.</p>}
      <ul className="space-y-1">
        {items.slice(0, 80).map((i) => (
          <li key={i.id} className={`flex items-start justify-between gap-2 rounded px-2 py-1 ${i.fresh ? "bg-primary/10" : ""}`}>
            <div className="min-w-0">
              {i.fresh && <span className="mr-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">NEW</span>}
              <a className="underline" href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
              <div className="text-xs text-muted-foreground">{names[i.source] ?? "source removed"} · found {ago(i.found)}</div>
            </div>
            <a href={i.url} target="_blank" rel="noreferrer" aria-label="Open" className="shrink-0 text-muted-foreground"><ExternalLink className="size-4" /></a>
          </li>
        ))}
      </ul>
    </div>
  );
}
