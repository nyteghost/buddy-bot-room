/**
 * Portable ShowPilot data backup. Only known work-tool keys are included;
 * never export application credentials or arbitrary Pixel Pals local storage.
 */
const MAX_BYTES=5_000_000;
const SHOWPILOT_DATA=new Set(["showpilot:vendors:v1","showpilot:theme","showpilot:screen","showpilot:sidebar","showpilot:ai:local-model"]);
const allow=(k:string)=>SHOWPILOT_DATA.has(k)||k.startsWith("stage-planner:")||k.startsWith("pixelpals:floormap:")||k==="pixelpals:work-name";
export type WorkBackup={kind:"showpilot-work-backup";version:1;createdAt:string;data:Record<string,string>};
export function exportWorkBackup(storage:Pick<Storage,"length"|"key"|"getItem">):WorkBackup {
 const data:Record<string,string>={};
 for(let i=0;i<storage.length;i++){const k=storage.key(i);if(!k||!allow(k))continue;const v=storage.getItem(k);if(v!==null)data[k]=v;}
 return {kind:"showpilot-work-backup",version:1,createdAt:new Date().toISOString(),data};
}
export function parseWorkBackup(raw:string):WorkBackup {
 if(raw.length>MAX_BYTES)throw new Error("Backup exceeds 5 MB");
 const value:unknown=JSON.parse(raw);
 if(!value||typeof value!=="object")throw new Error("Invalid backup");
 const b=value as Record<string,unknown>;
 if(b.kind!=="showpilot-work-backup"||b.version!==1||typeof b.data!=="object"||!b.data||Array.isArray(b.data))throw new Error("Not a supported ShowPilot backup");
 const data:Record<string,string>={};
 for(const [k,v] of Object.entries(b.data)){
   if(!allow(k)||typeof v!=="string")throw new Error("Backup contains unexpected data");
   if(v.length>1_000_000)throw new Error("Oversized backup entry");
   data[k]=v;
 }
 return {kind:"showpilot-work-backup",version:1,createdAt:typeof b.createdAt==="string"?b.createdAt:"",data};
}
export function restoreWorkBackup(b:WorkBackup,storage:Pick<Storage,"setItem">) {
 for(const [k,v] of Object.entries(b.data)){ if(!allow(k))throw new Error("Unknown backup key"); storage.setItem(k,v); }
 return Object.keys(b.data).length;
}
