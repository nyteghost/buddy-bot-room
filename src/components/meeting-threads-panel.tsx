import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MeetingThreadHit } from "@/lib/meeting-threads";

async function meetingThreadsApi(query: string, op?:Record<string,unknown>):Promise<Record<string,unknown>>{
  const url=op?"/api/meeting-threads":"/api/meeting-threads?q="+encodeURIComponent(query);
  const r=await fetch(url,op?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(op)}:undefined);
  const data=await r.json() as Record<string,unknown>;
  if(!r.ok)throw Error(typeof data["error"]==="string"?data["error"]:"Meeting Threads unavailable");
  return data;
}
export function MeetingThreadsPanel({open}:{open:boolean}) {
  const [items,setItems]=useState<MeetingThreadHit[]>([]);
  const [search,setSearch]=useState("");
  const [searched,setSearched]=useState("");
  const [editId,setEditId]=useState("");
  const [thread,setThread]=useState("");
  const [project,setProject]=useState("");
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [notice,setNotice]=useState("");
  const load=useCallback(async(q:string)=>{
    const result=await meetingThreadsApi(q);
    setItems(Array.isArray(result["items"])?result["items"] as MeetingThreadHit[]:[]);
    setLoaded(true);
  },[]);
  useEffect(()=>{
    if(!open)return;
    let stop=false;
    void meetingThreadsApi(searched).then(d=>{
      if(!stop){setItems(Array.isArray(d["items"])?d["items"] as MeetingThreadHit[]:[]);setLoaded(true);}
    }).catch(e=>{if(!stop)setNotice(e instanceof Error?e.message:"Couldn't load meeting threads");});
    return ()=>{stop=true};
  },[open,searched]);
  const run=async(payload:Record<string,unknown>)=>{
    setBusy(true);setNotice("");
    try {
      await meetingThreadsApi("",payload);
      setEditId("");
      await load(searched);
      setNotice(payload["op"]==="unlink"?"Thread link removed. The reviewed notes remain saved.":
        "Owner-approved thread link saved. No memories, calendar events, or tasks were created.");
    } catch(e) {
      setNotice(e instanceof Error?e.message:"Couldn't save meeting link");
    }finally{setBusy(false);}
  };
  const grouped=new Map<string,MeetingThreadHit[]>();
  for(const hit of items) {
    const label=hit.thread||"Unlinked reviewed meetings";
    grouped.set(label,[...(grouped.get(label)??[]),hit]);
  }
  return <section className="grid gap-3 rounded-lg border p-3 text-sm" aria-label="Meeting Threads">
    <div className="grid gap-1">
      <h3 className="font-semibold">Meeting Threads · reviewed notes</h3>
      <p className="text-xs text-muted-foreground">
        Search only owner-approved meeting reviews. Group them into named threads and optional project labels yourself.
        Pixel Pals never assumes attendees from calendar entries or creates links without your approval.
      </p>
    </div>
    <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();setSearched(search.trim());}}>
      <Input aria-label="Search approved meetings" placeholder="Find a decision or topic…" maxLength={100}
        className="min-w-0 flex-1" value={search} onChange={e=>setSearch(e.target.value)}/>
      <Button type="submit" size="sm" variant="outline">Search</Button>
      {!!searched && <Button type="button" size="sm" variant="ghost" onClick={()=>{setSearch("");setSearched("");}}>Clear</Button>}
    </form>
    <div className="flex justify-between gap-2">
      <p className="text-xs text-muted-foreground">{loaded?items.length+" approved review(s)":"Loading approved reviews…"}</p>
      <Button size="sm" variant="ghost" onClick={()=>void load(searched).catch(e=>setNotice(e instanceof Error?e.message:"Couldn't refresh"))}>Refresh</Button>
    </div>
    {loaded&&!items.length&&<p className="text-xs text-muted-foreground">No approved meetings match. Finish a recording's Review step first; drafts are never indexed.</p>}
    {[...grouped].map(([group,meetings])=><div key={group} className="grid gap-2">
      <h4 className="font-medium">{group}</h4>
      {meetings.map(m=><article className="grid gap-2 rounded-md border p-3" key={m.meetingId}>
        <div className="flex flex-wrap justify-between gap-2">
          <strong>{m.title}</strong>
          <span className="text-xs text-muted-foreground">{m.project?"Project: "+m.project:"No project label"}</span>
        </div>
        <p className="whitespace-pre-wrap text-xs">{searched?m.excerpt:m.summary}</p>
        <p className="text-xs text-muted-foreground">
          Approved: {m.reviewedAt.slice(0,10)} · Evidence: owner-reviewed meeting transcript
        </p>
        {editId===m.meetingId ? <form className="grid gap-2" onSubmit={e=>{
          e.preventDefault();
          void run({op:"link",id:m.meetingId,thread,project,revision:m.linkRevision});
        }}>
          <label className="grid gap-1 text-xs">Thread name
            <Input value={thread} required maxLength={80} onChange={e=>setThread(e.target.value)}
              placeholder="Weekly team planning"/>
          </label>
          <label className="grid gap-1 text-xs">Project identifier (optional)
            <Input value={project} maxLength={80} pattern="[A-Za-z0-9_-]*" onChange={e=>setProject(e.target.value)}
              placeholder="project_name"/>
          </label>
          <p className="text-xs text-muted-foreground">A project label organizes this view. It does not grant other users or integrations permission to read the meeting.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy||!thread.trim()}>Save reviewed link</Button>
            <Button size="sm" type="button" variant="ghost" onClick={()=>setEditId("")}>Cancel</Button>
          </div>
        </form> : <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={()=>{setEditId(m.meetingId);setThread(m.thread);setProject(m.project);}}>
            {m.thread?"Change thread…":"Link to thread…"}
          </Button>
          {!!m.thread&&<Button size="sm" variant="ghost" disabled={busy}
            onClick={()=>void run({op:"unlink",id:m.meetingId,revision:m.linkRevision})}>Unlink</Button>}
        </div>}
      </article>)}
    </div>)}
    {notice&&<p role="status" className="rounded bg-muted/40 p-2 text-xs">{notice}</p>}
  </section>;
}
