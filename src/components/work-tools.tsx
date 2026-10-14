import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Briefcase, CalendarPlus, CalendarSync, Download, FileUp, Search } from "lucide-react";
import { calendarStatus, completeCalendarConnect, pushShiftsToCalendar, startCalendarConnect } from "@/lib/calendar.functions";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildIcs, DEFAULT_SCHEDULE_NAME, entryLabel, formatMinutes, googleCalendarLink, parsePastedShifts, sheetRowFor, summarizeEvents, vendors, type EventEntry, type Shift } from "@/lib/work-tools";
import { deckReply } from "@/lib/deck-solver";
import { MessageResponse } from "@/components/ai-elements/message";

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

export function WorkTools() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="engine-trigger"><Briefcase className="size-4" /> Work tools</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Show Services tools</DialogTitle>
          <DialogDescription>Everything runs in this browser — files never leave your device.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="events">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="shifts">My shifts</TabsTrigger>
            <TabsTrigger value="deck">Deck</TabsTrigger>
            <TabsTrigger value="vendors">Vendors</TabsTrigger>
          </TabsList>
          <TabsContent value="events"><EventsTab /></TabsContent>
          <TabsContent value="shifts"><ShiftsTab /></TabsContent>
          <TabsContent value="deck"><DeckTab /></TabsContent>
          <TabsContent value="vendors"><VendorsTab /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function FilePick({ accept, label, onFile }: { accept: string; label: string; onFile: (f: File) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-muted">
      <FileUp className="size-4" /> {label}
      <input type="file" accept={accept} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </label>
  );
}

function EventsTab() {
  const [entries, setEntries] = useState<EventEntry[]>([]);
  const [status, setStatus] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  async function load(file: File) {
    setStatus("Reading…"); setBlob(null);
    try {
      const { readEventPdf, eventsWorkbook } = await import("@/lib/work-files");
      const rows = await readEventPdf(file);
      const list = summarizeEvents(rows);
      setEntries(list);
      setBlob(list.length ? await eventsWorkbook(list) : null);
      setStatus(list.length ? `${rows.length} lines read, ${list.length} schedule entries (date headers skipped).` : "No show, move-in or move-out lines found.");
    } catch (e) { setStatus(`Could not read that PDF: ${(e as Error).message}`); }
  }
  const { deliver } = useDeliver();
  return (
    <div className="space-y-3 pt-2">
      <FilePick accept="application/pdf" label="Drop an Ungerboeck “Event Functions” PDF" onFile={load} />
      <p className="text-xs text-muted-foreground">S = show · Exmi = exhibitor move in · MI = move in · MO = move out. Orange date rows are ignored.</p>
      {status && <p className="text-sm">{status}</p>}
      {entries.length > 0 && (
        <>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left"><tr><th className="p-2">Day</th><th className="p-2">Space</th><th className="p-2">Entry</th></tr></thead>
              <tbody>{entries.map((e, i) => (
                <tr key={i} className="border-t border-border"><td className="p-2">{dayLabel(e.date)}</td><td className="p-2">{sheetRowFor(e.space)}</td><td className="p-2 font-mono">{entryLabel(e)} <span className="text-muted-foreground">{e.title}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
          {blob && <Button size="sm" onClick={() => deliver(blob, "event-schedule.xlsx")}><Download className="size-4" /> Download Excel</Button>}
        </>
      )}
    </div>
  );
}

function useDeliver() {
  return { deliver: (blob: Blob, name: string) => import("@/lib/work-files").then((m) => m.downloadBlob(blob, name)) };
}

function waitForOAuthCompletion(popup: Window) {
  return new Promise<string | null>((resolve, reject) => {
    let poll: number | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (poll !== undefined) window.clearInterval(poll);
    };
    const onMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "google_calendar" ||
        (type !== "appUserConnectorOAuthComplete" && type !== "appUserConnectorOAuthFailed")
      ) return;
      cleanup();
      if (type === "appUserConnectorOAuthComplete") {
        resolve(typeof event.data?.code === "string" ? event.data.code : null);
        return;
      }
      popup.close();
      reject(new Error("Google Calendar connection failed."));
    };
    window.addEventListener("message", onMessage);
    poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("Google sign-in window was closed before finishing."));
    }, 500);
  });
}

