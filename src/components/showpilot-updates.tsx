import {useEffect,useState} from "react";
type Channel="main"|"beta";
type Check={channel:Channel;latest:null|{runId:number;sha:string;created:string;url:string};message:string};
type Api={status:()=>Promise<{channel:Channel;installedVersion:string}>;setChannel:(v:Channel)=>Promise<{channel:Channel}>;check:()=>Promise<Check>;open:()=>Promise<unknown>};
declare global {interface Window {showpilotUpdates?:Api}}
export function ShowPilotUpdates(){
 const api=typeof window!=="undefined"?window.showpilotUpdates:undefined;
 const [channel,setChannel]=useState<Channel>("beta");
 const [version,setVersion]=useState("");
 const [check,setCheck]=useState<Check|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{if(api)void api.status().then(s=>{setChannel(s.channel);setVersion(s.installedVersion)}).catch(e=>setError(String(e)))},[api]);
 const change=async(v:Channel)=>{setError("");setCheck(null);if(!api)return;try{await api.setChannel(v);setChannel(v)}catch(e){setError(String(e))}};
 const run=async()=>{if(!api)return;setBusy(true);setError("");try{setCheck(await api.check())}catch(e){setError(String(e))}finally{setBusy(false)}};
 const open=async()=>{if(!api)return;setBusy(true);setError("");try{await api.open()}catch(e){setError(String(e))}finally{setBusy(false)}};
 return <div className="rounded-lg border border-border p-4 space-y-3">
  <h2 className="font-semibold text-lg">App Updates</h2>
  <p className="text-sm text-muted-foreground">Choose your ShowPilot release channel and check for the latest Windows portable build.</p>
  {!api?<p className="text-sm">Automatic update checks are available in the Windows portable app. Browser users can download builds from GitHub Actions.</p>:<>
  <label className="block text-sm font-medium">Update channel
   <select className="block mt-1 rounded border border-border bg-background p-2 w-full max-w-xs" value={channel} onChange={e=>void change(e.target.value as Channel)}>
    <option value="main">Main — stable</option><option value="beta">Beta — testing</option>
   </select>
  </label>
  <p className="text-xs text-muted-foreground">Installed version: {version||"Unknown"} · Switching channels does not replace the current app until you download that build.</p>
  <div className="flex gap-2 flex-wrap">
   <button type="button" className="rounded bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={()=>void run()}>{busy?"Checking…":"Check for Updates"}</button>
   {check?.latest&&<button type="button" className="rounded border border-border px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={()=>void open()}>Download from GitHub</button>}
  </div>
  {check&&<p className="text-sm">{check.message}{check.latest?<> Latest build: <code>{check.latest.sha.slice(0,9)}</code> ({new Date(check.latest.created).toLocaleDateString()}).</>:null}</p>}
  <p className="text-xs text-muted-foreground">For safety, downloads open the official GitHub Actions page. Download the Windows portable artifact, close ShowPilot, and extract the updated files. Your local workspace data is kept separately.</p>
  </>}
  {error&&<p role="alert" className="text-sm text-red-500">{error}</p>}
 </div>;
}
