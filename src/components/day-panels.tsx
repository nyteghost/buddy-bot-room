import { useCallback, useEffect, useState } from "react";
import { Flag, ListChecks, Plus, Trash2, CalendarDays } from "lucide-react";
import { BrainDump } from "./brain-dump";
import { eventsOnDay, offsetDateKey, zoneDateKey } from "@/lib/day-overview";
import { describeCode as forecastDescription } from "@/lib/weather";
import { Button } from "@/components/ui/button";
import { dailyPicks } from "@/lib/brief";
import { watchQueue } from "@/lib/pick-reason";
import type { TraktItem } from "@/lib/trakt";
import { addTodo, clearDone, updateWorkbench, useWorkbench } from "@/lib/workbench";
import { describeCode, weatherLine, type Weather } from "@/lib/weather";
import { whenLabel } from "@/lib/when";
import { clock, dayLabel } from "./inbox-panels";

type Remind = { id: string; at: number; text: string; repeat?: string | undefined; repeatName?: string | undefined; notes?: string | undefined; important?: boolean | undefined };
type RemindReply = { text?: string; error?: string; items?: Remind[] };

async function remindCall(op: "list" | "add" | "remove" | "snooze" | "cancel", text = "", extra: { notes?: string; important?: boolean; id?: string } = {}): Promise<RemindReply> {
  try {
    const res = await fetch("/api/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, text, ...extra }) });
    return (await res.json()) as RemindReply;
  } catch { return { error: "Couldn't reach the server." }; }
}

/** To-dos (kept in this browser, the list the pals see) plus reminders (kept on the server, pushed to your phone). */
export function TasksPanel({ open, onJustStart }: { open: boolean; onJustStart?: (task: string) => void }) {
  const { todos } = useWorkbench();
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [important, setImportant] = useState(false);
  const [details, setDetails] = useState("");
  const [reminders, setReminders] = useState<Remind[]>([]);
  const [note, setNote] = useState("");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const load = useCallback(async () => { const r = await remindCall("list"); if (r.items) setReminders(r.items); else if (r.error) setNote(r.error); }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const addTask = () => { if (!text.trim()) return; updateWorkbench((w) => ({ ...w, todos: addTodo(w.todos, text) })); setText(""); };
  const changeTodo = async (id: string, remove: boolean) => {
    const task = todos.find((t) => t.id === id);
    if (!task) return;
    if (task.reminderId) {
      const result = await remindCall("cancel", "", { id: task.reminderId });
      if (result.error) { setNote("Could not cancel this task's scheduled alert: " + result.error); return; }
      if (result.items) setReminders(result.items);
    }
    updateWorkbench((w) => ({
      ...w, todos: remove ? w.todos.filter((t) => t.id !== id) :
        w.todos.map((t) => t.id === id ? { ...t, done: !t.done, important: t.done ? t.important : false, reminderId: undefined, reminderAt: undefined } : t),
    }));
  };
  const addReminder = async () => {
    if (!when.trim()) return;
    const r = await remindCall("add", when, { ...(details.trim() ? { notes: details } : {}), ...(important ? { important: true } : {}) });
    setNote(r.text ?? r.error ?? "");
    if (r.items) setReminders(r.items);
    if (r.text?.startsWith("Okay")) { setWhen(""); setDetails(""); setImportant(false); }
  };
  return (
    <div className="grid gap-4 p-3 text-sm">
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To do</h3>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addTask(); }}>
          <input className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" placeholder="Add a task" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="sm" aria-label="Add task"><Plus className="size-4" /></Button>
        </form>
        {!todos.length && <p className="text-muted-foreground">Nothing to do. Nice.</p>}
        {todos.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
            <input type="checkbox" checked={t.done} onChange={() => void changeTodo(t.id, false)} aria-label={`Done: ${t.text}`} />
            <span className={t.done ? "min-w-0 flex-1 truncate text-muted-foreground line-through" : "min-w-0 flex-1 truncate"}>{t.text}</span>
            {!t.done && onJustStart && <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" aria-label={`Just Start: ${t.text}`} onClick={() => onJustStart(t.text)}>Just Start</Button>}
            <Button size="sm" variant="ghost" className="h-7 px-1" aria-label="Remove" onClick={() => void changeTodo(t.id, true)}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        {todos.some((t) => t.done) && <Button size="sm" variant="ghost" className="justify-start" onClick={() => updateWorkbench((w) => ({ ...w, todos: clearDone(w.todos) }))}>Clear finished</Button>}
        <p className="text-xs text-muted-foreground">Kept in this browser; open ones are shared with the pals.</p>
      </section>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reminders to your phone</h3>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void addReminder(); }}>
          <input className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" placeholder="in 30m call mom · every first saturday 9am PC check" value={when} maxLength={300} onChange={(e) => setWhen(e.target.value)} />
          <Button type="submit" size="sm" aria-label="Add reminder"><Plus className="size-4" /></Button>
        </form>
        <textarea className="min-h-12 rounded-md border bg-background px-2 py-1 text-xs" aria-label="Reminder details" placeholder="Details (optional): steps, what to check, anything you want in front of you when it goes off" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
        <label className="flex w-fit items-center gap-2 text-xs"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> <Flag className="size-3" /> Important: pop up big and keep reminding me every 15 minutes until I press Done</label>
        <p className="text-xs text-muted-foreground">Repeats: every day / weekday / monday, every other week, every first saturday, every last friday, monthly, every 3 months.</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {reminders.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
            <span className="w-24 shrink-0 text-xs text-muted-foreground sm:w-28">{whenLabel(r.at, tz)}</span>
            <span className="min-w-0 flex-1 truncate" title={r.notes}>{r.important ? <Flag className="mr-1 inline size-3 text-red-500" aria-label="Important" /> : null}{r.text}{r.repeat ? <span className="text-xs text-muted-foreground"> · {r.repeatName ?? r.repeat}</span> : null}{r.notes ? <span className="text-xs text-muted-foreground"> · +details</span> : null}</span>
            <Button size="sm" variant="ghost" className="h-7 px-1 text-xs" title="Snooze 1 hour" onClick={() => void remindCall("snooze", `${r.id} 1h`).then((x) => { if (x.items) setReminders(x.items); })}>+1h</Button>
            <Button size="sm" variant="ghost" className="h-7 px-1" aria-label="Remove reminder" onClick={() => void remindCall("remove", r.id).then((x) => { if (x.items) setReminders(x.items); })}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        {!reminders.length && !note && <p className="text-muted-foreground">No reminders waiting. They go to ntfy or Telegram, so set <code>NTFY_URL</code> or <code>TELEGRAM_BOT_TOKEN</code> first.</p>}
      </section>
    </div>
  );
}

type Loaded<T> = { data: T | null; error: string };
function useOnce<T>(url: string, open: boolean, tick: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ data: null, error: "" });
  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(url).then(async (r) => { const j = (await r.json()) as T & { error?: string }; if (alive) setState(r.ok ? { data: j, error: "" } : { data: null, error: j.error ?? "" }); }).catch(() => alive && setState({ data: null, error: "Couldn't reach the server." }));
    return () => { alive = false; };
  }, [url, open, tick]);
  return state;
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="grid gap-1 rounded-md border px-3 py-2">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
    {children}
  </section>
);
const Quiet = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

