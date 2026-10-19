/**
 * Unraid health: pure shaping, problem detection and the up/down state machine.
 * The server module fetches; nothing here touches the network, so it can all be tested.
 */
export type DiskInfo = { name: string; status: string; tempC?: number };
export type ContainerInfo = { name: string; state: string; autoStart?: boolean };
export type UnraidStatus = {
  checkedAt: number;
  reachable: boolean;
  /** undefined when the server couldn't be reached at all. */
  apiOk?: boolean;
  arrayState?: string;
  disks: DiskInfo[];
  containers: ContainerInfo[];
  uptimeSeconds?: number;
  /** Things we couldn't read (API shape differences, permissions). Not problems with the server itself. */
  notes: string[];
  problems: string[];
};

export const TEMP_WARN = 50;
export const TEMP_HOT = 60;
const OK_DISK = new Set(["DISK_OK", "DISK_NP"]);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function shapeDisks(json: unknown): { state?: string; disks: DiskInfo[] } {
  const a = rec(rec(json)["array"]);
  const disks: DiskInfo[] = [];
  for (const group of ["parities", "disks", "caches"]) {
    for (const d of arr(a[group])) {
      const r = rec(d);
      const name = str(r["name"]);
      if (!name) continue;
      const disk: DiskInfo = { name, status: str(r["status"]) || "UNKNOWN" };
      const t = num(r["temp"]);
      if (t !== undefined && t > 0) disk.tempC = t;
      disks.push(disk);
    }
  }
  const state = str(a["state"]);
  return state ? { state, disks } : { disks };
}

