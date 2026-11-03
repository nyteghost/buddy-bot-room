import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MeetingReviewPanel } from "@/components/meeting-review-panel";
import { Input } from "@/components/ui/input";
import { MEETING_CHUNK_BYTES, MEETING_MAX_BYTES, MEETING_TYPES, type MeetingMime, type MeetingRecord } from "@/lib/meeting-vault";

const extensionTypes: Record<string, MeetingMime> = {
  m4a:"audio/mp4", mp4:"audio/mp4", mp3:"audio/mpeg", wav:"audio/wav",
  webm:"audio/webm", ogg:"audio/ogg", aac:"audio/aac", flac:"audio/flac",
};
function mimeFor(file:File):MeetingMime | null {
  if (file.type in MEETING_TYPES) return file.type as MeetingMime;
  return extensionTypes[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}
async function json(body?:Record<string,unknown>):Promise<Record<string,unknown>> {
  const r=await fetch("/api/meeting-vault",body?{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),
  }:undefined);
  const v=await r.json() as Record<string,unknown>;
  if(!r.ok)throw Error(typeof v["error"]==="string"?v["error"]:"Meeting Vault unavailable");
  return v;
}
async function digest(bytes:ArrayBuffer):Promise<string> {
  const result=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return [...result].map(x=>x.toString(16).padStart(2,"0")).join("");
}
/** Original-audio-only staging. Transcription and Obsidian approval are separate future steps. */
export function MeetingVaultPanel({open}:{open:boolean}) {
  const [records,setRecords]=useState<MeetingRecord[]>([]);
  const [file,setFile]=useState<File|null>(null);
  const [title,setTitle]=useState("");
  const [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [notice,setNotice]=useState("");
  const [expandedReviews,setExpandedReviews]=useState<string[]>([]);
  const abort=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    try {
      const response=await json();
      setRecords(Array.isArray(response["meetings"])?response["meetings"] as MeetingRecord[]:[]);
    } catch(e) {setNotice(e instanceof Error?e.message:"Couldn't load Meeting Vault");}
  },[]);
  useEffect(()=>{
    if(open)void refresh();
    return ()=>{abort.current?.abort();};
  },[open,refresh]);
  const upload=async()=>{
    if(!file||busy)return;
    const type=mimeFor(file);
    if(!type||!file.size||file.size>MEETING_MAX_BYTES){
      setNotice("Choose a supported audio file up to 512 MB.");return;
    }
    if(!consent){setNotice("Confirm permission to record and store this conversation first.");return;}
    if(!globalThis.crypto?.subtle){setNotice("Use a secure HTTPS or localhost connection for verified uploads.");return;}
    setBusy(true);setNotice("Preparing protected upload…");
    const controller=new AbortController();
    abort.current=controller;
    try {
      const filename=file.name.split(/[\\/]/).pop() ?? file.name;
      const existing=records.find(m=>m.status==="uploading" && m.filename===filename &&
        m.bytes===file.size && m.mimeType===type);
      let record=existing;
      if(!record){
        const data=await json({op:"create",title:title.trim()||filename.replace(/\.[^.]+$/,""),
          filename,mimeType:type,bytes:file.size,source:"iphone-voice-memos",consentConfirmed:true});
        record=data["record"] as MeetingRecord;
      }
      if(!record)throw Error("Couldn't create the recording");
      const have=new Set(record.received);
      setProgress(Math.round(have.size/record.parts*100));
      for(let index=0;index<record.parts;index++){
        if(controller.signal.aborted)throw Error("Upload paused. Reselect the same recording to resume.");
        if(have.has(index))continue;
        const bytes=await file.slice(index*MEETING_CHUNK_BYTES,
          Math.min(file.size,(index+1)*MEETING_CHUNK_BYTES)).arrayBuffer();
        const hash=await digest(bytes);
        const r=await fetch("/api/meeting-vault?id="+encodeURIComponent(record.id)+"&part="+index,{
          method:"PUT",headers:{"content-type":"application/octet-stream","x-chunk-sha256":hash},
          body:bytes,signal:controller.signal,
        });
        if(!r.ok){
          const response=await r.json().catch(()=>({})) as {error?:string};
          throw Error(response.error??"Audio part upload failed. Reselect the original to resume.");
        }
        have.add(index);
        setProgress(Math.round(have.size/record.parts*100));
      }
      if(controller.signal.aborted)throw Error("Upload paused.");
      const completed=await json({op:"finalize",id:record.id});
      if(!(completed["record"] as MeetingRecord|undefined)?.sha256)
        throw Error("Server did not verify the original audio.");
      setFile(null);setTitle("");setConsent(false);
      setNotice("Original audio verified and saved privately on Unraid. Transcription is not started.");
      await refresh();
    }catch(e){
      setNotice(controller.signal.aborted ? "Upload paused. Reselect the same file to resume." :
        e instanceof Error?e.message:"The import stopped. Reselect the same file to resume.");
      await refresh();
    }finally{abort.current=null;setBusy(false);}
  };
  const remove=async(m:MeetingRecord)=>{
    if(!window.confirm("Permanently delete this original recording and its upload data from Meeting Vault?"))return;
    setBusy(true);
    try {
      await json({op:"remove",id:m.id,revision:m.revision,confirm:true});
      setNotice("Recording deleted.");
      await refresh();
    }catch(e){setNotice(e instanceof Error?e.message:"Couldn't remove recording");}
    finally{setBusy(false);}
  };
  return <section className="grid gap-3 rounded-lg border p-3" aria-label="Meeting Vault">
    <div className="grid gap-1">
      <h3 className="font-semibold">Meeting Vault · original audio</h3>
      <p className="text-xs text-muted-foreground">
        Import iPhone Voice Memos or another audio recording. This saves the original on Unraid in verified,
        resumable chunks. No transcription, memories, notes, links or AI jobs are started automatically.
      </p>
    </div>
    <label className="grid gap-1 text-xs">Meeting name (optional)
      <Input value={title} maxLength={120} disabled={busy} onChange={e=>setTitle(e.target.value)}
        placeholder="Planning meeting" />
    </label>
    <label className="grid gap-1 text-xs">Choose original audio (up to 512 MB)
      <input type="file" accept="audio/*,.m4a,.mp4,.mp3,.wav,.webm,.ogg,.aac,.flac"
        disabled={busy} onChange={e=>{
          const selected=e.target.files?.[0]??null;
          setFile(selected);setProgress(0);
          if(selected && !title)setTitle(selected.name.replace(/\.[^.]+$/,"").slice(0,120));
        }} />
    </label>
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)} />
      <span>I have permission to record and store this conversation on my personal Unraid server, including any employer or participant requirements.</span>
    </label>
    {file && <p className="text-xs text-muted-foreground">
      Selected: {file.name} · {(file.size/1024/1024).toFixed(1)} MB
    </p>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy||!file||!consent} onClick={()=>void upload()}>
        {busy?"Uploading "+progress+"%":"Save or resume original audio"}
      </Button>
      {busy && <Button variant="outline" size="sm" onClick={()=>abort.current?.abort()}>Pause upload</Button>}
      <Button variant="outline" size="sm" disabled={busy} onClick={()=>void refresh()}>Refresh vault</Button>
    </div>
    {busy && <progress className="w-full" aria-label="Meeting audio upload progress" max={100} value={progress}/>}
    {notice && <p role="status" className="rounded-md bg-muted/40 p-2 text-xs">{notice}</p>}
    <div className="grid gap-2">
      <h4 className="text-sm font-medium">Your recordings</h4>
      {!records.length && <p className="text-xs text-muted-foreground">No recordings yet. Start with an audio file you have permission to store.</p>}
      {records.map(m=><article key={m.id} className="grid gap-2 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <strong>{m.title}</strong>
          <span className="rounded bg-muted px-2 py-1 text-xs">{m.status==="ready"?"Original stored":"Upload incomplete"}</span>
        </div>
        <p className="text-xs text-muted-foreground">{m.filename} · {(m.bytes/1024/1024).toFixed(1)} MB
          {m.status==="uploading"?" · "+m.received.length+"/"+m.parts+" parts saved":""}
        </p>
        {m.status==="ready" ? <>
          <audio controls preload="none" className="w-full" src={"/api/meeting-vault?id="+encodeURIComponent(m.id)+"&audio=1"} />
          <p className="text-xs text-muted-foreground">Original SHA-256: <span className="break-all font-mono">{m.sha256}</span></p>
          <details onToggle={e=>{
            const visible=e.currentTarget.open;
            setExpandedReviews(ids=>visible?[...new Set([...ids,m.id])]:ids.filter(id=>id!==m.id));
          }}>
            <summary className="cursor-pointer py-2 font-medium">Review transcript and meeting notes</summary>
            <MeetingReviewPanel id={m.id} open={expandedReviews.includes(m.id)} />
          </details>
        </> : <p className="text-xs text-muted-foreground">Reselect {m.filename} above to resume. Keep your original file until this says Original stored.</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={()=>void remove(m)}>Delete recording…</Button>
        </div>
      </article>)}
    </div>
  </section>;
}