/** Everything for today in one place: weather, calendar, unread mail, tasks and a watch pick. Each part quietly says how to set it up if it isn't. */
export function TodayPanel({ open, onOpenMail, onOpenCalendar, onOpenTasks }: { open: boolean; onOpenMail?: () => void; onOpenCalendar?: () => void; onOpenTasks?: () => void }) {
  const [tick, setTick] = useState(0);
  const [dayOffset, setDayOffset] = useState<0 | 1 | 2>(0);
  useEffect(() => { if (!open) return; const t = window.setInterval(() => setTick((n) => n + 1), 5 * 60_000); return () => window.clearInterval(t); }, [open]);
  const { todos } = useWorkbench();
  const weather = useOnce<{ weather?: Weather }>("/api/weather", open, tick);
  const cal = useOnce<{ tz: string; configured: boolean; items: { title: string; start: number; end: number; allDay: boolean }[] }>("/api/calendar?days=4", open, tick);
  const mail = useOnce<{ configured: boolean; items: { subject: string; from: string }[] }>("/api/mail", open, tick);
  const trakt = useOnce<{ items?: TraktItem[] }>("/api/trakt?plex=1", open, tick);
  const [reminders, setReminders] = useState<Remind[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = () => { void remindCall("list").then((r) => { if (alive && r.items) setReminders(r.items); }); };
    refresh();
    window.addEventListener("pixelpals:reminders-changed", refresh);
    return () => { alive = false; window.removeEventListener("pixelpals:reminders-changed", refresh); };
  }, [open, tick]);
  const tz = cal.data?.tz ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const todayKey = zoneDateKey(Date.now(), tz);
  const day = offsetDateKey(todayKey, dayOffset);
  const events = eventsOnDay(cal.data?.items ?? [], day, tz);
  const open_ = todos.filter((t) => {
    if (t.done) return false;
    const taskDay = t.dueDate ?? (t.scheduledAt ? zoneDateKey(t.scheduledAt, tz) : t.reminderAt ? zoneDateKey(t.reminderAt, tz) : null);
    return taskDay ? taskDay === day : dayOffset === 0;
  });
  const todayReminders = reminders.filter((r) => zoneDateKey(r.at, tz) === day);
  const forecast = weather.data?.weather?.days.find((item) => item.date === day);
  const pick = dailyPicks(trakt.data?.items ?? [], todayKey, 1)[0];
  const queue = watchQueue(trakt.data?.items ?? [], 6);
  return (
    <div className="grid gap-3 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{dayOffset === 0 ? dayLabel(Date.now(), tz) : dayOffset === 1 ? "Tomorrow" : "Day after tomorrow"} · {new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(day + "T12:00:00Z"))}</div>
        <Button size="sm" variant="outline" title="Open the full /today planner: your plan, times, week and focus timer" onClick={() => window.location.assign("/today")}><ListChecks className="size-4" /> /today</Button>
      </div>
      <nav className="grid grid-cols-3 gap-1.5" aria-label="Day overview">
        {([0, 1, 2] as const).map((offset) => (
          <Button key={offset} size="sm" variant={dayOffset === offset ? "default" : "outline"} aria-pressed={dayOffset === offset} onClick={() => setDayOffset(offset)} className="min-w-0 px-1.5 text-xs">
            {offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : "Day after"}
          </Button>
        ))}
      </nav>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        <CalendarDays className="mr-1 inline size-3.5" />
        {events.length} calendar {events.length === 1 ? "event" : "events"} · {todayReminders.length} scheduled {todayReminders.length === 1 ? "reminder" : "reminders"}
        {forecast ? " · " + forecastDescription(forecast.code).text : ""}
      </p>
      <Block title={dayOffset === 0 ? "Weather" : "Weather forecast"}>
        {dayOffset === 0 && weather.data?.weather ? <p>{describeCode(weather.data.weather.now.code).icon} {weather.data.weather.place}: {weatherLine(weather.data.weather)}</p>
          : forecast ? <p>{forecastDescription(forecast.code).icon} {weather.data?.weather?.place}: {forecastDescription(forecast.code).text}, {forecast.hi}°/{forecast.lo}°{forecast.rain >= 30 ? " · " + forecast.rain + "% chance of rain" : ""}</p>
          : <Quiet>{weather.error || "Forecast not available for this day yet."}</Quiet>}
      </Block>
      <Block title="Calendar">
        {cal.data?.configured === false && <Quiet>No calendar connected. Open Calendar for the one-minute setup.</Quiet>}
        {cal.data?.configured && !events.length && <Quiet>No calendar events for this day.</Quiet>}
        {events.map((e, i) => <button key={`${e.start}-${i}`} type="button" className="flex min-w-0 gap-3 rounded-sm text-left hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={onOpenCalendar} title="Open Calendar"><span className="w-16 shrink-0 text-xs text-muted-foreground">{e.allDay ? "All day" : clock(e.start, tz)}</span><span className="truncate">{e.title}</span></button>)}
        {!cal.data && <Quiet>{cal.error || "Loading…"}</Quiet>}
      </Block>
      {dayOffset === 0 && <Block title="Mail">
        {mail.data?.configured === false && <Quiet>No mailbox connected. Open Mail for setup.</Quiet>}
        {mail.data?.configured && <p>{mail.data.items.length ? mail.data.items.length + " unread" : "No unread mail."}</p>}
        {mail.data?.items.slice(0, 3).map((m, i) => <button key={i} type="button" className="block w-full truncate rounded-sm text-left text-xs text-muted-foreground hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring" title="Open Mail inbox" onClick={onOpenMail}>{m.subject} · {m.from}</button>)}
        {!mail.data && <Quiet>{mail.error || "Loading…"}</Quiet>}
      </Block>}
      <Block title="Tasks">
        {!open_.length && !todayReminders.length && <Quiet>{dayOffset === 0 ? "Nothing open. Add something in Brain Dump or Tasks." : "No timed tasks or reminders for this day."}</Quiet>}
        {todayReminders.map((r) => <button type="button" key={r.id} title="Open Tasks and reminders" className="w-full truncate rounded-sm text-left hover:bg-accent/40" onClick={onOpenTasks}>⏰ {whenLabel(r.at, tz)} — {r.text}</button>)}
        {open_.slice(0, 6).map((t) => <button type="button" key={t.id} title="Open Tasks and reminders" className="w-full truncate rounded-sm text-left hover:bg-accent/40" onClick={onOpenTasks}>☐ {t.text}</button>)}
      </Block>
      <BrainDump />
      {dayOffset === 0 && <Block title="Tonight">
        {pick ? <p>{pick.kind === "show" ? "📺" : "🎬"} {pick.title}{pick.year ? " (" + pick.year + ")" : ""}{pick.inPlex ? " · in Plex" : ""}</p> : <Quiet>{trakt.error ? "Connect Trakt to get a pick." : trakt.data ? "Nothing unwatched on your list." : "Loading…"}</Quiet>}
        {pick && <Quiet>{queue.find((q) => q.item.title === pick.title)?.reason}</Quiet>}
      </Block>}
      {dayOffset === 0 && queue.length > 0 && (
        <Block title="Watch queue">
          {queue.map((q) => (
            <div key={`${q.item.kind}-${q.item.title}`} className="flex items-center gap-2">
              <span className="min-w-0 flex-1"><span className="block truncate">{q.item.kind === "show" ? "📺" : "🎬"} {q.item.title}{q.item.year ? ` (${q.item.year})` : ""}</span><span className="block truncate text-xs text-muted-foreground">{q.reason}</span></span>
              {q.action === "request" && <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => window.dispatchEvent(new CustomEvent("pixelpals:request", { detail: { title: q.item.title } }))}>Request</Button>}
            </div>
          ))}
        </Block>
      )}
    </div>
  );
}
