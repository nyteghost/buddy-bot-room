import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { currentUser } from "./accounts.server";
import {
 draftHandoff,receivedReceipt,safeBridgeEndpoint,transitionHandoff,
 type Handoff,type HandoffStatus,
} from "./adhd-bridge";

const directory=()=>process.env["BUDDY_DATA_DIR"]?.trim().replace(/\/+$/,"")||"";
const file=()=>directory()+"/adhd-bridge-outbox.json";
const enabled=()=>process.env["ADHD_BRIDGE_ENABLED"]==="1";
const endpoint=()=>safeBridgeEndpoint(process.env["ADHD_BRIDGE_PEER_URL"],process.env["ADHD_BRIDGE_ALLOW_DOCKER_HOST"]==="1");
const token=()=>process.env["ADHD_BRIDGE_PEER_TOKEN"]||"";
let chain:Promise<unknown>=Promise.resolve();
const locked=<T,>(task:()=>Promise<T>):Promise<T>=>{
 const next=chain.then(task,task);chain=next.catch(()=>undefined);return next;
};

async function load():Promise<Handoff[]> {
 try{
  const parsed:unknown=JSON.parse(await fs.readFile(file(),"utf8"));
  if(!Array.isArray(parsed)||parsed.length>200)throw Error("Invalid ADHD bridge outbox");
  if(!parsed.every((x:unknown)=>{
   if(!x||typeof x!=="object")return false;
   const r=x as Record<string,unknown>;
   return typeof r["id"]==="string"&&/^[A-Za-z0-9_-]{8,100}$/.test(r["id"])
    &&(r["kind"]==="task"||r["kind"]==="note")
    &&["draft","approved","delivered","cancelled"].includes(String(r["status"]))
    &&r["payload"]&&typeof r["payload"]==="object"&&!Array.isArray(r["payload"])
    &&typeof (r["payload"] as {title?:unknown}).title==="string"
    &&typeof r["createdAt"]==="string"&&typeof r["updatedAt"]==="string"
    &&Number.isSafeInteger(r["attempts"])&&Number(r["attempts"])>=0;
  }))throw Error("Invalid ADHD bridge records");
  return parsed as Handoff[];
 }catch(e){if((e as {code?:string}).code==="ENOENT")return [];throw e;}
}

async function save(rows:Handoff[]):Promise<void>{
 const root=directory();if(!root)throw Error("Persistent data volume required");
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const tmp=file()+"."+randomUUID()+".tmp";
 try{
  await fs.writeFile(tmp,JSON.stringify(rows),{mode:0o600,flag:"wx"});
  await fs.rename(tmp,file());
 }finally{await fs.rm(tmp,{force:true}).catch(()=>undefined);}
}
const noStore={"cache-control":"no-store"};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:noStore});
function settings(){
 return {enabled:enabled(),configured:!!endpoint()&&token().length>=24,
  transport:"manual",protocol:"adhd-bridge/1"};
}

/** Browser API; cookie owner only, never callable by an imported character script. */
export async function handleAdhdBridge(request:Request):Promise<Response>{
 const owner=await currentUser(request);
 if(!owner?.owner)return reply({error:"Only the Pixel Pals owner can use ADHD handoffs."},403);
 if(!directory())return reply({error:"Persistent data directory unavailable."},503);
 if(request.method==="GET"){
  try{return reply({...settings(),items:await locked(load)});}
  catch{return reply({error:"Could not read the handoff outbox; no data was overwritten."},500);}
 }
 if(request.method!=="POST")return reply({error:"Method not allowed"},405);
 if(request.headers.get("sec-fetch-site")==="cross-site")return reply({error:"Cross-site request rejected"},403);
 if(!request.headers.get("content-type")?.includes("application/json"))return reply({error:"JSON required"},415);
 const raw=await request.text();
 if(raw.length>8000)return reply({error:"Request too large"},413);
 let body:Record<string,unknown>;
 try{
  const parsed:unknown=JSON.parse(raw);
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error();
  body=parsed as Record<string,unknown>;
 }catch{return reply({error:"Invalid JSON"},400);}
 const action=body["action"];
 if(action!=="draft"&&action!=="approve"&&action!=="cancel"&&action!=="send")return reply({error:"Unknown action"},400);
 if(action==="send"&&(!enabled()||!endpoint()||token().length<24))return reply({error:"Bridge is not configured and enabled."},503);
 try{
  return await locked(async()=>{
   const rows=await load();
   const now=new Date().toISOString();
   if(action==="draft"){
    if(rows.length>=200)throw Error("Handoff outbox is full; archive old records first");
    const draft=draftHandoff(body["handoff"],randomUUID(),now);
    rows.unshift(draft);await save(rows);
    return reply({item:draft},201);
   }
   const id=body["id"];
   if(typeof id!=="string")throw Error("Handoff ID required");
   const i=rows.findIndex(x=>x.id===id);
   if(i<0)throw Error("Unknown handoff ID");
   const item=rows[i]!;
   if(action==="approve"||action==="cancel"){
    const updated=transitionHandoff(item,action,now);
    rows[i]=updated;await save(rows);
    return reply({item:updated});
   }
   if(item.status!=="approved")throw Error("Only explicitly approved handoffs may be sent");
   let ok=false;let error="Delivery unavailable";
   try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),4500);
    try{
     const resp=await fetch(endpoint()!+"/bridge/v1/messages",{
      method:"POST",redirect:"manual",signal:controller.signal,
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+token()},
      body:JSON.stringify({id:item.id,kind:item.kind,payload:item.payload}),
     });
     if(resp.status===202){
      const receipt:unknown=await resp.json();
      if(receivedReceipt(receipt,item.id))ok=true;
      else error="Invalid receiver acknowledgment";
     }else error="Receiver did not accept delivery ("+resp.status+")";
    }finally{clearTimeout(timeout);}
   }catch{error="Peer unavailable or timed out";}
   const updated:Handoff={...item,attempts:item.attempts+1,updatedAt:now,
    ...(ok?{status:"delivered" as HandoffStatus,receipt:"Receiver acknowledged delivery; task awaits approval"}
         :{lastError:error})};
   rows[i]=updated;await save(rows);
   return reply({item:updated,delivered:ok},ok?200:503);
  });
 }catch(e){return reply({error:e instanceof Error?e.message:"Handoff action failed"},400);}
}
