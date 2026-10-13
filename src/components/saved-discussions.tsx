import { useEffect, useState } from "react";
import { Bookmark, Save, Plus, Trash2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { RoomMessage, Mode } from "@/lib/agents";
import { messageText } from "@/lib/agents";
import type { CharacterMode } from "@/lib/hellraiser";
import { readDiscussions, writeDiscussions, type SavedDiscussion } from "@/lib/saved-discussions";
import { useSession } from "@/hooks/use-session";
import { deleteCloudDiscussion, loadAccount, saveCloudDiscussion } from "@/lib/account.functions";

export function SavedDiscussions({ messages, mode, theme, running, cloud: archive, onCloud: onArchive, onOpen }: {
  messages: RoomMessage[]; mode: Mode; theme: CharacterMode; running: boolean; cloud: boolean;
  onCloud: (value: boolean) => void; onOpen: (messages: RoomMessage[], theme: CharacterMode, mode: Mode) => void;
}) {
  const session = useSession();
  const signedIn = !!session;
  const load = useServerFn(loadAccount);
  const saveRemote = useServerFn(saveCloudDiscussion);
  const deleteRemote = useServerFn(deleteCloudDiscussion);
  const [dialog, setDialog] = useState(false);
  const [rows, setRows] = useState<SavedDiscussion[]>([]);
  const [id, setId] = useState<string>();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => { setStatus(""); }, [messages, theme, mode]);
  async function act(work: () => void | Promise<void>) {
    setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save your discussion."); }
  }
  async function list(): Promise<SavedDiscussion[]> {
    if (!signedIn) return readDiscussions();
    return (await load()).discussions.map((d) => ({ ...d, messages: JSON.parse(d.messages) })) as SavedDiscussion[];
  }
  return <div className="saved-toolbar">
    <Select value={archive ? "archive" : "browser"} disabled={running} onValueChange={(v) => { onArchive(v === "archive"); setId(undefined); setStatus(""); }}>
      <SelectTrigger aria-label="Discussion storage"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="browser">Current chat</SelectItem><SelectItem value="archive">Saved discussions</SelectItem></SelectContent>
    </Select>
    {archive && <>
      <Button size="sm" variant="outline" disabled={running || !messages.length} onClick={() => act(async () => {
        const first = messages.find(m => m.role === "user") ?? messages[0];
        if (!first) return;
        const chosenTitle = title.trim() || messageText(first).slice(0, 120) || "Untitled discussion";
        const row: SavedDiscussion = { id: id ?? crypto.randomUUID(), title: chosenTitle, messages, theme, mode, updatedAt: new Date().toISOString() };
        if (signedIn) {
          await saveRemote({ data: { id: row.id, title: row.title, theme, mode, messages } });
          setStatus("Saved to your account");
        } else {
          const next = [row, ...readDiscussions().filter(r => r.id !== row.id)];
          writeDiscussions(next); setRows(next); setStatus("Saved in this browser");
        }
        setId(row.id); setTitle(chosenTitle);
      })}><Save size={14} /> Save</Button>
      <Button size="sm" variant="ghost" disabled={running} onClick={() => act(async () => { setRows(await list()); setDialog(true); })}><Bookmark size={14} /> Open</Button>
      <Button size="icon" variant="ghost" aria-label="New saved discussion" title="New saved discussion" disabled={running} onClick={() => { setId(undefined); setTitle(""); setStatus(""); onOpen([], theme, mode); }}><Plus size={16} /></Button>
      <input className="discussion-title" aria-label="Saved discussion title" placeholder="Discussion title" maxLength={120} value={title} disabled={running} onChange={e => { setTitle(e.target.value); setStatus(""); }} />
      <span className="save-status" role="status">{status || (signedIn ? "Press Save to keep this discussion in your account." : "Press Save to keep this discussion across browser sessions.")}</span>
    </>}
    {error && <p role="alert" className="text-destructive text-xs w-full">{error}</p>}
    <Dialog open={dialog} onOpenChange={setDialog}><DialogContent><DialogHeader><DialogTitle>Saved discussions</DialogTitle><DialogDescription>{signedIn ? "Saved to your account and available on any device you sign in on." : "Saved only in this browser. Sign in to keep discussions in your account."}</DialogDescription></DialogHeader>
      <div className="saved-list">{!rows.length && <p>No saved discussions yet.</p>}{rows.map(row => <div key={row.id} className="saved-row">
        <Button className="saved-row-open" variant="ghost" onClick={() => { setId(row.id); setTitle(row.title); onOpen(row.messages, row.theme, row.mode); setDialog(false); }}><span>{row.title}<small>{new Date(row.updatedAt).toLocaleDateString()}</small></span></Button>
        <Button size="icon" variant="ghost" aria-label={`Delete ${row.title}`} onClick={() => { if (!window.confirm(`Delete “${row.title}”?`)) return; act(async () => {
          if (signedIn) { await deleteRemote({ data: { id: row.id } }); setRows(rows.filter(r => r.id !== row.id)); }
          else { const next = readDiscussions().filter(r => r.id !== row.id); writeDiscussions(next); setRows(next); }
          if (id === row.id) { setId(undefined); setStatus(""); }
        }); }}><Trash2 size={16} /></Button>
      </div>)}</div>
    </DialogContent></Dialog>
  </div>;
}
