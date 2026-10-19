import { useEffect, useState, useSyncExternalStore } from "react";
import { Bug, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildReport, clearClientLog, clientLog, subscribeLog } from "@/lib/debug-log";

/** One-click bug report: app info, server events and browser events, with secrets stripped. */
export function DebugLogDialog({ open, onOpenChange, context }: { open: boolean; onOpenChange: (open: boolean) => void; context: string[] }) {
  const entries = useSyncExternalStore(subscribeLog, clientLog, clientLog);
  const [server, setServer] = useState("(loading…)");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!open) return;
    setCopied("");
    setServer("(loading…)");
    fetch("/api/debuglog")
      .then((r) => (r.ok ? r.text() : `(server log unavailable: ${r.status})`))
      .then(setServer)
      .catch(() => setServer("(could not reach the server)"));
  }, [open]);

  const report = buildReport({ app: `${__APP_VERSION__} · ${__APP_COMMIT__}${__SELF_HOSTED__ ? " · self-hosted" : ""}`, context, server, client: entries });

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied("Copied. Paste it into the chat with Claude.");
    } catch {
      setCopied("Couldn't copy automatically. Select the text and press Ctrl+C.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="debug-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bug className="size-4" /> Debug log</DialogTitle>
          <DialogDescription>Copy this and paste it to Claude if something breaks. API keys and passwords are hidden automatically.</DialogDescription>
        </DialogHeader>
        <textarea className="debug-text" readOnly value={report} aria-label="Debug report" onFocus={(e) => e.currentTarget.select()} />
        <div className="debug-actions">
          <Button onClick={copy}><Copy /> Copy report</Button>
          <Button variant="ghost" onClick={clearClientLog}><Trash2 /> Clear browser log</Button>
          {copied && <span className="debug-note">{copied}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
