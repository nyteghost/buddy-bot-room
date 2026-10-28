import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, FolderInput, Loader2, MailOpen, MailPlus, PenLine, RefreshCw, Reply, Search, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { forwardableQuote, gmailLink, replySubject, type Folder, type MailMessage, type MailSummary } from "@/lib/mailbox";
import { replyPrompt } from "@/lib/mail-reply";

type ListData = { folder: string; folders: Folder[]; messages: MailSummary[]; total: number; offset?: number; account?: string; gmail?: boolean; error?: string };
type Draft = { to: string; cc: string; subject: string; text: string; inReplyTo: string; references: string };
const blank: Draft = { to: "", cc: "", subject: "", text: "", inReplyTo: "", references: "" };

async function call<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T & { error?: string; aborted?: boolean }> {
  try {
    const init: RequestInit = body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {};
    if (signal) init.signal = signal;
    const res = await fetch(url, init);
    return (await res.json()) as T & { error?: string };
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) return { aborted: true } as T & { aborted: boolean };
    return { error: "Couldn't reach the server." } as T & { error?: string };
  }
}

/** Lists already seen this session, so a folder you've visited shows at once while the fresh copy loads. Bounded; never persisted. */
const seenLists = new Map<string, ListData>();
const listKey = (f: string, q: string, u: boolean) => `${f}\u0000${q.trim()}\u0000${u ? 1 : 0}`;
function remember(key: string, d: ListData) {
  seenLists.delete(key); seenLists.set(key, d);
  while (seenLists.size > 12) seenLists.delete(seenLists.keys().next().value as string);
}

