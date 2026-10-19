import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Smartphone, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Row = { username: string; owner: boolean; created: string };
type Data = { me: { username: string; owner: boolean }; hasToken?: boolean; users: Row[] };

async function call(method: string, body?: unknown, query = ""): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/accounts${query}`, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true } : { ok: false, error: json.error ?? "That didn't work." };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

/** Owner: add, reset and remove accounts. Everyone: change your own password. */
export function AccountsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [token, setToken] = useState("");

  const load = useCallback(() => {
    fetch("/api/accounts").then((r) => r.json()).then((j) => setData(j as Data)).catch(() => setNote("Couldn't load accounts."));
  }, []);
  useEffect(() => { if (open) { setNote(""); setToken(""); load(); } }, [open, load]);

  async function run(p: Promise<{ ok: boolean; error?: string }>, done: string, after?: () => void) {
    const r = await p;
    setNote(r.ok ? done : r.error ?? "That didn't work.");
    if (r.ok) { after?.(); load(); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="debug-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="size-4" /> Accounts</DialogTitle>
          <DialogDescription>Signed in as {data?.me.username ?? "…"}{data?.me.owner ? " (owner)" : ""}. Passwords are stored hashed, never as text.</DialogDescription>
        </DialogHeader>

        <div className="accounts-block">
          <strong>Change my password</strong>
          <input type="password" placeholder="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <input type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <Button variant="outline" size="sm" onClick={() => run(call("PUT", { current, password: next }), "Password changed.", () => { setCurrent(""); setNext(""); })}><KeyRound /> Change password</Button>
        </div>

        <div className="accounts-block">
          <strong>iPhone Shortcut access token</strong>
          <span className="debug-note">Lets an Apple Shortcut sync a Note with Trakt without signing in. It's shown once; creating a new one replaces the old.</span>
          {token && (
            <>
              <input readOnly value={token} aria-label="Access token" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(token).then(() => setNote("Token copied."), () => setNote("Select the token and press Ctrl+C.")); }}><Copy /> Copy token</Button>
            </>
          )}
          <span className="accounts-actions">
            <Button variant="outline" size="sm" onClick={async () => {
              const r = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "token" }) });
              const j = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
              if (j.token) { setToken(j.token); setNote("Copy it now. You won't see it again."); load(); } else setNote(j.error ?? "Couldn't create a token.");
            }}><Smartphone /> {data?.hasToken ? "Replace token" : "Create token"}</Button>
            {data?.hasToken && <Button variant="ghost" size="sm" onClick={() => run(call("DELETE", undefined, "?token=1"), "Token removed.", () => setToken(""))}><Trash2 /> Remove</Button>}
          </span>
        </div>

        {data?.me.owner && (
          <>
            <div className="accounts-block">
              <strong>People</strong>
              {data.users.map((u) => (
                <div className="accounts-row" key={u.username}>
                  <span>{u.username}{u.owner ? " · owner" : ""}</span>
                  {u.username.toLowerCase() !== data.me.username.toLowerCase() && (
                    <span className="accounts-actions">
                      <Button variant="ghost" size="sm" title="Set a new password" onClick={() => { const p = window.prompt(`New password for ${u.username} (8+ characters):`); if (p) void run(call("PUT", { username: u.username, password: p }), `Password reset for ${u.username}.`); }}><KeyRound /></Button>
                      <Button variant="ghost" size="sm" title="Remove account" onClick={() => { if (window.confirm(`Remove ${u.username}? They will be signed out.`)) void run(call("DELETE", undefined, `?username=${encodeURIComponent(u.username)}`), `Removed ${u.username}.`); }}><Trash2 /></Button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="accounts-block">
              <strong>Add someone</strong>
              <input placeholder="Username" autoComplete="off" autoCapitalize="none" value={name} onChange={(e) => setName(e.target.value)} />
              <input type="password" placeholder="Password (8+ characters)" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <Button size="sm" onClick={() => run(call("POST", { username: name, password: pw }), `Added ${name}.`, () => { setName(""); setPw(""); })}><UserPlus /> Add account</Button>
            </div>
          </>
        )}
        {note && <p className="debug-note" role="status">{note}</p>}
      </DialogContent>
    </Dialog>
  );
}
