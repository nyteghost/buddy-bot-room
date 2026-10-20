import { useCallback, useEffect, useState } from "react";
import { PenLine, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { replyPrompt } from "@/lib/mail-reply";

type CalItem = { title: string; start: number; end: number; allDay: boolean; location: string; source: string };
type CalData = { tz: string; configured: boolean; feeds: number; m365: boolean; items: CalItem[]; errors: string[]; error?: string };
type MailItem = { from: string; subject: string; date: string; source: string };
type MailData = { configured: boolean; imap: boolean; m365: boolean; items: MailItem[]; errors: string[]; error?: string };

export function useFeed<T extends { error?: string }>(url: string, open: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url);
      const json = (await res.json()) as T;
      if (!res.ok) setFailed(json.error ?? "Couldn't load.");
      else { setData(json); setFailed(""); }
    } catch { setFailed("Couldn't reach the server."); }
    setLoading(false);
  }, [url]);
  useEffect(() => {
    if (!open) return;
    void load();
    const t = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(t);
  }, [open, load]);
  return { data, loading, failed, reload: load };
}

export const Setup = ({ children }: { children: React.ReactNode }) => <div className="grid gap-2 rounded-md border p-3 text-sm text-muted-foreground">{children}</div>;
export const Header = ({ title, loading, onReload }: { title: string; loading: boolean; onReload: () => void }) => (
  <div className="flex items-center justify-between gap-2">
    <span className="font-medium">{title}</span>
    <Button size="sm" variant="ghost" className="h-8" onClick={onReload} disabled={loading} aria-label="Refresh"><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
  </div>
);

export function dayLabel(ms: number, tz: string): string {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(t);
  const today = Date.now();
  if (day(ms) === day(today)) return "Today";
  if (day(ms) === day(today + 86400000)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "long", month: "short", day: "numeric" }).format(ms);
}
export const clock = (ms: number, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(ms);

export function CalendarPanel({ open }: { open: boolean }) {
  const { data, loading, failed, reload } = useFeed<CalData>("/api/calendar?days=7", open);
  const tz = data?.tz ?? "UTC";
  const groups = new Map<string, CalItem[]>();
  for (const e of data?.items ?? []) {
    if (e.end < Date.now() && !e.allDay) continue; // hide what already finished today
    const key = dayLabel(e.start, tz);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return (
    <div className="grid gap-3 p-3 text-sm">
      <Header title="Next 7 days" loading={loading} onReload={() => void reload()} />
      {failed && <p className="text-destructive">{failed}</p>}
      {data && !data.configured && (
        <Setup>
          <span>No calendar is connected yet. The easiest way is a private <b>.ics link</b> (read-only, no sign-in):</span>
          <ul className="list-disc pl-5">
            <li><b>Google Calendar:</b> Settings → your calendar → <i>Integrate calendar</i> → <i>Secret address in iCal format</i>.</li>
            <li><b>iCloud:</b> Calendar → share → <i>Public Calendar</i> → copy the link.</li>
            <li><b>Outlook.com:</b> Settings → Calendar → <i>Shared calendars</i> → publish → copy the ICS link.</li>
          </ul>
          <span>Put the link(s) in <code>CALENDAR_ICS_URLS</code> (comma separated) on the stack and redeploy. A work Microsoft 365 calendar can be added with <code>/m365 connect</code>.</span>
        </Setup>
      )}
      {data?.configured && !groups.size && !failed && <p className="text-muted-foreground">Nothing coming up in the next 7 days.</p>}
      {[...groups.entries()].map(([label, items]) => (
        <section key={label} className="grid gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</h3>
          {items.map((e, i) => (
            <div key={`${e.start}-${i}`} className="flex gap-3 rounded-md border px-3 py-2">
              <span className="w-20 shrink-0 text-xs text-muted-foreground">{e.allDay ? "All day" : `${clock(e.start, tz)}`}</span>
              <span className="min-w-0"><span className="block truncate">{e.title}</span>{(e.location || data?.items.some((x) => x.source !== e.source)) && <span className="block truncate text-xs text-muted-foreground">{[e.location, e.source].filter(Boolean).join(" · ")}</span>}</span>
            </div>
          ))}
        </section>
      ))}
      {data?.errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
    </div>
  );
}

export function MailPanel({ open }: { open: boolean }) {
  const { data, loading, failed, reload } = useFeed<MailData>("/api/mail", open);
  const [drafting, setDrafting] = useState<number | null>(null);
  const [intent, setIntent] = useState("");
  const draft = (m: MailItem) => {
    window.dispatchEvent(new CustomEvent("pixelpals:ask", { detail: { partner: "echo", text: replyPrompt(m.from, m.subject, intent) } }));
    setDrafting(null);
    setIntent("");
  };
  return (
    <div className="grid gap-3 p-3 text-sm">
      <Header title="Unread" loading={loading} onReload={() => void reload()} />
      {failed && <p className="text-destructive">{failed}</p>}
      {data && !data.configured && (
        <Setup>
          <span>No mailbox is connected yet. Pixel Pals can show <b>unread subjects only</b>: it never downloads message bodies, marks anything read, sends, deletes or moves mail.</span>
          <span>Set these on the stack and redeploy (use an <b>app password</b>, not your normal password, for Gmail, iCloud, Outlook.com and Fastmail):</span>
          <code className="block whitespace-pre-wrap">IMAP_HOST=imap.gmail.com{"\n"}IMAP_USER=you@gmail.com{"\n"}IMAP_PASS=your-app-password</code>
          <span>Common hosts: <code>imap.gmail.com</code>, <code>imap.mail.me.com</code>, <code>outlook.office365.com</code>, <code>imap.fastmail.com</code>. A work Microsoft 365 mailbox can be added with <code>/m365 connect</code>.</span>
        </Setup>
      )}
      {data?.configured && !data.items.length && !failed && <p className="text-muted-foreground">No unread mail. 🎉</p>}
      {data?.items.map((m, i) => (
        <div key={`${m.subject}-${i}`} className="grid gap-0.5 rounded-md border px-3 py-2">
          <span className="truncate font-medium">{m.subject}</span>
          <span className="truncate text-xs text-muted-foreground">{m.from}{data.imap && data.m365 ? ` · ${m.source}` : ""}{m.date && !Number.isNaN(Date.parse(m.date)) ? ` · ${new Date(m.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</span>
          {drafting === i ? (
            <div className="mt-1 grid gap-2">
              <textarea className="min-h-16 w-full rounded-md border bg-background px-2 py-1 text-sm" placeholder="What do you want to say? A few words is enough, like “yes Thursday works, ask for the invoice”." value={intent} maxLength={400} onChange={(e) => setIntent(e.target.value)} autoFocus />
              <span className="text-xs text-muted-foreground">Echo sees only the sender, the subject and what you type here, never the message itself. You copy the draft into your own mail app; nothing is sent.</span>
              <div className="flex gap-2"><Button size="sm" onClick={() => draft(m)}>Draft with Echo</Button><Button size="sm" variant="ghost" onClick={() => setDrafting(null)}>Cancel</Button></div>
            </div>
          ) : (
            <Button size="sm" variant="ghost" className="mt-1 h-7 justify-start px-1 text-xs" onClick={() => { setDrafting(i); setIntent(""); }}><PenLine className="size-3" /> Draft a reply</Button>
          )}
        </div>
      ))}
      {data?.errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
    </div>
  );
}
