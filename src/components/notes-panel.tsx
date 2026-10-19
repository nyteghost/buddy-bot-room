import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addEntry,
  addTodo,
  clearDone,
  removeAt,
  toggleTodo,
  updateWorkbench,
  useWorkbench,
} from "@/lib/workbench";

/** Memories, notes and to-dos. Memories and open to-dos are shared with the pals; notes stay private. */
export function NotesPanel() {
  const bench = useWorkbench();
  const [memory, setMemory] = useState("");
  const [note, setNote] = useState("");
  const [todo, setTodo] = useState("");

  return (
    <div className="notes-panel">
      <section>
        <h3>Pals remember <span>shared with every pal</span></h3>
        <ul>
          {bench.memories.map((m, i) => (
            <li key={m.id}>
              <span>{m.text}</span>
              <button type="button" aria-label={`Forget memory ${i + 1}`} onClick={() => updateWorkbench((w) => ({ ...w, memories: removeAt(w.memories, i + 1) }))}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {bench.memories.length === 0 && <li className="empty">Nothing yet. Try “I run Unraid with a 3080”.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); updateWorkbench((w) => ({ ...w, memories: addEntry(w.memories, memory) })); setMemory(""); }}>
          <Input aria-label="New memory" placeholder="Something for the pals to remember" value={memory} onChange={(e) => setMemory(e.target.value)} />
          <Button type="submit" size="sm" disabled={!memory.trim()}>Add</Button>
        </form>
      </section>

      <section>
        <h3>To-dos <span>open ones are shared with the pals</span></h3>
        <ul>
          {bench.todos.map((t, i) => (
            <li key={t.id}>
              <label className={t.done ? "done" : ""}>
                <input type="checkbox" checked={t.done} onChange={() => updateWorkbench((w) => ({ ...w, todos: toggleTodo(w.todos, i + 1) }))} />
                <span>{t.text}</span>
              </label>
              <button type="button" aria-label={`Delete to-do ${i + 1}`} onClick={() => updateWorkbench((w) => ({ ...w, todos: removeAt(w.todos, i + 1) }))}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {bench.todos.length === 0 && <li className="empty">All clear.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); updateWorkbench((w) => ({ ...w, todos: addTodo(w.todos, todo) })); setTodo(""); }}>
          <Input aria-label="New to-do" placeholder="Add a to-do" value={todo} onChange={(e) => setTodo(e.target.value)} />
          <Button type="submit" size="sm" disabled={!todo.trim()}>Add</Button>
          {bench.todos.some((t) => t.done) && (
            <Button type="button" size="sm" variant="ghost" onClick={() => updateWorkbench((w) => ({ ...w, todos: clearDone(w.todos) }))}>Clear done</Button>
          )}
        </form>
      </section>

      <section>
        <h3>Notes <span>private to this browser</span></h3>
        <ul>
          {bench.notes.map((n, i) => (
            <li key={n.id}>
              <span>{n.text}</span>
              <button type="button" aria-label={`Delete note ${i + 1}`} onClick={() => updateWorkbench((w) => ({ ...w, notes: removeAt(w.notes, i + 1) }))}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
          {bench.notes.length === 0 && <li className="empty">No notes.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); updateWorkbench((w) => ({ ...w, notes: addEntry(w.notes, note) })); setNote(""); }}>
          <Input aria-label="New note" placeholder="Jot something down" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" size="sm" disabled={!note.trim()}>Add</Button>
        </form>
      </section>
    </div>
  );
}
