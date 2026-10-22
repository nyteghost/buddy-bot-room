import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Mic, Plus, Shrink, SkipForward, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { agents } from "@/lib/agents";
import { PACE_LABELS, TIERS, type Tier, type TodayState, type TodayTask } from "@/lib/today";
import { EndOfDay, MorningStart, RoutinesPanel, Schedule, WeekPanel, hhmm, type Cal, type Stats } from "@/components/today-week";

type View = Omit<TodayState, "nudged"> & { stats?: Stats };
type Reply = { state?: View; error?: string; warning?: string; today?: string; stepId?: string; cal?: Cal; weekNote?: string };

const COACH_KEY = "today:coach";
const TIER_LABEL: Record<Tier | "none", string> = { must: "Must", should: "Should", could: "Could", none: "Not sorted yet" };

async function call(body: Record<string, unknown>): Promise<Reply> {
  try {
    const r = await fetch("/api/today", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Reply;
    return r.ok ? j : { ...j, error: j.error ?? `Something went wrong (${r.status}).` };
  } catch { return { error: "Couldn't reach the server." }; }
}

function TaskRow({ t, busy, tz, onDone, onSmaller, onTier, onDrop, onWhen, onWeek, isPick }: { t: TodayTask; busy: boolean; tz: string; onDone: () => void; onSmaller: () => void; onTier: (x: Tier) => void; onDrop: () => void; onWhen: (hhmm: string) => void; onWeek: () => void; isPick: boolean }) {
  return (
    <li className={`rounded-lg border p-3 ${isPick ? "border-primary bg-primary/10" : "border-border bg-card"}`}>
      <div className="flex items-start gap-3">
        <button type="button" aria-label={`Done: ${t.title}`} disabled={busy} onClick={onDone} className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/60 hover:border-primary hover:bg-primary/10"><Check className="size-4 opacity-40" /></button>
        <div className="min-w-0 flex-1">
          <div className="break-words font-medium leading-snug">{t.title}</div>
          <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
            {t.at && <span className="rounded bg-primary/15 px-1.5 py-0.5 font-medium text-foreground">{new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(t.at))}{t.mins ? ` · ${t.mins} min` : ""}</span>}
            {t.week && <span className="rounded bg-muted px-1.5 py-0.5">this week</span>}
            {t.size && <span className="rounded bg-muted px-1.5 py-0.5">size {t.size}</span>}
            {t.energy && <span className="rounded bg-muted px-1.5 py-0.5">{t.energy} energy</span>}
            {t.feeling && <span className="rounded bg-muted px-1.5 py-0.5">{t.feeling}</span>}
          </div>
          {t.notes && <div className="mt-1 text-xs text-muted-foreground">{t.notes}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={onSmaller}><Shrink className="size-4" /> Make it smaller</Button>
            {TIERS.filter((x) => x !== t.tier).map((x) => <Button key={x} size="sm" variant="ghost" className="h-9" disabled={busy} onClick={() => onTier(x)}>→ {TIER_LABEL[x]}</Button>)}
            <Button size="sm" variant="ghost" className="h-9" disabled={busy} onClick={onWeek}>{t.week ? "Not this week" : "→ This week"}</Button>
            <label className="flex h-9 items-center gap-1 px-2 text-sm text-muted-foreground">Time <input type="time" value={hhmm(t.at, tz)} disabled={busy} onChange={(e) => onWhen(e.target.value)} aria-label={`Time for ${t.title}`} className="h-8 rounded border border-input bg-background px-1 text-foreground" /></label>
            <Button size="sm" variant="ghost" className="h-9 text-muted-foreground" disabled={busy} onClick={onDrop} aria-label={`Drop: ${t.title}`}><X className="size-4" /> Drop</Button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function TodayPlanner() {
  const [state, setState] = useState<View | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [quick, setQuick] = useState("");
  const [dump, setDump] = useState("");
  const [pace, setPace] = useState(3);
  const [mood, setMood] = useState("");
  const [coach, setCoach] = useState("");
  const [showDump, setShowDump] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [cal, setCal] = useState<Cal | null>(null);
  const [today, setToday] = useState("");
  const [weekNote, setWeekNote] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const apply = useCallback((r: Reply) => { if (r.state) setState(r.state); if (r.cal) setCal(r.cal); if (r.today) setToday(r.today); if (r.weekNote !== undefined) setWeekNote(r.weekNote); setMsg(r.error ?? r.warning ?? ""); }, []);
  const run = useCallback(async (label: string, body: Record<string, unknown>) => { setBusy(label); apply(await call({ ...body, coach })); setBusy(""); }, [apply, coach]);

  useEffect(() => {
    try { setCoach(localStorage.getItem(COACH_KEY) ?? ""); } catch { /* optional */ }
    // Install as its own home-screen app, and fill the box from the Share menu (it never saves by itself).
    document.querySelector('link[rel="manifest"]')?.setAttribute("href", "/today.webmanifest");
    document.title = "Today";
    const p = new URLSearchParams(window.location.search);
    const shared = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean).join(" ").trim();
    if (shared) { setQuick(shared.slice(0, 200)); window.history.replaceState(null, "", "/today"); }
    void call({ op: "get" }).then((r) => { apply(r); if (r.state && !r.state.day && r.state.tasks.length === 0) setShowDump(true); });
  }, [apply]);
  useEffect(() => { try { localStorage.setItem(COACH_KEY, coach); } catch { /* optional */ } }, [coach]);

  const tasks = state?.tasks ?? [];
  const open = tasks.filter((t) => t.status === "open");
  const done = tasks.filter((t) => t.status === "done");
  const pick = useMemo(() => open.find((t) => t.id === state?.pick?.id) ?? null, [open, state?.pick?.id]);
  const groups = useMemo(() => ([...TIERS, "none"] as (Tier | "none")[]).map((k) => ({ k, list: open.filter((t) => (k === "none" ? !t.tier : t.tier === k)) })).filter((g) => g.list.length), [open]);

  const rowProps = (t: TodayTask) => ({
    t, busy: !!busy, tz: cal?.tz ?? "UTC", isPick: pick?.id === t.id,
    onWhen: (time: string) => void run("when", { op: "when", id: t.id, time }),
    onWeek: () => void run("weekflag", { op: "weekflag", id: t.id }),
    onDone: () => void run("done", { op: "done", id: t.id }),
    onDrop: () => void run("drop", { op: "drop", id: t.id }),
    onTier: (x: Tier) => void run("tier", { op: "tier", id: t.id, tier: x }),
    onSmaller: () => void run("smaller", { op: "smaller", id: t.id }),
  });

  return (
    <div className="grid gap-4">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (quick.trim()) { const t = quick; setQuick(""); void run("add", { op: "add", text: t }); } }}>
        <input value={quick} onChange={(e) => setQuick(e.target.value)} placeholder="Capture anything… e.g. call Sam at 3pm" aria-label="Capture a task" enterKeyHint="done" className="h-12 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base" />
        <Button type="button" variant="outline" className="h-12 px-3" aria-label="Dictate with the Add to Today Shortcut" title="Runs your 'Add to Today' Shortcut" onClick={() => window.location.assign("shortcuts://run-shortcut?name=" + encodeURIComponent("Add to Today"))}><Mic className="size-5" /></Button>
        <Button type="submit" className="h-12 px-4" disabled={!quick.trim() || !!busy}><Plus className="size-5" /> Add</Button>
      </form>

      {msg && <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{msg}</p>}
      {state?.day?.opening && <p className="rounded-md bg-primary/10 px-3 py-2 text-sm">{state.day.opening}</p>}

      <MorningStart cal={cal} tasks={tasks} planned={state?.day?.date === today} today={today} onDump={() => setShowDump(true)} onStart={() => void run("whatnow", { op: "whatnow" })} />

      <Schedule cal={cal} tasks={tasks} today={today} />

      <div className="grid gap-2 rounded-lg border border-border bg-card p-4">
        <Button className="h-14 text-lg" disabled={!!busy || open.length === 0} onClick={() => void run("whatnow", { op: "whatnow" })}><Sparkles className="size-5" /> {busy === "whatnow" ? "Thinking…" : "What now?"}</Button>
        {pick && (
          <div className="grid gap-2 rounded-md border border-primary bg-primary/10 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Do this now</div>
            <div className="text-lg font-semibold leading-snug">{pick.title}</div>
            {state?.pick?.reason && <div className="text-sm">{state.pick.reason}</div>}
            <div className="flex flex-wrap gap-2">
              <Button className="h-11" disabled={!!busy} onClick={() => void run("done", { op: "done", id: pick.id })}><Check className="size-4" /> Done</Button>
              <Button variant="outline" className="h-11" disabled={!!busy} onClick={() => void run("whatnow", { op: "whatnow", id: pick.id })}><SkipForward className="size-4" /> Not this one</Button>
              <Button variant="outline" className="h-11" disabled={!!busy} onClick={() => void run("smaller", { op: "smaller", id: pick.id })}><Shrink className="size-4" /> Make it smaller</Button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left font-semibold" aria-expanded={showDump} onClick={() => setShowDump((v) => !v)}>Morning brain dump <span className="text-muted-foreground">{showDump ? "▾" : "▸"}</span></button>
        {showDump && (
          <div className="grid gap-3 border-t border-border p-4">
            <textarea value={dump} onChange={(e) => setDump(e.target.value)} rows={6} placeholder="Everything on your mind, in whatever words come out. Messy is fine." aria-label="Brain dump" className="w-full rounded-md border border-input bg-background p-3 text-base" />
            <label className="grid gap-1 text-sm"><span>Pace today: <b>{PACE_LABELS[pace - 1]}</b></span>
              <input type="range" min={1} max={5} value={pace} onChange={(e) => setPace(Number(e.target.value))} className="h-8 w-full accent-primary" aria-label="Pace" />
              <span className="flex justify-between text-xs text-muted-foreground"><span>running on fumes</span><span>go hard</span></span>
            </label>
            <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="How are you feeling? (optional)" aria-label="How you feel" className="h-11 rounded-md border border-input bg-background px-3 text-base" />
            <label className="grid gap-1 text-sm"><span>Coach</span>
              <select value={coach} onChange={(e) => setCoach(e.target.value)} className="h-11 rounded-md border border-input bg-background px-2 text-base">
                <option value="">Plain and kind</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}: {a.role}</option>)}
              </select>
            </label>
            <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-border bg-card/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
              <Button className="h-12 w-full" disabled={!!busy || !dump.trim()} onClick={async () => { await run("dump", { op: "dump", text: dump, pace, mood }); setDump(""); setShowDump(false); }}>{busy === "dump" ? "Sorting…" : "Make my plan"}</Button>
            </div>
          </div>
        )}
      </div>

      {groups.length === 0 && state && <p className="text-center text-sm text-muted-foreground">Nothing open. Capture something above, or do a brain dump.</p>}
      {groups.map((g) => (
        <section key={g.k} aria-label={TIER_LABEL[g.k as Tier | "none"]}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">{TIER_LABEL[g.k as Tier | "none"]} · {g.list.length}</h2>
          <ul className="grid gap-2">{g.list.map((t) => <TaskRow key={t.id} {...rowProps(t)} />)}</ul>
        </section>
      ))}

      {done.length > 0 && (
        <section aria-label="Done">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">Done · {done.length}</h2>
          <ul className="grid gap-1 text-sm text-muted-foreground">{done.map((t) => <li key={t.id} className="flex items-center gap-2"><Check className="size-4" /><span className="line-through">{t.title}</span><button type="button" className="ml-auto underline" onClick={() => void run("reopen", { op: "reopen", id: t.id })}>undo</button></li>)}</ul>
        </section>
      )}

      <EndOfDay cal={cal} tasks={tasks} today={today} busy={!!busy} run={run} />
      <WeekPanel cal={cal} tasks={tasks} stats={state?.stats} today={today} note={weekNote} busy={!!busy} run={run} />
      <RoutinesPanel routines={state?.routines ?? []} busy={!!busy} run={run} />

      <div className="rounded-lg border border-border bg-card">
        <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left font-semibold" aria-expanded={showSetup} onClick={() => setShowSetup((v) => !v)}>Put it on your iPhone <span className="text-muted-foreground">{showSetup ? "▾" : "▸"}</span></button>
        {showSetup && (
          <div className="grid gap-3 border-t border-border p-4 text-sm">
            <p><b>Home screen:</b> in Safari, tap Share, then Add to Home Screen. It opens as its own app called Today.</p>
            <p><b>Share menu:</b> after installing, share text or a link from any app and choose Today (if it isn't listed, use More). The text lands in the box above; tap Add to keep it.</p>
            <div className="grid gap-1">
              <b>Shortcut or Siri:</b>
              <ol className="ml-5 list-decimal space-y-1">
                <li>Create an access token in Pixel Pals (account menu, Connect iPhone) if you haven't.</li>
                <li>In Shortcuts, add <i>Dictate Text</i> (or <i>Ask for Input</i>), then <i>Get Contents of URL</i>.</li>
                <li>Method POST, request body JSON with <code>text</code> set to the dictated text, and a header <code>Authorization</code> = <code>Bearer </code> followed by your token.</li>
                <li>Name the Shortcut "Add to Today" and say that to Siri.</li>
              </ol>
              <div className="flex gap-2"><input readOnly value={`${origin}/api/today-capture`} aria-label="Capture address" className="secret min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2" onFocus={(e) => e.currentTarget.select()} /><Button variant="outline" size="sm" className="h-11" onClick={() => void navigator.clipboard?.writeText(`${origin}/api/today-capture`).then(() => setMsg("Address copied."), () => setMsg("Select the address and copy it."))}><Copy className="size-4" /> Copy</Button></div>
              <span className="text-xs text-muted-foreground">The token only lets a Shortcut add items. It can't read your list.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
