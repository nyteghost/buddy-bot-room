import { useRef, useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { scrubChatText } from "@/lib/chat-scrub";
export function ParkingButton({ task = "", step = "" }: { task?: string; step?: string }) {
  const [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const id = useRef("");
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote("");
    id.current ||=
      globalThis.crypto?.randomUUID?.() ??
      "park-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    try {
      const r = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "add",
          id: id.current,
          text,
          parked: true,
          context: { task, step },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Could not park this thought.");
      setText("");
      id.current = "";
      setOpen(false);
      setNote("Thought parked. Your current step is still here.");
      window.dispatchEvent(new Event("pixelpals:inbox-changed"));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-1">
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Park a thought
      </Button>
      {note && !open && (
        <p role="status" className="text-xs">
          {note}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Park this thought</DialogTitle>
            <DialogDescription>
              Save it for later, then return to what you were doing. Nothing becomes a task or
              permanent memory automatically.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="grid gap-3"
          >
            <label className="grid gap-1">
              Thought to park
              <textarea
                autoFocus
                aria-label="Thought to park"
                maxLength={4000}
                value={text}
                className="min-h-24 rounded-md border bg-background p-2 text-base"
                onChange={(e) => {
                  setText(scrubChatText(e.target.value));
                  id.current = "";
                }}
              />
            </label>
            {task && <p className="text-xs text-muted-foreground">Return to: {task}</p>}
            <Button disabled={busy || !text.trim()}>Save and return</Button>
            {note && <p role="status">{note}</p>}
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
