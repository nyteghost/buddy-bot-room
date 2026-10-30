import { useEffect, useMemo, useState } from "react";
import { Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EventEntry, TaskNote } from "@/lib/work-tools";
import { taskContext, validateTaskResponse, type AiTaskSuggestion } from "@/lib/showpilot-ai-tasks";
import { runLocalTaskAI } from "@/lib/showpilot-ai-local";
import { AI_PROVIDERS, type AiProviderId } from "@/lib/showpilot-ai-providers";

const modelKey="showpilot:ai:local-model";
type Mode="local"|"online";
export function AiTaskAssistant({ entries, tasks, onApprove }:{
 entries:EventEntry[]; tasks:TaskNote[]; onApprove:(task:TaskNote)=>void;
}) {
 const dates=useMemo(()=>[...new Set(entries.map(e=>e.date))].sort(),[entries]);
 const [date,setDate]=useState("");
 const chosenDate=dates.includes(date)?date:dates[0]??"";
 const [mode,setMode]=useState<Mode>("local");
 const [available,setAvailable]=useState<AiProviderId[]>([]);
 const [provider,setProvider]=useState<AiProviderId>("openai");
 const [status,setStatus]=useState("");
 const [busy,setBusy]=useState(false);
 const [suggestions,setSuggestions]=useState<AiTaskSuggestion[]>([]);
 const [edits,setEdits]=useState<Record<string,string>>({});
 const [dismissed,setDismissed]=useState<string[]>([]);
 useEffect(()=>{if(!window.showpilotAI)return;void window.showpilotAI.status().then(s=>{
   const p=s.providers.filter((n):n is AiProviderId=>AI_PROVIDERS.some(x=>x.id===n&&x.canGenerate));
   setAvailable(p);if(p.length)setProvider(p[0]!);
 }).catch(()=>{})},[]);
 const list=suggestions.filter(s=>!dismissed.includes(s.id));
 const run=async()=>{
  if(!chosenDate||busy)return;
  setBusy(true);setStatus("");setSuggestions([]);setDismissed([]);setEdits({});
  try{
   const eligible=entries.filter(e=>e.date===chosenDate);
   let result:AiTaskSuggestion[];
   if(mode==="local"){
    const model=(()=>{try{return localStorage.getItem(modelKey)||""}catch{return ""}})();
    if(!model)throw new Error("Go to Settings & AI to select and download a local model first.");
    result=await runLocalTaskAI({date:chosenDate,entries:eligible},model,setStatus);
   } else {
    if(!window.showpilotAI||!available.includes(provider))throw new Error("Connect a supported cloud provider in Settings first.");
    const context=taskContext({date:chosenDate,entries:eligible});
    if(!window.confirm("Send only the selected day's event names, rooms, phases and times to "+provider+"? No PDFs, shift records or API keys are included in this request."))return;
    setStatus("Requesting optional cloud AI task suggestions...");
    const raw=await window.showpilotAI.suggestTasks(provider,context);
    result=validateTaskResponse(raw,context,"online");
   }
   const existing=new Set(tasks.map(t=>[t.date,t.section,t.text.toLowerCase().trim()].join("|")));
   result=result.filter(x=>!existing.has([x.task.date,x.task.section,x.task.text.toLowerCase().trim()].join("|")));
   setSuggestions(result);
   setStatus(result.length?result.length+" suggestions to review. Nothing added automatically.":"The model returned no usable new suggestions. Your existing rule-based tasks are still available.");
  }catch(e){setStatus("AI suggestion failed: "+(e as Error).message)}
  finally{setBusy(false)}
 };
 const approve=(s:AiTaskSuggestion)=>{
  const text=(edits[s.id]??s.task.text).trim();
  if(!text){setStatus("Enter a task description before approving.");return;}
  onApprove({...s.task,text});
  setDismissed(a=>[...a,s.id]);
  setStatus("Approved task added to your reviewed schedule; Excel export will include it.");
 };
 return <section className="space-y-3 rounded-xl border border-border p-3 sm:p-4" aria-label="AI Task Assistant">
   <div className="flex items-start gap-3">
     <span className="rounded-lg bg-muted p-2"><Sparkles size={20}/></span>
     <div><h3 className="font-semibold">AI Task Assistant</h3>
       <p className="text-xs text-muted-foreground">Suggests air-wall, stage and room-turn checks. Recommendations never change engineer shifts and require your approval.</p></div>
   </div>
   <div className="flex flex-wrap gap-3 items-center">
     <label className="text-sm">Date <select aria-label="AI task date" className="rounded border bg-background px-3 py-2" value={chosenDate} onChange={e=>setDate(e.target.value)}>{dates.map(d=><option value={d} key={d}>{d}</option>)}</select></label>
     <label className="text-sm">Mode <select aria-label="AI task mode" className="rounded border bg-background px-3 py-2" value={mode} onChange={e=>setMode(e.target.value as Mode)}>
       <option value="local">Local GPU (private, no server)</option><option value="online">Cloud provider (optional)</option>
     </select></label>
     {mode==="online"&&<label className="text-sm">Provider <select className="rounded border bg-background px-3 py-2" value={provider} onChange={e=>setProvider(e.target.value as AiProviderId)}>
       {available.map(x=><option value={x} key={x}>{AI_PROVIDERS.find(a=>a.id===x)?.name}</option>)}
     </select></label>}
     <Button size="sm" onClick={()=>void run()} disabled={!chosenDate||busy||(mode==="online"&&!available.length)}>
       <Sparkles size={16}/>{busy?"Analyzing...":"Suggest engineering tasks"}
     </Button>
   </div>
   <p className="text-xs text-muted-foreground flex items-center gap-2"><ShieldCheck size={14}/> Local mode sends no scheduling details to a cloud provider. First-time model loading requires a download; cached models can run without internet.</p>
   {status&&<p role="status" className="text-xs rounded bg-muted p-2">{status}</p>}
   {list.map(s=><div key={s.id} className="rounded-lg border p-3 space-y-2">
     <div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{s.task.date} · {s.task.section} · {s.provider==="local"?"Local GPU":"Online AI"}</span><span>Requires approval</span></div>
     <Input aria-label={"Edit suggested task "+s.id} value={edits[s.id]??s.task.text} onChange={e=>setEdits(a=>({...a,[s.id]:e.target.value}))}/>
     <p className="text-xs">{s.reason}</p>
     <p className="text-xs text-muted-foreground">Evidence: {s.evidence.join(" · ")}</p>
     <div className="flex gap-2"><Button size="sm" onClick={()=>approve(s)}>Approve and add to schedule</Button>
       <Button size="sm" variant="outline" onClick={()=>setDismissed(a=>[...a,s.id])}>Dismiss</Button></div>
   </div>)}
 </section>;
}
