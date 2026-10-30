import { useEffect, useState } from "react";
import { CalendarSync, CheckCircle2, ExternalLink, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GoogleCalendarStatus } from "@/lib/showpilot-calendar-bridge";

export function GoogleCalendarSettings() {
  const [state, setState] = useState<GoogleCalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (window.showpilotCalendar) void window.showpilotCalendar.status().then(setState).catch(e => setMessage(String(e)));
  }, []);

  async function loadClient(file: File) {
    if (!window.showpilotCalendar) return;
    setBusy(true);setMessage("");
    try {
      if (file.size > 12000) throw new Error("The Google OAuth JSON is too large.");
      const status=await window.showpilotCalendar.saveClient(await file.text());
      setState(status);
      setMessage("Desktop OAuth credentials saved securely. Now click Connect Google Calendar.");
    } catch(e){setMessage("Could not configure Calendar: "+(e as Error).message)}
    finally{setBusy(false)}
  }
  async function connect(){
    if(!window.showpilotCalendar)return;
    setBusy(true);setMessage("Google sign-in will open in your regular browser. Approve access, then return to ShowPilot.");
    try{setState(await window.showpilotCalendar.connect());setMessage("Google Calendar connected. Open My Shifts and click Update in Google.");}
    catch(e){setMessage("Connection failed: "+(e as Error).message)}
    finally{setBusy(false)}
  }
  async function disconnect(clear=false){
    if(!window.showpilotCalendar)return;
    if(clear&&!window.confirm("Remove Google authorization AND your stored OAuth client configuration from this computer?"))return;
    setBusy(true);
    try{setState(clear?await window.showpilotCalendar.forget():await window.showpilotCalendar.disconnect());setMessage(clear?"Google settings removed from this computer.":"Google account disconnected; OAuth client configuration kept.");}
    catch(e){setMessage("Could not disconnect: "+(e as Error).message)}
    finally{setBusy(false)}
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="Google Calendar integration">
    <div className="flex items-center gap-2"><CalendarSync size={19}/><h2 className="font-semibold">Google Calendar — One-click shift updates</h2></div>
    <p className="text-sm text-muted-foreground">Connect once, then use <strong>Update in Google</strong> in My Shifts to add or update your entire schedule at once. Changes are sent only when you press the button. This requires internet access.</p>
    {!window.showpilotCalendar ? <p className="text-xs text-amber-700">Google sign-in is available in the portable Windows ShowPilot app. The browser build supports exporting .ics files instead.</p>
     : <>
        <div className="flex items-center gap-2 text-sm">{state?.connected?<><CheckCircle2 size={18} className="text-green-600"/>Connected to Google Calendar</>:
          state?.configured ? "Desktop OAuth configured; Google account not connected." : "Google authorization needs one-time setup."}</div>
        {state&&!state.available && <p className="text-sm text-red-700">Secure Windows credential storage is unavailable, so Google tokens cannot be saved. .ics export still works.</p>}
        {state?.available && <>
          <div className="rounded-lg bg-muted p-3 space-y-2">
            <p className="text-sm font-semibold">One-time setup (Google Desktop OAuth)</p>
            <p className="text-xs">In the Google Cloud Console, enable the Google Calendar API, configure the OAuth consent screen, and create an OAuth client with application type <strong>Desktop app</strong>. Download its JSON credentials file and select it here. Do not use a service-account JSON file.</p>
            <a className="inline-flex items-center gap-1 text-sm text-primary underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud credentials <ExternalLink size={14}/></a>
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"><Upload size={16}/> {state.configured?"Replace Desktop OAuth JSON":"Select downloaded Desktop OAuth JSON"}
              <input type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void loadClient(file);e.target.value="";}}/>
            </label>
            <p className="text-xs">For personal/testing OAuth applications, Google may require adding your Google account as an allowed test user. Company-managed Google accounts may require your IT administrator to approve access.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!state.connected&&<Button size="sm" disabled={!state.configured||busy} onClick={()=>void connect()}><CalendarSync size={16}/>{busy?"Connecting…":"Connect Google Calendar"}</Button>}
            {state.connected&&<Button variant="outline" size="sm" disabled={busy} onClick={()=>void disconnect()} >Disconnect Google account</Button>}
            {state.configured&&<Button variant="ghost" size="sm" disabled={busy} onClick={()=>void disconnect(true)}><Trash2 size={16}/> Remove Google settings</Button>}
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-2"><ShieldCheck size={15}/> Google credentials and refresh tokens are encrypted with Windows protection, stay on this computer, and are excluded from Work Tools backups. Disconnect does not delete any calendar events.</p>
        </>}
       </>}
    {message&&<p role="status" className="text-xs rounded border p-2">{message}</p>}
  </section>;
}
