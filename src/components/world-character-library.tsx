import { useEffect,useMemo,useRef,useState,type ChangeEvent } from "react";
import { Download,Upload,Plus,Pencil,Trash2,Undo2,Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { worldCharacterPacks,greenJacketSprite,greenJacketPalette } from "@/lib/world-character-packs";
import { guestSprite,guestPalette,type GuestId } from "@/lib/world-guest-packs";
import { starterCustomCharacter,validateCustomCharacter,exportCustomCharacters,importCustomCharacters,MAX_ACTIVE_VISITORS,CUSTOM_WORLD_LIMIT,CUSTOM_WORLD_FILE_LIMIT,CUSTOM_WORLD_COLOR_KEYS,type WorldCustomCharacter } from "@/lib/world-custom-packs";
import { spriteRuns } from "@/lib/sprite-upscale";
import { parseCharacterZip,CHARACTER_ZIP_MAX_BYTES,type ImportedCharacterZip } from "@/lib/character-zip";
import { planCharacterAddonInstall } from "@/lib/character-addon";
import { WORLD_HD_DIRECTIONS, type WorldHdAction, type WorldHdDirection } from "@/lib/world-hd";
import { useReducedMotion } from "@/lib/reduced-motion";
import { lowPower, useTabHidden } from "@/lib/power";
import { worldHdFrameAt } from "@/lib/world-hd-animation";
import "./world-character-library.css";

export function WorldPixelPreview({pixels,palette,name}:{pixels:readonly string[];palette:Record<string,string>;name:string}){
 const runs=useMemo(()=>spriteRuns([...pixels],()=> "body"),[pixels]);
 return <svg className="world-library-preview" viewBox="0 0 32 32" shapeRendering="crispEdges" role="img" aria-label={name+" original pixel preview"}>
  {runs.map(r=><rect key={r.x+"-"+r.y} x={r.x} y={r.y} width={r.w} height="1" fill={palette[r.c]??"transparent"}/>)}
 </svg>;
}

type Props={
 enabledIds:readonly string[];
 customCharacters:readonly WorldCustomCharacter[];
 syncStatus:string;
 onToggle:(id:string,on:boolean)=>void;
 onSave:(character:WorldCustomCharacter)=>Promise<boolean>;
 onInstallPack:(characters:WorldCustomCharacter[])=>Promise<boolean>;
 onDelete:(id:string)=>Promise<boolean>;
 onUpdatePack?:(characters:WorldCustomCharacter[])=>Promise<boolean>;
 onInstallBackup?:(characters:WorldCustomCharacter[])=>Promise<boolean>;
 onExportBackup?:()=>Promise<string>;
 recoveryBackup?:string|null;
 paused?:boolean;
};
function CharacterEditor({initial,onSave,onCancel}:{initial:WorldCustomCharacter;onSave:Props["onSave"];onCancel:()=>void}){
 const [character,setCharacter]=useState(initial);
 const [paint,setPaint]=useState("d");
 const [note,setNote]=useState("");
 const palette=character.palette;
 const draw=(x:number,y:number)=>{
  const rows=[...character.pixels],line=rows[y];
  if(!line)return;
  rows[y]=line.slice(0,x)+paint+line.slice(x+1);
  setCharacter(prev=>({...prev,pixels:rows}));
 };
 const valid=!!validateCustomCharacter(character);
 return <section className="world-character-editor" aria-label="Pixel character creator">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <h4 className="font-semibold text-sm">Character Creator · 32×32</h4>
   <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Close editor</Button>
  </div>
  <label className="text-xs font-medium">Character name
   <input className="world-character-name" aria-label="Custom character name" maxLength={40} value={character.name} onChange={e=>setCharacter(v=>({...v,name:e.target.value}))}/>
  </label>
  <div className="world-editor-main">
   <div className="world-pixel-grid" role="group" aria-label="32 by 32 pixel drawing grid">
    {character.pixels.map((row,y)=>Array.from(row).map((code,x)=>
     <button key={x+"-"+y} type="button" className="world-pixel-cell" title={"Row "+(y+1)+", column "+(x+1)}
      aria-label={"Paint pixel "+(x+1)+", "+(y+1)}
      style={{backgroundColor:code==="."?"transparent":palette[code]??"transparent"}}
      onClick={()=>draw(x,y)} />
    ))}
   </div>
   <div className="world-editor-tools">
    <WorldPixelPreview pixels={character.pixels} palette={palette} name={character.name}/>
    <p className="text-xs font-medium">Brush color</p>
    <div className="world-editor-colors">
     {Object.entries(palette).map(([key,color])=>
      <button key={key} type="button" className="world-color-swatch" style={{backgroundColor:color}}
       aria-label={"Select palette color "+key} aria-pressed={paint===key} onClick={()=>setPaint(key)}/>)}
     <button type="button" className="world-color-eraser" aria-label="Eraser" aria-pressed={paint==="."} onClick={()=>setPaint(".")}>✕</button>
    </div>
    {paint!=="."&&<label className="text-xs">Edit brush color
     <input type="color" aria-label="Edit selected palette color" value={palette[paint]??"#ffffff"}
      onChange={e=>setCharacter(c=>({...c,palette:{...c.palette,[paint]:e.target.value}}))}/>
    </label>}
    {Object.keys(palette).length<16&&<Button size="sm" variant="outline" onClick={()=>{
      const key=[...CUSTOM_WORLD_COLOR_KEYS].find(c=>!(c in palette));
      if(key){setCharacter(c=>({...c,palette:{...c.palette,[key]:"#ffffff"}}));setPaint(key);}
    }}>Add color</Button>}
    <p className="text-xs text-muted-foreground">Tap a square to paint. Choose a swatch or eraser. Works offline; import/export uses safe data-only JSON.</p>
   </div>
  </div>
  <div className="flex flex-wrap gap-2">
   <Button type="button" size="sm" disabled={!valid} onClick={async()=>{
    setNote("Saving character...");
    const saved=await onSave(character);
    if(saved)onCancel();else setNote("Save failed. Check the Library status and retry.");
   }}><Save className="size-3.5"/>Save character</Button>
   <Button type="button" size="sm" variant="outline" onClick={()=>setCharacter(c=>({...c,pixels:Array(32).fill(".".repeat(32))}))}>
    <Undo2 className="size-3.5"/>Clear art
   </Button>
  </div>
  {note&&<p role="status" className="text-xs">{note}</p>}
  {!valid&&<p className="text-xs text-muted-foreground">Paint at least 15 pixels, give the character a name, and use safe palette colors to save.</p>}
 </section>;
}
const directionNames:Record<WorldHdDirection,string>={s:"Front",se:"Front-right",e:"Right",ne:"Back-right",n:"Back",nw:"Back-left",w:"Left",sw:"Front-left"};
function CharacterArt({character}:{character:WorldCustomCharacter}){
 const image=character.hd3?.directions.s?.idle?.frames[0]?.src??character.hd?.idle[0];
 return image?<img className="world-library-preview world-library-hd" src={image} width={256} height={256} loading="lazy" alt={character.name+" high resolution pixel art"}/>
  :<WorldPixelPreview pixels={character.pixels} palette={character.palette} name={character.name}/>;
}
export function HdCharacterPreview({character,paused=false}:{character:WorldCustomCharacter;paused?:boolean}){
 const [direction,setDirection]=useState<WorldHdDirection>("s"),[action,setAction]=useState<WorldHdAction>("idle"),[elapsed,setElapsed]=useState(0);
 const reduced=useReducedMotion(),low=lowPower.use();
 const [playing,setPlaying]=useState(false);
 const art=character.hd3;
 const hidden=useTabHidden();
 const actions=art?.directions[direction];
 const clip=actions?.[action]??actions?.idle;
 useEffect(()=>{setElapsed(0);},[character,clip]);
 useEffect(()=>{
  if(!playing||paused||reduced||low||hidden||!clip||clip.frames.length<2)return;
  let previous=performance.now();
  const tick=window.setInterval(()=>{
   const now=performance.now(),delta=now-previous;previous=now;
   if(!document.hidden)setElapsed(value=>value+Math.min(delta,100));
  },40);
  return()=>window.clearInterval(tick);
 },[playing,paused,reduced,low,hidden,clip]);
 if(!art||!clip)return <CharacterArt character={character}/>;
 const frameSrc=worldHdFrameAt(clip,elapsed);
 return <section className="world-hd-preview" aria-label={character.name+" animation preview"}>
  <img src={frameSrc} width={256} height={256} alt={character.name+" "+directionNames[direction]+" "+action+" preview"}/>
  <div className="world-hd-preview-controls">
   <label>Facing<select aria-label={character.name+" preview facing"} value={direction} onChange={event=>{setDirection(event.target.value as WorldHdDirection);setAction("idle");}}>
    {WORLD_HD_DIRECTIONS.filter(value=>art.directions[value]).map(value=><option key={value} value={value}>{directionNames[value]}</option>)}
   </select></label>
   <label>Action<select aria-label={character.name+" preview action"} value={actions?.[action]?action:"idle"} onChange={event=>setAction(event.target.value as WorldHdAction)}>
    {Object.keys(actions??{}).map(value=><option key={value} value={value}>{value}</option>)}
   </select></label>
   <Button type="button" size="sm" variant="outline" disabled={paused||reduced||low||clip.frames.length<2} onClick={()=>setPlaying(value=>!value)}>{playing?"Pause preview":"Play preview"}</Button>
  </div>
  <p className="text-xs text-muted-foreground">{clip.frames.length} frame(s) · {Object.keys(art.directions).length} facing(s) · {art.artStatus==="prototype"?"Animation prototype":"Pack marked production-approved"}</p>
 </section>;
}
function downloadBackup(raw:string,name:string){
 const url=URL.createObjectURL(new Blob([raw],{type:"application/json"}));
 const link=document.createElement("a");link.href=url;link.download=name;link.click();
 window.setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export function WorldCharacterLibrary({enabledIds,customCharacters,syncStatus,onToggle,onSave,onInstallPack,onDelete,onUpdatePack,onInstallBackup,onExportBackup,recoveryBackup,paused=false}:Props){
 const reduced=useReducedMotion(),low=lowPower.use(),hidden=useTabHidden();
 const actionsPaused=paused||reduced||low||hidden;
 const [editor,setEditor]=useState<WorldCustomCharacter|null>(null);
 const [message,setMessage]=useState("");
 const [zipPack,setZipPack]=useState<ImportedCharacterZip|null>(null);
 const [backup,setBackup]=useState(false);
 const [selected,setSelected]=useState<string[]>([]);
 const [updates,setUpdates]=useState<string[]>([]);
 const [installing,setInstalling]=useState(false);
 const requestNumber=useRef(0);
 const active=enabledIds.length;
 const builtins=worldCharacterPacks.map(pack=>({pack,pixels:pack.id==="green-jacket"?greenJacketSprite():guestSprite(pack.id as GuestId),palette:pack.id==="green-jacket"?greenJacketPalette:guestPalette}));
 const toggle=(id:string)=>{
  const enabled=enabledIds.includes(id);
  if(!enabled&&active>=MAX_ACTIVE_VISITORS){setMessage("Up to six visual guests can walk around at once. Disable one to add another.");return;}
  onToggle(id,!enabled);
 };
 const exportBackup=async()=>{
  try{const raw=onExportBackup?await onExportBackup():exportCustomCharacters([...customCharacters]);downloadBackup(raw,"pixel-pals-character-universe.json");setMessage("Character backup exported.");}
  catch(error){setMessage(error instanceof Error?error.message:"Could not export character backup.");}
 };
 const handleImport=async(event:ChangeEvent<HTMLInputElement>,isBackup:boolean)=>{
  const file=event.target.files?.[0];event.target.value="";
  if(!file||installing)return;
  const request=++requestNumber.current;
  setZipPack(null);setSelected([]);setUpdates([]);setMessage("Checking character pack...");
  try{
   if(file.size>(isBackup?CUSTOM_WORLD_FILE_LIMIT:CHARACTER_ZIP_MAX_BYTES))throw Error("This file exceeds the character import size limit.");
   let pack:ImportedCharacterZip;
   if(isBackup){
    const characters=importCustomCharacters(await file.text());
    if(!characters?.length)throw Error("Invalid or empty Character Universe backup.");
    pack={name:"Character backup",characters};
   }else pack=await parseCharacterZip(file);
   if(request!==requestNumber.current)return;
   setZipPack(pack);setBackup(isBackup);
   setSelected(pack.characters.filter(character=>!customCharacters.some(existing=>existing.id===character.id)).map(character=>character.id));
   setMessage("Review the artwork and selection before approving installation.");
  }catch(error){if(request===requestNumber.current)setMessage(error instanceof Error?error.message:"Could not read character pack.");}
 };
 const install=async(update:boolean)=>{
  if(!zipPack||installing)return;
  setInstalling(true);
  try{
   const ids=update?updates:selected;
   const entries=zipPack.characters.filter(character=>ids.includes(character.id));
   if(!entries.length)throw Error("Select characters first.");
   if(update){
    if(!onUpdatePack)throw Error("Character updates require owner storage.");
    if(!await onUpdatePack(entries))throw Error("Update failed. Check Library storage status.");
   }else{
    if(entries.some(character=>customCharacters.some(saved=>saved.id===character.id)))throw Error("An existing character ID was selected. Choose a version update separately.");
    if(customCharacters.length+entries.length>CUSTOM_WORLD_LIMIT)throw Error("Character Library has reached its storage limit.");
    if(backup&&onInstallBackup){if(!await onInstallBackup(entries))throw Error("Backup import failed. Check Library storage status.");}
    else{
     planCharacterAddonInstall({format:"pixel-pals-character-addon",version:1,name:zipPack.name,characters:zipPack.characters},customCharacters,ids);
     if(!await onInstallPack(entries))throw Error("Installation failed. Check Library storage status.");
    }
   }
   setMessage(entries.length+" character(s) "+(update?"updated.":"installed. Use Add to place them in the Living World."));
   setZipPack(null);setSelected([]);setUpdates([]);
  }catch(error){setMessage(error instanceof Error?error.message:"Character import failed.");}
  finally{setInstalling(false);}
 };
 return <details className="world-character-library">
  <summary>Character Universe · {worldCharacterPacks.length} built-in visitors · {customCharacters.length} creations · {active} active</summary>
  <div className="world-library-body">
   <p className="text-xs text-muted-foreground">Choose who walks around your Living World. Tap a visitor to wave. HD characters can also perform their supplied signature action.</p>
   <p role="status" className="text-xs text-muted-foreground">{syncStatus}</p>
   {actionsPaused&&<p className="text-xs text-muted-foreground">Character actions are paused by your room or motion settings.</p>}
   <div className="world-library-controls">
    <Button type="button" variant="outline" size="sm" disabled={customCharacters.length>=CUSTOM_WORLD_LIMIT} onClick={()=>setEditor(starterCustomCharacter())}><Plus className="size-3.5"/>Create character</Button>
    <Button type="button" variant="outline" size="sm" onClick={()=>void exportBackup()}><Download className="size-3.5"/>Export JSON</Button>
    {recoveryBackup&&<Button type="button" variant="outline" size="sm" onClick={()=>downloadBackup(recoveryBackup,"pixel-pals-browser-recovery.json")}>Export browser recovery</Button>}
    <label className="world-import-label world-import-zip"><Upload className="size-3.5"/>Import character ZIP <input disabled={installing} aria-label="Choose character ZIP file" type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={event=>void handleImport(event,false)}/></label>
    <label className="world-import-label"><Upload className="size-3.5"/>Import JSON <input disabled={installing} aria-label="Import character pack JSON" type="file" accept=".json,application/json" onChange={event=>void handleImport(event,true)}/></label>
   </div>
   {message&&<p role="status" className="text-xs">{message}</p>}
   {zipPack&&<section className="world-character-zip-review" aria-label="Review character ZIP">
    <strong className="text-sm">{zipPack.name} · 256×256 character preview</strong>
    <p className="text-xs text-muted-foreground">Select new characters to install. Newer versions of installed HD characters require a separate update approval.</p>
    <div className="world-library-grid">
     {zipPack.characters.map(character=>{
      const existing=customCharacters.find(saved=>saved.id===character.id);
      const canUpdate=!!onUpdatePack&&!!(existing?.hd3||existing?.hd)&&!!character.hd3&&character.hd3.version>(existing.hd3?.version??0);
      return <article className="world-library-card world-import-card" key={character.id}>
       <label className="world-import-selection"><input type="checkbox" aria-label={"Select "+character.name} checked={selected.includes(character.id)} disabled={installing||!!existing}
        onChange={event=>setSelected(list=>event.target.checked?[...list,character.id]:list.filter(id=>id!==character.id))}/><strong>{character.name}</strong></label>
       {character.hd3?<HdCharacterPreview character={character} paused={paused}/>:<CharacterArt character={character}/>}
       <p className="text-xs">{existing?"Already installed":"Ready to install"}{character.hd3?" · Version "+character.hd3.version:""}</p>
       {canUpdate&&<label className="world-import-selection"><input type="checkbox" aria-label={"Update "+character.name} checked={updates.includes(character.id)} disabled={installing}
        onChange={event=>setUpdates(list=>event.target.checked?[...list,character.id]:list.filter(id=>id!==character.id))}/>Update version {existing!.hd3?.version??0} to {character.hd3!.version}</label>}
      </article>;
     })}
    </div>
    <div className="flex flex-wrap gap-2">
     <Button type="button" size="sm" disabled={installing||selected.length===0} onClick={()=>void install(false)}>{installing?"Saving...":"Approve & install "+selected.length+" character(s)"}</Button>
     {updates.length>0&&<Button type="button" size="sm" variant="outline" disabled={installing} onClick={()=>void install(true)}>Approve version update for {updates.length} character(s)</Button>}
     <Button type="button" size="sm" variant="outline" disabled={installing} onClick={()=>{requestNumber.current++;setZipPack(null);setSelected([]);setUpdates([]);setMessage("Import cancelled.");}}>Cancel</Button>
    </div>
   </section>}
   {editor&&<CharacterEditor key={editor.id} initial={editor} onSave={onSave} onCancel={()=>setEditor(null)}/>}
   <div className="world-library-grid">
    {builtins.map(({pack,pixels,palette})=>{
     const on=enabledIds.includes(pack.id);
     return <article className="world-library-card" key={pack.id}>
      <WorldPixelPreview pixels={pixels} palette={palette} name={pack.name}/>
      <div className="min-w-0 flex-1"><strong className="text-xs">{pack.name}</strong><p className="text-xs text-muted-foreground">{pack.description}</p></div>
      <Button type="button" size="sm" variant={on?"default":"outline"} aria-pressed={on} aria-label={(on?"Disable ":"Enable ")+pack.name} onClick={()=>toggle(pack.id)}>{on?"In room":"Add"}</Button>
     </article>;
    })}
    {customCharacters.map(character=>{
     const on=enabledIds.includes(character.id);
     const hasSignature=character.hd3&&Object.values(character.hd3.directions).some(actions=>actions?.signature);
     return <article className="world-library-card" key={character.id}>
      <CharacterArt character={character}/>
      <div className="min-w-0 flex-1"><strong className="text-xs">{character.name}</strong><p className="text-xs text-muted-foreground">{character.hd3?"HD256 · v"+character.hd3.version+" · "+(character.hd3.artStatus==="prototype"?"Prototype":"Pack marked production-approved"):character.hd?"Imported HD · 256×256 PNG":"Your original pixel character"}</p></div>
      <div className="world-library-card-controls">
       <Button size="sm" variant={on?"default":"outline"} aria-pressed={on} aria-label={(on?"Disable ":"Enable ")+character.name} onClick={()=>toggle(character.id)}>{on?"In room":"Add"}</Button>
       {hasSignature&&<Button type="button" size="sm" variant="outline" disabled={!on||actionsPaused} aria-label={"Signature action for "+character.name} onClick={()=>window.dispatchEvent(new CustomEvent("pixel-pals:hd-action",{detail:{id:character.id,action:"signature"}}))}>Signature</Button>}
       {!character.hd&&!character.hd3&&<Button size="sm" variant="ghost" aria-label={"Edit "+character.name} onClick={()=>setEditor(character)}><Pencil className="size-3.5"/></Button>}
       <Button size="sm" variant="ghost" aria-label={"Delete "+character.name} onClick={async()=>{
        if(window.confirm("Remove "+character.name+" from your Character Library? Export a backup first if you want to reinstall it later.")){
         const ok=await onDelete(character.id);setMessage(ok?"Character removed from Library.":"Could not remove character.");
        }
       }}><Trash2 className="size-3.5"/></Button>
      </div>
     </article>;
    })}
   </div>
  </div>
 </details>;
}
