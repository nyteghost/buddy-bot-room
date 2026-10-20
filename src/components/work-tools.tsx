import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Briefcase, CalendarPlus, CalendarSync, Download, FileUp, Search } from "lucide-react";
import { calendarStatus, completeCalendarConnect, pushShiftsToCalendar, startCalendarConnect } from "@/lib/calendar.functions";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildIcs, DEFAULT_SCHEDULE_NAME, editShift, entryLabel, formatMinutes, googleCalendarLink, isIsoDate, minutesToTime, newShiftId, parsePastedShifts, shiftLabel, summarizeEvents, timeToMinutes, vendors, withShiftIds, type EventEntry, type Shift } from "@/lib/work-tools";
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
        <ShowServicesTools />
      </DialogContent>
    </Dialog>
  );
}

export function ShowServicesTools() {
  return <Tabs defaultValue="events">
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
        </Tabs>;
}

function FilePick({ accept, label, onFile, onFiles }: { accept: string; label: string; onFile?: (f: File) => void; onFiles?: (f: File[]) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-muted">
      <FileUp className="size-4" /> {label}
      <input type="file" accept={accept} multiple={!!onFiles} className="sr-only" onChange={(e) => { const list = [...(e.target.files ?? [])]; if (onFiles && list.length) onFiles(list); else if (list[0]) onFile?.(list[0]); e.target.value = ""; }} />
    </label>
  );
}

