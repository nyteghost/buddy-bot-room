import { useSyncExternalStore } from "react";
import { agents } from "./agents";

/**
 * Lightweight project workspaces. A project is a small record kept in this browser (and in backups / account sync):
 * objective, status, assigned pals, tasks with "after" dependencies, saved decisions, next steps, relevant document names and a short run history.
 * Project memories live in the existing workbench (`project[name]`), and tasks can be copied to the normal to-do list, so nothing is duplicated.
 */
export type ProjectStatus = "active" | "paused" | "done";
export type PTask = { id: string; text: string; done: boolean; after: string[] };
export type PDecision = { id: string; text: string; at: number };
export type PRun = { at: number; topic: string; mode: string; pals: string[]; gist: string };
export type Project = {
  name: string;
  objective: string;
  status: ProjectStatus;
  agents: string[];
  tasks: PTask[];
  decisions: PDecision[];
  next: string;
  docs: string[];
  history: PRun[];
  updated: number;
};
export type Projects = Record<string, Project>;

export const PLIMITS = { name: 60, objective: 400, task: 160, decision: 300, next: 400, tasks: 60, decisions: 40, docs: 30, history: 30, gist: 200, topic: 120 } as const;
const STATUSES: ProjectStatus[] = ["active", "paused", "done"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");
const id = () => Math.random().toString(36).slice(2, 10);

export function newProject(name: string, now = Date.now()): Project | null {
  const n = str(name, PLIMITS.name).replace(/\s+/g, " ");
  if (!n || n === "__proto__" || n === "constructor") return null;
  return { name: n, objective: "", status: "active", agents: [], tasks: [], decisions: [], next: "", docs: [], history: [], updated: now };
}

/** Rebuilds one project from untrusted stored data, dropping bad fields and impossible dependencies. */
export function cleanProject(v: unknown, knownPals: readonly string[]): Project | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const base = newProject(str(r["name"], PLIMITS.name), Number.isFinite(r["updated"]) ? (r["updated"] as number) : 0);
  if (!base) return null;
  const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  const tasks: PTask[] = [];
  for (const t of arr(r["tasks"]).slice(0, PLIMITS.tasks)) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const text = str(o["text"], PLIMITS.task);
    const tid = str(o["id"], 20) || id();
    if (!text || tasks.some((x) => x.id === tid)) continue;
    tasks.push({ id: tid, text, done: o["done"] === true, after: arr(o["after"]).filter((a): a is string => typeof a === "string").slice(0, 10) });
  }
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.after = [...new Set(t.after)].filter((a) => ids.has(a) && a !== t.id);
  // Remove cycles by dropping the dependencies of any task that is part of one.
  for (const t of tasks) if (reaches(tasks, t.id, t.id)) t.after = [];
  return {
    ...base,
    objective: str(r["objective"], PLIMITS.objective),
    status: STATUSES.includes(r["status"] as ProjectStatus) ? (r["status"] as ProjectStatus) : "active",
    agents: [...new Set(arr(r["agents"]).filter((a): a is string => typeof a === "string" && knownPals.includes(a)))],
    tasks,
    decisions: arr(r["decisions"]).flatMap((d) => {
      const o = d as Record<string, unknown> | null;
      const text = o && typeof o === "object" ? str(o["text"], PLIMITS.decision) : "";
      return text ? [{ id: str(o?.["id"], 20) || id(), text, at: Number.isFinite(o?.["at"]) ? (o!["at"] as number) : 0 }] : [];
    }).slice(-PLIMITS.decisions),
    next: str(r["next"], PLIMITS.next),
    docs: [...new Set(arr(r["docs"]).filter((d): d is string => typeof d === "string" && !!d.trim()).map((d) => d.slice(0, 120)))].slice(0, PLIMITS.docs),
    history: arr(r["history"]).flatMap((h) => {
      const o = h as Record<string, unknown> | null;
      if (!o || typeof o !== "object") return [];
      const topic = str(o["topic"], PLIMITS.topic);
      return topic ? [{ at: Number.isFinite(o["at"]) ? (o["at"] as number) : 0, topic, mode: str(o["mode"], 20), pals: arr(o["pals"]).filter((p): p is string => typeof p === "string").slice(0, 8), gist: str(o["gist"], PLIMITS.gist) }] : [];
    }).slice(-PLIMITS.history),
  };
}
export function cleanProjects(v: unknown, knownPals: readonly string[]): Projects {
  const out: Projects = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const raw of Object.values(v as Record<string, unknown>)) {
    const p = cleanProject(raw, knownPals);
    if (p) out[p.name] = p;
  }
  return out;
}

// ── tasks and dependencies ──
function reaches(tasks: PTask[], from: string, target: string, seen = new Set<string>()): boolean {
  const t = tasks.find((x) => x.id === from);
  if (!t) return false;
  for (const a of t.after) {
    if (a === target) return true;
    if (!seen.has(a)) { seen.add(a); if (reaches(tasks, a, target, seen)) return true; }
  }
  return false;
}
export const isBlocked = (p: Project, t: PTask): boolean => !t.done && t.after.some((a) => p.tasks.some((x) => x.id === a && !x.done));
/** Tasks that can be worked on now: not done and not waiting for another task. */
export const readyTasks = (p: Project): PTask[] => p.tasks.filter((t) => !t.done && !isBlocked(p, t));
export function progress(p: Project): { done: number; total: number } {
  return { done: p.tasks.filter((t) => t.done).length, total: p.tasks.length };
}
/** A dependency that would create a loop is refused. */
export const canDepend = (p: Project, taskId: string, onId: string): boolean => taskId !== onId && p.tasks.some((t) => t.id === onId) && !reaches(p.tasks, onId, taskId);

