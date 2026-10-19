import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUTS_APP_URL, bearerHeader, cleanOrigin, isSecure, notesSteps, notesSyncUrl, shareSheetUrl, shareSteps, type SetupStep } from "@/lib/iphone-setup";

function CopyRow({ label, value, onCopied }: { label: string; value: string; onCopied: (m: string) => void; key?: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} aria-label={label} className="min-w-0 flex-1" onFocus={(e) => e.currentTarget.select()} />
        <Button variant="outline" size="sm" className="h-11 sm:h-8" onClick={() => { void navigator.clipboard.writeText(value).then(() => onCopied(`${label} copied.`), () => onCopied("Select the text and copy it.")); }}><Copy /> Copy</Button>
      </div>
    </div>
  );
}

function Steps({ steps, onCopied }: { steps: SetupStep[]; onCopied: (m: string) => void }) {
  return (
    <ol className="grid gap-3 pl-0">
      {steps.map((s, i) => (
        <li key={s.title} className="grid gap-2 rounded-md border p-3 text-sm">
          <div><b>{i + 1}. {s.title}.</b> <span className="text-muted-foreground">{s.detail.replace(/\*\*/g, "")}</span></div>
          {s.copy?.map((c) => <CopyRow key={c.label} label={c.label} value={c.value} onCopied={onCopied} />)}
        </li>
      ))}
    </ol>
  );
}

/** One place to get every value an iOS Shortcut needs. Nothing is sent anywhere until the Shortcut runs. */
export function ConnectIphoneDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [tab, setTab] = useState<"notes" | "share">("notes");
  const [origin, setOrigin] = useState("");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [noteTitle, setNoteTitle] = useState("Watch list");
  const [list, setList] = useState("");
  const [format, setFormat] = useState<"report" | "note">("report");
  const [skipTitle, setSkipTitle] = useState(true);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setOrigin(cleanOrigin(window.location.origin));
    setNote("");
    setToken("");
    fetch("/api/accounts").then((r) => r.json()).then((j: { hasToken?: boolean }) => setHasToken(!!j.hasToken)).catch(() => undefined);
  }, [open]);

  async function createToken() {
    try {
      const r = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "token" }) });
      const j = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
      if (j.token) { setToken(j.token); setHasToken(true); setNote("Token created. Copy the values below now; it won't be shown again."); }
      else setNote(j.error ?? "Couldn't create a token.");
    } catch {
      setNote("Couldn't reach the server.");
    }
  }

  const url = useMemo(() => notesSyncUrl({ origin, list, format, skipTitle }), [origin, list, format, skipTitle]);
  const share = shareSheetUrl(origin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="debug-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Smartphone className="size-4" /> Connect iPhone</DialogTitle>
          <DialogDescription>Copy-and-paste setup for Apple Shortcuts. A Shortcut only sends Pixel Pals what you point it at, when it runs.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Button size="sm" variant={tab === "notes" ? "default" : "outline"} onClick={() => setTab("notes")}>Notes ↔ Trakt</Button>
          <Button size="sm" variant={tab === "share" ? "default" : "outline"} onClick={() => setTab("share")}>Share sheet</Button>
          <Button asChild size="sm" variant="ghost" className="ml-auto"><a href={SHORTCUTS_APP_URL}>Open Shortcuts <ExternalLink className="size-3" /></a></Button>
        </div>
        {!isSecure(origin) && origin && <p className="debug-note">You're on a plain http address. Shortcuts works on your home network, but add Tailscale HTTPS (see the README) to use it away from home and to install the app.</p>}
        {tab === "notes" ? (
          <>
            <div className="accounts-block">
              <strong>1. Access token</strong>
              <span className="debug-note">Lets the Shortcut call Pixel Pals without signing in. It only works for notes sync. Creating a new one replaces the old.</span>
              <Button variant="outline" size="sm" onClick={() => void createToken()}><Smartphone /> {hasToken ? "Replace token" : "Create token"}</Button>
              {token && <CopyRow label="Token" value={token} onCopied={setNote} />}
              {!token && hasToken && <span className="debug-note">You already have a token, but it can't be shown again. Replace it to get a new one.</span>}
            </div>
            <div className="accounts-block">
              <strong>2. Your note</strong>
              <input placeholder="Note title, e.g. Watch list" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
              <input placeholder="Trakt list name (optional, default list is used if empty)" autoCapitalize="none" value={list} onChange={(e) => setList(e.target.value)} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipTitle} onChange={(e) => setSkipTitle(e.target.checked)} /> The note's first line is its title (skip it)</label>
              <label className="grid gap-1 text-sm">
                <span>What do you want back?</span>
                <select className="rounded-md border bg-background px-2 py-2" value={format} onChange={(e) => setFormat(e.target.value as "report" | "note")}>
                  <option value="report">A report of what changed</option>
                  <option value="note">The whole note with ✓ and ▶ added</option>
                </select>
              </label>
            </div>
            <div className="accounts-block">
              <strong>3. Build the Shortcut</strong>
              <Steps steps={notesSteps(url, token, noteTitle)} onCopied={setNote} />
            </div>
          </>
        ) : (
          <div className="accounts-block">
            <strong>Send anything to Pixel Pals from the share sheet</strong>
            <Steps steps={shareSteps(share)} onCopied={setNote} />
            <span className="debug-note">Shared text lands in the message box, ready to send. You need to be signed in already. iOS opens it in Safari rather than the installed app.</span>
          </div>
        )}
        {note && <p className="debug-note" role="status">{note}</p>}
        <p className="debug-note">Needs {tab === "notes" ? "Trakt set up on the server (TRAKT_CLIENT_ID and TRAKT_USER)" : "nothing extra"}. Bearer header example: <code>{bearerHeader("…")}</code></p>
      </DialogContent>
    </Dialog>
  );
}
