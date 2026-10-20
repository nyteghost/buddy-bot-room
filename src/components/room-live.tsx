import { useEffect, useMemo, useState } from "react";
import { agentName, type AgentId } from "@/lib/agents";
import { ambientLines, needsAttention, phaseOf, skyOf, whenText, type LiveData } from "@/lib/live-room";
import { levelFraction, levelOf, seasonal, unlocked } from "@/lib/progress";
import { syncDoneTasks, useProgress } from "@/lib/progress-store";
import { useWorkbench } from "@/lib/workbench";
import { describeCode, unitSymbols, type Weather } from "@/lib/weather";
import type { CharacterMode } from "@/lib/hellraiser";

export type RoomTarget = "today" | "mail" | "calendar" | "tasks" | "setup";

const getJson = async (path: string): Promise<any> => {
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};

/** Real weather, mail, calendar and server health for the room (owner only; anything unavailable is just left out). */
function useLiveData(active: boolean): LiveData {
  const { todos } = useWorkbench();
  const [d, setD] = useState<Omit<LiveData, "tasks">>({});
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = async () => {
      if (document.visibilityState === "hidden") return;
      const [w, cal, mail, un] = await Promise.all([getJson("/api/weather"), getJson("/api/calendar?days=2"), getJson("/api/mail"), getJson("/api/unraid")]);
      if (stop) return;
      const next: Omit<LiveData, "tasks"> = {};
      const weather = w as Weather | null;
      if (weather?.now) {
        const info = describeCode(weather.now.code);
        next.weather = { text: info.text, icon: info.icon, temp: `${weather.now.temp}${unitSymbols(weather.units).temp}`, sky: skyOf(weather.now.code) };
      }
      if (cal?.configured) {
        const now = Date.now();
        const up = (cal.items as { title: string; start: number; end: number; allDay: boolean }[]).find((e) => e.end >= now);
        next.next = up ? { title: up.title, when: whenText(up.start, now, cal.tz ?? "UTC", up.allDay) } : null;
      }
      if (mail?.configured) { next.unread = mail.items.length; next.newest = mail.items[0]?.subject; }
      if (un?.configured && un.status) next.server = un.phase === "down" ? "the server is down" : (un.status.problems?.[0] ?? true);
      setD(next);
    };
    void load();
    const t = window.setInterval(() => void load(), 300_000);
    return () => { stop = true; window.clearInterval(t); };
  }, [active]);
  const open = todos.filter((t) => !t.done).length;
  return { ...d, tasks: open };
}

/** The living room: sky and weather over the scene, clickable objects that show real data, ambient pal chatter, and XP. */
export function RoomLive({ active, running, theme, onOpen, onChatter }: { active: boolean; running: boolean; theme: CharacterMode; onOpen: (t: RoomTarget) => void; onChatter?: (id: AgentId | null) => void }) {
  const data = useLiveData(active);
  const progress = useProgress();
  const { todos } = useWorkbench();
  const done = todos.filter((t) => t.done).length;
  useEffect(() => { syncDoneTasks(done); }, [done]);
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => { const t = window.setInterval(() => setHour(new Date().getHours()), 60_000); return () => window.clearInterval(t); }, []);
  const phase = phaseOf(hour);
  const sky = data.weather?.sky ?? "clear";
  const lines = useMemo(() => ambientLines(data), [data]);
  const [i, setI] = useState(0);
  useEffect(() => { if (lines.length < 2) return; const t = window.setInterval(() => setI((n) => n + 1), 9000); return () => window.clearInterval(t); }, [lines.length]);
  const line = lines.length ? lines[i % lines.length] : undefined;
  useEffect(() => { onChatter?.(!running && line ? line.agent : null); }, [line?.agent, line?.text, running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onChatter?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const attention = needsAttention(data);
  const level = levelOf(progress.xp);
  const decor = [...unlocked(level).map((x) => x.icon), ...seasonal(new Date().getMonth())];
  const label = (id: AgentId) => agentName(id, theme === "hellraiser", theme === "horror", theme);
  const obj = (t: RoomTarget, icon: string, name: string, value: string, hint: string, dot = false) => (
    <button type="button" className="live-obj" title={hint} onClick={() => onOpen(t)}>
      <span className="live-icon" aria-hidden>{icon}</span>
      <span className="live-name">{name}</span>
      <span className="live-value">{value}</span>
      {dot && <i className="live-dot" aria-label="needs attention" />}
    </button>
  );
  return (
    <>
      <div className={`live-sky live-${phase} live-sky-${sky}`} aria-hidden />
      <div className="live-decor" aria-hidden>{decor.map((d, k) => <span key={k}>{d}</span>)}</div>
      <div className="live-progress" title={`Level ${level}. Finish tasks and have discussions to earn XP${progress.streak > 1 ? `. ${progress.streak}-day streak` : ""}.`}>
        <span>Lv {level}</span>
        <span className="live-bar"><i style={{ width: `${Math.round(levelFraction(progress.xp) * 100)}%` }} /></span>
        {progress.streak > 1 && <span>🔥{progress.streak}</span>}
      </div>
      {!running && line && <div className="live-ticker" role="status"><b className={`agent-${line.agent}`}>{label(line.agent)}</b> {line.text}</div>}
      <div className="live-shelf">
        {obj("today", data.weather?.icon ?? (phase === "night" ? "🌙" : "🪟"), phase === "night" ? "Night" : "Window", data.weather ? data.weather.temp : "—", data.weather ? `${data.weather.text} outside. Open Today.` : "Open Today")}
        {obj("mail", "📬", "Mailbox", data.unread === undefined ? "—" : String(data.unread), data.unread === undefined ? "Connect mail in Settings" : `${data.unread} unread. Open Mail.`, attention.mail)}
        {obj("calendar", "📅", "Calendar", data.next === undefined ? "—" : data.next ? data.next.when : "clear", data.next ? `Next: ${data.next.title}` : "Open Calendar")}
        {obj("tasks", "📋", "Board", String(data.tasks), `${data.tasks} open task${data.tasks === 1 ? "" : "s"}. Open Tasks.`)}
        {obj("setup", "🖥️", "Server", data.server === undefined || data.server === null ? "—" : data.server === true ? "ok" : "!", typeof data.server === "string" ? data.server : "Open Settings", attention.server)}
      </div>
    </>
  );
}
