import {useState} from "react";
import {Download,Upload,DatabaseBackup} from "lucide-react";
import {Button} from "@/components/ui/button";
import {exportWorkBackup,parseWorkBackup,restoreWorkBackup} from "@/lib/showpilot-backup";
export function BackupPanel(){
 const [status,setStatus]=useState("");
 const download=()=>{
  try{const b=exportWorkBackup(localStorage);const text=JSON.stringify(b,null,2);
   const url=URL.createObjectURL(new Blob([text],{type:"application/json"}));
   const a=document.createElement("a");a.href=url;a.download="showpilot-work-backup-"+new Date().toISOString().slice(0,10)+".json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setStatus("Work Tools backup downloaded. Keep it somewhere secure.");
  }catch(e){setStatus("Backup failed: "+(e as Error).message);}
 };
 const restore=async(f:File)=>{
  try{
   if(f.size>5_000_000)throw new Error("Backup exceeds 5 MB");
   const data=parseWorkBackup(await f.text());
   const n=Object.keys(data.data).length;
   if(!window.confirm("Restore "+n+" Work Tools settings/data entries? Existing matching saved data will be replaced."))return;
   restoreWorkBackup(data,localStorage);setStatus("Restored "+n+" entries. Reload ShowPilot to see the restored data.");
  }catch(e){setStatus("Restore failed: "+(e as Error).message);}
 };
 return <section className="sp-backup">
  <div><h2 className="font-semibold flex items-center gap-2"><DatabaseBackup size={18}/> Backup and restore</h2>
    <p className="text-xs text-muted-foreground mt-1">Save your stage plans, floor-map answers, vendor quotes and ShowPilot preferences. Backups stay on your device.</p></div>
  <div className="flex flex-wrap gap-2">
   <Button size="sm" variant="outline" onClick={download}><Download size={16}/> Export work data</Button>
   <label className="inline-flex items-center gap-2 cursor-pointer rounded-md border border-border px-3 py-2 text-xs font-semibold"><Upload size={16}/> Restore from backup
    <input className="sr-only" type="file" accept=".json" onChange={e=>{const f=e.target.files?.[0];if(f)void restore(f);e.target.value="";}}/>
   </label>
  </div>
  {status&&<p role="status" className="text-xs text-muted-foreground">{status}</p>}
 </section>;
}
