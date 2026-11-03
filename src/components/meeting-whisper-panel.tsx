import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MeetingTranscription } from "@/lib/meeting-transcribe";

type StatusResponse = { status: MeetingTranscription; configured: boolean };
async function getStatus(id: string): Promise<StatusResponse> {
  const r = await fetch("/api/meeting-transcribe?id=" + encodeURIComponent(id));
  const data = await r.json() as StatusResponse & {error?:string};
  if (!r.ok) throw Error(data.error ?? "Local transcription unavailable");
  return data;
}
async function action(id: string, op: string, confirm=false): Promise<void> {
  const r = await fetch("/api/meeting-transcribe",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({id,op,confirm}),
  });
  if (!r.ok) {
    const data = await r.json().catch(()=>({})) as {error?:string};
    throw Error(data.error ?? "Couldn't update transcription");
  }
}
export function MeetingWhisperPanel({id,open}:{id:string;open:boolean}) {
  const [data,setData]=useState<StatusResponse|null>(null);
  const [permission,setPermission]=useState(false);
  const [busy,setBusy]=useState("");
  const [message,setMessage]=useState("");
  const visible=useRef(open);
  visible.current=open;
  const refresh=useCallback(async()=>{
    const found=await getStatus(id);
    if(visible.current)setData(found);
  },[id]);
  useEffect(()=>{
    if(!open)return;
    let stale=false;
    void getStatus(id).then(result=>{if(!stale)setData(result);})
      .catch(e=>{if(!stale)setMessage(e instanceof Error?e.message:"Couldn't check local transcription");});
    const interval=window.setInterval(()=>{
      void getStatus(id).then(result=>{if(!stale)setData(result);}).catch(()=>{});
    },7000);
    return ()=>{stale=true;window.clearInterval(interval);};
  },[id,open]);
  const doAction=async(op:"start"|"pause"|"reset")=>{
    if(op==="reset"&&!window.confirm("Delete saved partial transcription segments? This does not delete the original recording or your reviewed notes."))return;
    setBusy(op);setMessage("");
    try {
      await action(id,op,op==="start"||op==="reset");
      if(op==="start")setPermission(false);
      await refresh();
      setMessage(op==="start"?"Local Whisper started. You can leave this view; progress is saved on Unraid.":
        op==="pause"?"The local job was paused. Saved completed segments are retained.":
        "Saved transcription checkpoints cleared. Original audio and reviews were not changed.");
    }catch(e){setMessage(e instanceof Error?e.message:"Couldn't update local transcription");}
    finally{setBusy("");}
  };
  const state=data?.status;
  const running=state?.status==="running";
  const percent=state?.totalSegments ? Math.round(100*state.finishedSegments/state.totalSegments):0;
  return <section className="grid gap-2 rounded-md border p-3" aria-label="Local Whisper transcription">
    <div className="grid gap-1">
      <h5 className="text-sm font-medium">Transcribe with local Whisper (optional)</h5>
      <p className="text-xs text-muted-foreground">Uses your configured private Whisper service and the original audio on Unraid. It never sends a recording to cloud AI, publishes notes, or approves the transcript.</p>
    </div>
    {data && !data.configured && <div className="grid gap-2 text-xs">
      <p>Local Whisper is not configured with a trusted local endpoint.</p>
      <Button size="sm" variant="outline" onClick={()=>window.dispatchEvent(
        new CustomEvent("pixelpals:configure-integration",{detail:{id:"whisper"}})
      )}>Configure local Whisper</Button>
    </div>}
    {state && <div className="grid gap-1 text-xs">
      <p>Status: <strong>{state.status.replace(/-/g," ")}</strong></p>
      {state.totalSegments>0 && <>
        <progress className="w-full" max={state.totalSegments} value={state.finishedSegments}
          aria-label="Local transcription progress"/>
        <p>{state.finishedSegments} of {state.totalSegments} audio segments · {percent}%</p>
      </>}
      {!!state.error && <p role="alert" className="text-destructive">{state.error}</p>}
      {state.status==="draft-ready" && <p role="status">A local transcript draft was saved. Use <strong>Reload review</strong> below to inspect and correct it. It has not been approved.</p>}
    </div>}
    {!running && state?.status!=="draft-ready" && data?.configured && <>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={permission} disabled={!!busy} onChange={e=>setPermission(e.target.checked)}/>
        <span>I confirm this recording is authorized for transcription by my private local Whisper server. I understand the transcript needs manual review.</span>
      </label>
      <Button size="sm" variant="outline" disabled={!permission||!!busy}
        onClick={()=>void doAction("start")}>{busy==="start"?"Starting…":state?.finishedSegments?"Resume local transcription":"Start local transcription"}</Button>
    </>}
    {running && <Button size="sm" variant="outline" disabled={!!busy}
      onClick={()=>void doAction("pause")}>Pause transcription</Button>}
    {state && ["failed","paused","interrupted"].includes(state.status) && state.finishedSegments>0 &&
      <Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>void doAction("reset")}>
        Reset saved transcription parts…
      </Button>}
    {message && <p role="status" className="rounded bg-muted/40 p-2 text-xs">{message}</p>}
    <p className="text-xs text-muted-foreground">Time ranges are approximate 3-minute audio segments, not verified word-level timestamps or speaker identification. Keep the original recording until you review the transcript.</p>
  </section>;
}
