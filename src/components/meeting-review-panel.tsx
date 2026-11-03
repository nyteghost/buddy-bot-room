import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_MEETING_SPEAKER_NOTES, MAX_MEETING_SUMMARY, MAX_MEETING_TRANSCRIPT, type MeetingReview } from "@/lib/meeting-review";

type Draft = { transcript: string; summary: string; speakerNotes: string };
function asDraft(r: MeetingReview): Draft {
  return { transcript:r.transcript, summary:r.summary, speakerNotes:r.speakerNotes };
}
async function meetingReviewApi(id:string, op?:string, payload:Record<string,unknown>={}):Promise<Record<string,unknown>> {
  const response=await fetch(op?"/api/meeting-review":"/api/meeting-review?id="+encodeURIComponent(id),op?{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({op,id,...payload}),
  }:undefined);
  const body=await response.json() as Record<string,unknown>;
  if(!response.ok)throw Error(typeof body["error"]==="string"?body["error"]:"Meeting review unavailable");
  return body;
}
/** Review does not start transcription, create memories, or export anything without distinct owner clicks. */
export function MeetingReviewPanel({id,open}:{id:string;open:boolean}) {
  const [review,setReview]=useState<MeetingReview|null>(null);
  const [draft,setDraft]=useState<Draft>({transcript:"",summary:"",speakerNotes:""});
  const [notice,setNotice]=useState("");
  const [busy,setBusy]=useState("");
  const load=useCallback(async()=>{
    const data=await meetingReviewApi(id);
    const received=data["review"] as MeetingReview;
    setReview(received);
    setDraft(asDraft(received));
  },[id]);
  useEffect(()=>{
    if(!open||review)return;
    let cancelled=false;
    void meetingReviewApi(id).then(data=>{
      if(cancelled)return;
      const received=data["review"] as MeetingReview;
      setReview(received);setDraft(asDraft(received));
    }).catch(e=>{if(!cancelled)setNotice(e instanceof Error?e.message:"Couldn't load review");});
    return ()=>{cancelled=true};
  },[id,open,review]);
  const changed=!!review && (draft.transcript!==review.transcript ||
    draft.summary!==review.summary || draft.speakerNotes!==review.speakerNotes);
  const update=(field:keyof Draft,value:string)=>setDraft(current=>({...current,[field]:value}));
  const action=async(op:"save"|"summarize"|"approve"|"publish")=>{
    if(!review)return;
    if(op!=="save"&&changed){setNotice("Save your edits first, then use this action.");return;}
    setBusy(op);setNotice("");
    try {
      const data=await meetingReviewApi(id,op,{
        revision:review.revision,
        ...(op==="save"?draft:{}),
      });
      const result=data["review"] as MeetingReview;
      setReview(result);
      setDraft(asDraft(result));
      setNotice(op==="save"?"Draft saved privately on Unraid.":
        op==="summarize"?"Local AI summary draft saved. Review and correct it before approval.":
        op==="approve"?"Transcript and summary approved. Obsidian export is a separate step.":
        "Reviewed meeting note exported without overwriting any existing Obsidian note.");
    }catch(e){setNotice(e instanceof Error?e.message:"Couldn't complete review action");}
    finally{setBusy("");}
  };
  return <section className="grid gap-3 rounded-md border p-3 text-sm" aria-label="Meeting transcript review">
    <div className="grid gap-1">
      <h4 className="font-medium">Review transcript and meeting notes</h4>
      <p className="text-xs text-muted-foreground">
        Nothing is transcribed automatically. Paste a transcript you have permission to use, then save it.
        A local-AI summary is optional and must be explicitly requested. Nothing becomes a memory or task.
      </p>
    </div>
    {!review?<p className="text-xs text-muted-foreground">Loading private meeting review…</p>:<>
      <label className="grid gap-1 text-xs">Transcript (editable, up to 100,000 characters)
        <textarea className="w-full resize-y rounded-md border bg-background p-2 text-sm"
          rows={8} maxLength={MAX_MEETING_TRANSCRIPT} value={draft.transcript}
          onChange={e=>update("transcript",e.target.value)} placeholder="Paste a transcript from your authorized local transcription tool…" />
      </label>
      <label className="grid gap-1 text-xs">Meeting summary (draft until you approve it)
        <textarea className="w-full resize-y rounded-md border bg-background p-2 text-sm"
          rows={7} maxLength={MAX_MEETING_SUMMARY} value={draft.summary}
          onChange={e=>update("summary",e.target.value)} placeholder="Important decisions, open questions, proposed action items, and uncertainty…" />
      </label>
      <label className="grid gap-1 text-xs">Speaker corrections and uncertainty (optional)
        <textarea className="w-full resize-y rounded-md border bg-background p-2 text-sm"
          rows={3} maxLength={MAX_MEETING_SPEAKER_NOTES} value={draft.speakerNotes}
          onChange={e=>update("speakerNotes",e.target.value)} placeholder="Speaker 1 may be…; ownership unverified…" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!!busy||!changed} onClick={()=>void action("save")}>
          {busy==="save"?"Saving…":"Save private draft"}
        </Button>
        <Button size="sm" variant="outline" disabled={!!busy||changed||!review.transcript.trim()}
          onClick={()=>void action("summarize")}>
          {busy==="summarize"?"Local Ollama is drafting…":"Draft summary with local Ollama"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Summary generation sends only this transcript to your configured local Ollama server.
        Long transcripts require segmented processing, which is not enabled yet.
      </p>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="rounded bg-muted px-2 py-1 text-xs">
          {review.status==="reviewed"?"Approved by owner":"Needs review"} · revision {review.revision}
        </span>
        <Button size="sm" variant="outline" disabled={!!busy||changed||!review.transcript.trim()||!review.summary.trim()||
          review.status==="reviewed"} onClick={()=>void action("approve")}>Approve reviewed notes</Button>
        <Button size="sm" disabled={!!busy||changed||review.status!=="reviewed"||!!review.exportedPath}
          onClick={()=>void action("publish")}>Export approved note to Obsidian</Button>
      </div>
      {review.exportedPath && <p className="break-all text-xs text-muted-foreground">
        Last approved export: {review.exportedPath}
      </p>}
      <div className="flex justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Editing after approval returns this to draft. An existing Obsidian note is never overwritten.
        </p>
        <Button size="sm" variant="ghost" disabled={!!busy} onClick={()=>{
          if(changed&&!window.confirm("Discard unsaved edits and reload from Unraid?"))return;
          void load().then(()=>setNotice("Review reloaded.")).catch(e=>setNotice(e instanceof Error?e.message:"Couldn't reload"));
        }}>Reload review</Button>
      </div>
    </>}
    {notice && <p role="status" className="rounded bg-muted/50 p-2 text-xs">{notice}</p>}
  </section>;
}
