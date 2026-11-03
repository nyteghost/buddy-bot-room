import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MeetingThreadHit } from "@/lib/meeting-threads";
import type { ReviewedMeetingBrief } from "@/lib/meeting-briefing";
import type { MeetingLinkSuggestion } from "@/lib/meeting-link-suggestions";

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
  const [brief,setBrief]=useState<ReviewedMeetingBrief|null>(null);
  const [briefLoading,setBriefLoading]=useState(false);
  const [suggestions,setSuggestions]=useState<MeetingLinkSuggestion[]>([]);
  const [suggestLoading,setSuggestLoading]=useState(false);
  const suggest=async()=>{
    setSuggestLoading(true);setNotice("");
    try{
      const r=await fetch("/api/meeting-threads?suggest=1");
      const data=await r.json() as {suggestions?:MeetingLinkSuggestion[];error?:string};
      if(!r.ok||!Array.isArray(data.suggestions))throw Error(data.error??"Couldn't check reviewed meeting links");
      setSuggestions(data.suggestions);
      if(!data.suggestions.length)setNotice("No strong shared-keyword suggestions from approved meetings. You can still link manually.");
    }catch(e){setNotice(e instanceof Error?e.message:"Couldn't check links");}
    finally{setSuggestLoading(false);}
  };

  const prepareBrief=async(threadName:string,projectName:string)=>{
    setBriefLoading(true);setNotice("");setBrief(null);
    try{
      const url="/api/meeting-threads?brief="+encodeURIComponent(threadName)+"&project="+encodeURIComponent(projectName);
      const r=await fetch(url);
      const result=await r.json() as {brief?:ReviewedMeetingBrief;error?:string};
      if(!r.ok||!result.brief)throw Error(result.error??"Couldn't prepare approved meeting brief");
      setBrief(result.brief);
    }catch(e){setNotice(e instanceof Error?e.message:"Couldn't prepare the meeting brief");}
    finally{setBriefLoading(false);}
  };

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
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={suggestLoading} onClick={()=>void suggest()}>
          {suggestLoading?"Checking reviewed notes…":"Suggest thread links"}
        </Button>
        <Button size="sm" variant="ghost" onClick={()=>void load(searched).catch(e=>setNotice(e instanceof Error?e.message:"Couldn't refresh"))}>Refresh</Button>
      </div>
    </div>
    {loaded&&!items.length&&<p className="text-xs text-muted-foreground">No approved meetings match. Finish a recording's Review step first; drafts are never indexed.</p>}
    {!!suggestions.length&&<section aria-label="Suggested reviewed meeting links" className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">Suggestions to review · {suggestions.length}</h4>
        <Button size="sm" variant="ghost" onClick={()=>setSuggestions([])}>Dismiss suggestions</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        These are simple shared-keyword matches between approved notes—not verified project relationships.
        Choosing a suggestion only fills the existing link form; you must press Save reviewed link separately.
      </p>
      {suggestions.map((suggestion,i)=><article key={suggestion.meetingId+"-"+i} className="grid gap-2 rounded-md bg-muted/30 p-2">
        <div className="text-sm font-medium">{suggestion.title}</div>
        <p className="text-xs">Suggested: {suggestion.proposedThread}{suggestion.proposedProject?" · "+suggestion.proposedProject:""}</p>
        <p className="text-xs text-muted-foreground">Based on reviewed meeting: {suggestion.evidenceTitle}.
          Shared terms: {suggestion.sharedTerms.join(", ")}. This is not AI-verified evidence.</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>{
          setEditId(suggestion.meetingId);
          setThread(suggestion.proposedThread);
          setProject(suggestion.proposedProject);
          setSuggestions([]);
          setSearched("");
          setSearch("");
          setNotice("Suggestion selected. Review the evidence and press Save reviewed link in the unlinked meeting card to confirm.");
        }}>Review in link form</Button>
      </article>)}
    </section>}
    {[...grouped].map(([group,meetings])=><div key={group} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{group}</h4>
        {group!=="Unlinked reviewed meetings"&&[...new Set(meetings.map(m=>m.project))].map(projectName=>
          <Button key={projectName} size="sm" variant="outline" disabled={briefLoading}
            onClick={()=>void prepareBrief(group,projectName)}>
            Prepare brief{projectName?" · "+projectName:""}
          </Button>)}
      </div>
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
    {brief&&<section className="grid gap-2 rounded-lg border p-3" aria-label="Reviewed meeting preparation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">Meeting preparation · {brief.thread}</h4>
        <Button size="sm" variant="outline" onClick={()=>void navigator.clipboard.writeText(brief.text).then(()=>{
          setNotice("Approved-source brief copied. Review it before sharing.");
        }).catch(()=>setNotice("Clipboard unavailable; select the brief text manually."))}>Copy brief</Button>
      </div>
      <p className="text-xs text-muted-foreground">{brief.reviewedSources} approved source(s).
        This is a reference summary, not an assumption about upcoming attendees or decisions.
        Do not share private meeting notes outside an authorized environment.
      </p>
      <textarea aria-label="Reviewed-source briefing" className="min-h-56 w-full resize-y rounded-md border bg-background p-2 text-xs"
        readOnly value={brief.text} />
      <Button size="sm" variant="ghost" onClick={()=>setBrief(null)}>Close brief</Button>
    </section>}
    {notice&&<p role="status" className="rounded bg-muted/40 p-2 text-xs">{notice}</p>}
  </section>;
}
