import { useState } from "react";
import { ListPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agents, agentName } from "@/lib/agents";
import { useDocs } from "@/lib/documents";
import { activeProject } from "@/lib/prefs";
import { addDecision, addTask, canDepend, isBlocked, newProject, PLIMITS, progress, removeDecision, removeTask, resumeLine, setDependency, setField, toggleTask, updateProject, updateProjects, useProjects, type Project, type ProjectStatus } from "@/lib/projects";
import { addTodo, updateWorkbench, useWorkbench } from "@/lib/workbench";

const nameOf = (id: string) => agentName(id as (typeof agents)[number]["id"], false, false, "normal");
const when = (at: number) => (at ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** A small project workspace: objective, team, tasks with dependencies, decisions, documents and a run history. Everything is kept in this browser and resumes after a restart. */
export function ProjectsSection() {
  const projects = useProjects();
  const bench = useWorkbench();
  const docs = useDocs();
  const active = activeProject.use();
  const [newName, setNewName] = useState("");
  const [taskText, setTaskText] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const names = [...new Set([...Object.keys(projects), ...Object.keys(bench.project ?? {})])].sort((a, b) => a.localeCompare(b));
  const p: Project | undefined = active ? projects[active] : undefined;
  const edit = (f: (p: Project) => Project) => active && updateProject(active, f);
  const create = (raw: string) => {
    const fresh = newProject(raw);
    if (!fresh) return;
    updateProjects((all) => ({ ...all, [fresh.name]: all[fresh.name] ?? fresh }));
    updateWorkbench((w) => ({ ...w, project: { ...(w.project ?? {}), [fresh.name]: w.project?.[fresh.name] ?? [] } }));
    activeProject.set(fresh.name);
  };
  const prog = p ? progress(p) : null;
  return (
    <section>
      <h3>Projects <span>goal, team, tasks, decisions</span></h3>
      <label className="grid gap-1">
        <select aria-label="Open project" className="h-9 rounded-md border border-input bg-background px-2" value={active} onChange={(e) => { setConfirmDelete(false); activeProject.set(e.target.value); }}>
          <option value="">No project</option>
          {names.map((n) => <option key={n} value={n}>{n}{projects[n] ? ` · ${projects[n]!.status}` : ""}</option>)}
        </select>
      </label>
      <form onSubmit={(e) => { e.preventDefault(); create(newName); setNewName(""); }}>
        <Input aria-label="Create project named" placeholder="New project name" maxLength={PLIMITS.name} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" size="sm" disabled={!newName.trim()}>Create</Button>
      </form>
      {active && !p && (
        <p className="docs-note">“{active}” only has memories so far. <Button type="button" size="sm" onClick={() => create(active)}>Set up as a project</Button></p>
      )}
      {p && prog && (
        <div className="grid gap-2 mt-2">
          <p className="docs-note" role="status">{resumeLine(p, nameOf)}</p>
          <label className="grid gap-1 text-xs">Status
            <select aria-label="Project status" className="h-9 rounded-md border border-input bg-background px-2" value={p.status} onChange={(e) => edit((x) => setField(x, "status", e.target.value as ProjectStatus))}>
              <option value="active">Active</option><option value="paused">Paused</option><option value="done">Done</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs">Objective
            <textarea aria-label="Project objective" className="pal-note" maxLength={PLIMITS.objective} placeholder="What is this project for?" value={p.objective} onChange={(e) => edit((x) => ({ ...x, objective: e.target.value.slice(0, PLIMITS.objective) }))} />
          </label>
          <fieldset className="text-xs">
            <legend>Team <span className="docs-note">seated when this project is active</span></legend>
            <div className="flex flex-wrap gap-2">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-1">
                  <input type="checkbox" checked={p.agents.includes(a.id)} onChange={(e) => edit((x) => setField(x, "agents", e.target.checked ? [...x.agents, a.id] : x.agents.filter((i) => i !== a.id)))} />
                  {nameOf(a.id)}
                </label>
              ))}
            </div>
          </fieldset>

          <h4 className="text-xs font-semibold">Tasks {prog.total ? `(${prog.done}/${prog.total} done)` : ""}</h4>
          <ul>
            {p.tasks.map((t) => {
              const blocked = isBlocked(p, t);
              const options = p.tasks.filter((o) => o.id !== t.id && !t.after.includes(o.id) && canDepend(p, t.id, o.id));
              return (
                <li key={t.id}>
                  <label className="flex flex-1 items-center gap-1">
                    <input type="checkbox" checked={t.done} onChange={() => edit((x) => toggleTask(x, t.id))} />
                    <span style={t.done ? { textDecoration: "line-through", opacity: 0.6 } : undefined}>{t.text}</span>
                    {blocked && <small> · waiting</small>}
                  </label>
                  {t.after.map((a) => {
                    const d = p.tasks.find((x) => x.id === a);
                    return d ? <button key={a} type="button" title="Remove this dependency" aria-label={`Stop waiting for ${d.text}`} onClick={() => edit((x) => setDependency(x, t.id, a, false))}><small>after: {d.text.slice(0, 18)} ✕</small></button> : null;
                  })}
                  {options.length > 0 && !t.done && (
                    <select aria-label={`Make "${t.text}" wait for another task`} className="h-7 rounded-md border border-input bg-background px-1 text-xs" value="" onChange={(e) => e.target.value && edit((x) => setDependency(x, t.id, e.target.value, true))}>
                      <option value="">waits for…</option>
                      {options.map((o) => <option key={o.id} value={o.id}>{o.text.slice(0, 30)}</option>)}
                    </select>
                  )}
                  <button type="button" title="Copy to my to-do list" aria-label={`Copy "${t.text}" to my to-dos`} onClick={() => updateWorkbench((w) => ({ ...w, todos: addTodo(w.todos, `${t.text} (${p.name})`) }))}><ListPlus size={13} /></button>
                  <button type="button" aria-label={`Delete task ${t.text}`} onClick={() => edit((x) => removeTask(x, t.id))}><Trash2 size={13} /></button>
                </li>
              );
            })}
            {p.tasks.length === 0 && <li className="empty">No tasks yet.</li>}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); edit((x) => addTask(x, taskText)); setTaskText(""); }}>
            <Input aria-label="New project task" placeholder="Add a task" maxLength={PLIMITS.task} value={taskText} onChange={(e) => setTaskText(e.target.value)} />
            <Button type="submit" size="sm" disabled={!taskText.trim()}>Add</Button>
          </form>

          <h4 className="text-xs font-semibold">Decisions</h4>
          <ul>
            {p.decisions.map((d) => (
              <li key={d.id}><span>{d.text} <small>{when(d.at)}</small></span><button type="button" aria-label={`Delete decision ${d.text}`} onClick={() => edit((x) => removeDecision(x, d.id))}><Trash2 size={13} /></button></li>
            ))}
            {p.decisions.length === 0 && <li className="empty">Nothing decided yet.</li>}
          </ul>
          <form onSubmit={(e) => { e.preventDefault(); edit((x) => addDecision(x, decisionText)); setDecisionText(""); }}>
            <Input aria-label="New decision" placeholder="Save a decision" maxLength={PLIMITS.decision} value={decisionText} onChange={(e) => setDecisionText(e.target.value)} />
            <Button type="submit" size="sm" disabled={!decisionText.trim()}>Save</Button>
          </form>

          <label className="grid gap-1 text-xs">Next steps
            <textarea aria-label="Next steps" className="pal-note" maxLength={PLIMITS.next} placeholder="What happens next?" value={p.next} onChange={(e) => edit((x) => ({ ...x, next: e.target.value.slice(0, PLIMITS.next) }))} />
          </label>

          {docs.length > 0 && (
            <fieldset className="text-xs">
              <legend>Documents <span className="docs-note">none ticked = the pals search all of them</span></legend>
              {docs.map((d) => (
                <label key={d.name} className="flex items-center gap-1">
                  <input type="checkbox" checked={p.docs.includes(d.name)} onChange={(e) => edit((x) => setField(x, "docs", e.target.checked ? [...x.docs, d.name] : x.docs.filter((n) => n !== d.name)))} />
                  {d.name}
                </label>
              ))}
            </fieldset>
          )}
          <p className="docs-note">Project memories are in “Project memories” above.</p>

          <h4 className="text-xs font-semibold">History</h4>
          <ul>
            {p.history.slice(-6).reverse().map((h) => (
              <li key={h.at + h.topic}><span><small>{when(h.at)} · {h.mode} · {h.pals.join(", ")}</small><br />{h.topic}{h.gist ? <><br /><small>{h.gist}</small></> : null}</span></li>
            ))}
            {p.history.length === 0 && <li className="empty">Discussions you have while this project is active are listed here.</li>}
          </ul>
          <div className="docs-actions">
            {confirmDelete
              ? <><Button type="button" size="sm" variant="destructive" onClick={() => { updateProjects((all) => { const { [p.name]: _gone, ...rest } = all; return rest; }); activeProject.set(""); setConfirmDelete(false); }}>Yes, delete the project record</Button><Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Keep</Button></>
              : <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>Delete project…</Button>}
          </div>
          {confirmDelete && <p className="docs-note">This removes the tasks, decisions and history. Project memories stay.</p>}
        </div>
      )}
    </section>
  );
}
