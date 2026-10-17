import { useEffect, useRef, useState } from "react";
import { History, Plus, Trash2, Check } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { RoomMessage, Mode } from "@/lib/agents";
import type { CharacterMode } from "@/lib/hellraiser";
import { readDiscussions, writeDiscussions, chatTitle, type SavedDiscussion } from "@/lib/saved-discussions";
import { useSession } from "@/hooks/use-session";
import { deleteCloudDiscussion, loadAccount, saveCloudDiscussion } from "@/lib/account.functions";

const activeKey = "pixel-pals-active-chat-v1";

/** Chats save themselves as you talk; the left slide-out panel lists them for one-click switching. */
export function SavedDiscussions({ messages, mode, theme, running, onOpen, openRequest = 0 }: {
  openRequest?: number;
  messages: RoomMessage[]; mode: Mode; theme: CharacterMode; running: boolean;
  onOpen: (messages: RoomMessage[], theme: CharacterMode, mode: Mode) => void;
}) {
  const session = useSession();
  const signedIn = !!session;
  const load = useServerFn(loadAccount);
  const saveRemote = useServerFn(saveCloudDiscussion);
  const deleteRemote = useServerFn(deleteCloudDiscussion);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SavedDiscussion[]>([]);
  const [id, setId] = useState<string>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const lastSaved = useRef("");

  useEffect(() => { setId(localStorage.getItem(activeKey) ?? undefined); }, []);
  function pick(next: string | undefined) {
    setId(next);
    if (next) localStorage.setItem(activeKey, next); else localStorage.removeItem(activeKey);
  }

  async function list(): Promise<SavedDiscussion[]> {
    if (!signedIn) return readDiscussions();
    return (await load()).discussions.map((d) => ({ ...d, messages: JSON.parse(d.messages) })) as SavedDiscussion[];
  }

  // Auto-save once a reply finishes (not mid-stream).
  useEffect(() => {
    if (running || !messages.length || session === undefined) return;
    const sig = `${id}:${messages.length}:${messages[messages.length - 1]?.id}:${theme}:${mode}`;
    if (sig === lastSaved.current) return;
    const t = setTimeout(async () => {
      const rowId = id ?? crypto.randomUUID();
      const title = chatTitle(messages);
      try {
        if (signedIn) await saveRemote({ data: { id: rowId, title, theme, mode, messages } });
        else {
          const row: SavedDiscussion = { id: rowId, title, messages, theme, mode, updatedAt: new Date().toISOString() };
          writeDiscussions([row, ...readDiscussions().filter((r) => r.id !== rowId)]);
        }
        lastSaved.current = `${rowId}:${messages.length}:${messages[messages.length - 1]?.id}:${theme}:${mode}`;
        if (!id) pick(rowId);
        setError(""); setStatus(signedIn ? "Saved to your account" : "Saved in this browser");
      } catch (e) { setError(e instanceof Error ? e.message : "Could not save this chat."); }
    }, 800);
    return () => clearTimeout(t);
  }, [messages, running, theme, mode, id, signedIn, session]); // eslint-disable-line react-hooks/exhaustive-deps

  async function showPanel() {
    setOpen(true);
    try { setRows(await list()); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load chats."); }
  }
  useEffect(() => {
    if (openRequest) void showPanel();
  }, [openRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  function newChat() { pick(undefined); lastSaved.current = ""; setStatus(""); onOpen([], theme, mode); setOpen(false); }

  return <div className="saved-toolbar">
    <Button size="sm" variant="outline" disabled={running} onClick={showPanel}><History size={14} /> Chats</Button>
    <Button size="sm" variant="ghost" disabled={running} onClick={newChat}><Plus size={14} /> New chat</Button>
    <span className="save-status" role="status">{status ? <><Check size={12} /> {status}</> : signedIn ? "Chats save to your account automatically." : "Chats save automatically. Sign in to see them on other devices."}</span>
    {error && <p role="alert" className="text-destructive text-xs w-full">{error}</p>}
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="history-panel">
        <SheetHeader>
          <SheetTitle>Your chats</SheetTitle>
          <SheetDescription>{signedIn ? "Synced to your account — available on any device you sign in on." : "Saved in this browser. Sign in to sync across devices."}</SheetDescription>
        </SheetHeader>
        <Button size="sm" className="mx-4" onClick={newChat}><Plus size={14} /> New chat</Button>
        <div className="saved-list px-2">
          {!rows.length && <p className="px-2 text-sm text-muted-foreground">No chats yet.</p>}
          {rows.map((row) => <div key={row.id} className={`saved-row${row.id === id ? " saved-row-active" : ""}`}>
            <Button className="saved-row-open" variant="ghost" onClick={() => { pick(row.id); lastSaved.current = `${row.id}:${row.messages.length}:${row.messages[row.messages.length - 1]?.id}:${row.theme}:${row.mode}`; onOpen(row.messages, row.theme, row.mode); setOpen(false); }}>
              <span>{row.title}<small>{new Date(row.updatedAt).toLocaleString()}</small></span>
            </Button>
            <Button size="icon" variant="ghost" aria-label={`Delete ${row.title}`} onClick={async () => {
              if (!window.confirm(`Delete “${row.title}”?`)) return;
              try {
                if (signedIn) await deleteRemote({ data: { id: row.id } });
                else writeDiscussions(readDiscussions().filter((r) => r.id !== row.id));
                setRows((r) => r.filter((x) => x.id !== row.id));
                if (id === row.id) newChat();
              } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); }
            }}><Trash2 size={16} /></Button>
          </div>)}
        </div>
      </SheetContent>
    </Sheet>
  </div>;
}

