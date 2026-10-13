import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { loadAccount, saveSettings } from "@/lib/account.functions";
import { normalizeKind, setEngine, useEngine } from "@/lib/engine";
import { isCharacterMode, type CharacterMode } from "@/lib/hellraiser";

/** Google sign-in that syncs engine, keys (encrypted on the server) and theme to the account. */
export function AccountButton({ theme, onTheme }: { theme: CharacterMode; onTheme: (t: CharacterMode) => void }) {
  const session = useSession();
  const engine = useEngine();
  const load = useServerFn(loadAccount);
  const save = useServerFn(saveSettings);
  const [synced, setSynced] = useState(false);
  const [note, setNote] = useState("");
  const userId = session?.user.id;
  const loadedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!userId) { setSynced(false); loadedFor.current = undefined; return; }
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    load().then(({ settings }) => {
      if (settings) {
        setEngine({ kind: normalizeKind(settings.engineKind), groqKey: settings.groqKey, geminiKey: settings.geminiKey, openrouterKey: settings.openrouterKey });
        if (isCharacterMode(settings.characterMode)) onTheme(settings.characterMode);
      }
      setSynced(true);
    }).catch((e) => setNote(e instanceof Error ? e.message : "Could not load your settings."));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!synced) return;
    const t = setTimeout(() => {
      save({ data: { engineKind: engine.kind, characterMode: theme, groqKey: engine.groqKey, geminiKey: engine.geminiKey, openrouterKey: engine.openrouterKey } })
        .then(() => setNote(""))
        .catch((e) => setNote(e instanceof Error ? e.message : "Could not save settings."));
    }, 800);
    return () => clearTimeout(t);
  }, [synced, engine.kind, engine.groqKey, engine.geminiKey, engine.openrouterKey, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) return null;
  if (!session)
    return (
      <Button variant="ghost" size="sm" onClick={async () => {
        const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
        if (r.error) setNote(r.error.message);
      }}>
        <LogIn /> Sign in
      </Button>
    );
  return (
    <span className="account-chip" title={note || "Settings and saved discussions sync to your account"}>
      <span className="account-name">{session.user.user_metadata?.["name"] ?? session.user.email}</span>
      <Button variant="ghost" size="sm" aria-label="Sign out" onClick={async () => {
        await supabase.auth.signOut();
        setEngine({ groqKey: "", geminiKey: "" });
      }}>
        <LogOut />
      </Button>
      {note && <span className="text-destructive text-xs">{note}</span>}
    </span>
  );
}
