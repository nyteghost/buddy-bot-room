import { buildVtodo, patchVtodo } from "./caldav";
import { caldavConfig, deleteTodo, listTodos, putTodo } from "./caldav.server";
import { logServer } from "./server-log.server";
import { updateReminders } from "./reminders.server";
import type { Reminder } from "./reminders";
import { syncPlan } from "./task-sync";

/**
 * Keeps reminders in step with the calendar server's "reminders" list, so they show up in the iPhone's Reminders app (with its own alerts),
 * and anything you add or finish there comes back. Runs every couple of minutes from the scheduler. A one-shot ticked off on the phone is dropped here.
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fs = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const baseFile = () => `${dir()}/caldav-reminders-base.json`;
const minute = (ms: number) => Math.round(ms / 60_000);
const same = (a: Reminder, b: Reminder): boolean => a.text === b.text && minute(a.at) === minute(b.at) && (a.repeat ?? "") === (b.repeat ?? "");
const state = globalThis as unknown as { __buddyReminderSync?: number };

async function readBase(): Promise<Record<string, Reminder>> {
  try { return JSON.parse(await (await fs()).readFile(baseFile(), "utf8")) as Record<string, Reminder>; } catch { return {}; }
}

export async function syncReminders(): Promise<void> {
  const cfg = caldavConfig();
  if (!cfg || !dir()) return;
  const rows = await listTodos(cfg, "reminders");
  const byId = new Map(rows.map((r) => [r.todo.uid, r]));
  // Finished on the phone, or no time set: not a reminder we can use. Finished ones are cleared off the server below.
  const finished = rows.filter((r) => r.todo.done);
  const remote: Reminder[] = rows.filter((r) => !r.todo.done && r.todo.due !== null).map((r) => ({ id: r.todo.uid, at: r.todo.due as number, text: r.todo.summary || "(untitled)", repeat: r.todo.repeat }));
  const base = await readBase();
  const out = await updateReminders(async (local) => {
    const plan = syncPlan(local, remote, base, same);
    const now = Date.now();
    for (const t of plan.push) {
      const ex = byId.get(t.id);
      if (ex) await putTodo(cfg, "reminders", t.id, patchVtodo(ex.raw, { summary: t.text, due: t.at }, now), ex.href);
      else await putTodo(cfg, "reminders", t.id, buildVtodo({ uid: t.id, summary: t.text, done: false, due: t.at, repeat: t.repeat }, now));
    }
    for (const id of plan.remoteDelete) { const ex = byId.get(id); if (ex) await deleteTodo(cfg, ex.href); }
    for (const f of finished) { if (!plan.remoteDelete.includes(f.todo.uid)) await deleteTodo(cfg, f.href).catch(() => undefined); }
    return { list: plan.local, result: plan.base };
  });
  const f = await fs();
  await f.mkdir(dir(), { recursive: true });
  await f.writeFile(`${baseFile()}.tmp`, JSON.stringify(out), { encoding: "utf8", mode: 0o600 });
  await f.rename(`${baseFile()}.tmp`, baseFile());
}

/** Scheduler hook: at most every two minutes, never throws. */
export async function tickCaldav(now = Date.now()): Promise<void> {
  if (!caldavConfig() || !dir()) return;
  if (now - (state.__buddyReminderSync ?? 0) < 120_000) return;
  state.__buddyReminderSync = now;
  try { await syncReminders(); } catch (e) { logServer("warn", `Reminder sync failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}`); }
}
