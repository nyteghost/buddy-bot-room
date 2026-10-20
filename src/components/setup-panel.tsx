import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setupSummary, type SetupItem, type SetupTest } from "@/lib/setup";
import { setHideSecrets, useHideSecrets } from "@/lib/privacy-store";

/** What's connected and what isn't, with a Test button for each. Names and hints only; no addresses or keys are ever sent to the browser. */
export function SetupPanel({ open }: { open: boolean }) {
  const [items, setItems] = useState<SetupItem[] | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, SetupTest | "running">>({});
  const hide = useHideSecrets();
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/setup");
      const json = (await res.json()) as { items?: SetupItem[]; error?: string };
      if (json.items) { setItems(json.items); setError(""); } else setError(json.error ?? "Couldn't load.");
    } catch { setError("Couldn't reach the server."); }
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  const test = async (id: string) => {
    setResults((r) => ({ ...r, [id]: "running" }));
    try {
      const res = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const out = (await res.json()) as SetupTest;
      setResults((r) => ({ ...r, [id]: out }));
    } catch { setResults((r) => ({ ...r, [id]: { ok: false, note: "Couldn't reach the server." } })); }
  };
  return (
    <div className="grid gap-3 p-3 text-sm">
      {error && <p className="text-destructive">{error}</p>}
      {items && <p className="font-medium">{setupSummary(items)}</p>}
      <label className="flex items-center gap-2 rounded-md border px-3 py-2">
        <input type="checkbox" checked={hide} onChange={(e) => setHideSecrets(e.target.checked)} />
        <span>Hide secrets on this device <span className="text-xs text-muted-foreground">(blurs links and addresses so screenshots are safe)</span></span>
      </label>
      {items?.map((i) => {
        const r = results[i.id];
        return (
          <div key={i.id} className="grid gap-1 rounded-md border px-3 py-2">
            <div className="flex items-center gap-2">
              {i.configured ? <CheckCircle2 className="size-4 shrink-0 text-green-500" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate font-medium">{i.name}</span>
              {i.testable && i.configured && <Button size="sm" variant="outline" className="h-7" disabled={r === "running"} onClick={() => void test(i.id)}>{r === "running" ? <Loader2 className="size-3 animate-spin" /> : "Test"}</Button>}
            </div>
            <span className="text-xs text-muted-foreground">{i.what}{i.configured ? "" : ` · set ${i.env}`}</span>
            {r && r !== "running" && <span className={r.ok ? "text-xs text-green-600 dark:text-green-400" : "text-xs text-destructive"}>{r.ok ? "✅" : "⚠"} {r.note}</span>}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">Settings are environment variables on the stack (Portainer → your stack → Environment variables), then redeploy. The README has every variable.</p>
    </div>
  );
}
