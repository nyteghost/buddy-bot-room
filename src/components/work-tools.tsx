import { useState } from "react";
import { Briefcase, CalendarPlus, Download, FileUp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildIcs, DEFAULT_SCHEDULE_NAME, entryLabel, formatMinutes, googleCalendarLink, sheetRowFor, summarizeEvents, vendors, type EventEntry, type Shift } from "@/lib/work-tools";
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
  return (
    <div className="space-y-3 pt-2">
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name on schedule" />
        {file && <Button variant="outline" onClick={() => load(file)}>Re-read</Button>}
      </div>
      <FilePick accept=".xlsx,.xls" label="Drop a monthly schedule workbook (.xlsx)" onFile={(f) => load(f)} />
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
