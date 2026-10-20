import { useEffect, useRef } from "react";
import { readBase, signature, writeBase, type SyncBase, type SyncItem } from "@/lib/task-sync-client";
import { getWorkbench, updateWorkbench, useWorkbench } from "@/lib/workbench";

/**
 * Renders nothing. When the server has a calendar server (Radicale) set up, keeps your to-dos in step with it, and so with the iPhone
 * Reminders app: on load, every minute, and a couple of seconds after you change the list. Quietly does nothing when it isn't set up.
 */
export function TaskSync() {
  const { todos } = useWorkbench();
  const on = useRef(true);
  const busy = useRef(false);
  const again = useRef(false);
  const sig = signature(todos);

  const run = useRef(async () => {});
  run.current = async () => {
    if (!on.current) return;
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      const sent = getWorkbench().todos.map(({ id, text, done }): SyncItem => ({ id, text, done }));
      const res = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "sync", todos: sent, base: readBase() }) });
      if (res.status === 403) { on.current = false; return; }
      const json = (await res.json().catch(() => ({}))) as { configured?: boolean; todos?: SyncItem[]; base?: SyncBase };
      if (json.configured === false) { on.current = false; return; }
      if (!res.ok || !json.todos || !json.base) return;
      if (signature(getWorkbench().todos) !== signature(sent)) { again.current = true; return; } // edited meanwhile: sync again with the new list
      const merged = json.todos;
      updateWorkbench((w) => ({
        ...w,
        todos: merged.map((t) => { const old = w.todos.find((x) => x.id === t.id); return { id: t.id, text: t.text, done: t.done, at: old?.at ?? Date.now() }; }).slice(-100),
      }));
      writeBase(json.base);
    } catch { /* offline: try again next time */ } finally {
      busy.current = false;
      if (again.current) { again.current = false; window.setTimeout(() => void run.current(), 1500); }
    }
  };

  useEffect(() => {
    void run.current();
    const t = window.setInterval(() => void run.current(), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    const t = window.setTimeout(() => void run.current(), 2000);
    return () => window.clearTimeout(t);
  }, [sig]);
  return null;
}
