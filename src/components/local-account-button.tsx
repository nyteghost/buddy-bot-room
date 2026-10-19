import { useEffect, useRef, useState } from "react";
import { LogOut, Users } from "lucide-react";
import { AccountsDialog } from "@/components/accounts-dialog";
import { Button } from "@/components/ui/button";
import { normalizeKind, setEngine, useEngine } from "@/lib/engine";
import { isCharacterMode, type CharacterMode } from "@/lib/hellraiser";

type Me = { accounts: boolean; user?: { username: string; owner: boolean } | null };

/**
 * Docker build: "Local mode" when accounts are off (BUDDY_ACCOUNTS=0). With accounts on, the server has already
 * made you sign in; here we show who you are, open the Accounts dialog, and sync engine settings, keys and theme
 * to your account (stored on your server, not Lovable).
 */
export function LocalAccountButton({ theme, onTheme }: { theme: CharacterMode; onTheme: (t: CharacterMode) => void }) {
  const engine = useEngine();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [synced, setSynced] = useState(false);
  const [note, setNote] = useState("");
  const [dialog, setDialog] = useState(false);
  const loadedFor = useRef<string | undefined>(undefined);
  const email = me?.accounts ? me.user?.username ?? null : null;

  useEffect(() => {
    fetch("/__me").then((r) => r.json()).then((j) => setMe(j as Me)).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!email || loadedFor.current === email) return;
    loadedFor.current = email;
    fetch("/api/account-local").then(async (r) => {
      const json = (await r.json().catch(() => ({}))) as { settings?: Record<string, string> | null; error?: string };
      if (!r.ok) throw new Error(json.error ?? "Could not load your settings.");
      const s = json.settings;
      if (s) {
        setEngine({ kind: normalizeKind(s["engineKind"] ?? ""), groqKey: s["groqKey"] ?? "", geminiKey: s["geminiKey"] ?? "", openrouterKey: s["openrouterKey"] ?? "", nvidiaKey: s["nvidiaKey"] ?? "" });
        if (isCharacterMode(s["characterMode"] ?? "")) onTheme(s["characterMode"] as CharacterMode);
      }
      setSynced(true);
    }).catch((e) => setNote(e instanceof Error ? e.message : "Could not load your settings."));
  }, [email]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => {
      fetch("/api/account-local", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineKind: engine.kind, characterMode: theme, groqKey: engine.groqKey, geminiKey: engine.geminiKey, openrouterKey: engine.openrouterKey, nvidiaKey: engine.nvidiaKey }),
      }).then(async (r) => { setNote(r.ok ? "" : ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save settings."); })
        .catch(() => setNote("Could not save settings."));
    }, 800);
    return () => clearTimeout(t);
  }, [synced, engine.kind, engine.groqKey, engine.geminiKey, engine.openrouterKey, engine.nvidiaKey, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!email)
    return <span className="account-chip" title="Settings and keys stay in this browser. Accounts are turned off on this server (BUDDY_ACCOUNTS=0).">Local mode</span>;
  return (
    <span className="account-chip" title={note || `Signed in as ${email}. Settings sync to your account on this server.`}>
      <span className="account-name">{email}</span>
      <Button variant="ghost" size="sm" aria-label="Accounts" onClick={() => setDialog(true)}><Users /></Button>
      <Button variant="ghost" size="sm" aria-label="Sign out" onClick={() => { window.location.href = "/__logout"; }}>
        <LogOut />
      </Button>
      {note && <span className="text-destructive text-xs">{note}</span>}
      <AccountsDialog open={dialog} onOpenChange={setDialog} />
    </span>
  );
}
