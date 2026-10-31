import { useState } from "react";
import { Pencil, Pin, PinOff, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agents } from "@/lib/agents";
import { activeProject } from "@/lib/prefs";
import { condenseOld, consolidate, explainPick, pickMemories, visibleMemories } from "@/lib/memory-rank";
import { memoryBoost } from "@/lib/memory-boost";
import { addEntry, addProjectMemory, editEntry, getWorkbench, removeAt, setProjectMemories, togglePin, updateWorkbench, useWorkbench, type Entry } from "@/lib/workbench";

/** One memory row: wording you can edit in place, pin (never dropped from prompts) and forget. */
function Row({ e, index, onChange, onRemove }: { e: Entry; index: number; onChange: (next: Entry[] | ((l: Entry[]) => Entry[])) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.text);
  return (
    <li>
      {editing ? (
        <form className="flex flex-1 gap-1" onSubmit={(ev) => { ev.preventDefault(); onChange((l) => editEntry(l, e.id, text)); setEditing(false); }}>
          <Input aria-label={`Edit memory ${index + 1}`} value={text} onChange={(ev) => setText(ev.target.value)} autoFocus />
          <button type="submit" aria-label="Save change"><Check size={13} /></button>
        </form>
      ) : (
        <>
          <span>{e.pinned ? "📌 " : ""}{e.text}</span>
          <button type="button" aria-label={`Edit memory ${index + 1}`} title="Edit" onClick={() => { setText(e.text); setEditing(true); }}><Pencil size={13} /></button>
          <button type="button" aria-label={`${e.pinned ? "Unpin" : "Pin"} memory ${index + 1}`} title={e.pinned ? "Unpin" : "Pin: always sent to the pals"} onClick={() => onChange((l) => togglePin(l, e.id))}>{e.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
          <button type="button" aria-label={`Forget memory ${index + 1}`} onClick={onRemove}><Trash2 size={13} /></button>
        </>
      )}
    </li>
  );
}

/** The pals' shared memories, plus per-project memories, tidy-up tools and "why were these used?". */
export function MemorySection() {
  const bench = useWorkbench();
  const project = activeProject.use();
  const [memory, setMemory] = useState("");
  const [projectText, setProjectText] = useState("");
  const [projectName, setProjectName] = useState("");
  const [msg, setMsg] = useState("");
  const [question, setQuestion] = useState("");
  const [palId, setPalId] = useState<string>(agents[0]?.id ?? "nova");
  const [why, setWhy] = useState<string[] | null>(null);
  const [vaultRevision, setVaultRevision] = useState<string | null>(null);
  const [vaultMessage, setVaultMessage] = useState("");
  const [vaultPending, setVaultPending] = useState(false);
  const [vaultPreview, setVaultPreview] = useState<{ memories: Entry[]; pal?: Record<string, Entry[]>; project?: Record<string, Entry[]> } | null>(null);
  async function loadVault() {
    setVaultPending(true); setVaultMessage("");
    try {
      const response = await fetch("/api/obsidian-memory");
      if (!response.ok) throw Error("Server vault unavailable. Check your login and persistent data folder.");
      const data = await response.json() as { revision: string; exists: boolean; memories: { memories: Entry[]; pal?: Record<string, Entry[]>; project?: Record<string, Entry[]> } };
      setVaultRevision(data.revision); setVaultPreview(data.memories);
      setVaultMessage(data.exists ? "Obsidian note loaded for review. Import only if you want to replace browser memories." : "No vault note yet. Save your current memories to create it.");
    } catch (error) { setVaultMessage(error instanceof Error ? error.message : "Could not read the vault."); }
    finally { setVaultPending(false); }
  }
  async function saveVault() {
    if (vaultRevision === null) { setVaultMessage("Load the vault first to prevent overwriting other changes."); return; }
    setVaultPending(true); setVaultMessage("");
    try {
      const w = getWorkbench();
      const response = await fetch("/api/obsidian-memory", { method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision:vaultRevision,memories:{memories:w.memories,pal:w.pal??{},project:w.project??{}}}) });
      const data = await response.json() as { revision?: string; error?: string };
      if (!response.ok || !data.revision) throw Error(data.error ?? "Vault save failed");
      setVaultRevision(data.revision);
      setVaultPreview({ memories:w.memories,pal:w.pal,project:w.project });
      setVaultMessage("Saved to Obsidian Markdown on your Unraid data volume.");
    } catch (error) { setVaultMessage(error instanceof Error ? error.message : "Could not save the vault."); }
    finally { setVaultPending(false); }
  }
  function importVault() {
    if (!vaultPreview) return;
    if (!window.confirm("Replace only your browser's Pal memories with the reviewed Obsidian memories? Notes and tasks will stay untouched.")) return;
    updateWorkbench((w) => ({ ...w, memories:vaultPreview.memories, pal:vaultPreview.pal??{}, project:vaultPreview.project??{} }));
    setVaultMessage("Vault memories imported into this browser. Your tasks and notes were preserved.");
  }
  const projects = Object.keys(bench.project ?? {});
  const shown = project ? bench.project?.[project] ?? [] : [];

  async function explain() {
    const w = getWorkbench();
    const proj = project || undefined;
    let boost: ReadonlyMap<string, number> | undefined;
    if (pickMemories(w, question, { pal: palId, project: proj }).ranked) boost = await memoryBoost(visibleMemories(w, { pal: palId, project: proj }).map((v) => ({ id: v.entry.id, text: v.entry.text })), question);
    setWhy(explainPick(pickMemories(w, question, { pal: palId, project: proj, boost })));
  }

  return (
    <>
      <section className="grid gap-2 rounded-lg border p-3" aria-label="Obsidian memory vault">
        <h3>Obsidian Memory Vault <span>Markdown on your Unraid server · owner-only</span></h3>
        <p className="docs-note">Your memories remain in this browser until you choose to export or import. Load the vault, review the counts, then save or import. Changes made in Obsidian need an import before the Pals can use them.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={vaultPending} onClick={() => void loadVault()}>1. Load vault</Button>
          <Button type="button" size="sm" disabled={vaultPending || vaultRevision === null} onClick={() => void saveVault()}>2. Save to Obsidian</Button>
          <Button type="button" size="sm" variant="outline" disabled={vaultPending || !vaultPreview} onClick={importVault}>Import reviewed memories</Button>
        </div>
        {vaultPreview && <p className="docs-note">Vault preview: {vaultPreview.memories.length} shared, {Object.values(vaultPreview.pal??{}).reduce((n,r)=>n+r.length,0)} Pal-specific, {Object.values(vaultPreview.project??{}).reduce((n,r)=>n+r.length,0)} project memories.</p>}
        {vaultMessage && <p role="status" className="docs-note">{vaultMessage}</p>}
        <p className="docs-note">Vault location inside the container: BUDDY_DATA_DIR/obsidian/Pixel Pals Memory.md. Open the mapped directory as an Obsidian vault.</p>
      </section>
      <section>
        <h3>Pals remember <span>shared with every pal · {bench.memories.length}</span></h3>
        <ul>
          {bench.memories.map((m, i) => (
            <Row key={m.id} e={m} index={i} onChange={(f) => updateWorkbench((w) => ({ ...w, memories: typeof f === "function" ? f(w.memories) : f }))} onRemove={() => updateWorkbench((w) => ({ ...w, memories: removeAt(w.memories, i + 1) }))} />
          ))}
          {bench.memories.length === 0 && <li className="empty">Nothing yet. Try “I run Unraid with a 3080”.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); updateWorkbench((w) => ({ ...w, memories: addEntry(w.memories, memory) })); setMemory(""); }}>
          <Input aria-label="New memory" placeholder="Something for the pals to remember" value={memory} onChange={(e) => setMemory(e.target.value)} />
          <Button type="submit" size="sm" disabled={!memory.trim()}>Add</Button>
        </form>
        <div className="docs-actions">
          <Button type="button" size="sm" variant="outline" disabled={bench.memories.length < 2} title="Merge memories that say nearly the same thing" onClick={() => {
            const r = consolidate(getWorkbench().memories);
            updateWorkbench((w) => ({ ...w, memories: r.list }));
            setMsg(r.merged ? `Merged ${r.merged} near-duplicate${r.merged === 1 ? "" : "s"}.` : "No near-duplicates found.");
          }}>Merge duplicates</Button>
          <Button type="button" size="sm" variant="outline" disabled={bench.memories.length < 20} title="Fold the oldest memories into one line (their opening words; pinned ones stay)" onClick={() => {
            const r = condenseOld(getWorkbench().memories);
            updateWorkbench((w) => ({ ...w, memories: r.list }));
            setMsg(r.folded ? `Folded ${r.folded} old memories into one line.` : "Nothing to condense yet.");
          }}>Condense old</Button>
        </div>
        {msg && <p className="docs-note" role="status">{msg}</p>}
      </section>

      <section>
        <h3>Project memories <span>only while a project is active</span></h3>
        <label className="grid gap-1">
          <span className="docs-note">Active project</span>
          <select aria-label="Active project" className="h-9 rounded-md border border-input bg-background px-2" value={project} onChange={(e) => activeProject.set(e.target.value)}>
            <option value="">None</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <form onSubmit={(e) => { e.preventDefault(); const n = projectName.trim(); if (n) { activeProject.set(n); updateWorkbench((w) => ({ ...w, project: { ...(w.project ?? {}), [n]: w.project?.[n] ?? [] } })); } setProjectName(""); }}>
          <Input aria-label="New project name" placeholder="New project name" value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          <Button type="submit" size="sm" disabled={!projectName.trim()}>Create</Button>
        </form>
        {project && (
          <>
            <ul>
              {shown.map((m, i) => (
                <Row key={m.id} e={m} index={i} onChange={(f) => updateWorkbench((w) => setProjectMemories(w, project, typeof f === "function" ? f(w.project?.[project] ?? []) : f))} onRemove={() => updateWorkbench((w) => setProjectMemories(w, project, removeAt(w.project?.[project] ?? [], i + 1)))} />
              ))}
              {shown.length === 0 && <li className="empty">Nothing for “{project}” yet.</li>}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); updateWorkbench((w) => addProjectMemory(w, project, projectText)); setProjectText(""); }}>
              <Input aria-label="New project memory" placeholder={`Something to remember for ${project}`} value={projectText} onChange={(e) => setProjectText(e.target.value)} />
              <Button type="submit" size="sm" disabled={!projectText.trim()}>Add</Button>
            </form>
          </>
        )}
      </section>

      <section>
        <h3>Why these memories? <span>see what a pal would be told</span></h3>
        <label className="grid gap-1">
          <select aria-label="Which pal (memories)" className="h-9 rounded-md border border-input bg-background px-2" value={palId} onChange={(e) => setPalId(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <form onSubmit={(e) => { e.preventDefault(); void explain(); }}>
          <Input aria-label="A question to try" placeholder="Type a question to try" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Button type="submit" size="sm" disabled={!question.trim()}>Show</Button>
        </form>
        {why && <ul aria-label="Memory explanation">{why.length ? why.map((l, i) => <li key={i}><span>{l}</span></li>) : <li className="empty">No memories to use yet.</li>}</ul>}
      </section>
    </>
  );
}
