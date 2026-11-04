import { currentUser } from "./accounts.server";
import { cleanCustomCharacters,cleanEnabledWorldIds,CUSTOM_WORLD_FILE_LIMIT,CUSTOM_WORLD_LIMIT,validateCustomCharacter,type WorldCustomCharacter } from "./world-custom-packs";
import { worldCharacterPacks } from "./world-character-packs";

/** Owner-only durable Character Universe settings; BUDDY_DATA_DIR is an existing persistent volume. */
type Store={revision:number;characters:WorldCustomCharacter[];enabled:string[]};
const empty=():Store=>({revision:0,characters:[],enabled:["green-jacket"]});
const dir=()=>process.env["BUDDY_DATA_DIR"]?.trim().replace(/\/+$/,"")??"";
const file=()=>dir()+"/character-universe.json";
async function fs(){return (await import(/* @vite-ignore */ "node:"+"fs/promises")) as typeof import("node:fs/promises");}
let queue:Promise<unknown>=Promise.resolve();
function locked<T>(fn:()=>Promise<T>):Promise<T>{
 const task=queue.then(fn,fn);queue=task.catch(()=>undefined);return task;
}
async function load():Promise<Store>{
 try{
  const data:unknown=JSON.parse(await (await fs()).readFile(file(),"utf8"));
  if(!data||typeof data!=="object"||Array.isArray(data))return empty();
  const source=data as Record<string,unknown>;
  const characters=cleanCustomCharacters(source.characters);
  if(!Array.isArray(source.characters)||source.characters.length!==characters.length)return empty();
  const allowed=[...worldCharacterPacks.map(x=>x.id),...characters.map(x=>x.id)];
  return {revision:Number.isSafeInteger(source.revision)&&Number(source.revision)>=0?Number(source.revision):0,characters,enabled:cleanEnabledWorldIds(source.enabled,allowed)};
 }catch(e){if((e as {code?:string}).code==="ENOENT")return empty();throw e;}
}
async function save(value:Store){
 const f=await fs();
 await f.mkdir(dir(),{recursive:true,mode:0o700});
 const tmp=file()+".tmp-"+crypto.randomUUID();
 try{
  await f.writeFile(tmp,JSON.stringify(value),{encoding:"utf8",mode:0o600,flag:"wx"});
  await f.rename(tmp,file());
 }catch(e){await f.rm(tmp,{force:true}).catch(()=>undefined);throw e;}
}
const answer=(s:Store,status=200)=>Response.json({revision:s.revision,characters:s.characters,enabled:s.enabled},{status,headers:{"cache-control":"no-store"}});
export async function handleCharacterUniverse(request:Request):Promise<Response>{
 const user=await currentUser(request);
 if(!user?.owner)return Response.json({error:"Only the owner may edit the Character Universe."},{status:403});
 if(!dir())return Response.json({error:"Persistent data volume is unavailable."},{status:503});
 if(request.method==="GET")return answer(await locked(load));
 if(request.method!=="POST")return new Response(null,{status:405});
 // Same-origin JSON only; never permit a browser form to change persistent data.
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"Cross-origin changes are not permitted."},{status:403});
 if(request.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")return Response.json({error:"JSON is required."},{status:415});
 const bodyText=await request.text();
 if(bodyText.length>CUSTOM_WORLD_FILE_LIMIT)return Response.json({error:"Character pack request is too large."},{status:413});
 let payload:Record<string,unknown>;
 try{const value:unknown=JSON.parse(bodyText);if(!value||typeof value!=="object"||Array.isArray(value))throw Error("bad");payload=value as Record<string,unknown>;}catch{return Response.json({error:"Invalid request."},{status:400});}
 return locked(async()=>{
  const current=await load();
  if(!Number.isSafeInteger(payload.expectedRevision)||Number(payload.expectedRevision)!==current.revision)
   return Response.json({error:"Character Universe changed on another device. Reload before editing.",...current},{status:409});
  if(payload.op==="save"){
   const character=validateCustomCharacter(payload.character);
   if(!character)return Response.json({error:"Character must contain safe 32x32 pixel data and a hex palette."},{status:400});
   const others=current.characters.filter(x=>x.id!==character.id);
   if(others.length>=CUSTOM_WORLD_LIMIT)return Response.json({error:"Character Library is full."},{status:400});
   current.characters=[...others,character];
  }else if(payload.op==="delete"){
   const id=payload.id;
   if(typeof id!=="string"||!current.characters.some(x=>x.id===id))return Response.json({error:"Character was not found."},{status:404});
   current.characters=current.characters.filter(x=>x.id!==id);
   current.enabled=current.enabled.filter(x=>x!==id);
  }else if(payload.op==="setEnabled"){
   const ids=payload.ids;
   if(!Array.isArray(ids)||ids.length>30)return Response.json({error:"Invalid guest selection."},{status:400});
   const allowed=[...worldCharacterPacks.map(x=>x.id),...current.characters.map(x=>x.id)];
   const cleaned=cleanEnabledWorldIds(ids,allowed);
   if(cleaned.length!==new Set(ids).size)return Response.json({error:"Unknown character or too many guests."},{status:400});
   current.enabled=cleaned;
  }else return Response.json({error:"Unsupported Character Universe action."},{status:400});
  current.revision+=1;
  await save(current);
  return answer(current);
 });
}
