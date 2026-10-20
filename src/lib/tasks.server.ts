import { accountsEnabled } from "./accounts";
import { currentUser } from "./accounts.server";
import { buildVtodo, patchVtodo } from "./caldav";
import { caldavConfig, deleteTodo, listTodos, putTodo } from "./caldav.server";
import { logServer } from "./server-log.server";
import { syncPlan } from "./task-sync";

/** To-do item as it travels between the browser, this server and the phone. */
export type Item = { id: string; text: string; done: boolean };
const same = (a: Item, b: Item): boolean => a.text === b.text && a.done === b.done;

let chain: Promise<unknown> = Promise.resolve();
const locked = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => undefined); return run; };

const clean = (raw: unknown): Item[] => (Array.isArray(raw) ? raw : []).flatMap((r): Item[] => {
  const o = r as Partial<Item> | null;
  return o && typeof o.id === "string" && o.id && typeof o.text === "string" && o.text.trim() ? [{ id: o.id.slice(0, 64), text: o.text.replace(/\s+/g, " ").trim().slice(0, 400), done: o.done === true }] : [];
}).slice(0, 200);

const cleanBase = (raw: unknown): Record<string, Item> => {
  const out: Record<string, Item> = {};
  for (const i of clean(Object.values((raw as Record<string, unknown>) ?? {}))) out[i.id] = i;
  return out;
};

/** POST { op: "sync", todos, base } → merges the browser's to-dos with the calendar server's "tasks" list. Owner only. */
export async function handleTasks(request: Request): Promise<Response> {
  if (accountsEnabled(process.env) && !(await currentUser(request))?.owner) return Response.json({ error: "Only the owner can sync tasks." }, { status: 403 });
  const cfg = caldavConfig();
  if (!cfg) return Response.json({ configured: false });
  const body = (await request.json().catch(() => ({}))) as { todos?: unknown; base?: unknown };
  return locked(async () => {
    try {
      const remoteRows = await listTodos(cfg, "tasks");
      const byId = new Map(remoteRows.map((r) => [r.todo.uid, r]));
      const remote: Item[] = remoteRows.map((r) => ({ id: r.todo.uid, text: r.todo.summary || "(untitled)", done: r.todo.done }));
      const plan = syncPlan(clean(body.todos), remote, cleanBase(body.base), same);
      const now = Date.now();
      for (const t of plan.push) {
        const existing = byId.get(t.id);
        if (existing) await putTodo(cfg, "tasks", t.id, patchVtodo(existing.raw, { summary: t.text, done: t.done }, now), existing.href);
        else await putTodo(cfg, "tasks", t.id, buildVtodo({ uid: t.id, summary: t.text, done: t.done }, now));
      }
      for (const id of plan.remoteDelete) { const r = byId.get(id); if (r) await deleteTodo(cfg, r.href); }
      return Response.json({ configured: true, todos: plan.local, base: plan.base });
    } catch (e) {
      logServer("warn", `Task sync failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`);
      return Response.json({ configured: true, error: e instanceof Error ? e.message : "Sync failed." }, { status: 502 });
    }
  });
}
