import { useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { PixelCharacter } from "./pixel-character";
import { useAdaptiveToday } from "@/lib/adaptive-store";
import { agentName } from "@/lib/agents";
import { useCharacterMode } from "@/lib/hellraiser";
import { fallbackStartStep } from "@/lib/focus-assist";
import { makeFocusSession, type FocusSession } from "@/lib/focus-companion";
export function StuckLaunchpad({
  task,
  onStart,
  resume,
}: {
  task: string;
  onStart?: ((s: FocusSession) => void) | undefined;
  resume?: FocusSession | null;
}) {
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState("start"),
    [smaller, setSmaller] = useState(0);
  const { adaptive } = useAdaptiveToday(),
    theme = useCharacterMode();
  const label = task.trim().slice(0, 280) || "Choose one thing to begin";
  const step =
    smaller > 1
      ? "Just point to one thing you might need. That counts."
      : smaller
        ? fallbackStartStep(label, "smaller")
        : reason === "overwhelmed"
          ? "Point to one task you could begin. Leave the rest for later."
          : reason === "distracted" && resume
            ? resume.step
            : fallbackStartStep(label, "first");
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          setSmaller(0);
        }}
      >
        I'm Stuck
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>One tiny action is enough</DialogTitle>
            <DialogDescription>
              Choose what feels closest, or start with the step below. No timer or setup needed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-3">
            <div className="size-16 shrink-0" aria-hidden="true">
              <PixelCharacter id={adaptive.favorite} mode={theme} motion="rest" />
            </div>
            <span>{agentName(adaptive.favorite, false, false, theme)} is here with you.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["start", "Hard to start"],
              ["unsure", "Where do I begin?"],
              ["overwhelmed", "Too many things"],
              ["distracted", "I got distracted"],
            ].map(([id, title]) => (
              <Button
                key={id}
                size="sm"
                variant={reason === id ? "default" : "outline"}
                aria-pressed={reason === id}
                onClick={() => {
                  setReason(id!);
                  setSmaller(0);
                }}
              >
                {title}
              </Button>
            ))}
          </div>
          <p className="rounded-md border p-3 text-base" aria-live="polite">
            {step}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const session =
                  reason === "distracted" && resume
                    ? resume
                    : makeFocusSession(label, step, adaptive.favorite, "quiet");
                if (session) {
                  onStart?.(session);
                  setOpen(false);
                }
              }}
            >
              Start this small step
            </Button>
            <Button variant="outline" onClick={() => setSmaller((n) => n + 1)}>
              Make it easier
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This help works without AI. It does not mark a task complete.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
