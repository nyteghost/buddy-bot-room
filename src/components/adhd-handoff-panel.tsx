import { useEffect,useState } from "react";
import { Button } from "@/components/ui/button";
import type { Handoff } from "@/lib/adhd-bridge";

type State={enabled:boolean;configured:boolean;items:Handoff[]};
const initial:State={enabled:false,configured:false,items:[]};

/** Opt-in manual handoff. Never reads chat history or accesses a private memory store. */
export function AdhdHandoffPanel(){
 const [state,setState]=useState<State>(initial);
 const [title,setTitle]=useState("");
 const [notes,setNotes]=useState("");
 const [due,setDue]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [opened,setOpened]=useState(false);
 async function refresh(){
  const response=await fetch("/api/adhd-bridge",{cache:"no-store"});
  if(!response.ok)throw Error("Owner sign-in and persistent storage are required");
  const data=await response.json() as State;
  setState(data);
 }
 useEffect(()=>{if(!opened)return;void refresh().catch(()=>setMessage("Handoffs unavailable. Sign in as the Pixel Pals owner."));},[opened]);
 async function action(body:Record<string,unknown>){
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/adhd-bridge",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
   const data=await response.json() as {item?:Handoff;error?:string;delivered?:boolean};
   if(!response.ok)throw Error(data.error??data.item?.lastError??"The handoff was not delivered");
   setMessage(body["action"]==="check-status"?"Receiver approval status checked. This is not task-completion status.":data.delivered?"Delivered for ADHD Assistant approval. It is not yet a scheduled task.":"Saved. Review before approving and sending.");
   if(body["action"]==="draft"){setTitle("");setNotes("");setDue("");}
  }catch(e){setMessage(e instanceof Error?e.message:"Something went wrong");}
  finally{await refresh().catch(()=>undefined);setBusy(false);}
 }
 return <details className="rounded-lg border border-border p-3 text-sm" onToggle={e=>setOpened(e.currentTarget.open)}>
  <summary className="cursor-pointer font-semibold">Send a task to ADHD Assistant (optional)</summary>
  <p className="my-2 text-xs text-muted-foreground">Explicit approval only. No chat transcript or private memory is copied. Both apps can run independently.</p>
  <p role="status" className="mb-2 text-xs">{state.enabled&&state.configured?"Bridge connected in server settings; delivery requires your approval.":"Bridge is off or not configured. Drafts stay in Pixel Pals until you opt in."}</p>
  <form className="grid gap-2" onSubmit={e=>{e.preventDefault();void action({action:"draft",handoff:{kind:"task",title,notes,...(due?{due_at:new Date(due).toISOString()}:{})}});}}>
   <label className="grid gap-1">Task title<input aria-label="Handoff task title" className="rounded border bg-background p-2" required maxLength={240} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Check ShowPilot schedule"/></label>
   <label className="grid gap-1">Notes (optional)<textarea aria-label="Handoff notes" className="rounded border bg-background p-2" maxLength={1500} rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   <label className="grid gap-1">Due date (optional)<input aria-label="Handoff due date" type="datetime-local" className="rounded border bg-background p-2" value={due} onChange={e=>setDue(e.target.value)}/></label>
   <Button type="submit" variant="outline" disabled={busy||!title.trim()}>Create draft for review</Button>
  </form>
  {message&&<p className="mt-2 text-xs" role="status">{message}</p>}
  <div className="mt-3 grid gap-2" aria-label="Handoff drafts and receipts">
   {state.items.slice(0,12).map(item=><article key={item.id} className="rounded border border-border p-2">
    <div className="flex flex-wrap justify-between gap-1"><strong>{item.payload.title}</strong><span className="text-xs text-muted-foreground">{item.status}</span></div>
    {item.payload.notes&&<p className="my-1 whitespace-pre-wrap text-xs">{item.payload.notes}</p>}
    {item.payload.due_at&&<p className="text-xs">Due: {new Date(item.payload.due_at).toLocaleString()}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
     {item.status==="draft"&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>void action({action:"approve",id:item.id})}>Approve this task</Button>}
     {item.status==="approved"&&<Button size="sm" variant="outline" disabled={busy||!state.enabled||!state.configured} onClick={()=>void action({action:"send",id:item.id})}>{item.attempts>0?"Retry delivery":"Send to ADHD Assistant"}</Button>}
     {item.status==="delivered"&&<Button size="sm" variant="outline" disabled={busy||!state.enabled||!state.configured} onClick={()=>void action({action:"check-status",id:item.id})}>Check ADHD approval</Button>}
     {(item.status==="draft"||item.status==="approved")&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void action({action:"cancel",id:item.id})}>Cancel</Button>}
    </div>
    {item.lastError&&<p className="mt-1 text-xs text-destructive">{item.lastError}</p>}
    {item.status==="delivered"&&<p className="mt-1 text-xs text-muted-foreground">Receiver acknowledged delivery, not task completion. {item.receiverState==="approved"?"ADHD Assistant approved this handoff.":item.receiverState==="rejected"?"ADHD Assistant rejected this handoff.":item.receiverState==="pending"?"Still waiting for ADHD Assistant approval.":"Click Check ADHD approval to ask for its latest review status."}</p>}
   </article>)}
  </div>
 </details>;
}
