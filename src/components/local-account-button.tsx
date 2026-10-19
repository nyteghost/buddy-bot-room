import { useEffect, useRef, useState } from "react";
import { LogOut, Smartphone, Users } from "lucide-react";
import { ConnectIphoneDialog } from "@/components/connect-iphone-dialog";
import { AccountsDialog } from "@/components/accounts-dialog";
import { Button } from "@/components/ui/button";
import { SYNC_KEYS } from "@/lib/settings-io";
import type { CharacterMode } from "@/lib/hellraiser";

type Me = { accounts: boolean; user?: { username: string; owner: boolean } | null };

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  try { for (const k of SYNC_KEYS) { const v = localStorage.getItem(k); if (v !== null) out[k] = v; } } catch { /* storage unavailable */ }
  return out;
}

/**
 * Docker build: "Local mode" when accounts are off (BUDDY_ACCOUNTS=0). With accounts on, the server has already
 * made you sign in; here we show who you are, open the Accounts dialog, and sync every setting (engine, keys, theme,
 * presets, pal notes, documents, campaign, layout…) to your account, stored on your server. Chats are handled by the chat store.
 * On the first load after signing in, your account's settings win (one reload applies them); after that this browser's changes are uploaded.
 */
export function LocalAccountButton(_props: { theme: CharacterMode; onTheme: (t: CharacterMode) => void }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [synced, setSynced] = useState(false);
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState(false);
  const [phone, setPhone] = useState(false);
  const loadedFor = useRef<string | undefined>(undefined);
  const lastSent = useRef("");
  const email = me?.accounts ? me.user?.username ?? null : null;

  useEffect(() => {
    fetch("/__me").then((r) => r.json()).then((j) => setMe(j as Me)).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!email || loadedFor.current === email) return;
    loadedFor.current = email;
    fetch("/api/account-local").then(async (r) => {
      const json = (await r.json().catch(() => ({}))) as { data?: Record<string, string> | null; error?: string };
      if (!r.ok) throw new Error(json.error ?? "Could not load your settings.");
      const server = json.data;
      if (server && Object.keys(server).length) {
        const local = snapshot();
        const differs = Object.entries(server).some(([k, v]) => local[k] !== v);
        const guard = `pixel-pals-synced-${email}`;
        let already = false;
        try { already = sessionStorage.getItem(guard) === "1"; } catch { /* optional */ }
        if (differs && !already) {
          for (const [k, v] of Object.entries(server)) localStorage.setItem(k, v);
          try { sessionStorage.setItem(guard, "1"); } catch { /* optional */ }
          window.location.reload();
          return;
        }
        lastSent.current = JSON.stringify(server);
      }
      setSynced(true);
    }).catch((e) => setNote(e instanceof Error ? e.message : "Could not load your settings."));
  }, [email]);

  // Upload whenever this browser's settings change (checked every few seconds; cheap string compare).
  useEffect(() => {
    if (!synced) return;
    const tick = () => {
      const data = snapshot();
      const body = JSON.stringify(data);
      if (body === lastSent.current) return;
      fetch("/api/account-local", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) })
        .then(async (r) => {
          if (r.ok) { lastSent.current = body; setNote(""); }
          else setNote(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save settings.");
        })
        .catch(() => setNote("Could not save settings."));
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [synced]);

  if (!email)
    return <span className="account-chip" title="Settings and keys stay in this browser. Accounts are turned off on this server (BUDDY_ACCOUNTS=0).">Local mode</span>;
  return (
    <span className="account-chip" title={note || `Signed in as ${email}. Your settings sync to your account on this server.`}>
      <span className="account-name">{email}</span>
      <Button variant="ghost" size="sm" aria-label="Connect iPhone" title="Connect iPhone (Shortcuts)" onClick={() => setPhone(true)}><Smartphone /></Button>
      <Button variant="ghost" size="sm" aria-label="Accounts" onClick={() => setDialog(true)}><Users /></Button>
      <Button variant="ghost" size="sm" aria-label="Sign out" onClick={() => { window.location.href = "/__logout"; }}>
        <LogOut />
      </Button>
      {note && <span className="text-destructive text-xs">{note}</span>}
      <AccountsDialog open={dialog} onOpenChange={setDialog} />
      <ConnectIphoneDialog open={phone} onOpenChange={setPhone} />
    </span>
  );
}