const touch = (p: Project, now = Date.now()): Project => ({ ...p, updated: now });
export function addTask(p: Project, text: string, after: string[] = []): Project {
  const t = str(text, PLIMITS.task);
  if (!t || p.tasks.length >= PLIMITS.tasks) return p;
  const tid = id();
  return touch({ ...p, tasks: [...p.tasks, { id: tid, text: t, done: false, after: after.filter((a) => p.tasks.some((x) => x.id === a)) }] });
}
export const toggleTask = (p: Project, taskId: string): Project => touch({ ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)) });
export const removeTask = (p: Project, taskId: string): Project => touch({ ...p, tasks: p.tasks.filter((t) => t.id !== taskId).map((t) => ({ ...t, after: t.after.filter((a) => a !== taskId) })) });
export function setDependency(p: Project, taskId: string, onId: string, on: boolean): Project {
  if (on && !canDepend(p, taskId, onId)) return p;
  return touch({ ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, after: on ? [...new Set([...t.after, onId])] : t.after.filter((a) => a !== onId) } : t)) });
}
export function addDecision(p: Project, text: string, now = Date.now()): Project {
  const t = str(text, PLIMITS.decision);
  return t ? touch({ ...p, decisions: [...p.decisions, { id: id(), text: t, at: now }].slice(-PLIMITS.decisions) }, now) : p;
}
export const removeDecision = (p: Project, decisionId: string): Project => touch({ ...p, decisions: p.decisions.filter((d) => d.id !== decisionId) });
export function logRun(p: Project, run: { topic: string; mode: string; pals: string[]; gist: string }, now = Date.now()): Project {
  const topic = str(run.topic, PLIMITS.topic);
  if (!topic) return p;
  return touch({ ...p, history: [...p.history, { at: now, topic, mode: str(run.mode, 20), pals: run.pals.slice(0, 8), gist: str(run.gist, PLIMITS.gist) }].slice(-PLIMITS.history) }, now);
}
export const setField = <K extends "objective" | "next" | "status" | "agents" | "docs">(p: Project, k: K, v: Project[K]): Project =>
  touch({ ...p, [k]: typeof v === "string" ? str(v, k === "objective" ? PLIMITS.objective : k === "next" ? PLIMITS.next : 20) : v });

/** What to put in front of the pals while this project is active. Short, plain text, labelled as notes (the caller adds the "data, not instructions" frame). */
export function projectBrief(p: Project, nameOf: (id: string) => string = (x) => x, maxChars = 800): string {
  const lines = [`Active project: ${p.name} (${p.status}).`];
  if (p.objective) lines.push(`Objective: ${p.objective}`);
  if (p.agents.length) lines.push(`Assigned: ${p.agents.map(nameOf).join(", ")}.`);
  const open = p.tasks.filter((t) => !t.done);
  if (open.length) lines.push("Open tasks: " + open.slice(0, 8).map((t) => `${t.text}${isBlocked(p, t) ? " (waiting on another task)" : ""}`).join("; ") + (open.length > 8 ? `; and ${open.length - 8} more` : ""));
  if (p.decisions.length) lines.push("Decisions made: " + p.decisions.slice(-5).map((d) => d.text).join("; "));
  if (p.next) lines.push(`Next steps: ${p.next}`);
  const text = lines.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
}

/** One line for "where did we leave off" after a restart. */
export function resumeLine(p: Project, nameOf: (id: string) => string = (x) => x): string {
  const last = p.history[p.history.length - 1];
  const ready = readyTasks(p);
  return [
    last ? `Last discussed: “${last.topic}”` : "Nothing discussed yet",
    ready.length ? `ready now: ${ready.slice(0, 3).map((t) => t.text).join("; ")}` : p.tasks.some((t) => !t.done) ? "all open tasks are waiting on others" : p.tasks.length ? "all tasks done" : "no tasks yet",
    p.next ? `next: ${p.next}` : "",
    p.agents.length ? `team: ${p.agents.map(nameOf).join(", ")}` : "",
  ].filter(Boolean).join(" · ");
}

// ── browser storage ──
export const PROJECTS_KEY = "pixel-pals-projects-v1";
const listeners = new Set<() => void>();
let cache: Projects | null = null;
const known: readonly string[] = agents.map((a) => a.id);
const none: Projects = {};
export function getProjects(): Projects {
  if (cache) return cache;
  try { cache = typeof localStorage === "undefined" ? none : cleanProjects(JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? "null"), known); } catch { cache = none; }
  return cache;
}
export function updateProjects(change: (p: Projects) => Projects): void {
  cache = cleanProjects(change(getProjects()), known);
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(cache)); } catch { /* optional storage */ }
  listeners.forEach((l) => l());
}
export const updateProject = (name: string, change: (p: Project) => Project): void =>
  updateProjects((all) => (all[name] ? { ...all, [name]: change(all[name]!) } : all));
export const useProjects = (): Projects => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), getProjects, () => none);
