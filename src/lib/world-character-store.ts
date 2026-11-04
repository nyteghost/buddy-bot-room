import { useEffect,useRef,useState } from "react";
import { worldCharacterPacks,readWorldPacks,WORLD_PACKS_KEY } from "./world-character-packs";
import { CUSTOM_WORLD_KEY,MAX_ACTIVE_VISITORS,readCustomCharacters,cleanEnabledWorldIds,type WorldCustomCharacter,validateCustomCharacter } from "./world-custom-packs";

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
function remember(state:WorldState){
 try{
  localStorage.setItem(WORLD_PACKS_KEY,JSON.stringify(state.enabled.filter(id=>builtinIds.includes(id as typeof builtinIds[number]))));
  localStorage.setItem(CUSTOM_WORLD_KEY,JSON.stringify(state.characters));
  localStorage.setItem(CUSTOM_WORLD_KEY+"-enabled",JSON.stringify(state.enabled));
 }catch{/* user can export if browser storage is unavailable */}
}
/** The user's data survives reloads locally and, when signed in as owner, in the Unraid data volume. */
export function useWorldCharacterUniverse(){
 const [state,setState]=useState<WorldState>(localState);
 const ref=useRef(state);const [status,setStatus]=useState("Loading Character Universe...");
 const queue=useRef<Promise<unknown>>(Promise.resolve());
 const update=(next:WorldState)=>{ref.current=next;setState(next);remember(next);};
 useEffect(()=>{
  let cancelled=false;
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
  }).catch(()=>{if(!cancelled)setStatus("Stored in this browser · export a backup to use on another device");});
  return()=>{cancelled=true;};
 },[]);
 const modify=(op:"setEnabled"|"save"|"delete",payload:Record<string,unknown>):Promise<boolean>=>{
  const work=async()=>{
   const current=ref.current;
   let next:WorldState={...current,characters:[...current.characters],enabled:[...current.enabled]};
   if(op==="setEnabled"){
    const ids=payload['ids'];
    const allowed=[...builtinIds,...next.characters.map(c=>c.id)];
    if(!Array.isArray(ids)||ids.length>MAX_ACTIVE_VISITORS){setStatus("Only six visual visitors can be active at once.");return false;}
    next.enabled=cleanEnabledWorldIds(ids,allowed);
   }else if(op==="save"){
    const char=validateCustomCharacter(payload['character']);
    if(!char){setStatus("Character art or palette is invalid.");return false;}
    next.characters=[...next.characters.filter(x=>x.id!==char.id),char];
    if(next.characters.length>12){setStatus("The Character Library can contain twelve custom characters.");return false;}
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
     setStatus(result.error||"Cannot save on Unraid. Your edit is kept only in this browser.");
    }catch{setStatus("Unraid sync unavailable. Your edit is stored only in this browser.");}
    next.server=false;
   }else{
    setStatus("Saved locally · export a backup to use on another device");
   }
   update(next);
   return true;
  };
  const task=queue.current.then(work,work);queue.current=task.catch(()=>undefined);return task;
 };
 const toggle=(id:string,enabled:boolean)=>{
  const next=enabled?[...new Set([...ref.current.enabled,id])]:ref.current.enabled.filter(c=>c!==id);
  return modify("setEnabled",{ids:next});
 };
 const save=(character:WorldCustomCharacter)=>modify("save",{character});
 const remove=(id:string)=>modify("delete",{id});
 return {state,status,toggle,save,remove};
}
