import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Mailbox } from "@/components/mailbox";

type CalItem = { title: string; start: number; end: number; allDay: boolean; location: string; source: string };
type CalData = { tz: string; configured: boolean; feeds: number; m365: boolean; google?: { configured: boolean; connected: boolean }; items: CalItem[]; errors: string[]; error?: string };
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
  const [note, setNote] = useState("");
  useEffect(() => {
    const done = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.pixelpals === "google-connected") { setNote(""); void reload(); } };
    window.addEventListener("message", done);
    return () => window.removeEventListener("message", done);
  }, [reload]);
  const connect = () => {
    if (!window.open(`/api/google/start?origin=${encodeURIComponent(location.origin)}`, "pixelpals-google", "width=520,height=700")) setNote("Popup blocked. Allow popups for this site and try again.");
    else setNote("Approve access in the popup. This window updates when you're done.");
  };
  const disconnect = async () => { await fetch("/api/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "disconnect" }) }).catch(() => null); void reload(); };
  return (
    <div className="grid gap-3 p-3 text-sm">
      <Header title="Next 7 days" loading={loading} onReload={() => void reload()} />
      {failed && <p className="text-destructive">{failed}</p>}
      {data?.google && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
          {data.google.connected ? (
            <>
              <span className="text-xs text-muted-foreground">Google Calendar is connected: your events show here, and shifts can be pushed from Work tools.</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void disconnect()}>Disconnect</Button>
            </>
          ) : data.google.configured ? (
            <Button size="sm" variant="outline" onClick={connect}>Connect Google Calendar</Button>
          ) : (
            <span className="text-xs text-muted-foreground">To connect Google Calendar, enter the Google client ID and secret in Settings → Google Calendar first.</span>
          )}
          {note && <span className="text-xs text-muted-foreground">{note}</span>}
        </div>
      )}
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
  const m365Items = (data?.items ?? []).filter((m) => m.source === "Microsoft 365");
  return (
    <div className="grid gap-3 p-3 text-sm">
      {failed && <p className="text-destructive">{failed}</p>}
      {data?.imap && <Mailbox open={open} />}
      {data && !data.configured && (
        <Setup>
          <span>No mailbox is connected yet. Connect <b>Gmail</b> (or any IMAP mail) and you can read, reply, send, move and delete mail here.</span>
          <ol className="list-decimal pl-5">
            <li>Turn on 2-Step Verification for your Google account, then create an <b>app password</b> at <code>myaccount.google.com/apppasswords</code> (your normal password won't work).</li>
            <li>Open <b>Settings → Mail</b> (top menu), press <b>Fill in for Gmail</b>, enter your address and the app password, and <b>Save</b>.</li>
            <li>Press <b>Test</b>. It checks both reading and sending.</li>
          </ol>
          <span>Other mail: <code>imap.mail.me.com</code> (iCloud), <code>outlook.office365.com</code>, <code>imap.fastmail.com</code>. A work Microsoft 365 mailbox (read-only unread subjects) can be added with <code>/m365 connect</code>.</span>
        </Setup>
      )}
      {data?.m365 && (
        <section className="grid gap-1">
          <Header title={data.imap ? "Microsoft 365 unread (read-only)" : "Unread"} loading={loading} onReload={() => void reload()} />
          {!m365Items.length && <p className="text-muted-foreground">No unread mail. 🎉</p>}
          {m365Items.map((m, i) => (
            <div key={`${m.subject}-${i}`} className="grid gap-0.5 rounded-md border px-3 py-2">
              <span className="truncate font-medium">{m.subject}</span>
              <span className="truncate text-xs text-muted-foreground">{m.from}{m.date && !Number.isNaN(Date.parse(m.date)) ? ` · ${new Date(m.date).toLocaleString()}` : ""}</span>
            </div>
          ))}
        </section>
      )}
      {data?.errors.map((e) => <p key={e} className="text-xs text-destructive">{e}</p>)}
    </div>
  );
}
