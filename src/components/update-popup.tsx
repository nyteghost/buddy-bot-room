import { useCallback, useEffect, useState } from "react";
import { startPolling } from "@/lib/poll";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { desktop } from "@/lib/linux";
import { isTauri } from "@/lib/local-llm";

const REPO = "nyteghost/buddy-bot-room";
const dismissedKey = "pixel-pals-update-dismissed-v1";

type Latest = { sha: string; message: string } | null;
type CheckStatus = "idle" | "checking" | "latest" | "error";

/** Desktop only: an always-visible "Check for updates" button, plus the automatic popup when GitHub has a newer build. */
export function UpdatePopup() {
  const [latest, setLatest] = useState<Latest>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<CheckStatus>("idle");

  const check = useCallback(async (manual: boolean) => {
    setStatus("checking");
    try {
      const info = await desktop.appInfo();
      if (!info.sha || info.sha === "unknown") {
        if (manual) setStatus("error");
        return;
      }
      // Desktop: ask GitHub natively (fast). Browser fallback: fetch with a
      // 10s timeout so a stuck connection can't hang the button forever.
      let sha = "";
      let message = "";
      try {
        const latest = await desktop.checkUpdate(REPO);
        sha = latest.sha;
        message = latest.message;
      } catch {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
          const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
            headers: { Accept: "application/vnd.github+json" },
            signal: ctrl.signal,
          });
          if (!res.ok) {
            if (manual) setStatus("error");
            return;
          }
          const json = (await res.json()) as { sha: string; commit?: { message?: string } };
          sha = json.sha;
          message = (json.commit?.message ?? "").split("\n")[0] ?? "";
        } finally {
          clearTimeout(timer);
        }
      }
      if (!sha) {
        if (manual) setStatus("error");
        return;
      }
      if (sha === info.sha) {
        if (manual) setStatus("latest");
        return;
      }
      // Dismissing only silences the automatic popup; a manual check always offers the update.
      if (!manual && localStorage.getItem(dismissedKey) === sha) return;
      setLatest({ sha, message });
    } catch {
      /* offline or private repo: stay quiet unless the user asked */
      if (manual) setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    return startPolling(() => check(false), 30 * 60 * 1000);
  }, [check]);

  // "Up to date" / error feedback is temporary, then the button goes back to its normal label.
  useEffect(() => {
    if (status !== "latest" && status !== "error") return;
    const t = setTimeout(() => setStatus("idle"), 4000);
    return () => clearTimeout(t);
  }, [status]);

  if (!isTauri()) return null;

  return (
    <>
      <button
        type="button"
        className="update-check-btn"
        disabled={status === "checking"}
        onClick={() => void check(true)}
      >
        {status === "checking"
          ? "Checking…"
          : status === "latest"
            ? "You're up to date ✓"
            : status === "error"
              ? "Couldn't check — try again"
              : "Check for updates"}
      </button>
      {latest && (
        <Dialog open onOpenChange={(open) => !open && setLatest(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pixel Pals update available</DialogTitle>
              <DialogDescription>
                A newer version is on GitHub{latest.message ? `: “${latest.message}”` : ""}. Update now? A terminal opens,
                downloads it and rebuilds the app — you may be asked for your password. Restart Pixel Pals when it finishes.
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  localStorage.setItem(dismissedKey, latest.sha);
                  setLatest(null);
                }}
              >
                No
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  desktop.runUpdate().then(
                    () => setLatest(null),
                    (e) => {
                      setBusy(false);
                      setError(String(e));
                    },
                  );
                }}
              >
                Yes, update
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
