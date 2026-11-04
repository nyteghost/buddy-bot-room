import { CHARACTER_ADDON_FORMAT,parseCharacterAddonManifest } from "./character-addon";
import { starterCustomCharacter,validateCustomCharacter,validHdPngUrl,CUSTOM_WORLD_LIMIT,type WorldCustomCharacter } from "./world-custom-packs";

/** Browser-only, data-only ZIP reader. No file is extracted to disk or executed. */
export const CHARACTER_ZIP_MAX_BYTES=8*1024*1024;
const MAX_UNPACKED_BYTES=16*1024*1024;
const MAX_ASSET_BYTES=520_000;
const MAX_ENTRIES=80;
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
 const stream=new Blob([inputBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
 const reader=stream.getReader();const parts:Uint8Array[]=[];let size=0;
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   size+=value.byteLength;if(size>limit)throw Error("Character ZIP expands beyond its safe size limit.");
   parts.push(value);
  }
 }finally{reader.releaseLock();}
 const out=new Uint8Array(size);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}
 return out;
}
async function zipEntries(source:Blob):Promise<Map<string,Uint8Array>>{
 if(source.size<22||source.size>CHARACTER_ZIP_MAX_BYTES)throw Error("Choose a character ZIP smaller than 8 MB.");
 const bytes=new Uint8Array(await source.arrayBuffer());
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)
  if(read32(v,p)===0x06054b50&&p+22+read16(v,p+20)===bytes.length){end=p;break;}
 if(end<0||read16(v,end+4)!==0||read16(v,end+6)!==0)throw Error("Not a supported single-disk ZIP file.");
 const count=read16(v,end+10),size=read32(v,end+12),start=read32(v,end+16);
 if(!count||count>MAX_ENTRIES||count!==read16(v,end+8)||size===0xffffffff||start===0xffffffff)throw Error("Unsupported or oversized character ZIP.");
 requireRange(start,size,end);
 let cursor=start,unpacked=0;const result=new Map<string,Uint8Array>();
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
  if((flags&1)!==0||![0,8].includes(method)||compressed===0xffffffff||original===0xffffffff)
   throw Error("Encrypted or unsupported ZIP entry.");
  if(name.endsWith("/"))continue;
  if(result.has(name))throw Error("The ZIP contains duplicate file names.");
  if(!/\.(png|json|txt|md)$/i.test(name))throw Error("Character packs may contain only PNG art and data files.");
  if(original>MAX_ASSET_BYTES&&name!=="character-pack.json"&&name!=="manifest.json")
   throw Error("An image in the ZIP is too large.");
  if((name==="character-pack.json"||name==="manifest.json")&&original>100_000)throw Error("Character pack manifest is too large.");
  unpacked+=original;if(unpacked>MAX_UNPACKED_BYTES)throw Error("Character ZIP contains too much data.");
  requireRange(localOffset,30,bytes.length);
  if(read32(v,localOffset)!==0x04034b50||read16(v,localOffset+8)!==method)
   throw Error("ZIP entry headers do not match.");
  const localNameLen=read16(v,localOffset+26),localExtraLen=read16(v,localOffset+28);
  requireRange(localOffset+30,localNameLen+localExtraLen+compressed,bytes.length);
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
 const candidate={...fallback,id:c.id,name:c.name,hd:{resolution:256,...frames}};
 const validated=validateCustomCharacter(candidate);
 if(!validated)throw Error("Invalid character name, ID or oversized HD animation frames.");
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
 if(root["format"]!==CHARACTER_ADDON_FORMAT||root["version"]!==2
  ||Object.keys(root).some(k=>!["format","version","name","description","characters"].includes(k)))
  throw Error("Unsupported character ZIP format.");
 if(typeof root["name"]!=="string"||root["name"].trim().length<2||root["name"].length>72||/[<>]/.test(root["name"]))
  throw Error("Invalid character pack name.");
 if(!Array.isArray(root["characters"])||root["characters"].length<1||root["characters"].length>CUSTOM_WORLD_LIMIT)
  throw Error("A pack must contain 1 to 12 characters.");
 const characters=root["characters"].map(entry=>hdCharacter(entry,entries));
 if(new Set(characters.map(c=>c.id)).size!==characters.length)throw Error("Duplicate character IDs in ZIP.");
 return {name:root["name"].trim(),characters};
}
