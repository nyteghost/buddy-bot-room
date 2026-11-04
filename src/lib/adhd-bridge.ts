/** Local-only, approval-first ADHD Assistant Bridge v1 envelope.
 * No AI tools, private memory, credentials, or email data are read automatically.
 */
export type HandoffKind = "task" | "note";
export type HandoffStatus = "draft" | "approved" | "delivered" | "cancelled";
export type HandoffPayload = Readonly<{title:string;notes?:string;due_at?:string;project?:string}>;
export type Handoff = Readonly<{
 id:string;kind:HandoffKind;payload:HandoffPayload;sourcePal?:string;
 status:HandoffStatus;createdAt:string;updatedAt:string;attempts:number;
 lastError?:string;receipt?:string;receiverState?:"pending"|"approved"|"rejected";receiverCheckedAt?:string
}>;

const asText=(v:unknown,max:number):string=>{
 if(typeof v!=="string")throw Error("Text field required");
 const t=v.trim();
 if(t.length>max)throw Error("Text field is too long");
 return t;
};

export function draftHandoff(input:unknown,id:string,now:string):Handoff {
 if(!input||typeof input!=="object"||Array.isArray(input))throw Error("Invalid handoff");
 const source=input as Record<string,unknown>;
 if(Object.keys(source).some(key=>!["kind","title","notes","due_at","project","sourcePal"].includes(key)))throw Error("Unexpected handoff fields");
 if(source["kind"]!=="task"&&source["kind"]!=="note")throw Error("Unsupported handoff kind");
 const title=asText(source["title"],240);
 if(!title)throw Error("Title is required");
 const notes=source["notes"]===undefined?"":asText(source["notes"],1500);
 const project=source["project"]===undefined?"":asText(source["project"],120);
 const due=source["due_at"]===undefined?"":asText(source["due_at"],50);
 if(due&&(!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(due)||!Number.isFinite(Date.parse(due))))throw Error("Invalid due date");
 const sourcePal=source["sourcePal"]===undefined?"":asText(source["sourcePal"],64);
 if(sourcePal&&!/^[A-Za-z0-9_-]{1,64}$/.test(sourcePal))throw Error("Invalid character reference");
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw Error("Invalid message id");
 if(!Number.isFinite(Date.parse(now)))throw Error("Invalid timestamp");
 return {
  id,kind:source["kind"],payload:{title,...(notes?{notes}:{}),...(due?{due_at:due}:{}),...(project?{project}:{})},
  ...(sourcePal?{sourcePal}:{}),status:"draft",createdAt:now,updatedAt:now,attempts:0
 };
}

export function transitionHandoff(handoff:Handoff,action:"approve"|"cancel",now:string):Handoff {
 if(action==="approve"&&handoff.status!=="draft")throw Error("Only drafts can be approved");
 if(action==="cancel"&&handoff.status!=="draft"&&handoff.status!=="approved")throw Error("Delivered handoffs cannot be withdrawn");
 return {...handoff,status:action==="approve"?"approved":"cancelled",updatedAt:now};
}

export function receivedReceipt(receipt:unknown,id:string):boolean {
 if(!receipt||typeof receipt!=="object"||Array.isArray(receipt))return false;
 const r=receipt as Record<string,unknown>;
 return r["id"]===id&&(r["status"]==="received_pending_approval"||r["status"]==="approved");
}

/** Never accept untrusted browser-supplied destinations or redirects.
 * Only the operator can configure the fixed host at startup.
 */
export function safeBridgeEndpoint(raw:string|undefined,allowDockerHost=false):string|null {
 if(!raw||raw.length>240)return null;
 try{
  const url=new URL(raw);
  if(url.protocol!=="http:"||url.username||url.password||url.search||url.hash
    ||(url.pathname!=="/"&&url.pathname!==""))return null;
  const allowed=url.hostname==="127.0.0.1"||url.hostname==="localhost"
    ||(allowDockerHost&&url.hostname==="host.docker.internal");
  return allowed?url.origin:null;
 }catch{return null;}
}

/** Strictly validate the receiver status: a delivery receipt is not approval or task completion. */
export function parseReceiverStatus(raw:unknown,id:string):"pending"|"approved"|"rejected"|null {
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null;
 const item=raw as Record<string,unknown>;
 if(item["id"]!==id)return null;
 return item["state"]==="pending"||item["state"]==="approved"||item["state"]==="rejected"?item["state"]:null;
}
