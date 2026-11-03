import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PalMission } from "@/lib/working-pals";

/** Owner-only Working Pals inbox. The UI never starts a mission when it is proposed or approved. */
export function WorkingPalsPanel({ open }: { open: boolean }) {
  const [jobs, setJobs] = useState<PalMission[]>([]);
  const [title,setTitle] = useState("");
  const [question,setQuestion] = useState("");
  const [scope,setScope] = useState<"personal" | "project">("personal");
  const [project,setProject] = useState("");
  const [busy,setBusy] = useState("");
  const [error,setError] = useState("");
  const [loaded,setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const response=await fetch("/api/working-pals");
      const data=(await response.json()) as {missions?:PalMission[];error?:string};
      if (!response.ok || !data.missions) throw Error(data.error ?? "Unable to load the inbox.");
      setJobs(data.missions);setLoaded(true);setError("");
    } catch(e) {setError(e instanceof Error ? e.message : "Working Pals is unavailable");}
  },[]);
  useEffect(()=>{
    if (!open) return;
    void refresh();
    const timer=window.setInterval(()=>void refresh(),30000);
    return ()=>window.clearInterval(timer);
  },[open,refresh]);
  const call = async (payload:Record<string,unknown>) => {
    setBusy(String(payload["id"]??payload["op"]));setError("");
    try {
      const response=await fetch("/api/working-pals",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),
      });
      const data=(await response.json()) as {error?:string};
      if (!response.ok) throw Error(data.error ?? "Couldn't update this job.");
      if (payload["op"]==="propose") {setTitle("");setQuestion("");setProject("");}
      await refresh();
    } catch(e) {
      setError(e instanceof Error?e.message:"Couldn't complete this action");
      await refresh(); // A stale revision must never overwrite current state.
    } finally {setBusy("");}
  };
  return (
    <section className="grid min-w-0 gap-3" aria-label="Working Pals Inbox">
      <p className="text-xs text-muted-foreground">
        Create a proposal, review it, approve it, then choose Run. Nothing runs just because a Pal suggests it.
        This first release only asks your local AI for a read-only summary. No browsing, emails, files, memory or calendar edits.
      </p>
      <form className="grid gap-2 rounded-lg border p-3" onSubmit={e=>{e.preventDefault();void call({op:"propose",title,question,scope,project:scope==="project"?project:""});}}>
        <h4 className="font-medium">Propose a job</h4>
        <label className="grid gap-1 text-xs">What should this job be called?
          <Input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Summarize my next steps"/>
        </label>
        <label className="grid gap-1 text-xs">What should your Pal answer?
          <textarea required maxLength={1200} rows={3} className="w-full resize-y rounded-md border bg-background p-2 text-sm" value={question}
            onChange={e=>setQuestion(e.target.value)} placeholder="Help me choose the smallest next step for my plan…"/>
        </label>
        <label className="grid gap-1 text-xs">Permission scope
          <select className="h-9 rounded-md border bg-background px-2" value={scope} onChange={e=>setScope(e.target.value as "personal"|"project")}>
            <option value="personal">Personal — no project context</option><option value="project">Specific project label</option>
          </select>
        </label>
        {scope==="project" && <label className="grid gap-1 text-xs">Project identifier (letters, numbers, underscores or hyphens)
          <Input required maxLength={80} pattern="[A-Za-z0-9_-]+" value={project} onChange={e=>setProject(e.target.value)} />
        </label>}
        <Button size="sm" type="submit" disabled={!!busy || !title.trim() || !question.trim() || (scope==="project"&&!project.trim())}>Add for approval</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium">Jobs awaiting review and results</h4>
        <Button size="sm" variant="outline" onClick={()=>void refresh()}>Refresh</Button>
      </div>
      {!loaded && <p className="text-xs text-muted-foreground">Loading your private job inbox…</p>}
      {loaded && !jobs.length && <p className="text-xs text-muted-foreground">No jobs yet. Start by proposing a small, read-only task.</p>}
      {jobs.map(m=>(
        <article key={m.id} className="grid gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{m.title}</strong>
            <span className="rounded-md bg-muted px-2 py-1 text-xs">{m.status}</span>
          </div>
          <p className="whitespace-pre-wrap text-xs">{m.question}</p>
          <p className="text-xs text-muted-foreground">{m.scope==="personal"?"Personal": "Project: "+m.project} · {m.approvedAt?"Approved":"Approval required"} · Local AI only</p>
          {m.result && <details className="rounded bg-muted/40 p-2 text-xs" open={m.status==="completed"}>
            <summary className="cursor-pointer font-medium">View recorded result</summary>
            <p className="mt-2 whitespace-pre-wrap">{m.result}</p>
          </details>}
          {m.error && <p className="text-xs text-destructive">{m.error}</p>}
          <div className="flex flex-wrap gap-2">
            {m.status==="proposed" &&
              <Button size="sm" onClick={()=>void call({op:"approve",id:m.id,revision:m.revision})} disabled={!!busy}>Approve</Button>}
            {["approved","completed","failed","paused","interrupted"].includes(m.status) &&
              <Button size="sm" onClick={()=>void call({op:"run",id:m.id,revision:m.revision})} disabled={!!busy}>
                {busy===m.id?"Running local AI…": m.status==="approved"?"Run approved job":"Run again"}
              </Button>}
            {m.status==="running" &&
              <Button size="sm" variant="outline" onClick={()=>void call({op:"pause",id:m.id,revision:m.revision})}>Pause</Button>}
            {m.status!=="revoked" &&
              <Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void call({op:"revoke",id:m.id,revision:m.revision})}>Revoke permission</Button>}
            {m.status!=="running" &&
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>{
                if (window.confirm("Delete this Working Pals job and its saved result? This cannot be undone without a backup."))
                  void call({op:"remove",id:m.id,revision:m.revision,confirm:true});
              }}>Delete job</Button>}
          </div>
        </article>
      ))}
      <p className="text-xs text-muted-foreground">
        Results stay in this private Unraid inbox and are not automatically added to Obsidian, memories, or notifications.
        Jobs interrupted by a restart need your explicit review before retry.
      </p>
    </section>
  );
}
