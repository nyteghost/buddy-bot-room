import { WORLD_HD_DIRECTIONS, WORLD_HD_ACTIONS, WORLD_HD_MAX_CLIP_FRAMES, WORLD_HD_MAX_FRAMES, validWorldHdPng } from "./world-hd";
import { CHARACTER_ADDON_FORMAT,parseCharacterAddonManifest } from "./character-addon";
import { starterCustomCharacter,validateCustomCharacter,validHdPngUrl,CUSTOM_WORLD_PACK_LIMIT,type WorldCustomCharacter } from "./world-custom-packs";

/** Browser-only, data-only ZIP reader. No file is extracted to disk or executed. */
export const CHARACTER_ZIP_MAX_BYTES=64*1024*1024;
const MAX_UNPACKED_BYTES=96*1024*1024;
const MAX_ASSET_BYTES=520_000;
const MAX_ENTRIES=2048;
const filename=(s:string)=>s.length<=160&&!s.startsWith("/")&&!s.includes("\\")
 &&s.split("/").every(part=>part.length>0&&part!=="."&&part!==".."&&/^[a-zA-Z0-9._ -]+$/.test(part));
const table=Array.from({length:256},(_,n)=>{
 let v=n;for(let i=0;i<8;i++)v=v&1?0xedb88320^(v>>>1):v>>>1;return v>>>0;
});
function crc32(bytes:Uint8Array):number{
 let c=0xffffffff;for(const n of bytes)c=table[(c^n)&255]!^(c>>>8);return (c^0xffffffff)>>>0;
}
function read32(v:DataView,p:number){return v.getUint32(p,true);}
function read16(v:DataView,p:number){return v.getUint16(p,true);}
function requireRange(start:number,size:number,total:number){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(size)||start<0||size<0||start+size>total)throw Error("Damaged character ZIP.");
}
function decodeName(bytes:Uint8Array):string{
 const name=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
 if(!filename(name)&&!(name.endsWith("/")&&filename(name.slice(0,-1))))throw Error("The ZIP contains an unsafe file path.");
 return name;
}
async function deflate(input:Uint8Array,limit:number):Promise<Uint8Array>{
 if(typeof DecompressionStream==="undefined")throw Error("This browser cannot unpack compressed ZIP files.");
 const inputBuffer=input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength) as ArrayBuffer;
 const inputStream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(inputBuffer));controller.close();}});
 const stream=inputStream.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array,Uint8Array>);
 const reader=stream.getReader();const parts:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>limit)throw Error("Character ZIP expands beyond its safe size limit.");
   parts.push(value);
  }
 }catch(error){await reader.cancel().catch(()=>undefined);throw error;}finally{reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}
 return out;
}
async function zipEntries(source:Blob):Promise<Map<string,Uint8Array>>{
 if(source.size<22||source.size>CHARACTER_ZIP_MAX_BYTES)throw Error("Choose a character ZIP up to 64 MiB.");
 const bytes=new Uint8Array(await source.arrayBuffer());
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)
  if(read32(v,p)===0x06054b50&&p+22+read16(v,p+20)===bytes.length){end=p;break;}
 if(end<0||read16(v,end+4)!==0||read16(v,end+6)!==0)throw Error("Not a supported single-disk ZIP file.");
 const count=read16(v,end+10),size=read32(v,end+12),start=read32(v,end+16);
 if(!count||count>MAX_ENTRIES||count!==read16(v,end+8)||size===0xffffffff||start===0xffffffff)throw Error("Unsupported or oversized character ZIP.");
 requireRange(start,size,end);
 let cursor=start,unpacked=0;const occupied:{start:number;end:number}[]=[];const seen=new Set<string>();const result=new Map<string,Uint8Array>();
 for(let i=0;i<count;i++){
  requireRange(cursor,46,start+size);
  if(read32(v,cursor)!==0x02014b50)throw Error("Invalid character ZIP index.");
  const flags=read16(v,cursor+8),method=read16(v,cursor+10),crc=read32(v,cursor+16);
  const compressed=read32(v,cursor+20),original=read32(v,cursor+24);
  const nameLen=read16(v,cursor+28),extraLen=read16(v,cursor+30),commentLen=read16(v,cursor+32);
  const localOffset=read32(v,cursor+42);
  requireRange(cursor+46,nameLen+extraLen+commentLen,start+size);
  const name=decodeName(bytes.subarray(cursor+46,cursor+46+nameLen));
  cursor+=46+nameLen+extraLen+commentLen;
  if((flags&~0x0808)!==0||![0,8].includes(method)||compressed===0xffffffff||original===0xffffffff)
   throw Error("Encrypted or unsupported ZIP entry.");
  if(seen.has(name))throw Error("The ZIP contains duplicate file names.");
  seen.add(name);
  if(name.endsWith("/")){if(original||compressed)throw Error("Invalid ZIP directory entry.");continue;}
  if(!/\.(png|json|txt|md)$/i.test(name))throw Error("Character packs may contain only PNG art and data files.");
  if(original>MAX_ASSET_BYTES&&name!=="character-pack.json"&&name!=="manifest.json")
   throw Error("An image in the ZIP is too large.");
  if((name==="character-pack.json"||name==="manifest.json")&&original>1024*1024)throw Error("Character pack manifest is too large.");
  unpacked+=original;if(unpacked>MAX_UNPACKED_BYTES)throw Error("Character ZIP contains too much data.");
  requireRange(localOffset,30,start);
  if(read32(v,localOffset)!==0x04034b50||read16(v,localOffset+8)!==method||read16(v,localOffset+6)!==flags)
   throw Error("ZIP entry headers do not match.");
  const localNameLen=read16(v,localOffset+26),localExtraLen=read16(v,localOffset+28);
  requireRange(localOffset+30,localNameLen+localExtraLen+compressed,start);
  const entryEnd=localOffset+30+localNameLen+localExtraLen+compressed;
  if(occupied.some(range=>localOffset<range.end&&entryEnd>range.start))throw Error("Overlapping ZIP entries.");
  occupied.push({start:localOffset,end:entryEnd});
  const localName=decodeName(bytes.subarray(localOffset+30,localOffset+30+localNameLen));
  if(localName!==name)throw Error("ZIP entry name mismatch.");
  const dataStart=localOffset+30+localNameLen+localExtraLen;
  const raw=bytes.subarray(dataStart,dataStart+compressed);
  const output=method===0?new Uint8Array(raw):await deflate(raw,Math.min(original,MAX_UNPACKED_BYTES));
  if(output.byteLength!==original||crc32(output)!==crc)throw Error("Corrupt character ZIP entry.");
  result.set(name,output);
 }
 if(cursor!==start+size)throw Error("Invalid ZIP index length.");
 return result;
}
function b64(bytes:Uint8Array):string{
 const out:string[]=[];const chunk=24576;
 for(let at=0;at<bytes.length;at+=chunk){
  let text="";for(const n of bytes.subarray(at,at+chunk))text+=String.fromCharCode(n);
  out.push(btoa(text));
 }
 return out.join("");
}
type SourceCharacter={id?:unknown;name?:unknown;sprites?:unknown};
function hdCharacter(raw:unknown,files:Map<string,Uint8Array>):WorldCustomCharacter{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid character definition.");
 const c=raw as SourceCharacter;
 if(Object.keys(c).some(k=>!["id","name","sprites"].includes(k)))throw Error("Unknown character setting.");
 if(!c.sprites||typeof c.sprites!=="object"||Array.isArray(c.sprites))throw Error("Missing character sprite files.");
 const sprites=c.sprites as Record<string,unknown>,frames:Record<string,string[]>={};
 if(Object.keys(sprites).some(k=>!["idle","walk","wave","celebrate"].includes(k)))throw Error("Unsupported character animation.");
 for(const action of ["idle","walk","wave","celebrate"]){
  const source=sprites[action];if(source===undefined){if(action==="idle")throw Error("An idle sprite is required.");continue;}
  const names=typeof source==="string"?[source]:source;
  if(!Array.isArray(names)||names.length<1||names.length>(action==="idle"?1:8)||names.some(n=>typeof n!=="string"))throw Error("Invalid animation frames.");
  frames[action]=names.map(name=>{
   if(!filename(name))throw Error("Invalid sprite file path.");
   const bytes=files.get(name);
   if(!bytes||!name.toLowerCase().endsWith(".png"))throw Error("Missing PNG frame: "+name);
   const value="data:image/png;base64,"+b64(bytes);
   if(!validHdPngUrl(value))throw Error("Every frame must be a valid 256x256 PNG image.");
   return value;
  });
 }
 const fallback=starterCustomCharacter();
 const candidate={...fallback,id:c["id"],name:c["name"],hd:{resolution:256,...frames}};
 const validated=validateCustomCharacter(candidate);
 if(!validated)throw Error("Invalid character name, ID or oversized HD animation frames.");
 return validated;
}
function directionalCharacter(raw:unknown,files:Map<string,Uint8Array>,cache:Map<string,string>):WorldCustomCharacter{
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid HD character definition.");
 const c=raw as Record<string,unknown>;
 if(Object.keys(c).some(key=>!["id","name","resolution","revision","artStatus","description","movement","height","directions"].includes(key))||c["resolution"]!==256)
  throw Error("Unsupported HD character metadata or resolution.");
 if(!c["directions"]||typeof c["directions"]!=="object"||Array.isArray(c["directions"]))throw Error("HD character directions are required.");
 const directions:Record<string,unknown>={};
 let frameCount=0;
 for(const [direction,value] of Object.entries(c["directions"])){
  if(!WORLD_HD_DIRECTIONS.includes(direction as typeof WORLD_HD_DIRECTIONS[number])||!value||typeof value!=="object"||Array.isArray(value))throw Error("Unsupported HD facing direction.");
  const actions:Record<string,unknown>={};
  for(const [action,rawClip] of Object.entries(value)){
   if(!WORLD_HD_ACTIONS.includes(action as typeof WORLD_HD_ACTIONS[number])||!rawClip||typeof rawClip!=="object"||Array.isArray(rawClip))throw Error("Unsupported HD animation action.");
   const clip=rawClip as Record<string,unknown>;
   if(Object.keys(clip).some(key=>!["frames","loop"].includes(key))||typeof clip["loop"]!=="boolean"||!Array.isArray(clip["frames"])||clip["frames"].length<1||clip["frames"].length>WORLD_HD_MAX_CLIP_FRAMES)
    throw Error("Invalid HD animation clip.");
   const frames=clip["frames"].map(rawFrame=>{
    if(!rawFrame||typeof rawFrame!=="object"||Array.isArray(rawFrame))throw Error("Invalid HD animation frame.");
    const frame=rawFrame as Record<string,unknown>;
    if(Object.keys(frame).some(key=>!["file","durationMs"].includes(key))||typeof frame["file"]!=="string"||!filename(frame["file"])||!frame["file"].toLowerCase().endsWith(".png"))
     throw Error("Invalid HD PNG frame path.");
    if(!Number.isSafeInteger(frame["durationMs"])||Number(frame["durationMs"])<40||Number(frame["durationMs"])>10_000)throw Error("Frame duration must be 40–10000 milliseconds.");
    if(++frameCount>WORLD_HD_MAX_FRAMES)throw Error("HD character has too many frames.");
    let src=cache.get(frame["file"]);
    if(!src){
     const bytes=files.get(frame["file"]);
     if(!bytes||!validWorldHdPng(bytes))throw Error("HD frames must be complete 256x256 PNGs with transparency support.");
     src="data:image/png;base64,"+b64(bytes);cache.set(frame["file"],src);
    }
    return {src,durationMs:frame["durationMs"]};
   });
   actions[action]={frames,loop:clip["loop"]};
  }
  directions[direction]=actions;
 }
 const candidate={...starterCustomCharacter(),id:c["id"],name:c["name"],hd3:{version:c["revision"],artStatus:c["artStatus"],movement:c["movement"],...(c["height"]===undefined?{}:{height:c["height"]}),directions,...(c["description"]===undefined?{}:{description:c["description"]})}};
 const validated=validateCustomCharacter(candidate);
 if(!validated)throw Error("Invalid HD character metadata, missing front idle, or excessive animation data.");
 return validated;
}
export type ImportedCharacterZip={name:string;characters:WorldCustomCharacter[]};
export async function parseCharacterZip(file:Blob):Promise<ImportedCharacterZip>{
 const entries=await zipEntries(file);
 const manifest=entries.get("character-pack.json")??entries.get("manifest.json");
 if(!manifest)throw Error("The ZIP needs a character-pack.json manifest.");
 let data:unknown;
 try{data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(manifest));}
 catch{throw Error("The character-pack.json file is not valid JSON.");}
 if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Invalid character pack.");
 const root=data as Record<string,unknown>;
 if(root["version"]===1){
  const legacy=parseCharacterAddonManifest(data);
  return {name:legacy.name,characters:legacy.characters};
 }
 if(root["format"]!==CHARACTER_ADDON_FORMAT||(root["version"]!==2&&root["version"]!==3)
  ||Object.keys(root).some(k=>!["format","version","name","description","characters"].includes(k)))
  throw Error("Unsupported character ZIP format.");
 if(typeof root["name"]!=="string"||root["name"].trim().length<2||root["name"].length>72||/[<>]/.test(root["name"]))
  throw Error("Invalid character pack name.");
 if(!Array.isArray(root["characters"])||root["characters"].length<1||root["characters"].length>CUSTOM_WORLD_PACK_LIMIT)
  throw Error("A pack must contain 1 to 12 characters.");
 const cache=new Map<string,string>();
 const characters=root["characters"].map(entry=>root["version"]===3?directionalCharacter(entry,entries,cache):hdCharacter(entry,entries));
 if(new Set(characters.map(c=>c["id"])).size!==characters.length)throw Error("Duplicate character IDs in ZIP.");
 return {name:root["name"].trim(),characters};
}