/** Button that connects Google Calendar once, then pushes every shift with one click. */
function AddAllToCalendar({ shifts, onStatus }: { shifts: Shift[]; onStatus: (s: string) => void }) {
  const session = useSession();
  const start = useServerFn(startCalendarConnect);
  const complete = useServerFn(completeCalendarConnect);
  const push = useServerFn(pushShiftsToCalendar);
  const status = useServerFn(calendarStatus);
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  async function connect(): Promise<boolean> {
    const popup = window.open("", "lovable-oauth", "width=600,height=720");
    if (!popup) { onStatus("Popup blocked — allow popups and try again."); return false; }
    try {
      const { authorizationUrl } = await start();
      const completion = waitForOAuthCompletion(popup);
      popup.location.href = authorizationUrl;
      const code = await completion;
      if (code) await complete({ data: { code } });
      return true;
    } catch (e) {
      popup.close();
      onStatus((e as Error).message);
      return false;
    }
  }

  async function run() {
    setBusy(true);
    onStatus("");
    try {
      let { connected } = await status();
      if (!connected) connected = await connect();
      if (!connected) return;
      const r = await push({ data: { shifts } });
      if (!r.connected) {
        onStatus(r.reconnectRequired ? "Your Google Calendar access needs to be renewed — click again to reconnect." : "Google Calendar is not connected yet — click again to connect.");
        return;
      }
      onStatus(`Added ${r.added} shift${r.added === 1 ? "" : "s"} to your Google Calendar${r.skipped ? ` (${r.skipped} skipped)` : ""}.`);
    } catch (e) {
      onStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy || !shifts.length} onClick={run}>
      <CalendarSync className="size-4" /> {busy ? "Working…" : "Add all to Google Calendar"}
    </Button>
  );
}

function ShiftsTab() {
  const [name, setName] = useState(DEFAULT_SCHEDULE_NAME);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  async function load(f: File, who = name) {
    setFile(f); setStatus("Reading…");
    try {
      const { readScheduleWorkbook } = await import("@/lib/work-files");
      const { shifts, people } = await readScheduleWorkbook(f, who);
      setShifts(shifts);
      setStatus(shifts.length ? `${shifts.length} shifts for ${who}.` : `No shifts found for “${who}”. Names on sheet: ${people.slice(0, 12).join(", ")}`);
    } catch (e) { setStatus(`Could not read that workbook: ${(e as Error).message}`); }
  }
  const ics = () => import("@/lib/work-files").then((m) => m.downloadBlob(new Blob([buildIcs(shifts)], { type: "text/calendar" }), "my-shifts.ics"));
  const [pasted, setPasted] = useState("");
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // this week's Monday
    return d.toISOString().slice(0, 10);
  });
  function readPasted() {
    const list = parsePastedShifts(pasted, weekStart, name);
    setShifts(list);
    setStatus(list.length ? `${list.length} shifts for ${name}.` : `No shifts found — make sure the first line starts with “${name}” and the times look like 9a-6p.`);
  }
  return (
    <div className="space-y-3 pt-2">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name on schedule" />
        {file && <Button variant="outline" onClick={() => load(file)}>Re-read</Button>}
      </div>
      <FilePick accept=".xlsx,.xls" label="Drop a monthly schedule workbook (.xlsx)" onFile={(f) => load(f)} />
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm text-muted-foreground">…or paste your rows from Excel</summary>
        <div className="mt-2 space-y-2">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={3}
            aria-label="Pasted schedule rows"
            placeholder={"Paste the week block from Excel — include the date row (10/19/26 … 10/25/26) and your name row."}
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="week-start">Week starting (Mon)</label>
            <Input id="week-start" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="w-auto" />
            <Button size="sm" onClick={readPasted} disabled={!pasted.trim()}>Read</Button>
          </div>
        </div>
      </details>
      {status && <p className="text-sm">{status}</p>}
      {shifts.length > 0 && (
        <>
          <Button size="sm" onClick={ics}><Download className="size-4" /> Download all (.ics)</Button>
          <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {shifts.map((s) => (
              <li key={s.date} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                <span>{dayLabel(s.date)} · <span className="font-mono">{formatMinutes(s.start)}–{formatMinutes(s.end)}</span></span>
                <a href={googleCalendarLink(s)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline"><CalendarPlus className="size-4" /> Google</a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DeckTab() {
  const [size, setSize] = useState("24x24x32");
  const reply = deckReply(`@deck ${size}`);
  return (
    <div className="space-y-3 pt-2">
      <Input value={size} onChange={(e) => setSize(e.target.value)} aria-label="Stage size" placeholder='width x length x height, e.g. 24x24x32' />
      {reply && <div className="rounded-md border border-border p-3 text-sm"><MessageResponse>{reply}</MessageResponse></div>}
      <p className="text-xs text-muted-foreground">Tip: type <code>@deck 24x24x32</code> in the chat box too.</p>
    </div>
  );
}

function VendorsTab() {
  const [q, setQ] = useState("");
  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-2"><Search className="size-4" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="gaffer tape 2in black" aria-label="Item" /></div>
      <ul className="space-y-2 text-sm">
        {vendors.map((v) => (
          <li key={v.name} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
            <span><strong>{v.name}</strong> <span className="text-muted-foreground">— {v.taxNote}</span></span>
            <a className={q.trim() ? "text-primary underline" : "pointer-events-none opacity-50"} href={v.url(q.trim())} target="_blank" rel="noreferrer">Search</a>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Compare listed prices before tax — you're tax-exempt.</p>
    </div>
  );
}
