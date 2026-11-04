/** Data-only, 32×32 custom cosmetic characters. No external JS, SVG or URL fields. */
export const CUSTOM_WORLD_KEY="pixel-pals-custom-world-characters-v1";
export const CUSTOM_WORLD_LIMIT=12;
export const CUSTOM_WORLD_FILE_LIMIT=120_000;
export const CUSTOM_WORLD_COLOR_KEYS="abcdefghijklmnop";
export type WorldCustomCharacter={
 id:string;name:string;pixels:string[];palette:Record<string,string>;
};
export const STARTER_PALETTE:Record<string,string>={
 a:"#202335",b:"#fac19a",c:"#82543c",d:"#4e7dcf",e:"#c3ed6b",f:"#f6ebdc",
 g:"#e98c50",h:"#745db4"
};
export function customCharacterId():string{
 return "user-"+(globalThis.crypto?.randomUUID?.().replace(/-/g,"")??Date.now().toString(36)+"abcdef00");
}
export function starterCustomCharacter():WorldCustomCharacter{
 const g=Array.from({length:32},()=>Array<string>(32).fill("."));
 const rect=(x:number,y:number,w:number,h:number,c:string)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)if(g[j]&&i>=0&&i<32)g[j]![i]=c;};
 rect(11,25,5,5,"a");rect(17,25,5,5,"a");
 rect(9,15,15,12,"d");rect(7,18,3,8,"d");rect(24,18,3,8,"d");
 rect(10,4,14,12,"b");rect(11,2,12,5,"c");
 rect(12,9,3,2,"a");rect(19,9,3,2,"a");rect(15,13,4,1,"g");
 return {id:customCharacterId(),name:"My Pixel Pal",pixels:g.map(row=>row.join("")),palette:{...STARTER_PALETTE}};
}
export function validateCustomCharacter(value:unknown):WorldCustomCharacter|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(typeof v['id']!=="string"||!/^user-[a-z0-9]{8,40}$/.test(v['id']))return null;
 if(typeof v['name']!=="string"||v['name'].trim().length<2||v['name'].trim().length>40||/[\x00-\x1f<>]/.test(v['name']))return null;
 if(!Array.isArray(v['pixels'])||v['pixels'].length!==32||v['pixels'].some(row=>typeof row!=="string"||!/^[.a-p]{32}$/.test(row)))return null;
 if(!v['palette']||typeof v['palette']!=="object"||Array.isArray(v['palette']))return null;
 const values=Object.entries(v['palette'] as Record<string,unknown>);
 if(!values.length||values.length>16||values.some(([k,c])=>!CUSTOM_WORLD_COLOR_KEYS.includes(k)||k.length!==1||typeof c!=="string"||!/^#[a-fA-F0-9]{6}$/.test(c)))return null;
 const palette=Object.fromEntries(values.map(([k,c])=>[k,(c as string).toLowerCase()])) as Record<string,string>;
 const colors=new Set((v['pixels'] as string[]).join("").replace(/\./g,""));
 if(colors.size===0||[...colors].some(c=>!(c in palette)))return null;
 if((v['pixels'] as string[]).join("").replace(/\./g,"").length<15)return null;
 return {id:v['id'],name:v['name'].trim(),pixels:[...(v['pixels'] as string[])],palette};
}
export function cleanCustomCharacters(value:unknown):WorldCustomCharacter[]{
 if(!Array.isArray(value)||value.length>CUSTOM_WORLD_LIMIT)return [];
 const items:WorldCustomCharacter[]=[];
 for(const entry of value){const valid=validateCustomCharacter(entry);if(!valid)return [];if(items.some(i=>i.id===valid.id))return [];items.push(valid);}
 return items;
}
export function readCustomCharacters(raw:string|null):WorldCustomCharacter[]{
 if(!raw||raw.length>CUSTOM_WORLD_FILE_LIMIT)return [];
 try{return cleanCustomCharacters(JSON.parse(raw));}catch{return [];}
}
export function exportCustomCharacters(characters:WorldCustomCharacter[]):string{
 return JSON.stringify({format:"pixel-pals-character-universe",version:1,characters:cleanCustomCharacters(characters)},null,2);
}
export function importCustomCharacters(raw:string):WorldCustomCharacter[]|null{
 if(raw.length>CUSTOM_WORLD_FILE_LIMIT)return null;
 try{
  const data:unknown=JSON.parse(raw);
  if(!data||typeof data!=="object")return null;
  const item=data as Record<string,unknown>;
  if(item['format']!=="pixel-pals-character-universe"||item['version']!==1||!Array.isArray(item['characters'])||item['characters'].length>CUSTOM_WORLD_LIMIT)return null;
  const parsed=cleanCustomCharacters(item['characters']);
  return parsed.length===item['characters'].length?parsed:null;
 }catch{return null;}
}
/** Enforce a reasonable cap on visible guests, especially on mobile devices. */
export const MAX_ACTIVE_VISITORS=6;
export function cleanEnabledWorldIds(raw:unknown,allowed:readonly string[]):string[]{
 if(!Array.isArray(raw))return ["green-jacket"];
 const unique=[...new Set(raw.filter((x):x is string=>typeof x==="string"&&allowed.includes(x)))];
 return unique.slice(0,MAX_ACTIVE_VISITORS);
}
