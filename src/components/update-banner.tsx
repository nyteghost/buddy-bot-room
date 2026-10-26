import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Info = { enabled?: boolean; behind?: number; latest?: string; current?: string; changes?: string[]; text?: string };
const dismissedKey = "pixel-pals-update-banner-dismissed";

/** Web/self-hosted: a slim bar when GitHub has a newer version than the one running. Dismissing hides that version only. */
export function UpdateBanner() {
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/update").then(async (r) => (r.ok ? ((await r.json()) as Info) : null)).then((j) => { if (alive && j) setInfo(j); }).catch(() => undefined);
    void load();
    const t = window.setInterval(() => void load(), 6 * 3600_000);
    return () => { alive = false; window.clearInterval(t); };
  }, []);
  useEffect(() => {
    try { setHidden(!!info?.latest && localStorage.getItem(dismissedKey) === info.latest); } catch { setHidden(false); }
  }, [info?.latest]);
  if (!info?.enabled || !info.behind || info.behind <= 0 || hidden) return null;
  const dismiss = () => { try { localStorage.setItem(dismissedKey, info.latest ?? ""); } catch { /* optional */ } setHidden(true); };
  return (
    <div className="update-banner" role="status">
      <div className="update-banner-row">
        <span><b>Update available</b> — {info.behind} new change{info.behind === 1 ? "" : "s"}.</span>
        <span className="update-banner-actions">
          <Button size="sm" variant="secondary" className="h-7" onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "What's new"}</Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={dismiss}>Dismiss</Button>
        </span>
      </div>
      {open && (
        <div className="update-banner-details">
          <ul>{(info.changes ?? []).map((c) => <li key={c}>{c}</li>)}</ul>
          <p>To update on Unraid: Docker tab → Compose → your <b>pixelpals</b> stack → <b>Update Stack</b>. Your data is kept. (Portainer: Stacks → your stack → Pull and redeploy.)</p>
        </div>
      )}
    </div>
  );
}
