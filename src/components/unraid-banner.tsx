import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDuration, type UnraidReply } from "@/lib/unraid";

/** A strip under the header when Unraid is unreachable or has warnings. Renders nothing when Unraid isn't set up or all is well. */
export function UnraidBanner({ onDiagnose }: { onDiagnose: () => void }) {
  const [reply, setReply] = useState<UnraidReply | null>(null);
  const [dismissed, setDismissed] = useState("");
  const [perm, setPerm] = useState<NotificationPermission | "none">("none");
  const lastPhase = useRef<string>("");
  const lastProblems = useRef<string>("");

  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let next = 60000;
      try {
        const res = await fetch("/api/unraid");
        if (res.ok) {
          const json = (await res.json()) as UnraidReply;
          if (stop) return;
          setReply(json);
          if (!json.configured) return; // not set up: stop polling
          next = Math.max(20000, json.intervalSec * 1000);
          const problems = json.status?.problems.join("|") ?? "";
          const alert = (title: string, body: string) => {
            try { if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body }); } catch { /* notifications unavailable here */ }
          };
          if (lastPhase.current && json.phase !== lastPhase.current) {
            if (json.phase === "down") alert("Unraid is unreachable", "Pixel Pals can't reach your Unraid server.");
            else if (json.phase === "up" && lastPhase.current === "down") alert("Unraid is back", "Unraid is reachable again.");
          }
          if (json.phase === "up" && problems && problems !== lastProblems.current && lastPhase.current) alert("Unraid needs attention", json.status?.problems[0] ?? "");
          lastPhase.current = json.phase;
          lastProblems.current = problems;
        }
      } catch { /* the Pixel Pals server itself is unreachable; nothing to show */ }
      if (!stop) timer = setTimeout(poll, next);
    };
    void poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, []);

  if (!reply || !reply.configured) return null;
  const down = reply.phase === "down";
  const problems = reply.status?.problems ?? [];
  const key = down ? "down" : problems.join("|");
  if ((!down && !problems.length) || dismissed === key) return null;
  return (
    <div className={`unraid-banner ${down ? "unraid-down" : "unraid-warn"}`} role="alert">
      <span>
        {down
          ? `Unraid is unreachable${reply.downSince ? ` (for ${formatDuration(Math.round((Date.now() - reply.downSince) / 1000))})` : ""}.`
          : `Unraid needs attention: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`}
      </span>
      <span className="unraid-actions">
        <Button size="sm" variant="secondary" onClick={onDiagnose}>What's wrong?</Button>
        {perm === "default" && <Button size="sm" variant="secondary" onClick={() => void Notification.requestPermission().then(setPerm)}>Enable notifications</Button>}
        {!down && <Button size="sm" variant="ghost" onClick={() => setDismissed(key)}>Dismiss</Button>}
      </span>
    </div>
  );
}
