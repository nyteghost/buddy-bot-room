import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { SECOND_BRAIN_CATEGORIES, brainRelativePath, searchBrainNotes, type BrainNote } from "./second-brain";
const fs=async()=>await import("node:fs/promises");
const root=()=>process.env["OBSIDIAN_VAULT_DIR"]?.trim().replace(/\/+$/,"")??"";
const dirs=()=>SECOND_BRAIN_CATEGORIES;
const validCategory=(x:unknown)=>typeof x==="string"&&dirs().some(c=>c===x);
const response=(x:unknown,status=200)=>Response.json(x,{status,headers:{"Cache-Control":"no-store"}});
const uid=/^[a-zA-Z0-9_-]{1,64}$/;
function validNote(v:unknown):v is BrainNote{
 if(!v||typeof v!=="object")return false;
 const n=v as BrainNote;
 return uid.test(n.id)&&validCategory(n.category)&&typeof n.title==="string"&&!!n.title.trim()&&n.title.length<=100&&typeof n.body==="string"&&n.body.length<=4000&&typeof n.createdAt==="string"&&typeof n.updatedAt==="string"&&Array.isArray(n.tags)&&n.tags.length<=15&&n.tags.every(t=>typeof t==="string"&&t.length<=40)&&["user-confirmed","explicit-save","task-progress"].includes(n.source);
}
const stringify=(n:BrainNote)=>"---\ntype: pixel-pals-second-brain\nid: "+n.id+"\ncategory: "+JSON.stringify(n.category)+"\ncreated: "+JSON.stringify(n.createdAt)+"\nupdated: "+JSON.stringify(n.updatedAt)+"\nsource: "+JSON.stringify(n.source)+"\ntags: "+JSON.stringify(n.tags)+"\n---\n# "+n.title.replace(/[\r\n]/g," ")+"\n\n"+n.body+"\n";
async function load(base:string):Promise<BrainNote[]>{
 const f=await fs();const baseReal=await f.realpath(base);const notes:BrainNote[]=[];
 for(const cat of dirs()){
  const dir=base+"/PixelPals/"+cat;
  let names:string[];try{names=await f.readdir(dir);}catch(e){if((e as {code?:string}).code==="ENOENT")continue;throw e;}
  for(const name of names.slice(0,300)){
   if(!/^[^/\\]+--[a-zA-Z0-9_-]{1,64}\.md$/.test(name))continue;
   const p=dir+"/"+name;const st=await f.lstat(p);if(!st.isFile()||st.size>15000)continue;
   const resolved=await f.realpath(p);if(!resolved.startsWith(baseReal+"/PixelPals/"))continue;
   const text=await f.readFile(p,"utf8");
   const id=/^id: ([a-zA-Z0-9_-]+)$/m.exec(text)?.[1];const title=/^# (.+)$/m.exec(text)?.[1];
   const created=/^created: (.+)$/m.exec(text)?.[1];const updated=/^updated: (.+)$/m.exec(text)?.[1];const source=/^source: (.+)$/m.exec(text)?.[1];const tags=/^tags: (.+)$/m.exec(text)?.[1];
   const body=text.split("\n---\n").slice(1).join("\n---\n").replace(/^# [^\n]+\n+/,"").trim();
   let note:unknown;
   try{note={id,category:cat,title,body,createdAt:JSON.parse(created??'""'),updatedAt:JSON.parse(updated??'""'),source:JSON.parse(source??'""'),tags:JSON.parse(tags??"[]")};}catch{continue;}
   if(validNote(note))notes.push(note);
   if(notes.length>=200)return notes;
  }
 }
 return notes;
}
async function safeFile(base:string,rel:string,creation:boolean):Promise<string>{
 const f=await fs();const realBase=await f.realpath(base);const full=base+"/"+rel;const parent=full.slice(0,full.lastIndexOf("/"));
 if(creation)await f.mkdir(parent,{recursive:true});
 const realParent=await f.realpath(parent);
 if(!realParent.startsWith(realBase+"/PixelPals/"))throw Error("Unsafe vault path");
 if(!creation){const st=await f.lstat(full);if(!st.isFile())throw Error("Not a note");const real=await f.realpath(full);if(!real.startsWith(realBase+"/PixelPals/"))throw Error("Unsafe note");}
 return full;
}
let chain:Promise<unknown>=Promise.resolve();
function locked<T>(fn:()=>Promise<T>):Promise<T>{const p=chain.then(fn,fn);chain=p.catch(()=>undefined);return p;}
export async function handleSecondBrain(req:Request):Promise<Response>{
 if(!root())return response({configured:false,notes:[]},404);
 const user=accountsEnabled(process.env)?await currentUser(req):null;
 if(accountsEnabled(process.env)&&!user?.owner)return response({error:"Owner only"},403);
 try{
  const f=await fs();await f.access(root());const notes=await load(root());
  if(req.method==="GET"){
   const q=new URL(req.url).searchParams.get("q")??"";
   return response({configured:true,notes:q?searchBrainNotes(q,notes,10):notes});
  }
  if(req.method!=="POST")return response({error:"Unsupported"},405);
  const raw=await req.text();if(raw.length>12000)return response({error:"Request too large"},413);
  const data=JSON.parse(raw) as {op?:string;note?:unknown;id?:string;revision?:string};
  return await locked(async()=>{
   const current=await load(root());
   if(data.op==="save"&&validNote(data.note)){
    const n=data.note;const existing=current.find(x=>x.id===n.id);
    if(existing&&data.revision!==existing.updatedAt)return response({error:"Note changed. Refresh before editing."},409);
    if(!existing&&current.length>=200)return response({error:"Note limit reached"},413);
    if(existing&&brainRelativePath(existing)!==brainRelativePath(n))return response({error:"Changing an existing note's path is not supported"},400);
    const p=await safeFile(root(),brainRelativePath(n),!existing);
    const next={...n,updatedAt:new Date().toISOString()};
    await f.writeFile(p+".tmp",stringify(next),{encoding:"utf8",mode:0o600});
    await f.rename(p+".tmp",p);
    return response({ok:true,note:next});
   }
   if(data.op==="trash"&&typeof data.id==="string"){
    const note=current.find(x=>x.id===data.id);
    if(!note)return response({error:"Note not found"},404);
    if(data.revision!==note.updatedAt)return response({error:"Note changed. Refresh before deleting."},409);
    const p=await safeFile(root(),brainRelativePath(note),false);
    const trash=root()+"/.trash";await f.mkdir(trash,{recursive:true});
    await f.rename(p,trash+"/"+note.id+"-"+Date.now()+".md");return response({ok:true});
   }
   return response({error:"Invalid request"},400);
  });
 }catch(e){return response({error:e instanceof Error?e.message:"Vault unavailable"},500);}
}
