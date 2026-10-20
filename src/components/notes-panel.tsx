import { useRef, useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agents, agentName } from "@/lib/agents";
import { addFact, endCampaign, removeFact, setCharacter, startCampaign, updateCampaign, useCampaign } from "@/lib/campaign";
import { useCharacterMode } from "@/lib/hellraiser";
import { addFile, removeDoc, useDocs } from "@/lib/documents";
import { MAX_NOTE, setNote as withNote, updateNotes, useAgentNotes } from "@/lib/agent-notes";
import {
  addEntry,
  removeAt,
  updateWorkbench,
  useWorkbench,
} from "@/lib/workbench";

/** Memories and notes. Memories are shared with the pals; notes stay private. To-dos live in the Tasks window. */
export function NotesPanel() {
  const bench = useWorkbench();
  const [memory, setMemory] = useState("");
  const [note, setNote] = useState("");
  const docs = useDocs();
  const notes = useAgentNotes();
  const theme = useCharacterMode();
  const camp = useCampaign();
  const [premise, setPremise] = useState("");
  const [fact, setFact] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [docMsg, setDocMsg] = useState("");
  const [palId, setPalId] = useState<string>(agents[0]?.id ?? "nova");
  async function onFiles(files: FileList | null) {
    const msgs: string[] = [];
    for (const f of Array.from(files ?? [])) {
      const r = await addFile(f);
      msgs.push(r.ok ? `${r.name} added${r.truncated ? " (trimmed to the first 120k characters)" : ""}.` : `${r.name}: ${r.error}`);
    }
    setDocMsg(msgs.join(" "));
  }

  return (
    <div className="notes-panel">
      <section>
        <h3>Dungeon Master <span>{camp.active ? "campaign running" : "off"}</span></h3>
        {camp.active ? (
          <>
            <p className="docs-note"><b>{camp.title}</b> — the first pal narrates, the rest are your party. Just say what you do. <code>/roll d20</code> rolls dice.</p>
            <label className="grid gap-1">
              <span className="text-xs">Your character</span>
              <Input aria-label="Your character" placeholder="e.g. a nervous halfling locksmith" value={camp.character} onChange={(e) => updateCampaign((c) => setCharacter(c, e.target.value))} />
            </label>
            <ul>
              {camp.facts.map((f, i) => (
                <li key={f}>
                  <span>{f}</span>
                  <button type="button" aria-label={`Remove fact ${i + 1}`} onClick={() => updateCampaign((c) => removeFact(c, i + 1))}><Trash2 size={13} /></button>
                </li>
              ))}
              {camp.facts.length === 0 && <li className="empty">No facts yet. Add things the Dungeon Master must not forget.</li>}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); updateCampaign((c) => addFact(c, fact)); setFact(""); }}>
              <Input aria-label="New fact" placeholder="e.g. The keeper vanished three nights ago" value={fact} onChange={(e) => setFact(e.target.value)} />
              <Button type="submit" size="sm" disabled={!fact.trim()}>Add</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => updateCampaign(endCampaign)}>End campaign</Button>
            </form>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (premise.trim()) { updateCampaign(() => startCampaign(premise)); setPremise(""); } }}>
            <Input aria-label="Adventure premise" placeholder="Start an adventure: a haunted lighthouse on a stormy coast" value={premise} onChange={(e) => setPremise(e.target.value)} />
            <Button type="submit" size="sm" disabled={!premise.trim()}>Begin</Button>
          </form>
        )}
      </section>

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
        <h3>Documents <span>pals search these when you ask</span></h3>
        <ul>
          {docs.map((d) => (
            <li key={d.name}>
              <span><FileText size={12} className="inline mr-1" />{d.name} <small>{Math.round(d.text.length / 1000)}k chars</small></span>
              <button type="button" aria-label={`Remove ${d.name}`} onClick={() => removeDoc(d.name)}><Trash2 size={13} /></button>
            </li>
          ))}
          {docs.length === 0 && <li className="empty">No documents. Add notes, a runbook or a CSV and ask the pals about it.</li>}
        </ul>
        <input ref={fileRef} type="file" multiple hidden accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.yml,.yaml,.toml,.ini,.conf,.xml,.html,.css,.js,.ts,.tsx,.py,.sh,.fish,.sql" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
        <div className="docs-actions"><Button type="button" size="sm" onClick={() => fileRef.current?.click()}>Add files</Button></div>
        {docMsg && <p className="docs-note" role="status">{docMsg}</p>}
      </section>

      <section>
        <h3>Pal instructions <span>extra guidance for one pal</span></h3>
        <label className="grid gap-1">
          <select aria-label="Which pal" className="h-9 rounded-md border border-input bg-background px-2" value={palId} onChange={(e) => setPalId(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{agentName(a.id, false, false, theme)}{notes[a.id] ? " ✎" : ""}</option>)}
          </select>
          <textarea
            aria-label="Instructions for this pal"
            className="pal-note"
            maxLength={MAX_NOTE}
            placeholder="e.g. Keep answers under three sentences, and always suggest a test."
            value={notes[palId] ?? ""}
            onChange={(e) => updateNotes((n) => withNote(n, palId, e.target.value))}
          />
        </label>
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
