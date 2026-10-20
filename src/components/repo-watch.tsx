import { useCallback, useEffect, useState } from "react";
import { CircleAlert, CircleCheck, CircleDashed, GitCommit, GitPullRequest, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ago, type CiState, type RepoView } from "@/lib/repos";

type Reply = { items?: RepoView[]; token?: boolean; error?: string };
const call = async (body: object): Promise<Reply> => {
  try { return (await (await fetch("/api/repos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Reply; }
  catch { return { error: "Couldn't reach the server." }; }
};

const CI: Record<CiState, { label: string; cls: string; icon: typeof CircleCheck }> = {
  passing: { label: "Build passing", cls: "text-emerald-500", icon: CircleCheck },
  failing: { label: "Build FAILING", cls: "text-destructive", icon: CircleAlert },
  running: { label: "Build running", cls: "text-amber-500", icon: CircleDashed },
  other: { label: "Build cancelled or skipped", cls: "text-muted-foreground", icon: CircleDashed },
  none: { label: "No builds", cls: "text-muted-foreground", icon: CircleDashed },
};

export function RepoWatch() {
  const [items, setItems] = useState<RepoView[] | null>(null);
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [token, setToken] = useState(true);
  const [checked, setChecked] = useState<number | null>(null);

  const apply = useCallback((r: Reply) => {
    if (r.error) { setStatus(r.error); return false; }
    setItems(r.items ?? []); setToken(r.token !== false); setChecked(Date.now()); setStatus("");
    return true;
  }, []);
  const run = useCallback(async (body: object) => { setBusy(true); const ok = apply(await call(body)); setBusy(false); return ok; }, [apply]);
  useEffect(() => { void run({ op: "list" }); }, [run]);

  const failing = (items ?? []).filter((i) => i.ci.state === "failing").length;
  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap gap-2">
        <Input className="min-w-48 flex-1" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name or a GitHub link" aria-label="Repo to watch"
          onKeyDown={(e) => { if (e.key === "Enter" && repo.trim() && !busy) void run({ op: "add", repo }).then((ok) => ok && setRepo("")); }} />
        <Button size="sm" disabled={busy || !repo.trim()} onClick={() => void run({ op: "add", repo }).then((ok) => ok && setRepo(""))}><Plus className="size-4" /> Watch</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ op: "list", force: true })}><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} /> Refresh</Button>
      </div>
      {status && <p className="text-xs text-destructive" role="status">{status}</p>}
      {items && failing > 0 && <p className="text-sm font-medium text-destructive">{failing} repo{failing === 1 ? " has" : "s have"} a failing build.</p>}
      {items && !items.length && <p className="text-sm text-muted-foreground">Add a repo to see its latest commits, build status and open pull requests here. Public repos work right away.</p>}
      {!token && items?.length ? <p className="text-xs text-muted-foreground">No GitHub token set, so GitHub allows about 60 checks an hour and private repos can't be seen. Add one in Settings → Code.</p> : null}
      {items?.map((r) => <RepoCard key={r.repo} r={r} busy={busy} onRemove={() => void run({ op: "remove", repo: r.repo })} />)}
      {checked && <p className="text-xs text-muted-foreground">Checked {ago(new Date(checked).toISOString())}. Read-only: nothing here changes your repos.</p>}
    </div>
  );
}

function RepoCard({ r, busy, onRemove }: { r: RepoView; busy: boolean; onRemove: () => void }) {
  const ci = CI[r.ci.state];
  const Icon = ci.icon;
  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a className="font-medium text-primary underline" href={r.url} target="_blank" rel="noreferrer">{r.repo}</a>
          {r.description && <div className="truncate text-xs text-muted-foreground">{r.description}</div>}
        </div>
        <Button size="icon" variant="ghost" aria-label={`Stop watching ${r.repo}`} disabled={busy} onClick={onRemove}><Trash2 className="size-4" /></Button>
      </div>
      {r.error ? <p className="mt-1 text-xs text-destructive">{r.error}</p> : (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className={`inline-flex items-center gap-1 font-medium ${ci.cls}`}><Icon className="size-3.5" />
              {r.ci.url ? <a className="underline" href={r.ci.url} target="_blank" rel="noreferrer">{ci.label}</a> : ci.label}{r.ci.at ? <span className="font-normal text-muted-foreground"> · {ago(r.ci.at)}</span> : null}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground"><GitPullRequest className="size-3.5" /> {r.openPrs >= 100 ? "100+" : r.openPrs} open PR{r.openPrs === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground">{r.openIssues} open issue{r.openIssues === 1 ? "" : "s"}</span>
            {r.pushedAt && <span className="text-muted-foreground">pushed {ago(r.pushedAt)}</span>}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {r.commits.slice(0, 3).map((c) => (
              <li key={c.sha} className="flex gap-1">
                <GitCommit className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0"><a className="underline" href={c.url} target="_blank" rel="noreferrer">{c.message || c.sha}</a> <span className="text-muted-foreground">· {c.author} · {ago(c.date)}</span></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
