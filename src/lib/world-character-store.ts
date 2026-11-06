import { useEffect,useRef,useState } from "react";
import { worldCharacterPacks,readWorldPacks,WORLD_PACKS_KEY } from "./world-character-packs";
import { CUSTOM_WORLD_KEY,MAX_ACTIVE_VISITORS,readCustomCharacters,cleanEnabledWorldIds,cleanCustomCharacters,CUSTOM_WORLD_LIMIT,CUSTOM_WORLD_PACK_LIMIT,exportCustomCharacters,type WorldCustomCharacter,validateCustomCharacter } from "./world-custom-packs";

type WorldState={revision:number;enabled:string[];characters:WorldCustomCharacter[];server:boolean};
type ResponsePayload={revision?:unknown;enabled?:unknown;characters?:unknown;error?:string};
const builtinIds=worldCharacterPacks.map(x=>x.id);
const localState=():WorldState=>{
 let enabled=["green-jacket"],characters:WorldCustomCharacter[]=[];
 try{
  enabled=readWorldPacks(localStorage.getItem(WORLD_PACKS_KEY));
  characters=readCustomCharacters(localStorage.getItem(CUSTOM_WORLD_KEY));
 }catch{/* browser storage can be disabled */}
 return {revision:0,enabled,characters,server:false};
};
function validServer(s:ResponsePayload):WorldState|null{
 if(!Number.isSafeInteger(s.revision)||Number(s.revision)<0||!Array.isArray(s.characters))return null;
 const characters=readCustomCharacters(JSON.stringify(s.characters));
 if(characters.length!==s.characters.length)return null;
 const allowed=[...builtinIds,...characters.map(c=>c.id)];
 return {revision:Number(s.revision),enabled:cleanEnabledWorldIds(s.enabled,allowed),characters,server:true};
}
const RECOVERY_KEY=CUSTOM_WORLD_KEY+"-recovery";
function remember(state:WorldState){
 try{
  localStorage.setItem(WORLD_PACKS_KEY,JSON.stringify(state.enabled.filter(id=>builtinIds.includes(id as typeof builtinIds[number]))));
  if(!state.server&&!state.characters.some(c=>c.hd3))localStorage.setItem(CUSTOM_WORLD_KEY,JSON.stringify(state.characters));
  localStorage.setItem(CUSTOM_WORLD_KEY+"-enabled",JSON.stringify(state.enabled));
  return true;
 }catch{return false;}
}
/** The user's data survives reloads locally and, when signed in as owner, in the Unraid data volume. */
export function useWorldCharacterUniverse(){
 const [state,setState]=useState<WorldState>({revision:0,enabled:["green-jacket"],characters:[],server:false});
 const [recoveryBackup,setRecoveryBackup]=useState<string|null>(null);
 const initializing=useRef(true);
 const ref=useRef(state);const [status,setStatus]=useState("Loading Character Universe...");
 const queue=useRef<Promise<unknown>>(Promise.resolve());
 const update=(next:WorldState)=>{ref.current=next;setState(next);remember(next);};
 useEffect(()=>{
  let cancelled=false;
  const local=localState();
  ref.current=local;setState(local);
  try{
   const previous=localStorage.getItem(RECOVERY_KEY);
   if(previous)setRecoveryBackup(previous);
   if(local.characters.length){
    const backup=exportCustomCharacters(local.characters);
    setRecoveryBackup(backup);localStorage.setItem(RECOVERY_KEY,backup);
   }
  }catch{/* The original browser library is retained even if recovery storage is full. */}
  try{
   const raw=localStorage.getItem(CUSTOM_WORLD_KEY+"-enabled");
   if(raw){
    const ids:unknown=JSON.parse(raw);const allowed=[...builtinIds,...ref.current.characters.map(c=>c.id)];
    update({...ref.current,enabled:cleanEnabledWorldIds(ids,allowed)});
   }
  }catch{/* optional */}
  void fetch("/api/character-universe",{credentials:"same-origin"}).then(async response=>{
   if(!response.ok)throw Error("Unraid owner storage is unavailable");
   const data=await response.json() as ResponsePayload;
   const loaded=validServer(data);
   if(!loaded)throw Error("The server returned invalid Character Universe data");
   if(!cancelled){update(loaded);setStatus("Saved on Unraid · shared across your signed-in devices");}
  }).catch(()=>{if(!cancelled)setStatus("Stored in this browser · export a backup to use on another device");}).finally(()=>{if(!cancelled)initializing.current=false;});
  return()=>{cancelled=true;};
 },[]);
 const modify=(op:"setEnabled"|"save"|"delete"|"installPack"|"updatePack"|"installBackup",payloadOrFactory:Record<string,unknown>|((current:WorldState)=>Record<string,unknown>)):Promise<boolean>=>{
  const work=async()=>{
   if(initializing.current){setStatus("Wait for Character Universe storage to finish loading.");return false;}
   const current=ref.current;
   const payload=typeof payloadOrFactory==="function"?payloadOrFactory(current):payloadOrFactory;
   let next:WorldState={...current,characters:[...current.characters],enabled:[...current.enabled]};
   if(op==="setEnabled"){
    const ids=payload['ids'];
    const allowed=[...builtinIds,...next.characters.map(c=>c.id)];
    if(!Array.isArray(ids)||ids.length>MAX_ACTIVE_VISITORS){setStatus("Only six visual visitors can be active at once.");return false;}
    next.enabled=cleanEnabledWorldIds(ids,allowed);
   }else if(op==="installPack"||op==="installBackup"||op==="updatePack"){
    const input=payload['characters'];
    if(!Array.isArray(input)||input.length<1||input.length>(op==="installBackup"?CUSTOM_WORLD_LIMIT:CUSTOM_WORLD_PACK_LIMIT)){setStatus("Choose up to twelve characters.");return false;}
    const entries=cleanCustomCharacters(input);
    if(entries.length!==input.length){setStatus("Invalid characters in ZIP.");return false;}
    if(entries.some(c=>c.hd3)&&!current.server){setStatus("HD directional packs require signed-in owner storage on Unraid.");return false;}
    if(op==="updatePack"){
     const expected=payload["expectedVersions"] as Record<string,unknown>;
     if(entries.some(c=>{const prior=current.characters.find(old=>old.id===c.id);return !c.hd3||(!prior?.hd3&&!prior?.hd)||expected?.[c.id]!==(prior.hd3?.version??0)||c.hd3.version<=(prior.hd3?.version??0);})){setStatus("Review a newer version of an installed HD character.");return false;}
     const replacements=new Map(entries.map(c=>[c.id,c]));
     next.characters=next.characters.map(c=>replacements.get(c.id)??c);
    }else{
    if(next.characters.length+entries.length>CUSTOM_WORLD_LIMIT){setStatus("Character Library is full.");return false;}
    if(entries.some(c=>next.characters.some(existing=>existing.id===c.id))){setStatus("A character is already installed. Existing art was not overwritten.");return false;}
    next.characters=[...next.characters,...entries];
    }
   }else if(op==="save"){
    const char=validateCustomCharacter(payload['character']);
    if(!char){setStatus("Character art or palette is invalid.");return false;}
    if(char.hd3||next.characters.find(c=>c.id===char.id)?.hd3){setStatus("Use reviewed HD pack installation or version updates.");return false;}
    next.characters=[...next.characters.filter(x=>x.id!==char.id),char];
    if(next.characters.length>CUSTOM_WORLD_LIMIT){setStatus("The Character Library can contain "+CUSTOM_WORLD_LIMIT+" custom characters.");return false;}
   }else{
    const id=payload['id'];
    if(typeof id!=="string")return false;
    next.characters=next.characters.filter(c=>c.id!==id);
    next.enabled=next.enabled.filter(c=>c!==id);
   }
   if(current.server){
    try{
     const response=await fetch("/api/character-universe",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:JSON.stringify({op,expectedRevision:current.revision,...payload})});
     const result=await response.json() as ResponsePayload;
     if(response.ok){
      const saved=validServer(result);
      if(saved){update(saved);setStatus("Saved on Unraid · all signed-in devices");return true;}
     }
     if(response.status===409){
      setStatus("Another device changed this Library. Reload Pixel Pals, then retry your edit.");return false;
     }
     setStatus(result.error||"Cannot save on Unraid. Retry your edit when storage is available.");
    }catch{setStatus("Unraid sync unavailable. Retry your edit when storage is available.");}
    return false;
   }else{
    if(!remember(next)){setStatus("Browser storage is unavailable or full. Export your existing library before retrying.");return false;}
    setStatus("Saved locally · export a backup to use on another device");
   }
   update(next);
   return true;
  };
  const task=queue.current.then(work,work);queue.current=task.catch(()=>undefined);return task;
 };
 const toggle=(id:string,enabled:boolean)=>modify("setEnabled",current=>({ids:enabled?[...new Set([...current.enabled,id])]:current.enabled.filter(c=>c!==id)}));
 const save=(character:WorldCustomCharacter)=>modify("save",{character});
 const remove=(id:string)=>modify("delete",{id});
 const installPack=(characters:WorldCustomCharacter[])=>modify("installPack",{characters});
 const installBackup=(characters:WorldCustomCharacter[])=>modify("installBackup",{characters});
 const updatePack=(characters:WorldCustomCharacter[])=>{
  const expectedVersions=Object.fromEntries(characters.map(c=>[c.id,ref.current.characters.find(old=>old.id===c.id)?.hd3?.version??0]));
  return modify("updatePack",{characters,expectedVersions});
 };
 const exportBackup=async()=>{
  if(!ref.current.server)return exportCustomCharacters(ref.current.characters);
  const response=await fetch("/api/character-universe?export=1",{credentials:"same-origin"});
  if(!response.ok)throw Error("Could not export the complete character artwork. Retry when Unraid storage is available.");
  return response.text();
 };
 return {state,status,toggle,save,remove,installPack,installBackup,updatePack,exportBackup,recoveryBackup};
}
