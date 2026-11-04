import { useMemo,useState,type ChangeEvent } from "react";
import { Download,Upload,Plus,Pencil,Trash2,Undo2,Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { worldCharacterPacks,greenJacketSprite,greenJacketPalette,type WorldPackId } from "@/lib/world-character-packs";
import { guestSprite,guestPalette,type GuestId } from "@/lib/world-guest-packs";
import { starterCustomCharacter,validateCustomCharacter,exportCustomCharacters,importCustomCharacters,MAX_ACTIVE_VISITORS,CUSTOM_WORLD_LIMIT,CUSTOM_WORLD_FILE_LIMIT,CUSTOM_WORLD_COLOR_KEYS,type WorldCustomCharacter } from "@/lib/world-custom-packs";
import { spriteRuns } from "@/lib/sprite-upscale";
import { parseCharacterZip,CHARACTER_ZIP_MAX_BYTES,type ImportedCharacterZip } from "@/lib/character-zip";
import { planCharacterAddonInstall } from "@/lib/character-addon";
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
export function WorldCharacterLibrary({enabledIds,customCharacters,syncStatus,onToggle,onSave,onInstallPack,onDelete}:Props){
 const [editor,setEditor]=useState<WorldCustomCharacter|null>(null);
 const [message,setMessage]=useState("");
 const [zipPack,setZipPack]=useState<ImportedCharacterZip|null>(null);
 const [selected,setSelected]=useState<string[]>([]);
 const [installing,setInstalling]=useState(false);
 const active=enabledIds.length;
 const builtins=worldCharacterPacks.map(pack=>{
  const pixels=pack.id==="green-jacket"?greenJacketSprite():guestSprite(pack.id as GuestId);
  const palette=pack.id==="green-jacket"?greenJacketPalette:guestPalette;
  return {pack,pixels,palette};
 });
 const toggle=(id:string)=>{
  const enabled=enabledIds.includes(id);
  if(!enabled&&active>=MAX_ACTIVE_VISITORS){setMessage("Up to six visual guests can walk around at once. Disable one to add another.");return;}
  onToggle(id,!enabled);
 };
 const exportBackup=()=>{
  const raw=exportCustomCharacters([...customCharacters]);
  const blob=new Blob([raw],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download="pixel-pals-character-universe.json";a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),3000);
 };
 const handleImport=async(event:ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];
  event.target.value="";
  if(!file)return;
  if(file.size>CUSTOM_WORLD_FILE_LIMIT){setMessage("The import exceeds the character library backup limit.");return;}
  const imported=importCustomCharacters(await file.text());
  if(!imported){setMessage("Invalid Character Universe JSON file. Only safe 32×32 data is accepted.");return;}
  let saved=0;
  for(const entry of imported){
   if(await onSave(entry))saved++;else break;
  }
  setMessage(saved+" custom character(s) imported. No scripts, images or external links were executed.");
 };
 const handleZip=async(event:ChangeEvent<HTMLInputElement>)=>{
  const file=event.target.files?.[0];event.target.value="";
  if(!file)return;
  setZipPack(null);setSelected([]);setMessage("Checking 256x256 character ZIP...");
  if(file.size>CHARACTER_ZIP_MAX_BYTES){setMessage("ZIP must be smaller than 8 MB.");return;}
  try{
   const pack=await parseCharacterZip(file);
   setZipPack(pack);
   setSelected(pack.characters.filter(c=>!customCharacters.some(existing=>existing.id===c.id)).map(c=>c.id));
   setMessage("Preview the characters, then approve the import. Your existing characters will not be replaced.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not read character ZIP.");}
 };
 const installZip=async()=>{
  if(!zipPack||installing)return;
  setInstalling(true);
  try{
   const entries=planCharacterAddonInstall(
    {format:"pixel-pals-character-addon",version:1,name:zipPack.name,characters:zipPack.characters},
    customCharacters,selected);
   const ok=await onInstallPack(entries);
   if(!ok)throw Error("Could not install the selected characters. Check Library storage status.");
   setMessage(entries.length+" character(s) installed! Use Add to place them in the Living World.");
   setZipPack(null);setSelected([]);
  }catch(e){setMessage(e instanceof Error?e.message:"Character import failed.");}
  finally{setInstalling(false);}
 };
 return <details className="world-character-library">
  <summary>Character Universe · {worldCharacterPacks.length} built-in visitors · {customCharacters.length} creations · {active} active</summary>
  <div className="world-library-body">
   <p className="text-xs text-muted-foreground">Choose who walks around your Living World. All guests are visual only; your existing AI Pals stay unchanged. Tap a guest in the room to wave.</p>
   <p role="status" className="text-xs text-muted-foreground">{syncStatus}</p>
   <div className="world-library-controls">
    <Button type="button" variant="outline" size="sm" disabled={customCharacters.length>=CUSTOM_WORLD_LIMIT} onClick={()=>setEditor(starterCustomCharacter())}><Plus className="size-3.5"/>Create character</Button>
    <Button type="button" variant="outline" size="sm" onClick={exportBackup}><Download className="size-3.5"/>Export JSON</Button>
    <label className="world-import-label world-import-zip"><Upload className="size-3.5"/>Import character ZIP <input aria-label="Choose character ZIP file" type="file" accept=".zip,application/zip,application/x-zip-compressed" onChange={e=>void handleZip(e)}/></label>
    <label className="world-import-label"><Upload className="size-3.5"/>Import JSON <input aria-label="Import character pack JSON" type="file" accept=".json,application/json" onChange={e=>void handleImport(e)}/></label>
   </div>
   {message&&<p role="status" className="text-xs">{message}</p>}
   {zipPack&&<section className="world-character-zip-review" aria-label="Review character ZIP">
    <strong className="text-sm">{zipPack.name} · 256×256 character preview</strong>
    <p className="text-xs text-muted-foreground">Select characters to install. All artwork is local PNG data; no scripts or permissions are imported.</p>
    <div className="world-library-grid">
     {zipPack.characters.map(c=><label className="world-library-card" key={c.id}>
      <input type="checkbox" aria-label={"Select "+c.name} checked={selected.includes(c.id)} disabled={installing||customCharacters.some(saved=>saved.id===c.id)}
       onChange={e=>setSelected(list=>e.target.checked?[...list,c.id]:list.filter(id=>id!==c.id))}/>
      {c.hd?<img className="world-library-preview world-library-hd" src={c.hd.idle[0]} width={256} height={256} alt={c.name+" 256 by 256 PNG preview"}/>:
       <WorldPixelPreview pixels={c.pixels} palette={c.palette} name={c.name}/>}
      <span className="text-xs"><strong>{c.name}</strong><span className="block text-muted-foreground">{customCharacters.some(saved=>saved.id===c.id)?"Already installed":"Ready to install"}</span></span>
     </label>)}
    </div>
    <div className="flex flex-wrap gap-2">
     <Button type="button" size="sm" disabled={installing||selected.length===0} onClick={()=>void installZip()}>{installing?"Installing...":"Approve & install "+selected.length+" character(s)"}</Button>
     <Button type="button" size="sm" variant="outline" disabled={installing} onClick={()=>{setZipPack(null);setSelected([]);setMessage("Import cancelled.");}}>Cancel</Button>
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
    {customCharacters.map(c=>{
     const on=enabledIds.includes(c.id);
     return <article className="world-library-card" key={c.id}>
      {c.hd?<img className="world-library-preview world-library-hd" src={c.hd.idle[0]} width={256} height={256} alt={c.name+" high resolution pixel art"}/>:<WorldPixelPreview pixels={c.pixels} palette={c.palette} name={c.name}/>}
      <div className="min-w-0 flex-1"><strong className="text-xs">{c.name}</strong><p className="text-xs text-muted-foreground">{c.hd?"Imported HD · 256×256 PNG":"Your original pixel character"}</p></div>
      <div className="world-library-card-controls">
       <Button size="sm" variant={on?"default":"outline"} aria-pressed={on} aria-label={(on?"Disable ":"Enable ")+c.name} onClick={()=>toggle(c.id)}>{on?"In room":"Add"}</Button>
       {!c.hd&&<Button size="sm" variant="ghost" aria-label={"Edit "+c.name} onClick={()=>setEditor(c)}><Pencil className="size-3.5"/></Button>}
       <Button size="sm" variant="ghost" aria-label={"Delete "+c.name} onClick={async()=>{
        if(window.confirm("Delete "+c.name+"? This removes its saved pixel art from your Character Library.")){
         const ok=await onDelete(c.id);setMessage(ok?"Character deleted.":"Could not delete character.");
        }
       }}><Trash2 className="size-3.5"/></Button>
      </div>
     </article>;
    })}
   </div>
   <p className="text-xs text-muted-foreground">Fan tribute sprites are unofficial originals, not downloaded artwork. Guest personalities are decorative, with no AI tools, memory or Discord permissions.</p>
  </div>
 </details>;
}
