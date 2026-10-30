import { useEffect, useState } from "react";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanCompletedSteps } from "@/lib/focus-assist";
import "./tiny-wins.css";

/** Session-only progress; existing Just Start tab storage and explicit Focus
 * checkpoint are the only persistence. No streaks, deadlines, notifications or scores. */
export function TinyWins({ completed, celebrationToken = 0, compact = false }: {
  completed: string[];
  celebrationToken?: number;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (celebrationToken <= 0) return;
    setCelebrating(true);
    const timeout = window.setTimeout(() => setCelebrating(false), 2600);
    return () => window.clearTimeout(timeout);
  }, [celebrationToken]);

  const wins = cleanCompletedSteps(completed);
  if (!wins.length) return null;
  return (
    <section className="tiny-wins" aria-label="Tiny wins">
      {celebrating && (
        <div className="tiny-wins-celebrate" role="status">
          <span className="tiny-wins-sparkles" aria-hidden="true">✦ ✨ ✦</span>
          <span>You showed up. That's a tiny win!</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
        <span className="text-xs font-semibold">{compact ? "Tiny wins" : "Your tiny wins"}</span>
        <div className="tiny-wins-trail" aria-label={wins.length + " recent steps started or marked done"}>
          {wins.map((win, index) => (
            <span className="tiny-wins-dot" key={index} title={win} aria-hidden="true">✦</span>
          ))}
        </div>
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}>
          {expanded ? "Hide wins" : "See wins"}
          {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        </Button>
      </div>
      {expanded && (
        <ol className="tiny-wins-list" aria-label="Recent small actions">
          {wins.map((win, index) => <li key={index}>{win}</li>)}
        </ol>
      )}
      {!compact && <p className="text-xs text-muted-foreground">Each star is one step you started. No streaks or deadlines.</p>}
    </section>
  );
}
