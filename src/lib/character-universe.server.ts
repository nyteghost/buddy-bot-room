import { createHash, randomUUID } from "node:crypto";
import { characterAssetResponse, hydrateCharacterAssets, persistCharacterAssets } from "./character-assets.server";
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
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Invalid Character Universe data");
  const source=data as Record<string,unknown>;
  const characters=cleanCustomCharacters(source['characters']);
  if(!Array.isArray(source['characters'])||source['characters'].length!==characters.length)throw Error("Invalid saved characters; refusing to overwrite");
  if(source["revision"]!==undefined&&(!Number.isSafeInteger(source["revision"])||Number(source["revision"])<0))throw Error("Invalid saved revision");
  const allowed=[...worldCharacterPacks.map(x=>x.id),...characters.map(x=>x.id)];
  return {revision:Number.isSafeInteger(source['revision'])&&Number(source['revision'])>=0?Number(source['revision']):0,characters,enabled:cleanEnabledWorldIds(source['enabled'],allowed)};
 }catch(e){if((e as {code?:string}).code==="ENOENT")return empty();throw e;}
}
async function save(value:Store, previous:Store){
 const f=await fs();
 await f.mkdir(dir(),{recursive:true,mode:0o700});
 const serialized=JSON.stringify(value);
 if(serialized.length>CUSTOM_WORLD_FILE_LIMIT)throw Error("Character metadata storage limit exceeded.");
 const history=dir()+"/character-history";
 await f.mkdir(history,{recursive:true,mode:0o700});
 const snapshot=JSON.stringify(previous);
 const hash=createHash("sha256").update(snapshot).digest("hex");
 try { await f.writeFile(history+"/"+previous.revision+"-"+hash+".json",snapshot,{mode:0o600,flag:"wx"}); }
 catch(error){if((error as {code?:string}).code!=="EEXIST")throw error;}
 const tmp=file()+".tmp-"+randomUUID();
 try{
  await f.writeFile(tmp,serialized,{encoding:"utf8",mode:0o600,flag:"wx"});
  await f.rename(tmp,file());
 }catch(e){await f.rm(tmp,{force:true}).catch(()=>undefined);throw e;}
}
const answer=(s:Store,status=200)=>Response.json({revision:s.revision,characters:s.characters,enabled:s.enabled},{status,headers:{"cache-control":"no-store"}});
export const CHARACTER_REQUEST_LIMIT=128*1024*1024;
async function readRequestBody(request:Request):Promise<string>{
 const advertised=request.headers.get("content-length");
 if(advertised&&Number(advertised)>CHARACTER_REQUEST_LIMIT)throw Error("Too large");
 if(!request.body)return "";
 const reader=request.body.getReader();
 const parts:Uint8Array[]=[];
 let length=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   length+=value.byteLength;
   if(length>CHARACTER_REQUEST_LIMIT){await reader.cancel();throw Error("Too large");}
   parts.push(value);
  }
 }finally{reader.releaseLock();}
 const combined=new Uint8Array(length);let offset=0;
 for(const part of parts){combined.set(part,offset);offset+=part.length;}
 return new TextDecoder("utf-8",{fatal:true}).decode(combined);
}
export async function handleCharacterUniverse(request:Request):Promise<Response>{
 const user=await currentUser(request);
 if(!user?.owner)return Response.json({error:"Only the owner may edit the Character Universe."},{status:403});
 if(!dir())return Response.json({error:"Persistent data volume is unavailable."},{status:503});
 if(request.method==="GET"){
  const params=new URL(request.url).searchParams;
  if(params.has("asset"))return characterAssetResponse(dir(),params.get("asset")??"");
  try{return await locked(async()=>{
   const current=await load();
   if(params.get("export")==="1")return Response.json({format:"pixel-pals-character-universe",version:1,
    characters:await hydrateCharacterAssets(dir(),current.characters)}, {headers:{"cache-control":"no-store"}});
   return answer(current);
  });}catch{return Response.json({error:"Character Universe could not be read. Existing data was preserved."},{status:500});}
 }
 if(request.method!=="POST")return new Response(null,{status:405});
 // Same-origin JSON only; never permit a browser form to change persistent data.
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return Response.json({error:"Cross-origin changes are not permitted."},{status:403});
 if(request.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")return Response.json({error:"JSON is required."},{status:415});
 let bodyText:string;
 try{bodyText=await readRequestBody(request);}catch{return Response.json({error:"Character pack request is too large or incomplete."},{status:413});}
 let payload:Record<string,unknown>;
 try{const value:unknown=JSON.parse(bodyText);if(!value||typeof value!=="object"||Array.isArray(value))throw Error("bad");payload=value as Record<string,unknown>;}catch{return Response.json({error:"Invalid request."},{status:400});}
 try{return await locked(async()=>{
  const current=await load();
  const previous=structuredClone(current);
  if(!Number.isSafeInteger(payload['expectedRevision'])||Number(payload['expectedRevision'])!==current.revision)
   return Response.json({error:"Character Universe changed on another device. Reload before editing.",...current},{status:409});
  if(payload['op']==="save"){
   const character=validateCustomCharacter(payload['character']);
   if(!character)return Response.json({error:"Invalid character artwork."},{status:400});
   if(character.hd3||current.characters.find(c=>c.id===character.id)?.hd3)
    return Response.json({error:"Use the reviewed pack installation or version update for HD characters."},{status:400});
   const others=current.characters.filter(x=>x.id!==character.id);
   if(others.length>=CUSTOM_WORLD_LIMIT)return Response.json({error:"Character Library is full."},{status:400});
   current.characters=[...others,character];
  }else if(payload['op']==="installPack"||payload['op']==="installBackup"){
   const input=payload['characters'];
   if(!Array.isArray(input)||input.length<1||input.length>(payload["op"]==="installBackup"?CUSTOM_WORLD_LIMIT:12))
    return Response.json({error:"The character selection exceeds the import limit."},{status:400});
   const entries=cleanCustomCharacters(input);
   if(entries.length!==input.length)return Response.json({error:"Invalid or duplicate characters in ZIP."},{status:400});
   if(current.characters.length+entries.length>CUSTOM_WORLD_LIMIT)
    return Response.json({error:"Character Library is full."},{status:400});
   if(entries.some(c=>current.characters.some(saved=>saved.id===c.id)))
    return Response.json({error:"A character from this ZIP is already installed. Existing art was not overwritten."},{status:409});
   current.characters=[...current.characters,...entries];
  }else if(payload['op']==="updatePack"){
   const input=payload['characters'];
   const expected=payload['expectedVersions'];
   if(!Array.isArray(input)||input.length<1||input.length>12||!expected||typeof expected!=="object"||Array.isArray(expected))
    return Response.json({error:"Select a versioned character update for review."},{status:400});
   const entries=cleanCustomCharacters(input);
   if(entries.length!==input.length||entries.some(c=>!c.hd3))return Response.json({error:"Invalid HD character update."},{status:400});
   for(const entry of entries){
    const prior=current.characters.find(c=>c.id===entry.id);
    const priorVersion=prior?.hd3?.version??0;
    if((!prior?.hd3&&!prior?.hd)||priorVersion!==(expected as Record<string,unknown>)[entry.id])
     return Response.json({error:"The installed character version changed. Review the update again."},{status:409});
    if(entry.hd3!.version<=priorVersion)return Response.json({error:"An update requires a newer character version."},{status:400});
   }
   const replacements=new Map(entries.map(c=>[c.id,c]));
   current.characters=current.characters.map(c=>replacements.get(c.id)??c);
  }else if(payload['op']==="delete"){
   const id=payload['id'];
   if(typeof id!=="string"||!current.characters.some(x=>x.id===id))return Response.json({error:"Character was not found."},{status:404});
   current.characters=current.characters.filter(x=>x.id!==id);
   current.enabled=current.enabled.filter(x=>x!==id);
  }else if(payload['op']==="setEnabled"){
   const ids=payload['ids'];
   if(!Array.isArray(ids)||ids.length>30)return Response.json({error:"Invalid guest selection."},{status:400});
   const allowed=[...worldCharacterPacks.map(x=>x.id),...current.characters.map(x=>x.id)];
   const cleaned=cleanEnabledWorldIds(ids,allowed);
   if(cleaned.length!==new Set(ids).size)return Response.json({error:"Unknown character or too many guests."},{status:400});
   current.enabled=cleaned;
  }else return Response.json({error:"Unsupported Character Universe action."},{status:400});
  current.revision+=1;
  current.characters=await persistCharacterAssets(dir(),current.characters);
  await save(current,previous);
  return answer(current);
 });}catch{return Response.json({error:"Character Library could not be saved. Existing data was preserved."},{status:500});}
}