function EventsTab() {
  const [entries, setEntries] = useState<EventEntry[]>([]);
  const [status, setStatus] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [merged, setMerged] = useState(false);
  async function load(files: File[]) {
    setStatus("Reading…"); setBlob(null);
    try {
      const { readEventPdf, eventsWorkbook } = await import("@/lib/work-files");
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
      const existing = files.find((f) => /\.xlsx?$/i.test(f.name));
      const rows = (await Promise.all(pdfs.map(readEventPdf))).flat();
      const list = summarizeEvents(rows);
      setEntries(list); setMerged(!!existing);
      setBlob(list.length ? await eventsWorkbook(list, existing) : null);
      const dates = new Set(list.map((e) => e.date)).size;
      setStatus(list.length ? `${pdfs.length} PDF${pdfs.length > 1 ? "s" : ""} · ${list.length} entries across ${dates} days. ${existing ? `Filled into ${existing.name} — engineer shifts kept.` : "Built weekly sheets with the engineering roster."}` : "No show, move-in or move-out lines found.");
    } catch (e) { setStatus(`Could not read that PDF: ${(e as Error).message}`); }
  }
  const { deliver } = useDeliver();
  return (
    <div className="space-y-3 pt-2">
      <FilePick accept="application/pdf,.xlsx" label="Drop Ungerboeck PDFs — add your monthly schedule .xlsx to fill it in" onFiles={load} />
      <p className="text-xs text-muted-foreground">S = show · Exmi = exhibitor move in / service desk · MI = move in · MO = move out. Combined halls split into each hall. Escalators = 1 hr before first show to 1 hr after.</p>
      {status && <p className="text-sm">{status}</p>}
      {entries.length > 0 && (
        <>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left"><tr><th className="p-2">Day</th><th className="p-2">Space</th><th className="p-2">Entry</th></tr></thead>
              <tbody>{entries.map((e, i) => (
                <tr key={i} className="border-t border-border"><td className="p-2">{dayLabel(e.date)}</td><td className="p-2">{e.space}</td><td className="p-2 font-mono">{entryLabel(e)} <span className="text-muted-foreground">{e.title}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
          {blob && <Button size="sm" onClick={() => deliver(blob, merged ? "schedule-updated.xlsx" : "engineering-schedule.xlsx")}><Download className="size-4" /> Download Excel</Button>}
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
type GoogleReply = { configured?: boolean; connected?: boolean; error?: string; added?: number; updated?: number; removed?: number; skipped?: number; reasons?: string[] };

function AddAllToCalendar({ shifts, title, remove, onPushed, onStatus, onDownload }: { shifts: Shift[]; title: string; remove: string[]; onPushed: () => void; onStatus: (s: string) => void; onDownload: () => void }) {
  const session = useSession();
  const start = useServerFn(startCalendarConnect);
  const complete = useServerFn(completeCalendarConnect);
  const push = useServerFn(pushShiftsToCalendar);
  const status = useServerFn(calendarStatus);
  const [busy, setBusy] = useState(false);
  // null = unknown yet; false = must open the Google popup on the next click.
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!session) return;
    status().then((r) => setReady(r.connected)).catch(() => setReady(false));
  }, [session, status]);
  const [own, setOwn] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [ownBusy, setOwnBusy] = useState(false);
  const ownCall = async (body: object) => (await fetch("/api/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<GoogleReply>;
  useEffect(() => {
    if (session) return;
    ownCall({ op: "status" }).then((r) => setOwn({ configured: !!r.configured, connected: !!r.connected })).catch(() => setOwn({ configured: false, connected: false }));
    const done = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.pixelpals === "google-connected") setOwn({ configured: true, connected: true }); };
    window.addEventListener("message", done);
    return () => window.removeEventListener("message", done);
  }, [session]);
  async function ownRun() {
    setOwnBusy(true);
    try {
      const r = await ownCall({ op: "push", shifts, title, remove });
      if (!r.connected) {
        setOwn((o) => ({ configured: o?.configured ?? true, connected: false }));
        onStatus(String(r.error ?? "Google Calendar isn't connected yet."));
        return;
      }
      const reasons = r.reasons ?? [];
      const why = reasons.length ? ` — ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? ` (+${reasons.length - 3} more)` : ""}` : "";
      if (!r.skipped) onPushed();
      const bits = [r.added ? `added ${r.added}` : "", r.updated ? `updated ${r.updated}` : "", r.removed ? `removed ${r.removed}` : ""].filter(Boolean).join(", ") || "nothing to change";
      onStatus(`Google Calendar: ${bits}${r.skipped ? ` (${r.skipped} skipped${why})` : ""}.`);
    } catch { onStatus("Couldn't reach Pixel Pals."); } finally { setOwnBusy(false); }
  }
  // Not signed in to the hosted app (your own server): use your own Google sign-in when it's set up, otherwise download one calendar file.
  // Each event has a fixed id, so pushing or importing again updates the same events instead of making copies.
  if (!session) return (
    <>
      {own?.connected
        ? <Button size="sm" variant="outline" disabled={ownBusy || !shifts.length} onClick={ownRun}><CalendarSync className="size-4" /> {ownBusy ? "Working…" : "Add or update in Google Calendar"}</Button>
        : own?.configured
          ? <Button size="sm" variant="outline" onClick={() => { if (!window.open(`/api/google/start?origin=${encodeURIComponent(location.origin)}`, "pixelpals-google", "width=520,height=700")) onStatus("Popup blocked. Allow popups for this site and try again."); else onStatus("Approve Google Calendar access in the popup, then press the button again."); }}><CalendarSync className="size-4" /> Connect Google Calendar</Button>
          : null}
      <Button size="sm" variant="secondary" disabled={!shifts.length} onClick={() => {
        onDownload();
        window.open("https://calendar.google.com/calendar/u/0/r/settings/export", "_blank", "noopener");
        onStatus("Downloaded my-shifts.ics. In the Google Calendar tab: Import → Select file from your computer → pick the calendar → Import. Importing again later updates the same events.");
      }}><CalendarPlus className="size-4" /> {own?.connected ? "Download .ics instead" : "Add all to Google Calendar"}</Button>
    </>
  );

  // The popup must open synchronously inside the click, before any await, or browsers block it.
  async function connect(popup: Window): Promise<boolean> {
    try {
      const { authorizationUrl } = await start();
      const completion = waitForOAuthCompletion(popup);
      popup.location.href = authorizationUrl;
      const code = await completion;
      if (code) await complete({ data: { code } });
      setReady(true);
      return true;
    } catch (e) {
      popup.close();
      onStatus((e as Error).message);
      return false;
    }
  }

  async function run() {
    const popup = ready ? null : window.open("", "lovable-oauth", "width=600,height=720");
    if (!ready && !popup) { onStatus("Popup blocked — allow popups for this site and try again."); return; }
    setBusy(true);
    onStatus(popup ? "Approve Google Calendar access in the popup…" : "");
    try {
      if (popup && !(await connect(popup))) return;
      const r = await push({ data: { shifts, title, remove } });
      if (!r.connected) {
        setReady(false);
        onStatus(r.reconnectRequired ? "Your Google Calendar access needs to be renewed — click the button again to reconnect." : "Google Calendar is not connected yet — click the button again to connect.");
        return;
      }
      const why = r.reasons?.length ? ` — ${r.reasons.slice(0, 3).join("; ")}${r.reasons.length > 3 ? ` (+${r.reasons.length - 3} more)` : ""}` : "";
      if (!r.skipped) onPushed();
      const bits = [r.added ? `added ${r.added}` : "", r.updated ? `updated ${r.updated}` : "", r.removed ? `removed ${r.removed}` : ""].filter(Boolean).join(", ") || "nothing to change";
      onStatus(`Google Calendar: ${bits}${r.skipped ? ` (${r.skipped} skipped${why})` : ""}.`);
    } catch (e) {
      onStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={busy || !shifts.length} onClick={run}>
      <CalendarSync className="size-4" /> {busy ? "Working…" : "Add or update in Google Calendar"}
    </Button>
  );
}

function ShiftsTab() {
  const [name, setName] = useState(DEFAULT_SCHEDULE_NAME);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("Mark Work");
  const [removed, setRemoved] = useState<string[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const edit = (i: number, change: Parameters<typeof editShift>[1]) => setShifts((list) => list.map((x, n) => (n === i ? editShift(x, change) : x)));
  const drop = (i: number) => {
    const gone = shifts[i];
    if (gone?.id) setRemoved((r) => [...new Set([...r, gone.id!])]);
    setShifts((list) => list.filter((_, n) => n !== i));
    setEditing(null);
  };
  const add = () => {
    const last = shifts[shifts.length - 1];
    const date = last ? new Date(Date.parse(`${last.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
    setShifts((list) => [...list, { date, start: 9 * 60, end: 17 * 60, raw: "9a-5p", id: newShiftId() }]);
    setEditing(shifts.length);
  };
  async function load(f: File, who = name) {
    setFile(f); setStatus("Reading…");
    try {
      const { readScheduleWorkbook } = await import("@/lib/work-files");
      const { shifts, people } = await readScheduleWorkbook(f, who);
      setShifts(withShiftIds(shifts)); setRemoved([]); setEditing(null);
      setStatus(shifts.length ? `${shifts.length} shifts for ${who}.` : `No shifts found for “${who}”. Names on sheet: ${people.slice(0, 12).join(", ")}`);
    } catch (e) { setStatus(`Could not read that workbook: ${(e as Error).message}`); }
  }
  const ics = () => import("@/lib/work-files").then((m) => m.downloadBlob(new Blob([buildIcs(shifts, title.trim() || "Mark Work")], { type: "text/calendar" }), "my-shifts.ics"));
  const [pasted, setPasted] = useState("");
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // this week's Monday
    return d.toISOString().slice(0, 10);
  });
  function readPasted() {
    const list = parsePastedShifts(pasted, weekStart, name);
    setShifts(withShiftIds(list)); setRemoved([]); setEditing(null);
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
      {(shifts.length > 0 || removed.length > 0) && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground" htmlFor="shift-title">Event title</label>
            <Input id="shift-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="w-48" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={ics} disabled={!shifts.length}><Download className="size-4" /> Download all (.ics)</Button>
            <AddAllToCalendar onDownload={() => void ics()} shifts={shifts} title={title.trim() || "Mark Work"} remove={removed} onPushed={() => setRemoved([])} onStatus={setStatus} />
            <Button size="sm" variant="outline" onClick={add}>Add a shift</Button>
          </div>
          {removed.length > 0 && <p className="text-xs text-muted-foreground">{removed.length} removed shift{removed.length === 1 ? "" : "s"} will also be deleted from Google Calendar the next time you press “Add or update”.</p>}
          <p className="text-xs text-muted-foreground">Press Edit on a shift to change its date, times or note. Pushing again updates the events you already added instead of making copies.</p>
          <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {shifts.map((s, i) => (
              <li key={s.id ?? `${s.date}-${i}`} className="rounded border border-border px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span>{dayLabel(s.date)} · <span className="font-mono">{shiftLabel(s)}</span>{s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}</span>
                  <span className="flex items-center gap-2">
                    <button type="button" className="text-primary underline" aria-expanded={editing === i} onClick={() => setEditing(editing === i ? null : i)}>{editing === i ? "Done" : "Edit"}</button>
                    <a href={googleCalendarLink(s, title.trim() || "Mark Work")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline"><CalendarPlus className="size-4" /> Google</a>
                  </span>
                </div>
                {editing === i && (
                  <div className="mt-2 grid gap-2 border-t border-border pt-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs text-muted-foreground">Date
                      <Input type="date" value={s.date} onChange={(e) => { if (isIsoDate(e.target.value)) edit(i, { date: e.target.value }); }} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="grid gap-1 text-xs text-muted-foreground">Start
                        <Input type="time" value={minutesToTime(s.start)} onChange={(e) => { const m = timeToMinutes(e.target.value); if (m !== null) edit(i, { start: m }); }} />
                      </label>
                      <label className="grid gap-1 text-xs text-muted-foreground">End
                        <Input type="time" value={minutesToTime(s.end)} onChange={(e) => { const m = timeToMinutes(e.target.value); if (m !== null) edit(i, { end: m }); }} />
                      </label>
                    </div>
                    <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">Note (added to the event description)
                      <Input value={s.note ?? ""} maxLength={300} onChange={(e) => edit(i, { note: e.target.value })} placeholder="e.g. Hall B load-in" />
                    </label>
                    <div className="sm:col-span-2"><Button size="sm" variant="ghost" className="text-destructive" onClick={() => drop(i)}>Remove this shift</Button></div>
                  </div>
                )}
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
