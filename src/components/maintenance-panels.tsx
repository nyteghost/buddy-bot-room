import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Sched = { id: string; time: string; days: string; prompt: string; last: string; lastResult: string };
const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
};

/** Last backup, "Back up now" and one-click restore (a safety copy is always taken first). */
export function BackupSection({ open }: { open: boolean }) {
  const [status, setStatus] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [ages, setAges] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try {
      const s = await (await fetch("/api/backup")).json() as { text?: string; error?: string };
      setStatus(s.text ?? s.error ?? "");
      const l = await post("/api/backup", { op: "list" });
      setNames(Array.isArray(l["names"]) ? (l["names"] as string[]) : []);
      setAges((l["ages"] as Record<string, string>) ?? {});
    } catch { setStatus("Couldn't reach the server."); }
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const backupNow = async () => { setBusy("now"); setNote(""); const r = await post("/api/backup", {}); setNote(String(r["text"] ?? r["error"] ?? "")); await load(); setBusy(""); };
  const restore = async (name: string) => {
    if (!window.confirm(`Restore ${name}? Your current data is saved first as pre-restore-<time>. You may need to sign in again.`)) return;
    setBusy(name); setNote("");
    const r = await post("/api/backup", { op: "restore", name, confirm: true });
    setNote(String(r["text"] ?? r["error"] ?? ""));
    setBusy("");
  };
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <p className="font-medium">Backups</p>
      <p className="whitespace-pre-wrap text-xs text-muted-foreground">{status || "Loading…"}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!!busy} onClick={() => void backupNow()}>{busy === "now" ? <Loader2 className="size-3 animate-spin" /> : "Back up now"}</Button></div>
      {names.length > 0 && (
        <ul className="grid gap-1">
          {names.map((n) => (
            <li key={n} className="flex items-center justify-between gap-2 text-xs"><span>{n}{ages[n] ? ` · ${ages[n]}` : ""}</span><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void restore(n)}>{busy === n ? <Loader2 className="size-3 animate-spin" /> : "Restore"}</Button></li>
          ))}
        </ul>
      )}
      {note && <p className="whitespace-pre-wrap text-xs">{note}</p>}
    </div>
  );
}

/** Scheduled tasks: what each one last did, a Run button, and add/remove. */
export function SchedulesSection({ open }: { open: boolean }) {
  const [list, setList] = useState<Sched[] | null>(null);
  const [zone, setZone] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [shown, setShown] = useState<Record<string, string>>({});
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState("weekdays");
  const [prompt, setPrompt] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await post("/api/schedules", { op: "data" });
      if (typeof r["error"] === "string") { setErr(r["error"]); setList([]); return; }
      setErr(""); setList((r["schedules"] as Sched[]) ?? []); setZone(String(r["tz"] ?? ""));
    } catch { setErr("Couldn't reach the server."); }
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const run = async (s: Sched) => { setBusy(s.id); const r = await post("/api/schedules", { op: "run", text: s.id }); setShown((x) => ({ ...x, [s.id]: String(r["text"] ?? r["error"] ?? "") })); await load(); setBusy(""); };
  const remove = async (i: number) => { setBusy("rm"); await post("/api/schedules", { op: "remove", text: String(i + 1) }); await load(); setBusy(""); };
  const add = async () => {
    if (!prompt.trim()) return;
    setBusy("add"); const r = await post("/api/schedules", { op: "add", text: `${time} ${days} ${prompt.trim()}` });
    setErr(String(r["text"] ?? "").startsWith("Scheduled") ? "" : String(r["text"] ?? "")); setPrompt(""); await load(); setBusy("");
  };
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <p className="font-medium">Scheduled tasks {zone && <span className="text-xs font-normal text-muted-foreground">({zone}; answers go to your phone)</span>}</p>
      {list?.length === 0 && !err && <p className="text-xs text-muted-foreground">None yet. Add one below, for example 08:00 weekdays "What should I know today?".</p>}
      {list?.map((s, i) => (
        <div key={s.id} className="grid gap-1 rounded border p-2 text-xs">
          <div className="flex items-center justify-between gap-2"><span><b>{s.time}</b> {s.days} · {s.prompt}</span>
            <span className="flex gap-1"><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void run(s)} title="Run it now"><>{busy === s.id ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />} Run</></Button>
              <Button size="icon" variant="ghost" aria-label="Remove" disabled={!!busy} onClick={() => void remove(i)}><Trash2 className="size-3" /></Button></span></div>
          <p className="text-muted-foreground">{s.last ? `Last ran ${s.last}.` : "Hasn't run yet."} {(shown[s.id] ?? s.lastResult) && <span className="whitespace-pre-wrap">Last answer: {(shown[s.id] ?? s.lastResult).slice(0, 600)}</span>}</p>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input className="w-20 rounded-md border bg-background px-2 py-1" aria-label="Time (24-hour)" value={time} onChange={(e) => setTime(e.target.value)} />
        <select className="rounded-md border bg-background px-2 py-1" aria-label="Days" value={days} onChange={(e) => setDays(e.target.value)}><option>daily</option><option>weekdays</option><option>weekends</option></select>
        <input className="min-w-40 flex-1 rounded-md border bg-background px-2 py-1" aria-label="What should the pals answer?" placeholder="What should the pals answer?" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <Button size="sm" disabled={!!busy || !prompt.trim()} onClick={() => void add()}>Add</Button>
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
    </div>
  );
}
