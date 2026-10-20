import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { listLocalOrServer } from "@/lib/chat-store";
import type { SavedDiscussion } from "@/lib/saved-discussions";
import { KIND_LABEL, messageText, searchDocs, type Doc, type Hit } from "@/lib/find";
import { useWorkbench } from "@/lib/workbench";

/** One box that searches your saved chats, notes, tasks, memories and reminders. Chats open in the Conversation window. */
export function SearchPanel({ open, onOpenChat }: { open: boolean; onOpenChat: (row: SavedDiscussion) => void }) {
  const wb = useWorkbench();
  const [q, setQ] = useState("");
  const [chats, setChats] = useState<SavedDiscussion[]>([]);
  const [reminders, setReminders] = useState<{ id: string; at: number; text: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    void listLocalOrServer().then(setChats).catch(() => setChats([]));
    void fetch("/api/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "list" }) })
      .then((r) => r.json()).then((j: { items?: { id: string; at: number; text: string }[] }) => setReminders(j.items ?? [])).catch(() => setReminders([]));
  }, [open]);
  const docs = useMemo<Doc[]>(() => [
    ...chats.map((c): Doc => ({ kind: "chat", id: c.id, title: c.title, text: c.messages.map((m) => messageText(m.parts as { type: string; text?: string }[])).join(" "), at: Date.parse(c.updatedAt) || 0 })),
    ...wb.notes.map((n): Doc => ({ kind: "note", id: n.id, title: n.text.slice(0, 60), text: n.text, at: n.at })),
    ...wb.todos.map((t): Doc => ({ kind: "todo", id: t.id, title: t.text.slice(0, 60), text: `${t.done ? "(done) " : ""}${t.text}`, at: t.at })),
    ...wb.memories.map((m): Doc => ({ kind: "memory", id: m.id, title: m.text.slice(0, 60), text: m.text, at: m.at })),
    ...reminders.map((r): Doc => ({ kind: "reminder", id: r.id, title: r.text.slice(0, 60), text: r.text, at: r.at })),
  ], [chats, wb, reminders]);
  const hits: Hit[] = useMemo(() => searchDocs(docs, q), [docs, q]);
  return (
    <div className="grid gap-3 p-3 text-sm">
      <label className="flex items-center gap-2 rounded-md border px-2 py-1.5">
        <Search className="size-4 text-muted-foreground" />
        <input className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Search chats, notes, tasks, memories, reminders" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </label>
      {q.trim() && !hits.length && <p className="text-muted-foreground">Nothing found. Every word you type has to appear, so try fewer words.</p>}
      {hits.map((h) => {
        const chat = h.doc.kind === "chat" ? chats.find((c) => c.id === h.doc.id) : undefined;
        const body = (
          <>
            <span className="flex items-center gap-2"><span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{KIND_LABEL[h.doc.kind]}</span><span className="min-w-0 flex-1 truncate font-medium">{h.doc.title || "Untitled"}</span></span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{h.snippet}</span>
          </>
        );
        return chat
          ? <button key={`${h.doc.kind}-${h.doc.id}`} className="grid gap-1 rounded-md border px-3 py-2 text-left hover:bg-muted" onClick={() => onOpenChat(chat)}>{body}</button>
          : <div key={`${h.doc.kind}-${h.doc.id}`} className="grid gap-1 rounded-md border px-3 py-2">{body}</div>;
      })}
      {!q.trim() && <p className="text-xs text-muted-foreground">Searches {chats.length} saved chat{chats.length === 1 ? "" : "s"}, your notes, tasks, memories and reminders. Click a chat to open it.</p>}
    </div>
  );
}
