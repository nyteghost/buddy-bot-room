import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { desktop } from "@/lib/linux";
import { isTauri } from "@/lib/local-llm";

const REPO = "nyteghost/buddy-bot-room";
const dismissedKey = "pixel-pals-update-dismissed-v1";

/** Desktop only: checks GitHub for a newer commit than the one this app was built from. */
export function UpdatePopup() {
  const [latest, setLatest] = useState<{ sha: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let stop = false;
    async function check() {
      try {
        const info = await desktop.appInfo();
        if (!info.sha || info.sha === "unknown") return;
        const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { sha: string; commit?: { message?: string } };
        if (stop || json.sha === info.sha || localStorage.getItem(dismissedKey) === json.sha) return;
        setLatest({ sha: json.sha, message: (json.commit?.message ?? "").split("\n")[0] ?? "" });
      } catch {
        /* offline or private repo: stay quiet */
      }
    }
    void check();
    const timer = setInterval(check, 30 * 60 * 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  if (!latest) return null;
  return (
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
  );
}