const when = (d: string) => (d && !Number.isNaN(Date.parse(d)) ? new Date(d).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** Read, reply, send, move and delete mail. Bodies are shown as plain text; nothing is sent, moved or deleted until you press the button. */
export function Mailbox({ open }: { open: boolean }) {
  const [folder, setFolder] = useState("INBOX");
  const [unread, setUnread] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListData | null>(null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<MailMessage | null>(null);
  const [view, setView] = useState<"list" | "read" | "compose">("list");
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<"" | "send" | "delete">("");
  const [moveTo, setMoveTo] = useState("");
  const [intent, setIntent] = useState<string | null>(null);

  // Only the newest list request may update the screen: switching folders quickly cancels the older request, and a late answer is ignored.
  const listReq = useRef<{ id: number; ctl: AbortController | null }>({ id: 0, ctl: null });
  const load = useCallback(async (f = folder, search = q, onlyUnread = unread, fresh = false) => {
    listReq.current.ctl?.abort();
    const ctl = new AbortController();
    const id = ++listReq.current.id;
    listReq.current.ctl = ctl;
    const key = listKey(f, search, onlyUnread);
    const seen = fresh ? undefined : seenLists.get(key);
    if (seen) { setData(seen); setError(""); }
    setLoading(true); setMore(false);
    const params = new URLSearchParams({ op: "list", folder: f, ...(search.trim() ? { q: search.trim() } : {}), ...(onlyUnread ? { unread: "1" } : {}), ...(fresh ? { fresh: "1" } : {}) });
    const res = await call<ListData>(`/api/mailbox?${params}`, undefined, ctl.signal);
    if (id !== listReq.current.id || res.aborted) return;
    if (res.error) setError(res.error); else { setData(res); remember(key, res); setError(""); }
    setLoading(false);
  }, [folder, q, unread]);

  const loadOlder = async () => {
    if (!data || more) return;
    setMore(true);
    const params = new URLSearchParams({ op: "list", folder: data.folder, offset: String(data.messages.length), ...(q.trim() ? { q: q.trim() } : {}), ...(unread ? { unread: "1" } : {}) });
    const res = await call<ListData>(`/api/mailbox?${params}`);
    setMore(false);
    if (res.error || res.aborted) { if (res.error) setError(res.error); return; }
    setData((d) => {
      if (!d || d.folder !== res.folder) return d; // the folder changed while this was loading
      const have = new Set(d.messages.map((m) => m.uid));
      const next = { ...d, total: res.total, messages: [...d.messages, ...res.messages.filter((m) => !have.has(m.uid))] };
      remember(listKey(d.folder, q, unread), next);
      return next;
    });
  };

  const openByRef = useCallback(async (f: string, uid: number) => {
    setBusy(`open${uid}`); setNote("");
    const res = await call<{ message: MailMessage }>(`/api/mailbox?op=read&folder=${encodeURIComponent(f)}&uid=${uid}`);
    setBusy("");
    if (res.error || !res.message) { setError(res.error ?? "Couldn't open it."); return; }
    setFolder(f); setMsg(res.message); setView("read"); setConfirm(""); setMoveTo(""); setIntent(null);
  }, []);
  useEffect(() => {
    // An email alert's Read button asks for one message; it may arrive before this window is mounted, so it is also parked on window.
    const take = () => {
      const w = window as unknown as { __ppOpenMail?: { folder: string; uid: number } | undefined };
      const want = w.__ppOpenMail;
      if (want) { w.__ppOpenMail = undefined; void openByRef(want.folder, want.uid); }
    };
    take();
    window.addEventListener("pixelpals:open-mail", take);
    return () => window.removeEventListener("pixelpals:open-mail", take);
  }, [openByRef, open]);
  useEffect(() => { if (open) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const openMessage = async (m: MailSummary) => {
    setBusy(`open${m.uid}`); setNote("");
    const res = await call<{ message: MailMessage }>(`/api/mailbox?op=read&folder=${encodeURIComponent(folder)}&uid=${m.uid}`);
    setBusy("");
    if (res.error || !res.message) { setError(res.error ?? "Couldn't open it."); return; }
    setMsg(res.message); setView("read"); setConfirm(""); setMoveTo(""); setIntent(null);
    setData((d) => (d ? { ...d, messages: d.messages.map((x) => (x.uid === m.uid ? { ...x, seen: true } : x)) } : d));
    seenLists.clear();
  };

  const act = async (what: string, body: Record<string, unknown>, done: string) => {
    setBusy(what); setError("");
    const res = await call<{ ok?: boolean; forever?: boolean; moved?: string }>("/api/mailbox", { folder, ...body });
    setBusy("");
    if (res.error) { setError(res.error); setConfirm(""); return false; }
    setNote(typeof res.moved === "string" ? `Moved to ${res.moved}.` : res.forever ? "Deleted for good." : done);
    return true;
  };

  // Back from a message keeps the list you were on (no reload); after delete, move or mark-unread the list is fetched fresh.
  const backToList = async (refresh = true) => { setView("list"); setMsg(null); setConfirm(""); if (refresh) { seenLists.clear(); await load(folder, q, unread, true); } };

  const startReply = (m: MailMessage) => {
    setDraft({ to: m.fromAddr, cc: "", subject: replySubject(m.subject), text: forwardableQuote(m.from, m.date, m.text), inReplyTo: m.messageId, references: [m.references, m.messageId].filter(Boolean).join(" ").slice(-600) });
    setConfirm(""); setView("compose");
  };

  const send = async () => {
    if (confirm !== "send") { setConfirm("send"); return; }
    const ok = await act("send", { op: "send", to: draft.to, cc: draft.cc, subject: draft.subject, text: draft.text, inReplyTo: draft.inReplyTo, references: draft.references }, "Sent.");
    setConfirm("");
    if (ok) { setDraft(blank); setView("list"); setMsg(null); }
  };

  const doDelete = async () => {
    if (confirm !== "delete") { setConfirm("delete"); return; }
    if (msg && (await act("delete", { op: "delete", uid: msg.uid }, "Moved to Trash."))) await backToList();
    setConfirm("");
  };

  const doMove = async () => {
    if (msg && moveTo && (await act("move", { op: "move", uid: msg.uid, to: moveTo }, "Moved."))) await backToList();
  };

  const inTrash = data?.folders.find((f) => f.name === folder)?.special === "trash" || data?.folders.find((f) => f.name === folder)?.special === "junk";

  if (view === "compose") {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setView(msg ? "read" : "list"); setConfirm(""); }}><ArrowLeft className="size-4" /> Back</Button>
          <span className="font-medium">{draft.inReplyTo ? "Reply" : "New message"}</span>
        </div>
        <Input aria-label="To" placeholder="To (separate several with commas)" value={draft.to} onChange={(e) => { setDraft({ ...draft, to: e.target.value }); setConfirm(""); }} />
        <Input aria-label="Cc" placeholder="Cc (optional)" value={draft.cc} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} />
        <Input aria-label="Subject" placeholder="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
        <textarea aria-label="Message" className="min-h-48 w-full rounded-md border bg-background px-2 py-1 text-sm" placeholder="Write your message" value={draft.text} onChange={(e) => { setDraft({ ...draft, text: e.target.value }); setConfirm(""); }} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant={confirm === "send" ? "destructive" : "default"} disabled={busy === "send" || !draft.to.trim()} onClick={() => void send()}>
            {busy === "send" ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />} {confirm === "send" ? "Really send it" : "Send"}
          </Button>
          {confirm === "send" && <><span className="text-xs text-muted-foreground">Sends to {draft.to}{draft.cc.trim() ? `, ${draft.cc}` : ""} right now.</span><Button size="sm" variant="ghost" onClick={() => setConfirm("")}>Cancel</Button></>}
        </div>
        <span className="text-xs text-muted-foreground">Plain text only, no attachments. Gmail keeps a copy in Sent by itself.</span>
      </div>
    );
  }

  if (view === "read" && msg) {
    const targets = (data?.folders ?? []).filter((f) => f.name !== folder);
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => void backToList(false)}><ArrowLeft className="size-4" /> Back</Button>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{msg.from}{msg.fromAddr ? ` <${msg.fromAddr}>` : ""}</span>
          {data?.gmail && data.account && gmailLink(data.account, msg.messageId) && <a href={gmailLink(data.account, msg.messageId) ?? "#"} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent/40"><ExternalLink className="size-3" /> Open in Gmail</a>}
        </div>
        <h3 className="text-base font-semibold">{msg.subject}</h3>
        <span className="text-xs text-muted-foreground">{when(msg.date)}{msg.to ? ` · to ${msg.to}` : ""}{msg.cc ? ` · cc ${msg.cc}` : ""}</span>
        <div className="max-h-[45vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background/50 p-3 text-sm">{msg.text || "(no text in this message)"}{msg.truncated ? "\n\n… (shortened)" : ""}</div>
        {msg.attachments.length > 0 && <span className="text-xs text-muted-foreground">Attachments (not downloaded): {msg.attachments.join(", ")}</span>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => startReply(msg)} disabled={!msg.fromAddr}><Reply className="size-3" /> Reply</Button>
          <Button size="sm" variant={confirm === "delete" ? "destructive" : "outline"} disabled={busy === "delete"} onClick={() => void doDelete()}>
            {busy === "delete" ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} {confirm === "delete" ? (inTrash ? "Delete for good?" : "Move to Trash?") : "Delete"}
          </Button>
          {confirm === "delete" && <Button size="sm" variant="ghost" onClick={() => setConfirm("")}>Cancel</Button>}
          <Button size="sm" variant="outline" disabled={busy === "seen"} onClick={async () => { if (await act("seen", { op: "seen", uid: msg.uid, seen: false }, "Marked unread.")) await backToList(); }}><MailOpen className="size-3" /> Mark unread</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FolderInput className="size-4 text-muted-foreground" />
          <select aria-label="Move to" className="h-8 rounded-md border bg-background px-2 text-sm" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Move to…</option>
            {targets.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!moveTo || busy === "move"} onClick={() => void doMove()}>{busy === "move" ? <Loader2 className="size-3 animate-spin" /> : "Move"}</Button>
        </div>
        {intent === null ? (
          <Button size="sm" variant="ghost" className="h-7 w-fit justify-start px-1 text-xs" onClick={() => setIntent("")}><PenLine className="size-3" /> Get a draft from Echo</Button>
        ) : (
          <div className="grid gap-2">
            <textarea className="min-h-16 w-full rounded-md border bg-background px-2 py-1 text-sm" placeholder="What do you want to say? A few words is enough." value={intent} onChange={(e) => setIntent(e.target.value)} />
            <span className="text-xs text-muted-foreground">Echo sees only the sender, the subject and what you type here, never the message itself. The draft appears in the chat; copy it into Reply.</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { window.dispatchEvent(new CustomEvent("pixelpals:ask", { detail: { partner: "echo", text: replyPrompt(msg.from, msg.subject, intent) } })); setIntent(null); }}>Draft with Echo</Button>
              <Button size="sm" variant="ghost" onClick={() => setIntent(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Folder" className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm" value={folder} onChange={(e) => { setFolder(e.target.value); setNote(""); void load(e.target.value); }}>
          {(data?.folders ?? [{ name: "INBOX", label: "INBOX", special: "inbox" as const }]).map((f) => <option key={f.name} value={f.name}>{f.special === "inbox" ? "Inbox" : f.label}</option>)}
        </select>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => void load(folder, q, unread, true)} aria-label="Refresh"><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
        <Button size="sm" className="h-8" onClick={() => { setDraft(blank); setConfirm(""); setMsg(null); setView("compose"); }}><MailPlus className="size-4" /> Write</Button>
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(folder, q, unread); }}>
        <Input aria-label="Search mail" placeholder="Search this folder, e.g. from:anna subject:invoice since:2026-10-01" title="Words search the whole message. Also: from: to: subject: since:YYYY-MM-DD before:YYYY-MM-DD is:unread is:read" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" className="h-9" aria-label="Search"><Search className="size-4" /></Button>
      </form>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={unread} onChange={(e) => { setUnread(e.target.checked); void load(folder, q, e.target.checked); }} /> Unread only
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {note && <p className="text-xs text-green-600 dark:text-green-400">✅ {note}</p>}
      {data && !data.messages.length && !error && <p className="text-muted-foreground">{q || unread ? "Nothing matches." : "This folder is empty."}</p>}
      {data?.messages.map((m) => {
        const link = data.gmail && data.account ? gmailLink(data.account, m.messageId) : null;
        return (
          <div key={m.uid} className="flex items-stretch gap-1">
            <button type="button" onClick={() => void openMessage(m)} className="grid min-w-0 flex-1 gap-0.5 rounded-md border px-3 py-2 text-left hover:bg-accent/40" disabled={busy === `open${m.uid}`}>
              <span className={`truncate ${m.seen ? "" : "font-semibold"}`}>{!m.seen && <span className="mr-1 text-primary">●</span>}{m.subject}</span>
              <span className="truncate text-xs text-muted-foreground">{m.from}{when(m.date) ? ` · ${when(m.date)}` : ""}</span>
            </button>
            {link && <a href={link} target="_blank" rel="noopener noreferrer" title="Open in Gmail" aria-label={`Open "${m.subject}" in Gmail`} className="flex w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent/40 hover:text-foreground"><ExternalLink className="size-4" /></a>}
          </div>
        );
      })}
      {data && data.total > data.messages.length && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="h-8" disabled={more} onClick={() => void loadOlder()}>{more ? <Loader2 className="size-3 animate-spin" /> : null} Load older</Button>
          <span className="text-xs text-muted-foreground">Showing the newest {data.messages.length} of {data.total}.</span>
        </div>
      )}
    </div>
  );
}
