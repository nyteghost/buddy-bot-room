import { useCallback, useEffect, useState } from "react";
import { BellRing, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AlertRule, MailAlert } from "@/lib/mail-alerts";

type State = { rules: AlertRule[]; alerts: MailAlert[]; error?: string };

async function call<T>(url: string, body?: unknown): Promise<T & { error?: string }> {
  try {
    const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
    return (await res.json()) as T & { error?: string };
  } catch { return { error: "Couldn't reach the server." } as T & { error?: string }; }
}

/** Big pop-up for each new email that matches an alert rule. Stays until you press Read or Close. Polls while the page is open. */
export function MailAlertPopup({ onRead }: { onRead: (a: MailAlert) => void }) {
  const [alerts, setAlerts] = useState<MailAlert[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (stop) return;
      if (document.visibilityState === "visible") {
        const res = await call<State>("/api/mailbox?op=alerts");
        if (res.error) { if (/owner|set up|account/i.test(res.error)) return; } // not the owner or no mailbox: stop asking
        else setAlerts(res.alerts);
      }
      timer = setTimeout(() => void poll(), 20_000);
    }
    void poll();
    const onVis = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const current = alerts.find((a) => !dismissed.includes(a.id));
  if (!current) return null;
  const left = alerts.filter((a) => !dismissed.includes(a.id)).length - 1;
  const finish = (a: MailAlert) => { setDismissed((d) => [...d, a.id]); void call("/api/mailbox", { op: "alert-ack", id: a.id }); };

  return (
    <div role="alertdialog" aria-modal="true" aria-label={`Email from ${current.from}`} className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-xl border-4 border-red-500 bg-background p-6 shadow-2xl motion-safe:animate-pulse">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-red-500"><BellRing className="size-5" /> New email{current.spam ? " · found in Spam" : ""}</div>
        <h2 className="text-3xl font-extrabold leading-tight">Email from {current.from}</h2>
        <p className="mt-3 text-lg font-semibold">{current.subject}</p>
        {current.preview && <p className="mt-2 line-clamp-4 text-sm text-muted-foreground">{current.preview}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={() => { finish(current); onRead(current); }}>Read</Button>
          <Button size="lg" variant="outline" onClick={() => finish(current)}><X className="size-4" /> Close</Button>
          {left > 0 && <span className="text-xs text-muted-foreground">+{left} more waiting</span>}
        </div>
      </div>
    </div>
  );
}

/** The list of alert rules, with add and remove. */
export function MailAlertRules() {
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const [kind, setKind] = useState<"from" | "keyword">("from");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await call<State>("/api/mailbox?op=alerts");
    if (res.error) setError(res.error); else { setError(""); setRules(res.rules); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function add() {
    const res = await call<{ rules: AlertRule[] }>("/api/mailbox", { op: "alert-rule-add", kind, value });
    if (res.error) { setError(res.error); return; }
    setError(""); setRules(res.rules); setValue("");
  }
  async function remove(id: string) {
    const res = await call<{ rules: AlertRule[] }>("/api/mailbox", { op: "alert-rule-remove", id });
    if (res.error) setError(res.error); else setRules(res.rules);
  }
  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold"><BellRing className="mr-1 inline size-4" />Email alerts <span className="font-normal text-muted-foreground">({rules?.length ?? "…"} rule{rules?.length === 1 ? "" : "s"})</span></summary>
      <p className="mt-2 text-xs text-muted-foreground">New mail in any folder, including Spam, that matches a rule pops up a big alert here (while this page is open) and sends a phone push. Checked about once a minute.</p>
      {error && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
      <ul className="mt-2 grid gap-1">
        {(rules ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span><span className="text-xs uppercase text-muted-foreground">{r.kind === "from" ? "from" : "words"}</span> {r.value}</span>
            <button type="button" aria-label={`Remove rule ${r.value}`} onClick={() => void remove(r.id)}><Trash2 className="size-3.5" /></button>
          </li>
        ))}
        {rules && rules.length === 0 && <li className="text-xs text-muted-foreground">No rules, so nothing will alert.</li>}
      </ul>
      <form className="mt-2 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <select aria-label="Rule type" className="h-9 rounded-md border border-input bg-background px-2" value={kind} onChange={(e) => setKind(e.target.value as "from" | "keyword")}>
          <option value="from">Sender</option>
          <option value="keyword">Words</option>
        </select>
        <Input aria-label="Rule value" className="min-w-40 flex-1" placeholder={kind === "from" ? "@company.com or name@x.com" : "word in the subject or message"} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit" size="sm" disabled={value.trim().length < 3}>Add</Button>
      </form>
    </details>
  );
}
