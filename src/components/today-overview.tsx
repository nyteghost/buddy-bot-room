import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { FocusHub } from "./focus-hub";
import type { FocusSession } from "@/lib/focus-companion";
import type { TodayTask } from "@/lib/today";
import type { Todo } from "@/lib/workbench";
type Overview = {
  priorities: TodayTask[];
  taskCount: number;
  pendingCaptures: number;
  zone: string;
  nextEvent: { title: string; start: number; allDay: boolean } | null;
  calendarAvailable: boolean;
  idea: { title: string; text: string; reason: string } | null;
  weekly: {
    completed: number;
    lingering: TodayTask[];
    ideas: { id: string; title: string; text: string }[];
  };
};
export function TodayOverview({
  open,
  onStart,
  onBrainDump,
  onOpenTasks,
  onOpenMail,
  onResumeFocus,
}: {
  open: boolean;
  onStart: (task: string) => void;
  onBrainDump: () => void;
  onOpenTasks: () => void;
  onOpenMail: () => void;
  onResumeFocus?: ((s: FocusSession) => void) | undefined;
}) {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      void fetch(
        "/api/inbox?view=brief&tz=" +
          encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone),
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive) setData(d);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 60000);
    const changed = () => {
      setData(null);
      load();
    };
    window.addEventListener("pixelpals:inbox-changed", changed);
    window.addEventListener("pixelpals:memory-changed", changed);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("pixelpals:inbox-changed", changed);
      window.removeEventListener("pixelpals:memory-changed", changed);
    };
  }, [open]);
  const todos: Todo[] = (data?.priorities ?? []).map((t) => ({
    id: t.id,
    text: t.title,
    at: t.createdAt,
    done: false,
    important: t.tier === "must",
    ...(t.at ? { scheduledAt: t.at } : {}),
  }));
  return (
    <>
      <section
        className="grid gap-2 rounded-md border p-3"
        aria-label="Personalized Today briefing"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Your day, a little clearer</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.dispatchEvent(new Event("pixelpals:inbox"))}
          >
            Capture a thought
            {data?.pendingCaptures ? " · " + data.pendingCaptures + " to review" : ""}
          </Button>
        </div>
        {data ? (
          <>
            <p>
              {data.taskCount} open planner tasks · {data.pendingCaptures} captures waiting for
              review
            </p>
            <p>
              {data.nextEvent ? (
                <>
                  Next: {data.nextEvent.title} ·{" "}
                  {data.nextEvent.allDay
                    ? "All day"
                    : new Date(data.nextEvent.start).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: data.zone,
                      })}
                </>
              ) : data.calendarAvailable ? (
                "No more calendar events today."
              ) : (
                "Calendar is not connected or could not be checked."
              )}
            </p>
            {data.priorities.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words">
                  {t.title}
                  {t.mins ? " · ~" + t.mins + " min" : ""}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onStart(t.title + (t.notes ? "\n" + t.notes : ""))}
                >
                  Help me start
                </Button>
              </div>
            ))}
            {data.idea && (
              <details>
                <summary>A saved idea to revisit</summary>
                <p>{data.idea.text}</p>
                <small>{data.idea.reason}</small>
              </details>
            )}
            <details>
              <summary className="cursor-pointer py-2">Gentle weekly review</summary>
              <div className="grid gap-2">
                <p>{data.weekly.completed} tasks completed in the last seven days.</p>
                {data.weekly.lingering.length ? (
                  <>
                    <p>
                      These have been open for at least a week. Continue one, or review its plan
                      when you’re ready.
                    </p>
                    {data.weekly.lingering.map((t) => (
                      <div key={t.id}>
                        <p>{t.title}</p>
                        <Button size="sm" variant="outline" onClick={() => onStart(t.title)}>
                          Continue this
                        </Button>
                      </div>
                    ))}
                  </>
                ) : (
                  <p>No week-old tasks waiting here.</p>
                )}
                {data.weekly.ideas.map((i) => (
                  <p key={i.id}>Saved idea: {i.text}</p>
                ))}
                <Button size="sm" variant="outline" onClick={() => location.assign("/today")}>
                  Review or reschedule in Today planner
                </Button>
                <p className="text-xs text-muted-foreground">
                  This review does not move, archive or delete anything automatically.
                </p>
              </div>
            </details>
          </>
        ) : (
          <p className="text-muted-foreground">
            Your planner and captures appear here when persistent owner storage is available.
          </p>
        )}
      </section>
      <FocusHub
        serverTodos={todos}
        onStart={onStart}
        onBrainDump={onBrainDump}
        onOpenTasks={todos.length ? () => location.assign("/today") : onOpenTasks}
        onOpenMail={onOpenMail}
        onResumeFocus={onResumeFocus}
      />
    </>
  );
}
