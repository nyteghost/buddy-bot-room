import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agents, agentName } from "@/lib/agents";
import { useCharacterMode } from "@/lib/hellraiser";
import { addFile, removeDoc, useDocs } from "@/lib/documents";
import { MAX_NOTE, setNote as withNote, updateNotes, useAgentNotes } from "@/lib/agent-notes";
import {
  addEntry,
  removeAt,
  updateWorkbench,
  useWorkbench,
} from "@/lib/workbench";


type PhoneNote = { uid: number; uuid: string; title: string; text: string; date: string };
type Edit = { uid: number; uuid: string; title: string; text: string };

async function notesCall<T>(url: string, body?: unknown): Promise<T & { error?: string }> {
  try {
    const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    return (await res.json()) as T & { error?: string };
  } catch { return { error: "Couldn't reach the server." } as T & { error?: string }; }
}

/** iPhone Notes kept in your Gmail account (turn on Notes for Gmail on the phone). Changes here show up there and back. */
function PhoneNotes() {
  const [notes, setNotes] = useState<PhoneNote[] | null>(null);
  const [found, setFound] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const res = await notesCall<{ notes: PhoneNote[]; found: boolean }>("/api/mailbox?op=notes");
    if (res.error) setError(res.error); else { setError(""); setNotes(res.notes); setFound(res.found); }
    setBusy(false);
  }, []);
  useEffect(() => {
    void load();
    const onFocus = () => { if (!edit) void load(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function save() {
    if (!edit) return;
    setBusy(true);
    const res = await notesCall<{ ok?: boolean }>("/api/mailbox", { op: "note-save", ...(edit.uid ? { uid: edit.uid, uuid: edit.uuid } : {}), title: edit.title, text: edit.text });
    if (res.error) { setError(res.error); setBusy(false); return; }
    setEdit(null);
    await load();
  }
  async function del() {
    if (!edit?.uid) { setEdit(null); return; }
    setBusy(true);
    const res = await notesCall<{ ok?: boolean }>("/api/mailbox", { op: "note-delete", uid: edit.uid });
    if (res.error) { setError(res.error); setBusy(false); return; }
    setEdit(null); setConfirmDel(false);
    await load();
  }

  return (
    <section>
      <h3><Smartphone size={12} className="inline mr-1" />iPhone notes <span>synced through Gmail</span></h3>
      {error && <p className="docs-note" role="alert">{error}</p>}
      {!edit && (
        <>
          <ul>
            {(notes ?? []).map((n) => (
              <li key={n.uid}>
                <button type="button" className="text-left" onClick={() => { setConfirmDel(false); setEdit({ uid: n.uid, uuid: n.uuid, title: n.title, text: n.text }); }}>
                  <strong>{n.title}</strong>{n.text ? <small className="block opacity-70">{n.text.split("\n")[0]?.slice(0, 80)}</small> : null}
                </button>
              </li>
            ))}
            {notes && notes.length === 0 && <li className="empty">{found ? "No notes in the Gmail section yet." : "No Gmail notes folder yet. On the iPhone: Settings → Notes → Accounts → Gmail → Notes on, then make a note. Or add one here to create it."}</li>}
            {!notes && !error && <li className="empty">Loading…</li>}
          </ul>
          <div className="docs-actions">
            <Button type="button" size="sm" onClick={() => { setConfirmDel(false); setEdit({ uid: 0, uuid: "", title: "", text: "" }); }}>New note</Button>{" "}
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw size={12} className="inline mr-1" />{busy ? "…" : "Refresh"}</Button>
          </div>
        </>
      )}
      {edit && (
        <div className="grid gap-2">
          <Input aria-label="Note title" placeholder="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <textarea aria-label="Note text" className="pal-note" maxLength={15000} placeholder="Write the note…" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          <div className="docs-actions">
            <Button type="button" size="sm" disabled={busy || (!edit.title.trim() && !edit.text.trim())} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>{" "}
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEdit(null)}>Cancel</Button>{" "}
            {edit.uid > 0 && (confirmDel
              ? <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void del()}>Really delete?</Button>
              : <Button type="button" size="sm" variant="outline" onClick={() => setConfirmDel(true)}><Trash2 size={12} className="inline mr-1" />Delete</Button>)}
          </div>
          <p className="docs-note">Saved notes appear in the Notes app on your iPhone within a minute or so. Formatting and checklists aren't kept.</p>
        </div>
      )}
    </section>
  );
}

/** Memories and notes. Memories are shared with the pals; notes stay private. To-dos live in the Tasks window. */
export function NotesPanel() {
  const bench = useWorkbench();
  const [memory, setMemory] = useState("");
  const [note, setNote] = useState("");
  const docs = useDocs();
  const notes = useAgentNotes();
  const theme = useCharacterMode();
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
      <PhoneNotes />

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
