import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dailyPicks } from "@/lib/brief";
import { watchQueue } from "@/lib/pick-reason";
import type { TraktItem } from "@/lib/trakt";
import { addTodo, clearDone, removeAt, toggleTodo, updateWorkbench, useWorkbench } from "@/lib/workbench";
import { describeCode, weatherLine, type Weather } from "@/lib/weather";
import { whenLabel } from "@/lib/when";
import { clock, dayLabel } from "./inbox-panels";

type Remind = { id: string; at: number; text: string; repeat?: string | undefined };
type RemindReply = { text?: string; error?: string; items?: Remind[] };

async function remindCall(op: "list" | "add" | "remove" | "snooze", text = ""): Promise<RemindReply> {
  try {
    const res = await fetch("/api/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, text }) });
    return (await res.json()) as RemindReply;
  } catch { return { error: "Couldn't reach the server." }; }
}

/** To-dos (kept in this browser, shared with Notes & tasks) plus reminders (kept on the server, pushed to your phone). */
export function TasksPanel({ open }: { open: boolean }) {
  const { todos } = useWorkbench();
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [reminders, setReminders] = useState<Remind[]>([]);
  const [note, setNote] = useState("");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const load = useCallback(async () => { const r = await remindCall("list"); if (r.items) setReminders(r.items); else if (r.error) setNote(r.error); }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const addTask = () => { if (!text.trim()) return; updateWorkbench((w) => ({ ...w, todos: addTodo(w.todos, text) })); setText(""); };
  const addReminder = async () => {
    if (!when.trim()) return;
    const r = await remindCall("add", when);
    setNote(r.text ?? r.error ?? "");
    if (r.items) setReminders(r.items);
    if (r.text?.startsWith("Okay")) setWhen("");
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
        {todos.map((t, i) => (
          <div key={t.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
            <input type="checkbox" checked={t.done} onChange={() => updateWorkbench((w) => ({ ...w, todos: toggleTodo(w.todos, i + 1) }))} aria-label={`Done: ${t.text}`} />
            <span className={t.done ? "min-w-0 flex-1 truncate text-muted-foreground line-through" : "min-w-0 flex-1 truncate"}>{t.text}</span>
            <Button size="sm" variant="ghost" className="h-7 px-1" aria-label="Remove" onClick={() => updateWorkbench((w) => ({ ...w, todos: removeAt(w.todos, i + 1) }))}><Trash2 className="size-3.5" /></Button>
          </div>
        ))}
        {todos.some((t) => t.done) && <Button size="sm" variant="ghost" className="justify-start" onClick={() => updateWorkbench((w) => ({ ...w, todos: clearDone(w.todos) }))}>Clear finished</Button>}
        <p className="text-xs text-muted-foreground">These are the same tasks as Notes &amp; tasks, kept in this browser.</p>
      </section>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reminders to your phone</h3>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void addReminder(); }}>
          <input className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1" placeholder="in 30m call mom · every monday 9am send report" value={when} maxLength={300} onChange={(e) => setWhen(e.target.value)} />
          <Button type="submit" size="sm" aria-label="Add reminder"><Plus className="size-4" /></Button>
        </form>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {reminders.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
            <span className="w-24 shrink-0 text-xs text-muted-foreground sm:w-28">{whenLabel(r.at, tz)}</span>
            <span className="min-w-0 flex-1 truncate">{r.text}{r.repeat ? <span className="text-xs text-muted-foreground"> · {r.repeat === "weekdays" ? "every weekday" : r.repeat}</span> : null}</span>
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
export function TodayPanel({ open }: { open: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!open) return; const t = window.setInterval(() => setTick((n) => n + 1), 5 * 60_000); return () => window.clearInterval(t); }, [open]);
  const { todos } = useWorkbench();
  const weather = useOnce<{ weather?: Weather }>("/api/weather", open, tick);
  const cal = useOnce<{ tz: string; configured: boolean; items: { title: string; start: number; end: number; allDay: boolean }[] }>("/api/calendar?days=1", open, tick);
  const mail = useOnce<{ configured: boolean; items: { subject: string; from: string }[] }>("/api/mail", open, tick);
  const trakt = useOnce<{ items?: TraktItem[] }>("/api/trakt?plex=1", open, tick);
  const [reminders, setReminders] = useState<Remind[]>([]);
  useEffect(() => { if (open) void remindCall("list").then((r) => setReminders(r.items ?? [])); }, [open, tick]);
  const tz = cal.data?.tz ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(Date.now());
  const events = (cal.data?.items ?? []).filter((e) => e.end >= Date.now() || e.allDay);
  const open_ = todos.filter((t) => !t.done);
  const todayReminders = reminders.filter((r) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(r.at) === day);
  const pick = dailyPicks(trakt.data?.items ?? [], day, 1)[0];
  const queue = watchQueue(trakt.data?.items ?? [], 6);
  return (
    <div className="grid gap-3 p-3 text-sm">
      <div className="font-medium">{dayLabel(Date.now(), tz)} · {new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(Date.now())}</div>
      <Block title="Weather">
        {weather.data?.weather ? <p>{describeCode(weather.data.weather.now.code).icon} {weather.data.weather.place}: {weatherLine(weather.data.weather)}</p> : <Quiet>{weather.error || "Loading…"}</Quiet>}
      </Block>
      <Block title="Calendar">
        {cal.data?.configured === false && <Quiet>No calendar connected. Open Calendar for the one-minute setup.</Quiet>}
        {cal.data?.configured && !events.length && <Quiet>Nothing else on today.</Quiet>}
        {events.map((e, i) => <div key={`${e.start}-${i}`} className="flex gap-3"><span className="w-16 shrink-0 text-xs text-muted-foreground">{e.allDay ? "All day" : clock(e.start, tz)}</span><span className="truncate">{e.title}</span></div>)}
        {!cal.data && <Quiet>{cal.error || "Loading…"}</Quiet>}
      </Block>
      <Block title="Mail">
        {mail.data?.configured === false && <Quiet>No mailbox connected. Open Mail for setup.</Quiet>}
        {mail.data?.configured && <p>{mail.data.items.length ? `${mail.data.items.length} unread` : "No unread mail."}</p>}
        {mail.data?.items.slice(0, 3).map((m, i) => <p key={i} className="truncate text-xs text-muted-foreground">{m.subject} · {m.from}</p>)}
        {!mail.data && <Quiet>{mail.error || "Loading…"}</Quiet>}
      </Block>
      <Block title="Tasks">
        {!open_.length && !todayReminders.length && <Quiet>Nothing open. Add some in Tasks.</Quiet>}
        {todayReminders.map((r) => <p key={r.id} className="truncate">⏰ {whenLabel(r.at, tz)} — {r.text}</p>)}
        {open_.slice(0, 6).map((t) => <p key={t.id} className="truncate">☐ {t.text}</p>)}
      </Block>
      <Block title="Tonight">
        {pick ? <p>{pick.kind === "show" ? "📺" : "🎬"} {pick.title}{pick.year ? ` (${pick.year})` : ""}{pick.inPlex ? " · in Plex" : ""}</p> : <Quiet>{trakt.error ? "Connect Trakt to get a pick." : trakt.data ? "Nothing unwatched on your list." : "Loading…"}</Quiet>}
        {pick && <Quiet>{queue.find((q) => q.item.title === pick.title)?.reason}</Quiet>}
      </Block>
      {queue.length > 0 && (
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
