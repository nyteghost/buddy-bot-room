import { Bookmark, Play } from "lucide-react";
import { Button } from "./ui/button";
import { saveFocusCheckpoint, useFocusCheckpoint } from "@/lib/focus-checkpoint-store";
import type { FocusSession } from "@/lib/focus-companion";
import { useState } from "react";

export function ResumeFocusCard({ onResume }: { onResume: (session: FocusSession) => void }) {
  const saved = useFocusCheckpoint();
  const [message, setMessage] = useState("");
  if (!saved) return null;
  return <section aria-label="Where was I?" className="grid gap-2 rounded-lg border border-primary/40 bg-muted/40 p-3">
    <h4 className="flex items-center gap-2 text-sm font-semibold"><Bookmark className="size-4" /> Where was I?</h4>
    <p className="break-words text-sm font-medium">{saved.task}</p>
    <p className="break-words text-sm">Next tiny step ({saved.stepNumber}): {saved.step}</p>
    <p className="text-xs text-muted-foreground">{saved.completed.length} completed {saved.completed.length === 1 ? "step" : "steps"}. Saved by you in this browser.</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => onResume(saved)}><Play className="size-3.5" /> Resume my saved step</Button>
      <Button size="sm" variant="ghost" onClick={() => { if (!saveFocusCheckpoint(null)) setMessage("This browser couldn't clear the saved place."); }}>Dismiss checkpoint</Button>
    </div>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
