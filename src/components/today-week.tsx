import { useState } from "react";
import { CalendarDays, Plus, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Routine, TodayTask } from "@/lib/today";

export type CalEvent = { title: string; start: number; end: number; allDay: boolean };
export type Cal = { tz: string; configured: boolean; events: CalEvent[] };
export type Stats = { doneWeek: number; open: number; stale: string[] };
type Run = (label: string, body: Record<string, unknown>) => Promise<void>;

const timeFmt = (at: number, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(at));
export const dayKeyOf = (at: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
export const hhmm = (at: number | undefined, tz: string) => (at ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at)) : "");
const dayLabel = (key: string, today: string, tz: string) => {
  const d = new Date(`${key}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(d);
  return key === today ? `Today, ${name.split(", ").slice(1).join(", ")}` : (void tz, name);
};

/** Today's calendar events and timed tasks in one strip, in time order. */
export function Schedule({ cal, tasks, today }: { cal: Cal | null; tasks: TodayTask[]; today: string }) {
  const tz = cal?.tz ?? "UTC";
  const rows = [
    ...(cal?.events ?? []).filter((e) => !e.allDay && dayKeyOf(e.start, tz) === today).map((e) => ({ k: `e${e.start}${e.title}`, at: e.start, end: e.end, title: e.title, task: false })),
    ...tasks.filter((t) => t.status === "open" && t.at && dayKeyOf(t.at, tz) === today).map((t) => ({ k: `t${t.id}`, at: t.at!, end: t.at! + (t.mins ?? 0) * 60_000, title: t.title, task: true })),
  ].sort((a, b) => a.at - b.at);
  const allDay = (cal?.events ?? []).filter((e) => e.allDay && dayKeyOf(e.start, tz) <= today && dayKeyOf(e.end - 1, tz) >= today);
  if (!rows.length && !allDay.length) return null;
  const now = Date.now();
  return (
    <section aria-label="Today's schedule" className="grid gap-1 rounded-lg border border-border bg-card p-3">
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">On the clock</h2>
      {allDay.map((e) => <div key={`a${e.start}${e.title}`} className="text-sm text-muted-foreground">All day: {e.title}</div>)}
      <ul className="grid gap-1">
        {rows.map((r) => (
          <li key={r.k} className={`flex items-baseline gap-3 text-sm ${r.end && r.end < now ? "text-muted-foreground line-through" : ""}`}>
            <span className="w-16 shrink-0 tabular-nums font-medium">{timeFmt(r.at, tz)}</span>
            <span className="min-w-0 flex-1 break-words">{r.title}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{r.task ? "task" : "calendar"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Week look-ahead: the calendar by day, a few focus items, and a calm Friday wrap-up. */
export function WeekPanel({ cal, tasks, stats, today, note, busy, run }: { cal: Cal | null; tasks: TodayTask[]; stats: Stats | undefined; today: string; note: string; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const tz = cal?.tz ?? "UTC";
  const focus = tasks.filter((t) => t.status === "open" && t.week);
  const days = new Map<string, CalEvent[]>();
  for (const e of cal?.events ?? []) { const k = dayKeyOf(e.start, tz); if (k >= today) days.set(k, [...(days.get(k) ?? []), e]); }
  const stale = tasks.filter((t) => stats?.stale.includes(t.id));
  return (
    <div className="rounded-lg border border-border bg-card">
      <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left font-semibold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2"><CalendarDays className="size-4" /> This week{focus.length ? ` · ${focus.length} focus` : ""}</span>
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-border p-4 text-sm">
          <div className="grid gap-2">
            <b>Focus this week</b>
            {note && <p className="rounded-md bg-primary/10 px-3 py-2">{note}</p>}
            {focus.length ? <ul className="ml-5 list-disc">{focus.map((t) => <li key={t.id}>{t.title} <button type="button" className="ml-1 text-muted-foreground underline" onClick={() => void run("weekflag", { op: "weekflag", id: t.id })}>remove</button></li>)}</ul> : <p className="text-muted-foreground">Nothing picked. You can pick two or three that would make the week feel handled, or tap "→ This week" on any task.</p>}
            <Button variant="outline" className="h-11" disabled={busy} onClick={() => void run("weekplan", { op: "weekplan" })}>{busy ? "Looking…" : "Pick my week focus"}</Button>
          </div>
          <div className="grid gap-2">
            <b>Calendar</b>
            {!cal?.configured && <p className="text-muted-foreground">No calendar is connected yet, so nothing shows here. Connect Google Calendar in Pixel Pals settings.</p>}
            {[...days.entries()].slice(0, 7).map(([k, list]) => (
              <div key={k}><div className="font-medium">{dayLabel(k, today, tz)}</div>
                <ul className="ml-1 text-muted-foreground">{list.slice(0, 8).map((e) => <li key={`${e.start}${e.title}`}>{e.allDay ? "All day" : timeFmt(e.start, tz)} · {e.title}</li>)}</ul></div>
            ))}
          </div>
          <div className="grid gap-2">
            <b>Wrap-up</b>
            <p>{stats ? `${stats.doneWeek} done this week, ${stats.open} still open.` : "Nothing yet."} {stats && stats.doneWeek > 0 ? "That counts." : ""}</p>
            {stale.length > 0 && (
              <div className="grid gap-1">
                <span className="text-muted-foreground">Still want these? They've been sitting over a week.</span>
                {stale.slice(0, 8).map((t) => (
                  <div key={t.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{t.title}</span>
                    <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => void run("keep", { op: "keep", id: t.id })}>Keep</Button>
                    <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => void run("drop", { op: "drop", id: t.id })}>Drop</Button></div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const repeatText = (r: Routine) => (r.repeat === "daily" ? "every day" : r.repeat === "weekdays" ? "weekdays" : `every ${DOW[r.dow]}`);
const minText = (m: number | null) => (m === null ? "" : ` at ${new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`);

/** Things that come back by themselves. */
export function RoutinesPanel({ routines, busy, run }: { routines: Routine[]; busy: boolean; run: Run }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [repeat, setRepeat] = useState("weekdays");
  const [dow, setDow] = useState(1);
  const [time, setTime] = useState("");
  const [mins, setMins] = useState("");
  return (
    <div className="rounded-lg border border-border bg-card">
      <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left font-semibold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="flex items-center gap-2"><Repeat className="size-4" /> Routines{routines.length ? ` · ${routines.length}` : ""}</span>
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="grid gap-3 border-t border-border p-4 text-sm">
          <p className="text-muted-foreground">Things that come back on their own. They show up in your list that morning, with a time if you give one (you'll get a nudge before it).</p>
          {routines.length > 0 && <ul className="grid gap-1">{routines.map((r) => (
            <li key={r.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{r.title} <span className="text-muted-foreground">· {repeatText(r)}{minText(r.time)}{r.mins ? ` · ${r.mins} min` : ""}</span></span>
              <Button size="sm" variant="ghost" className="h-9" aria-label={`Remove routine: ${r.title}`} disabled={busy} onClick={() => void run("routine_del", { op: "routine_del", id: r.id })}><Trash2 className="size-4" /></Button></li>
          ))}</ul>}
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; void run("routine_add", { op: "routine_add", title, repeat, dow, time, mins: Number(mins) || 0 }).then(() => { setTitle(""); setTime(""); setMins(""); }); }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Build the weekly schedule" aria-label="Routine" className="h-11 rounded-md border border-input bg-background px-3 text-base" />
            <div className="grid grid-cols-2 gap-2">
              <select value={repeat} onChange={(e) => setRepeat(e.target.value)} aria-label="How often" className="h-11 rounded-md border border-input bg-background px-2 text-base">
                <option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Once a week</option>
              </select>
              {repeat === "weekly" ? <select value={dow} onChange={(e) => setDow(Number(e.target.value))} aria-label="Which day" className="h-11 rounded-md border border-input bg-background px-2 text-base">{DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}</select> : <span />}
              <label className="grid gap-0.5 text-xs text-muted-foreground">Time (optional)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="h-11 rounded-md border border-input bg-background px-2 text-base text-foreground" /></label>
              <label className="grid gap-0.5 text-xs text-muted-foreground">Minutes (optional)<input inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="30" className="h-11 rounded-md border border-input bg-background px-2 text-base text-foreground" /></label>
            </div>
            <Button type="submit" variant="outline" className="h-11" disabled={busy || !title.trim()}><Plus className="size-4" /> Add routine</Button>
          </form>
        </div>
      )}
    </div>
  );
}

const hourIn = (tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
const flag = (key: string) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } };
const setFlag = (key: string) => { try { localStorage.setItem(key, "1"); } catch { /* optional */ } };

/** First open of the morning: what's on, and one question. */
export function MorningStart({ cal, tasks, planned, today, onDump, onStart }: { cal: Cal | null; tasks: TodayTask[]; planned: boolean; today: string; onDump: () => void; onStart: () => void }) {
  const tz = cal?.tz ?? "UTC";
  const [hidden, setHidden] = useState(false);
  if (!today || hidden || flag(`today:start:${today}`) || planned || hourIn(tz) >= 12) return null;
  const hide = () => { setFlag(`today:start:${today}`); setHidden(true); };
  const open = tasks.filter((t) => t.status === "open");
  const clock = open.filter((t) => t.at && dayKeyOf(t.at, tz) === today).length + (cal?.events ?? []).filter((e) => !e.allDay && dayKeyOf(e.start, tz) === today).length;
  const focus = open.filter((t) => t.week);
  return (
    <section aria-label="Good morning" className="grid gap-3 rounded-lg border border-primary bg-primary/10 p-4">
      <div>
        <h2 className="text-lg font-semibold">Good morning</h2>
        <p className="text-sm">{clock ? `${clock} thing${clock === 1 ? "" : "s"} on the clock today.` : "Nothing on the clock today."} {open.length ? `${open.length} open.` : "Your list is empty."}{focus.length ? ` This week's focus: ${focus.map((t) => t.title).join(", ")}.` : ""}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button className="h-12" onClick={() => { hide(); onDump(); }}>Brain dump</Button>
        <Button variant="outline" className="h-12" disabled={!open.length} onClick={() => { hide(); onStart(); }}>Just start</Button>
      </div>
      <button type="button" className="justify-self-start text-sm text-muted-foreground underline" onClick={hide}>Not now</button>
    </section>
  );
}

/** Evening: what got done, what carries over, and a clean close. Open by default after 5pm. */
export function EndOfDay({ cal, tasks, today, busy, run }: { cal: Cal | null; tasks: TodayTask[]; today: string; busy: boolean; run: Run }) {
  const tz = cal?.tz ?? "UTC";
  const [open, setOpen] = useState<boolean | null>(null);
  if (!today) return null;
  const evening = hourIn(tz) >= 17;
  const closed = flag(`today:closed:${today}`);
  const show = open ?? (evening && !closed);
  const done = tasks.filter((t) => t.status === "done" && t.doneAt && dayKeyOf(t.doneAt, tz) === today);
  const left = tasks.filter((t) => t.status === "open");
  return (
    <div className="rounded-lg border border-border bg-card">
      <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left font-semibold" aria-expanded={show} onClick={() => setOpen(!show)}>
        <span>End of day{done.length ? ` · ${done.length} done` : ""}</span><span className="text-muted-foreground">{show ? "▾" : "▸"}</span>
      </button>
      {show && (
        <div className="grid gap-3 border-t border-border p-4 text-sm">
          <p>{done.length ? `You finished ${done.length} thing${done.length === 1 ? "" : "s"} today.` : "Nothing checked off today, and that's okay. Some days are for other things."}</p>
          {done.length > 0 && <ul className="ml-5 list-disc text-muted-foreground">{done.slice(0, 10).map((t) => <li key={t.id}>{t.title}</li>)}</ul>}
          {left.length > 0 ? (
            <div className="grid gap-1">
              <b>Still open · they carry over unless you drop them</b>
              {left.slice(0, 12).map((t) => (
                <div key={t.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 break-words">{t.title}</span>
                  <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" disabled={busy} onClick={() => void run("drop", { op: "drop", id: t.id })}>Drop</Button></div>
              ))}
              {left.length > 12 && <span className="text-muted-foreground">and {left.length - 12} more</span>}
            </div>
          ) : <p className="text-muted-foreground">Nothing open. Clean slate for tomorrow.</p>}
          <Button className="h-12" disabled={busy} onClick={() => { void run("closeday", { op: "closeday" }).then(() => { setFlag(`today:closed:${today}`); setOpen(false); }); }}>Close the day</Button>
          <p className="text-xs text-muted-foreground">Closing clears the "do this now" pick and any times that already passed. Nothing is deleted.</p>
        </div>
      )}
    </div>
  );
}
