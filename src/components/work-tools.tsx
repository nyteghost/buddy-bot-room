import { lazy, Suspense, useEffect, useState } from "react";
import { Briefcase, CalendarClock, CalendarDays, CalendarPlus, CalendarSync, Download, ExternalLink, FileUp, GitBranch, Layers, Map as MapIcon, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildIcs, DEFAULT_SCHEDULE_NAME, editShift, entryLabel, formatMinutes, googleCalendarLink, isIsoDate, minutesToTime, newShiftId, parsePastedShifts, shiftLabel, airwallTasks, isCancelledRow, isPendingRow, sharedSpaces, summarizeEvents, taskSuggestions, timeToMinutes, withShiftIds, type EventEntry, type EventRow, type Shift, type TaskNote } from "@/lib/work-tools";
import { StandaloneVendors } from "@/components/showpilot-vendors";
import { FloorMapPanel } from "@/components/floor-map-panel";
import { scopeShowPilotRows } from "@/lib/showpilot-venue";

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

const TABS = [
  { id: "events", label: "Events", Icon: CalendarDays, hint: "Turn Ungerboeck event PDFs into the engineering schedule workbook." },
  { id: "shifts", label: "My shifts", Icon: CalendarClock, hint: "Pull your shifts from the monthly schedule and put them on your calendar." },
  { id: "deck", label: "Deck", Icon: Layers, hint: "Plan a stage from the decks, stairs and rails in the warehouse." },
  { id: "vendors", label: "Vendors", Icon: Store, hint: "Compare prices and rentals across your usual suppliers." },
  { id: "floor", label: "Floor map", Icon: MapIcon, hint: "Color a floor plan from the work order: who ordered what power, where." },
] as const;
export type WorkTabId = (typeof TABS)[number]["id"];
type TabId = WorkTabId;
const TAB_KEY = "pixelpals:work-tab";
const startTab = (): TabId => {
  try {
    const q = new URLSearchParams(location.search).get("tab") ?? localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === q) ? (q as TabId) : "events";
  } catch { return "events"; }
};