export function shapeContainers(json: unknown): ContainerInfo[] {
  const root = rec(json);
  const list = arr(root["dockerContainers"]).length ? arr(root["dockerContainers"]) : arr(rec(root["docker"])["containers"]);
  const out: ContainerInfo[] = [];
  for (const c of list) {
    const r = rec(c);
    const name = (arr(r["names"])[0] ? str(arr(r["names"])[0]) : str(r["name"])).replace(/^\//, "");
    if (!name) continue;
    const item: ContainerInfo = { name, state: (str(r["state"]) || str(r["status"]) || "unknown").toLowerCase() };
    if (typeof r["autoStart"] === "boolean") item.autoStart = r["autoStart"];
    out.push(item);
  }
  return out;
}

export function shapeUptime(json: unknown): number | undefined {
  const up = rec(rec(rec(json)["info"])["os"])["uptime"];
  if (typeof up === "number") return up > 1e12 ? undefined : up; // seconds
  if (typeof up === "string") {
    const t = Date.parse(up); // boot time
    return Number.isNaN(t) ? undefined : Math.max(0, Math.round((Date.now() - t) / 1000));
  }
  return undefined;
}

export function problemsOf(s: Pick<UnraidStatus, "arrayState" | "disks" | "containers">): string[] {
  const out: string[] = [];
  if (s.arrayState && s.arrayState.toUpperCase() !== "STARTED") out.push(`The array is ${s.arrayState.toLowerCase().replace(/_/g, " ")} (not started).`);
  for (const d of s.disks) {
    if (!OK_DISK.has(d.status.toUpperCase()) && d.status !== "UNKNOWN") out.push(`Disk ${d.name} reports ${d.status}.`);
    if (d.tempC !== undefined && d.tempC >= TEMP_HOT) out.push(`Disk ${d.name} is very hot (${d.tempC}°C).`);
    else if (d.tempC !== undefined && d.tempC >= TEMP_WARN) out.push(`Disk ${d.name} is running warm (${d.tempC}°C).`);
  }
  for (const c of s.containers) if (c.autoStart === true && c.state !== "running") out.push(`Container ${c.name} is ${c.state} but is set to auto-start.`);
  return out;
}

export function buildStatus(parts: { now: number; reachable: boolean; apiOk?: boolean; disks?: ReturnType<typeof shapeDisks>; containers?: ContainerInfo[]; uptimeSeconds?: number; notes?: string[] }): UnraidStatus {
  const base = { disks: parts.disks?.disks ?? [], containers: parts.containers ?? [] };
  const s: UnraidStatus = { checkedAt: parts.now, reachable: parts.reachable, ...base, notes: parts.notes ?? [], problems: [] };
  if (parts.apiOk !== undefined) s.apiOk = parts.apiOk;
  if (parts.disks?.state) s.arrayState = parts.disks.state;
  if (parts.uptimeSeconds !== undefined) s.uptimeSeconds = parts.uptimeSeconds;
  s.problems = parts.reachable ? problemsOf(s) : [];
  return s;
}

const dur = (sec: number) => (sec >= 86400 ? `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h` : sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : `${Math.max(1, Math.round(sec / 60))}m`);
export const formatDuration = dur;

export function statusMarkdown(s: UnraidStatus): string {
  if (!s.reachable) return "**Unraid is unreachable.** I couldn't connect to it just now.";
  const lines = [s.problems.length ? `**Unraid needs attention** (${s.problems.length} issue${s.problems.length === 1 ? "" : "s"}):` : "**Unraid looks healthy.**"];
  for (const p of s.problems) lines.push(`- ${p}`);
  const bits: string[] = [];
  if (s.arrayState) bits.push(`array ${s.arrayState.toLowerCase()}`);
  if (s.disks.length) bits.push(`${s.disks.length} disk${s.disks.length === 1 ? "" : "s"}${s.disks.some((d) => d.tempC) ? `, hottest ${Math.max(...s.disks.map((d) => d.tempC ?? 0))}°C` : ""}`);
  if (s.containers.length) bits.push(`${s.containers.filter((c) => c.state === "running").length}/${s.containers.length} containers running`);
  if (s.uptimeSeconds !== undefined) bits.push(`up ${dur(s.uptimeSeconds)}`);
  if (bits.length) lines.push(bits.join(" · "));
  if (s.apiOk === false) lines.push("_The Unraid API rejected the key or isn't available, so I can only tell that the server answers._");
  for (const n of s.notes) lines.push(`_${n}_`);
  return lines.join("\n");
}

/** Topic handed to the pals for /diagnose. Read-only data; they advise, they don't act. */
export function diagnoseTopic(s: UnraidStatus): string {
  const facts = [
    s.reachable ? "The server answers." : "The server is NOT reachable.",
    s.arrayState ? `Array state: ${s.arrayState}.` : "",
    ...s.problems,
    s.disks.length ? `Disks: ${s.disks.map((d) => `${d.name} ${d.status}${d.tempC ? ` ${d.tempC}°C` : ""}`).join("; ")}.` : "",
    s.containers.length ? `Containers not running: ${s.containers.filter((c) => c.state !== "running").map((c) => `${c.name} (${c.state})`).join(", ") || "none"}.` : "",
  ].filter(Boolean);
  return `My Unraid server was just checked. Facts (read-only data, nothing has been changed):\n${facts.map((f) => `- ${f}`).join("\n")}\nWhat is most likely wrong, and what should I check first? Give safe, ordered steps. Don't claim you fixed anything.`;
}

// ── watcher state machine ──────────────────────────────────────────────────────────────────────
export type WatchState = {
  /** "unknown" until the first check completes. */
  phase: "unknown" | "up" | "down";
  fails: number;
  downSince?: number;
  lastProblems: string[];
  last?: UnraidStatus;
};
export type WatchEvent =
  | { type: "down"; since: number }
  | { type: "up"; downFor: number }
  | { type: "problems"; problems: string[] }
  | { type: "cleared" };

export const FAILS_BEFORE_DOWN = 2;
export const initialWatch: WatchState = { phase: "unknown", fails: 0, lastProblems: [] };

/** One check result in, new state and the alerts to send out. Two failures in a row before "down" avoids false alarms. */
export function nextWatch(prev: WatchState, status: UnraidStatus): { state: WatchState; events: WatchEvent[] } {
  const events: WatchEvent[] = [];
  if (!status.reachable) {
    const fails = prev.fails + 1;
    const state: WatchState = { ...prev, fails, last: status };
    if (prev.phase !== "down" && fails >= FAILS_BEFORE_DOWN) {
      state.phase = "down";
      state.downSince = prev.downSince ?? status.checkedAt;
      events.push({ type: "down", since: state.downSince });
    }
    return { state, events };
  }
  const state: WatchState = { phase: "up", fails: 0, lastProblems: status.problems, last: status };
  if (prev.phase === "down") events.push({ type: "up", downFor: Math.round((status.checkedAt - (prev.downSince ?? status.checkedAt)) / 1000) });
  const before = prev.phase === "down" ? [] : prev.lastProblems;
  const key = (l: string[]) => [...l].sort().join("|");
  if (key(before) !== key(status.problems)) events.push(status.problems.length ? { type: "problems", problems: status.problems } : { type: "cleared" });
  return { state, events };
}

export function eventText(e: WatchEvent): { title: string; body: string; priority: "default" | "high" | "urgent" } {
  switch (e.type) {
    case "down": return { title: "Unraid is unreachable", body: `Pixel Pals can't reach your Unraid server (since ${new Date(e.since).toLocaleTimeString()}).`, priority: "urgent" };
    case "up": return { title: "Unraid is back", body: `Unraid is reachable again after ${dur(e.downFor)}.`, priority: "default" };
    case "problems": return { title: "Unraid needs attention", body: e.problems.slice(0, 5).join(" "), priority: "high" };
    case "cleared": return { title: "Unraid is healthy again", body: "The earlier warnings are gone.", priority: "default" };
  }
}

/** What /api/unraid returns to the browser. */
export type UnraidReply =
  | { configured: false }
  | { configured: true; phase: WatchState["phase"]; downSince?: number; status: UnraidStatus | null; events: { t: number; title: string; body: string }[]; intervalSec: number; push: boolean };

export const NOT_SET_UP = "Unraid isn't set up yet. Add `UNRAID_URL` (and `UNRAID_API_KEY`, created in Unraid under Settings → Management Access → API Keys) to the stack's environment variables, then redeploy.";
