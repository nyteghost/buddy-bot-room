import {useEffect,useState} from "react";
import {Download,KeyRound,Monitor,ShieldCheck,ShieldAlert,Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {AI_PROVIDERS,detectAiProvider,type AiProviderId} from "@/lib/showpilot-ai-providers";
import {gpuAvailable,localModelOptions,loadLocalModel} from "@/lib/showpilot-ai-local";
import type {AiStatus} from "@/lib/showpilot-ai-bridge";
const NAME="showpilot:ai:local-model";
export function ShowPilotAiSettings(){
 const [draft,setDraft]=useState("");
 const detection=detectAiProvider(draft);
 const [provider,setProvider]=useState<AiProviderId|"">("");
 const [secrets,setSecrets]=useState<AiStatus|null>(null);
 const [gpu,setGpu]=useState<boolean|null>(null);
 const [models,setModels]=useState<string[]>([]);
 const [model,setModel]=useState(()=>{try{return localStorage.getItem(NAME)||""}catch{return ""}});
 const [working,setWorking]=useState(false);
 const [status,setStatus]=useState("");
 const [progress,setProgress]=useState("");
 useEffect(()=>{
   void gpuAvailable().then(setGpu);
   void localModelOptions().then(list=>{setModels(list);setModel(old=>list.includes(old)?old:list[0]||"")}).catch(()=>setModels([]));
   if(window.showpilotAI)void window.showpilotAI.status().then(setSecrets).catch(()=>setSecrets({available:false,providers:[]}));
 },[]);
 const selected=provider||detection.provider;
 const save=async()=>{
   if(!window.showpilotAI||!secrets?.available||!selected)return;
   setWorking(true);setStatus("");
   try{const s=await window.showpilotAI.saveKey(selected,draft.trim());setSecrets(s);setDraft("");setProvider("");setStatus("API key encrypted using Windows protection and saved on this computer.");}
   catch(e){setStatus((e as Error).message)}
   finally{setWorking(false)}
 };
 const remove=async(id:AiProviderId)=>{
   if(!window.showpilotAI||!window.confirm("Remove the saved "+id+" API key?"))return;
   try{setSecrets(await window.showpilotAI.removeKey(id));setStatus("Credential removed.");}catch(e){setStatus((e as Error).message)}
 };
 const load=async()=>{
  if(!model||working)return;
  setWorking(true);setProgress("Checking GPU and preparing local model...");
  try{await loadLocalModel(model,setProgress);try{localStorage.setItem(NAME,model)}catch{};setStatus("Local model is ready. You can run task recommendations offline while cached.");}
  catch(e){setStatus("Could not load local model: "+(e as Error).message)}
  finally{setWorking(false)}
 };
 return <div className="space-y-6">
   <div className="rounded-xl border p-4 space-y-3">
     <h2 className="font-semibold flex items-center gap-2"><Monitor size={19}/> Local GPU AI — no Ollama or API key</h2>
     <p className="text-sm text-muted-foreground">Runs a small model directly inside ShowPilot using WebGPU. First use downloads model files to this app's cache; later runs can work without internet while the cached files remain. No report data is sent to an AI service in local mode.</p>
     <div className="text-sm">{gpu===null?"Checking GPU…":gpu?"WebGPU is available on this computer.":"No WebGPU adapter detected. Rule-based offline task suggestions remain available."}</div>
     <label className="text-xs font-semibold">Local model (small models are better for work PCs)</label>
     <select className="w-full max-w-xl rounded-md border bg-background p-2 text-sm" aria-label="Local AI model" value={model} onChange={e=>{setModel(e.target.value);try{localStorage.setItem(NAME,e.target.value)}catch{}}}>
       {models.length?models.map(m=><option value={m} key={m}>{m}</option>):<option value="">No compatible model list loaded</option>}
     </select>
     <div><Button onClick={()=>void load()} disabled={!gpu||!model||working}><Download size={16}/> {working?"Loading…":"Download / Load Local AI"}</Button></div>
     {progress&&<p role="status" className="text-xs text-muted-foreground">{progress}</p>}
     <p className="text-xs text-muted-foreground">Large model downloads may need substantial space and GPU memory. Cached model data is separate from ShowPilot work-data backups. Unsupported computers can continue using offline task rules.</p>
   </div>
   <div className="rounded-xl border p-4 space-y-3">
     <h2 className="font-semibold flex items-center gap-2"><KeyRound size={19}/> Online AI Providers</h2>
     <p className="text-sm text-muted-foreground">Paste an API key; ShowPilot tries to recognize its provider from the prefix. This is a hint, not proof. Ambiguous keys require manual selection. Keys are never saved to browser storage or exported with work backups.</p>
     {!window.showpilotAI?<p className="text-xs text-amber-700">Secure API key storage is available in the portable Windows application only. Browser mode can use Local WebGPU AI without keys.</p>:
      !secrets?.available?<p className="text-xs text-amber-700">Windows credential protection is unavailable. ShowPilot will not save plaintext keys.</p>:<div className="space-y-3">
       <Input type="password" autoComplete="off" spellCheck={false} aria-label="AI API key" placeholder="Paste your AI provider key" value={draft} onChange={e=>{setDraft(e.target.value);setProvider("");}}/>
       <p className="text-xs">{detection.description}</p>
       <label className="text-xs font-semibold">Provider</label>
       <select aria-label="AI key provider" value={selected||""} onChange={e=>setProvider(e.target.value as AiProviderId)} className="block w-full max-w-sm rounded-md border bg-background p-2 text-sm">
        <option value="">Choose provider</option>
        {AI_PROVIDERS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
       </select>
       <Button disabled={!draft.trim()||!selected||working} onClick={()=>void save()}><ShieldCheck size={16}/> Save encrypted key</Button>
      </div>}
     {secrets&&secrets.providers.length>0&&<div className="space-y-2">
      <p className="font-medium text-sm">Saved providers (keys hidden)</p>
      {secrets.providers.map(id=><div className="flex items-center justify-between gap-2 rounded border p-2" key={id}><span className="text-sm">{AI_PROVIDERS.find(p=>p.id===id)?.name||id}</span><Button size="sm" variant="outline" onClick={()=>void remove(id as AiProviderId)}><Trash2 size={14}/> Remove</Button></div>)}
     </div>}
     <p className="text-xs text-muted-foreground flex gap-2"><ShieldAlert size={15}/> Sending event context to a cloud AI requires a separate action and internet. Only OpenAI, Claude, and Gemini have a task-generation adapter currently; other providers are stored but not yet connected.</p>
   </div>
   {status&&<p role="status" className="rounded-lg border p-3 text-sm">{status}</p>}
 </div>;
}
