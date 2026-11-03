import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { currentUser } from "./accounts.server";
import { completedMeetingSources } from "./meeting-vault.server";
import { reviewedMeetingForThread } from "./meeting-review.server";
import { meetingId } from "./meeting-vault";
import {
  matchingExcerpt, parseThreadInput, validMeetingThreadLink,
  type MeetingThreadLink, type MeetingThreadHit,
} from "./meeting-threads";

const root = () => (process.env["BUDDY_DATA_DIR"]??"").trim().replace(/\/+$/,"");
const filepath = () => join(root(),"meeting-vault","threads.json");
const response=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
let chain:Promise<unknown>=Promise.resolve();
const locked=<T,>(cb:()=>Promise<T>):Promise<T>=>{
  const action=chain.then(cb,cb);chain=action.catch(()=>undefined);return action;
};
async function readLinks():Promise<MeetingThreadLink[]>{
  try{
    const st=await lstat(filepath());
    if(!st.isFile()||st.isSymbolicLink()||st.size>30000)throw Error("Meeting Threads index needs repair");
    const raw:unknown=JSON.parse(await readFile(filepath(),"utf8"));
    if(!Array.isArray(raw)||raw.length>40||!raw.every(validMeetingThreadLink)||
       new Set(raw.map((x:MeetingThreadLink)=>x.meetingId)).size!==raw.length)
      throw Error("Meeting Threads index needs repair");
    return raw;
  }catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return [];
    throw e;
  }
}
async function writeLinks(links:MeetingThreadLink[]):Promise<void>{
  if(links.length>40||!links.every(validMeetingThreadLink))throw Error("Invalid Meeting Threads index");
  const path=filepath();
  const temporary=path+"."+randomUUID()+".tmp";
  await mkdir(join(root(),"meeting-vault"),{recursive:true,mode:0o700});
  try{
    await writeFile(temporary,JSON.stringify(links,null,2),{flag:"wx",mode:0o600});
    await rename(temporary,path);await chmod(path,0o600);
  }finally{await rm(temporary,{force:true}).catch(()=>undefined);}
}
async function visibleMeetings(q:string):Promise<MeetingThreadHit[]>{
  const sources=await completedMeetingSources();
  const links=await readLinks();
  const linkById=new Map(links.map(x=>[x.meetingId,x]));
  const hits:MeetingThreadHit[]=[];
  for(const original of sources){
    const review=await reviewedMeetingForThread(original.id);
    if(!review)continue; // Only approved notes, never raw unreviewed drafts.
    const excerpt=matchingExcerpt(q,original.title,review.summary,review.transcript);
    if(excerpt===null)continue;
    const link=linkById.get(original.id);
    hits.push({
      meetingId:original.id,title:original.title,reviewedAt:review.approvedAt,
      thread:link?.thread??"",project:link?.project??"",linkRevision:link?.revision??0,
      excerpt,summary:review.summary.slice(0,1500),originalSha256:original.sha256,
    });
  }
  return hits.sort((a,b)=>b.reviewedAt.localeCompare(a.reviewedAt));
}
/** User-initiated, owner-scoped Meeting Threads: no model-generated links or memory writes. */
export async function handleMeetingThreads(request:Request):Promise<Response>{
  const user=await currentUser(request);
  if(!user?.owner)return response({error:"Meeting Threads is owner-only."},403);
  if(!root())return response({error:"Meeting Threads requires the private Unraid data directory."},503);
  try{
    if(request.method==="GET"){
      const q=new URL(request.url).searchParams.get("q")??"";
      if(q.length>100)return response({error:"Search query is too long."},400);
      return response({items:await locked(()=>visibleMeetings(q.trim()))});
    }
    if(request.method!=="POST")return new Response(null,{status:405});
    const body=await request.json().catch(()=>({})) as Record<string,unknown>;
    const id=typeof body["id"]==="string"?body["id"]:"";
    const revision=body["revision"];
    if(!meetingId(id)||typeof revision!=="number"||!Number.isSafeInteger(revision)||revision<0)
      return response({error:"Invalid meeting or revision."},400);
    const op=body["op"];
    if(op!=="link"&&op!=="unlink")return response({error:"Unknown Meeting Threads operation."},400);
    if(op==="link"){
      const accepted=parseThreadInput(body["thread"],body["project"]);
      if(!accepted)return response({error:"Choose a thread name (80 characters max) and an optional simple project label."},400);
      if(!(await reviewedMeetingForThread(id)))return response({error:"Review and approve the meeting before linking it."},409);
      if(!(await completedMeetingSources()).some(x=>x.id===id))
        return response({error:"Original meeting recording was not found."},404);
      return locked(async()=>{
        const links=await readLinks();
        const existing=links.find(x=>x.meetingId===id);
        if((existing?.revision??0)!==revision)return response({error:"Meeting link changed elsewhere; refresh."},409);
        if(!existing&&links.length>=40)return response({error:"Too many linked meetings; remove old links first."},409);
        const now=new Date().toISOString();
        const next:MeetingThreadLink={meetingId:id,thread:accepted.thread,project:accepted.project,
          revision:revision+1,source:"owner-reviewed",linkedAt:existing?.linkedAt??now,updatedAt:now};
        if(existing)links.splice(links.indexOf(existing),1,next);
        else links.push(next);
        await writeLinks(links);
        return response({link:next});
      });
    }
    return locked(async()=>{
      const links=await readLinks();
      const existing=links.find(x=>x.meetingId===id);
      if(!existing||existing.revision!==revision)
        return response({error:"Link changed elsewhere; refresh."},409);
      links.splice(links.indexOf(existing),1);
      await writeLinks(links);
      return response({ok:true});
    });
  }catch{
    return response({error:"Meeting Threads could not safely read or save its private index."},500);
  }
}