export function ShowServicesTools({ page = false, selectedTab, hideTabBar = false, venueOnly = false }: { page?: boolean; selectedTab?: WorkTabId; hideTabBar?: boolean; venueOnly?: boolean } = {}) {
  const [tab, setTab] = useState<TabId>("events");
  useEffect(() => { if (!selectedTab) setTab(startTab()); }, [selectedTab]); // after mount so server and browser render the same first frame
  const pick = (v: string) => { setTab(v as TabId); try { localStorage.setItem(TAB_KEY, v); } catch { /* private window */ } };
  const activeTab = selectedTab ?? tab;
  const cur = TABS.find((x) => x.id === activeTab) ?? TABS[0];
  return <Tabs value={activeTab} onValueChange={pick}>
          {!hideTabBar && <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
            {TABS.map(({ id, label, Icon }) => (
              <TabsTrigger key={id} value={id} className="gap-1.5"><Icon className="size-4" aria-hidden />{label}</TabsTrigger>
            ))}
          </TabsList>}
          <div className="flex items-start justify-between gap-3 pt-2">
            <p className="text-sm text-muted-foreground">{cur.hint}</p>
            {!page && <a href={`/work?tab=${tab}`} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-primary underline"><ExternalLink className="size-3.5" /> Open as its own page</a>}
          </div>
          <TabsContent value="events"><EventsTab venueOnly={venueOnly} /></TabsContent>
          <TabsContent value="shifts"><ShiftsTab /></TabsContent>
          <TabsContent value="deck"><DeckTab /></TabsContent>
          <TabsContent value="vendors"><StandaloneVendors /></TabsContent>
          <TabsContent value="floor"><FloorMapPanel /></TabsContent>
        </Tabs>;
}

function FilePick({ accept, label, onFile, onFiles }: { accept: string; label: string; onFile?: (f: File) => void; onFiles?: (f: File[]) => void }) {
  const [over, setOver] = useState(false);
  const take = (list: File[]) => { if (onFiles && list.length) onFiles(list); else if (list[0]) onFile?.(list[0]); };
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take([...e.dataTransfer.files]); }}
      className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center text-sm hover:bg-muted ${over ? "border-primary bg-muted text-foreground" : "border-border text-muted-foreground"}`}
    >
      <FileUp className="size-4 shrink-0" /> {label}
      <input type="file" accept={accept} multiple={!!onFiles} className="sr-only" onChange={(e) => { take([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </label>
  );
}

function EventsTab({ venueOnly = false }: { venueOnly?: boolean }) {
  const [entries, setEntries] = useState<EventEntry[]>([]);
  const [status, setStatus] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [merged, setMerged] = useState(false);
  const [tasks, setTasks] = useState<TaskNote[]>([]);
  const [shared, setShared] = useState<string[]>([]);
  const [source, setSource] = useState<{ rows: EventRow[]; existing?: File; sources: number } | null>(null);
  const [withPending, setWithPending] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [venueReview, setVenueReview] = useState<string[]>([]);
  const [venueExcluded, setVenueExcluded] = useState(0);
  const [report, setReport] = useState("");
  async function build(src: { rows: EventRow[]; existing?: File; sources: number }, includePending: boolean) {
    const { eventsWorkbook } = await import("@/lib/work-files");
    const uncancelled = src.rows.filter((r) => !isCancelledRow(r));
    const scope = venueOnly ? scopeShowPilotRows(uncancelled) : { accepted: uncancelled, excluded: [] as EventRow[], needsReview: [] as EventRow[] };
    const live = scope.accepted;
    setVenueExcluded(scope.excluded.length);
    setVenueReview([...new Set(scope.needsReview.map((r) => r.space || "(no space)"))].sort());
    setPending([...new Set(live.filter(isPendingRow).map((r) => `${r.event || r.description} (${r.status})`))].sort());
    const rows = includePending ? live : live.filter((r) => !isPendingRow(r));
    const list = summarizeEvents(rows);
    const dayList = [...new Set(live.map((r) => r.date))].sort();
    const statuses = new Map<string, number>();
    for (const r of src.rows) statuses.set(r.status ?? "(none)", (statuses.get(r.status ?? "(none)") ?? 0) + 1);
    setReport((old) => [old.split("\n--- counts ---")[0], "--- counts ---",
      `rows read: ${src.rows.length}`, `cancelled: ${src.rows.length - uncancelled.length}`, `other-building rows excluded: ${scope.excluded.length}`, `unverified-space rows: ${scope.needsReview.length}`, `not-yet-definite: ${live.filter(isPendingRow).length} (${includePending ? "included" : "left out"})`,
      `rows used: ${rows.length}`, `entries built: ${list.length}`, `dates: ${dayList[0] ?? "-"} to ${dayList.at(-1) ?? "-"}`,
      `statuses: ${[...statuses].map(([k, v]) => `${k}=${v}`).join(", ") || "-"}`,
      `sample rows: ${JSON.stringify(src.rows.slice(0, 3))}`].join("\n"));
    const notes = [...airwallTasks(rows), ...taskSuggestions(rows)].sort((a, b) => a.date.localeCompare(b.date));
    setShared(sharedSpaces(list));
    setEntries(list); setMerged(!!src.existing); setTasks(notes);
    setBlob(list.length ? await eventsWorkbook(list, src.existing, notes) : null);
    const dates = new Set(list.map((e) => e.date)).size;
    setStatus(list.length ? `${src.sources} report${src.sources > 1 ? "s" : ""} · ${list.length} entries across ${dates} days. ${src.existing ? `Filled into ${src.existing.name} — engineer shifts kept.${notes.length ? ` ${notes.length} task suggestions added to empty Tasks cells.` : ""}` : "Built weekly sheets with the engineering roster."}` : "No show, move-in or move-out lines found.");
  }
  async function load(files: File[]) {
    setStatus("Reading…"); setBlob(null);
    const head = [`ShowPilot Events report · ${new Date().toISOString()}`, `build: ${__APP_VERSION__} ${__APP_COMMIT__} ${__APP_BUILD_DATE__}`];
    setReport(head.join("\n"));
    try {
      const { describeSheet } = await import("@/lib/work-files");
      const described = await Promise.all(files.filter((f) => /\.xlsx?$/i.test(f.name)).map(describeSheet));
      const names = `dropped: ${files.map((f) => `${f.name} (${f.size} B)`).join("; ") || "nothing"}`;
      setReport([...head, names, ...described].join("\n"));
    } catch { /* describing is best-effort */ }
    try {
      const { readEventPdf, readEventSheet } = await import("@/lib/work-files");
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
      // An .xlsx is either the For Scheduling report exported from Ungerboeck or your monthly schedule to fill in.
      const sheets = files.filter((f) => /\.xlsx?$/i.test(f.name));
      const reports: EventRow[][] = [];
      let existing: File | undefined;
      for (const f of sheets) {
        const r = await readEventSheet(f);
        if (r) reports.push(r); else existing = f;
        setReport((old) => `${old}\nreadEventSheet(${f.name}): ${r ? `${r.length} rows` : "null → treated as a monthly schedule to fill in, not a For Scheduling report"}`);
      }
      const rows = [...(await Promise.all(pdfs.map(readEventPdf))).flat(), ...reports.flat()];
      const src = { rows, sources: pdfs.length + reports.length, ...(existing ? { existing } : {}) };
      setSource(src);
      if (!rows.length && existing) {
        setStatus(`No events found: ${existing.name} was read as a schedule to fill in, not a For Scheduling report (cell A1 must say "For Scheduling"). Drop the Ungerboeck report on its own, or with this schedule.`);
        return;
      }
      await build(src, withPending);
    } catch (e) {
      setReport((old) => `${old}\nERROR: ${(e as Error).stack ?? (e as Error).message}`);
      setStatus(`Could not read that file: ${(e as Error).message}`);
    }
  }
  const { deliver } = useDeliver();
  return (
    <div className="space-y-3 pt-2">
      <FilePick accept="application/pdf,.xlsx" label="Drop the For Scheduling report (.xlsx or PDF) — add your monthly schedule .xlsx to fill it in" onFiles={load} />
      <p className="text-xs text-muted-foreground">S = show · Exmi = exhibitor move in / service desk · MI = move in · MO = move out · Food = meal or reception after the show · MTG = meeting · MO? = no move-out line in the report; guessed as 3 hours after the show ends, so check it. Combined halls split into each hall. Escalators = 1 hr before first show to 1 hr after.</p>
      {status && <p className={`text-sm ${/^Could not|^No /.test(status) ? "text-destructive" : ""}`} role="status">{status}</p>}
      {report && /^Could not|^No /.test(status) && (
        <div className="space-y-1 rounded-md border border-border p-2 text-xs">
          <div className="flex items-center justify-between gap-2"><span className="font-medium">Details to send me</span><Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(report).catch(() => undefined); }}>Copy details</Button></div>
          <textarea readOnly value={report} rows={8} className="w-full rounded border border-border bg-background p-1 font-mono" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {venueOnly && (venueExcluded > 0 || venueReview.length > 0) && <details className="rounded border border-amber-500 p-3 text-xs"><summary className="cursor-pointer font-semibold">Venue review: {venueExcluded} excluded rows and {venueReview.length} space name(s) needing review</summary><p className="mt-2">Only confirmed Cobb Convention Center-Atlanta spaces are scheduled. Unrecognized spaces are not included until their venue is verified.</p><ul className="mt-2 list-disc pl-4">{venueReview.map((s) => <li key={s}>{s}</li>)}</ul></details>}
      {pending.length > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-amber-500 p-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={withPending} onChange={(e) => { setWithPending(e.target.checked); if (source) build(source, e.target.checked).catch((err) => setStatus(`Could not read that PDF: ${(err as Error).message}`)); }} />
          <span><span className="font-medium">Include {pending.length} not-yet-definite events</span> (left out unless checked): {pending.slice(0, 8).join("; ")}{pending.length > 8 ? ` +${pending.length - 8} more` : ""}</span>
        </label>
      )}
      {entries.length === 0 && !status && <ol className="list-decimal space-y-0.5 pl-5 text-xs text-muted-foreground"><li>Drop one or more Ungerboeck event PDFs.</li><li>Optional: drop your monthly schedule .xlsx in the same box to fill it in (engineer shifts are kept).</li><li>Download the Excel file.</li></ol>}
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
          {shared.length > 0 && (
            <details className="rounded-md border border-amber-500 p-2 text-xs">
              <summary className="cursor-pointer font-medium">{shared.length} rooms are shared by more than one event</summary>
              <ul className="mt-1 space-y-0.5">{shared.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </details>
          )}
          {tasks.length > 0 && (
            <details className="rounded-md border border-border p-2 text-xs">
              <summary className="cursor-pointer font-medium">{tasks.length} task suggestions (air walls, stage builds, room turns)</summary>
              <ul className="mt-1 space-y-0.5">{tasks.map((t, i) => <li key={i}><span className="text-muted-foreground">{dayLabel(t.date)}:</span> {t.text}</li>)}</ul>
            </details>
          )}
          {blob && <Button size="sm" onClick={() => deliver(blob, merged ? "schedule-updated.xlsx" : "engineering-schedule.xlsx")}><Download className="size-4" /> Download Excel</Button>}
        </>
      )}
    </div>
  );
}

function useDeliver() {
  return { deliver: (blob: Blob, name: string) => import("@/lib/work-files").then((m) => m.downloadBlob(blob, name)) };
}

/** Button that connects Google Calendar once, then pushes every shift with one click. */
type GoogleReply = { configured?: boolean; connected?: boolean; mode?: string; error?: string; added?: number; updated?: number; removed?: number; skipped?: number; reasons?: string[] };

function AddAllToCalendar({ shifts, title, remove, onPushed, onStatus, onDownload }: { shifts: Shift[]; title: string; remove: string[]; onPushed: () => void; onStatus: (s: string) => void; onDownload: () => void }) {
  const [own, setOwn] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [ownBusy, setOwnBusy] = useState(false);
  const ownCall = async (body: object) => (await fetch("/api/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<GoogleReply>;
  useEffect(() => {
    ownCall({ op: "status" }).then((r) => setOwn({ configured: !!r.configured, connected: !!r.connected })).catch(() => setOwn({ configured: false, connected: false }));
    const done = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.pixelpals === "google-connected") setOwn({ configured: true, connected: true }); };
    window.addEventListener("message", done);
    return () => window.removeEventListener("message", done);
  }, []);
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
    } catch { onStatus("Couldn't connect to the calendar service."); } finally { setOwnBusy(false); }
  }
  // (self-hosted): use your own Google sign-in when it's set up, otherwise download one calendar file.
  // Each event has a fixed id, so pushing or importing again updates the same events instead of making copies.
  return (
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
}

function ShiftsTab() {
  const [name, setNameRaw] = useState(DEFAULT_SCHEDULE_NAME);
  useEffect(() => { try { const n = localStorage.getItem("pixelpals:work-name"); if (n) setNameRaw(n); } catch { /* ignore */ } }, []);
  const setName = (n: string) => { setNameRaw(n); try { localStorage.setItem("pixelpals:work-name", n); } catch { /* ignore */ } };
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
      <label className="grid gap-1 text-xs text-muted-foreground">Your name exactly as it appears on the schedule (remembered)</label>
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
      {status && <p className={`text-sm ${/^Could not|^No shifts/.test(status) ? "text-destructive" : ""}`} role="status">{status}</p>}
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

const DeckPlanner = lazy(() => import("@/components/deck-planner/planner").then((m) => ({ default: m.DeckPlanner })));

function DeckTab() {
  return (
    <div className="pt-2">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the stage planner…</p>}>
        <DeckPlanner />
      </Suspense>
      <p className="mt-3 text-xs text-muted-foreground">Tip: type <code>@deck 24x24x32</code> in the chat box for a quick answer. Want to share the planner? <a className="text-primary underline" href="/stage-planner.html" download="stage-planner.html">Download the one-file version</a>. It works offline in any browser.</p>
    </div>
  );
}

