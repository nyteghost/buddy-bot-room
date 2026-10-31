import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SECOND_BRAIN_CATEGORIES, type BrainNote, type SecondBrainCategory } from "@/lib/second-brain";
import { getWorkbench, updateWorkbench, addEntry } from "@/lib/workbench";
export function SecondBrainPanel(){
 const [notes,setNotes]=useState<BrainNote[]>([]);
 const [loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [query,setQuery]=useState("");
 const [title,setTitle]=useState("");
 const [body,setBody]=useState("");
 const [category,setCategory]=useState<SecondBrainCategory>("Preferences");
 const [editing,setEditing]=useState<BrainNote|null>(null);
 const [retrieval,setRetrieval]=useState(()=>{try{return localStorage.getItem("pixelpals-brain-retrieval")==="1"}catch{return false}});
 async function refresh(){
  setBusy(true);
  try{const r=await fetch("/api/second-brain");if(!r.ok)throw Error("Mount and configure your Obsidian vault to enable Second Brain.");
   const data=await r.json() as {notes:BrainNote[]};setNotes(data.notes);setLoaded(true);setMessage("Obsidian connected. "+data.notes.length+" approved notes loaded.");
  }catch(e){setMessage(e instanceof Error?e.message:"Vault unavailable")}
  finally{setBusy(false)}
 }
 const save=async()=>{
  setBusy(true);
  try{
   const now=new Date().toISOString();
   const note:BrainNote={id:editing?.id??crypto.randomUUID(),category,title:title.trim(),body:body.trim(),createdAt:editing?.createdAt??now,updatedAt:editing?.updatedAt??now,source:"user-confirmed",tags:editing?.tags??[]};
   const r=await fetch("/api/second-brain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"save",note,revision:editing?.updatedAt})});
   const data=await r.json() as {note?:BrainNote;error?:string};
   if(!r.ok||!data.note)throw Error(data.error??"Save failed");
   setNotes(rows=>[data.note!,...rows.filter(n=>n.id!==data.note?.id)]);setTitle("");setBody("");setEditing(null);
   setMessage("Saved to Obsidian. Nothing was sent to an external AI.");
  }catch(e){setMessage(e instanceof Error?e.message:"Save failed")}
  finally{setBusy(false)}
 };
 const trash=async(n:BrainNote)=>{
  if(!window.confirm("Move this memory note to Obsidian's .trash?"))return;
  setBusy(true);
  try{const r=await fetch("/api/second-brain",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op:"trash",id:n.id,revision:n.updatedAt})});if(!r.ok)throw Error("Could not move note to trash");
    setNotes(rows=>rows.filter(x=>x.id!==n.id));setMessage("Moved to Obsidian trash.");
  }catch(e){setMessage(e instanceof Error?e.message:"Trash failed")}finally{setBusy(false)}
 };
 const filtered=notes.filter(n=>(n.title+" "+n.body+" "+n.category).toLowerCase().includes(query.toLowerCase()));
 return <section className="grid gap-3 rounded-xl border p-3" aria-label="Second Brain">
  <h3>Second Brain <span>Obsidian · opt-in</span></h3>
  <p className="docs-note">These notes live in your mounted Obsidian vault, under PixelPals/. ShowPilot and other vault folders are never changed by this tool. Only approved notes are saved.</p>
  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>void refresh()}>{loaded?"Refresh Obsidian":"Connect to Obsidian"}</Button>
  <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={retrieval} onChange={e=>{setRetrieval(e.target.checked);try{localStorage.setItem("pixelpals-brain-retrieval",e.target.checked?"1":"0")}catch{}}}/> Enable local-only Second Brain chat retrieval</label>
  <p className="docs-note">When enabled, only relevant short excerpts are supplied to local AI. Cloud models do not receive vault excerpts.</p>
  <label className="grid gap-1 text-sm">Search notes<Input aria-label="Search Second Brain notes" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a project, preference or decision"/></label>
  <div className="grid gap-2">
   <select aria-label="Memory category" className="rounded-md border bg-background p-2" value={category} onChange={e=>setCategory(e.target.value as SecondBrainCategory)}>{SECOND_BRAIN_CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
   <Input aria-label="Memory title" value={title} onChange={e=>setTitle(e.target.value)} maxLength={100} placeholder="What should this memory be called?"/>
   <textarea aria-label="Memory details" className="min-h-24 rounded-md border bg-background p-2" value={body} onChange={e=>setBody(e.target.value)} maxLength={4000} placeholder="Write what you want your Pals to remember."/>
   <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy||!loaded||!title.trim()||!body.trim()} onClick={()=>void save()}>{editing?"Update note":"Save approved note"}</Button>{editing&&<Button type="button" size="sm" variant="ghost" onClick={()=>{setEditing(null);setTitle("");setBody("")}}>Cancel edit</Button>}</div>
  </div>
  {loaded&&<ul className="grid gap-2">{filtered.slice(0,100).map(n=><li key={n.id} className="rounded-lg border p-2">
   <p className="text-sm font-semibold">{n.title}</p><p className="text-xs text-muted-foreground">{n.category} · {n.updatedAt.slice(0,10)}</p><p className="text-sm whitespace-pre-wrap">{n.body.slice(0,240)}</p>
   <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>{setEditing(n);setCategory(n.category);setTitle(n.title);setBody(n.body)}}>Edit</Button>
   <Button size="sm" variant="outline" onClick={()=>{updateWorkbench(w=>({...w,memories:addEntry(w.memories,n.body.slice(0,400))}));setMessage("Copied into approved Pal memory in this browser.")}}>Use as Pal memory</Button>
   <Button size="sm" variant="ghost" onClick={()=>void trash(n)}>Move to trash</Button></div>
  </li>)}</ul>}
  {message&&<p role="status" className="docs-note">{message}</p>}
 </section>;
}
