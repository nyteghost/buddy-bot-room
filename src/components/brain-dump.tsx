import { useState } from "react";
import { Bell, BellOff, Flag, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addTodo, updateWorkbench, useWorkbench, type Todo } from "@/lib/workbench";
import { whenLabel } from "@/lib/when";

type AlertReply = { id?: string; text?: string; error?: string };
async function alertCall(body: Record<string, unknown>): Promise<AlertReply> {
  try {
    const response = await fetch("/api/reminders", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json() as AlertReply;
    if (!response.ok) return { error: data.error ?? "Could not save the alert." };
    return data;
  } catch { return { error: "Couldn't reach the reminder service." }; }
}

export function BrainDump() {
  const { todos } = useWorkbench();
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [times, setTimes] = useState<Record<string, string>>({});
  const tasks = todos.filter((t) => t.source === "brain-dump").slice(-12).reverse();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const capture = () => {
    const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) { setNote("Write anything that's on your mind first."); return; }
    if (lines.length > 12 || lines.some((line) => line.length > 200)) {
      setNote("Add up to 12 lines at a time, with up to 200 characters per line."); return;
    }
    updateWorkbench((w) => ({ ...w, todos: lines.reduce((all, line) => addTodo(all, line, Date.now(), "brain-dump"), w.todos) }));
    setInput("");
    setNote(lines.length === 1 ? "Captured. No need to organize it yet." : "Captured " + lines.length + " things. You can deal with them later.");
  };
  const change = (id: string, patch: Partial<Todo>) => updateWorkbench((w) => ({
    ...w, todos: w.todos.map((item) => item.id === id ? { ...item, ...patch } : item),
  }));
  const cancel = async (task: Todo): Promise<boolean> => {
    if (!task.reminderId) return true;
    const response = await alertCall({ op: "cancel", id: task.reminderId });
    if (response.error) { setNote('Could not cancel the alert for "' + task.text + '": ' + response.error); return false; }
    window.dispatchEvent(new Event("pixelpals:reminders-changed"));
    return true;
  };
  const toggleImportant = async (task: Todo, checked: boolean) => {
    if (checked) {
      change(task.id, { important: true });
      setNote("Marked important. Choose a date and time, then select Set alert.");
      return;
    }
    if (busyId) return;
    setBusyId(task.id);
    try {
      if (!(await cancel(task))) return;
      change(task.id, { important: false, reminderId: undefined, reminderAt: undefined });
      setNote("Importance cleared. Any scheduled alert was cancelled.");
    } finally { setBusyId(null); }
  };
  const schedule = async (task: Todo) => {
    if (busyId) return;
    const value = times[task.id] ?? "";
    const epoch = value ? new Date(value).getTime() : NaN;
    if (!Number.isFinite(epoch) || epoch <= Date.now() + 10_000) {
      setNote("Choose a future date and time to set this alert."); return;
    }
    setBusyId(task.id);
    try {
      const reply = await alertCall({ op: "add-at", at: epoch, text: task.text, important: true });
      if (!reply.id) { setNote(reply.error ?? "Alert not saved. The task is still captured."); return; }
      const oldId = task.reminderId;
      change(task.id, { important: true, reminderId: reply.id, reminderAt: epoch });
      window.dispatchEvent(new Event("pixelpals:reminders-changed"));
      setTimes((prev) => ({ ...prev, [task.id]: "" }));
      setNote(reply.text ?? "Important alert saved.");
      if (oldId && oldId !== reply.id) {
        const response = await alertCall({ op: "cancel", id: oldId });
        if (response.error) setNote("New alert saved, but the old alert could not be cancelled: " + response.error);
      }
    } finally { setBusyId(null); }
  };
  const complete = async (task: Todo) => {
    if (busyId) return;
    setBusyId(task.id);
    try {
      if (!task.done && !(await cancel(task))) return;
      change(task.id, { done: !task.done, reminderId: undefined, reminderAt: undefined, important: task.done ? task.important : false });
      setNote(task.done ? "Task reopened." : "Marked done. Its scheduled alert, if any, was cancelled.");
    } finally { setBusyId(null); }
  };
  const remove = async (task: Todo) => {
    if (busyId) return;
    setBusyId(task.id);
    try {
      if (!(await cancel(task))) return;
      updateWorkbench((w) => ({ ...w, todos: w.todos.filter((t) => t.id !== task.id) }));
      setNote("Removed from your brain dump.");
    } finally { setBusyId(null); }
  };
  return (
    <section className="grid gap-3 rounded-md border p-3" aria-label="Brain Dump">
      <div>
        <h3 className="text-sm font-semibold">Brain Dump</h3>
        <p className="text-xs text-muted-foreground">Get it out of your head. One thought per line; organize it only if you want to.</p>
      </div>
      <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); capture(); }}>
        <textarea aria-label="Brain dump tasks" className="min-h-20 w-full resize-y rounded-md border bg-background p-2 text-sm" rows={3} maxLength={2600} placeholder={"Check next week's schedule\nReply to a message\nPick up groceries"} value={input} onChange={(event) => setInput(event.target.value)} />
        <Button type="submit" size="sm" className="justify-self-start"><Plus className="size-4" /> Capture thoughts</Button>
      </form>
      {tasks.length === 0 && <p className="text-xs text-muted-foreground">Nothing captured here yet. It's okay to leave it messy.</p>}
      {tasks.map((task) => (
        <div key={task.id} className="grid gap-2 rounded-md border bg-muted/20 p-2">
          <div className="flex items-start gap-2">
            <input type="checkbox" checked={task.done} disabled={!!busyId} aria-label={"Done: " + task.text} onChange={() => void complete(task)} className="mt-1 size-4" />
            <span className={"min-w-0 flex-1 break-words text-sm " + (task.done ? "text-muted-foreground line-through" : "")}>{task.text}</span>
            <Button variant="ghost" size="sm" disabled={!!busyId} aria-label={"Remove: " + task.text} className="h-7 px-1" onClick={() => void remove(task)}><Trash2 className="size-3.5" /></Button>
          </div>
          {!task.done && (
            <>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" aria-label={"Important: " + task.text} disabled={!!busyId} checked={!!task.important} onChange={(e) => void toggleImportant(task, e.target.checked)} />
                <Flag className="size-3.5" /> Important — alert me at a chosen time
              </label>
              {task.important && (
                <div className="grid gap-2 rounded-md bg-background/60 p-2">
                  {task.reminderAt && task.reminderId ? (
                    <p className="flex items-center gap-2 text-xs"><Bell className="size-3.5" /> Alert set: {whenLabel(task.reminderAt, timezone)}</p>
                  ) : (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><BellOff className="size-3.5" /> Not scheduled yet — choose when to be alerted.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="datetime-local" aria-label={"Alert time: " + task.text} className="min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 py-1 text-xs" value={times[task.id] ?? ""} onChange={(e) => setTimes((old) => ({ ...old, [task.id]: e.target.value }))} />
                    <Button size="sm" variant="outline" disabled={!!busyId || !times[task.id]} onClick={() => void schedule(task)}><Bell className="size-3.5" /> {task.reminderId ? "Change alert" : "Set alert"}</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
      <p className="text-xs text-muted-foreground">Captured tasks stay in this browser and appear in Tasks. Scheduled alerts are stored on your server. Phone alerts require configured ntfy or Telegram; important alerts repeat every 15 minutes until dismissed (within the reminder system's limits).</p>
    </section>
  );
}
