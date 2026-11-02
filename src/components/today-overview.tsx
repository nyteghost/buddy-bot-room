import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { FocusHub } from "./focus-hub";
import type { FocusSession } from "@/lib/focus-companion";
import type { TodayTask } from "@/lib/today";
import type { Todo } from "@/lib/workbench";
import { AdaptiveControls } from "./adaptive-controls";
import { TodaySection } from "./today-section";
import { WorkCheckpoints } from "./work-checkpoints";
import { StuckLaunchpad } from "./stuck-launchpad";
import { ParkingButton } from "./parking-lot";
import { useAdaptiveToday } from "@/lib/adaptive-store";
import { adaptiveBrief } from "@/lib/adaptive-today";
import { makeFocusSession } from "@/lib/focus-companion";
import { fallbackStartStep } from "@/lib/focus-assist";
import { useFocusCheckpoint } from "@/lib/focus-checkpoint-store";
type Overview = {
  adaptive: ReturnType<typeof adaptiveBrief>;
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
  const { adaptive } = useAdaptiveToday();
  const saved = useFocusCheckpoint();
  const [easier, setEasier] = useState(false);
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
      load();
    };
    window.addEventListener("pixelpals:inbox-changed", changed);
    window.addEventListener("pixelpals:memory-changed", changed);
    window.addEventListener("pixelpals:adaptive-changed", changed);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("pixelpals:inbox-changed", changed);
      window.removeEventListener("pixelpals:memory-changed", changed);
      window.removeEventListener("pixelpals:adaptive-changed", changed);
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
        style={{ order: -29 }}
        className="grid min-w-0 gap-3 rounded-md border p-3"
        aria-label="Personalized Today briefing"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Today at a glance</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.dispatchEvent(new Event("pixelpals:inbox"))}
          >
            Capture a thought
          </Button>
        </div>
        <div className="grid gap-2">
          <h4 className="text-xs font-semibold text-primary">NOW</h4>
          <p className="break-words font-medium">
            {data?.adaptive.task?.title ?? "Choose one small starting point"}
          </p>
          <p>
            {easier
              ? fallbackStartStep(data?.adaptive.task?.title ?? "Get started", "smaller")
              : (data?.adaptive.step ?? "Name one thing you would like to begin.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                const task = data?.adaptive.task?.title;
                if (!task) {
                  onStart("");
                  return;
                }
                const step = easier ? fallbackStartStep(task, "smaller") : data!.adaptive.step;
                const session = makeFocusSession(task, step, adaptive.favorite, "quiet");
                if (session && onResumeFocus) onResumeFocus(session);
                else onStart(task);
              }}
            >
              Start
            </Button>
            <Button variant="outline" onClick={() => setEasier(true)}>
              Make it easier
            </Button>
            <StuckLaunchpad
              task={data?.adaptive.task?.title ?? ""}
              onStart={onResumeFocus}
              resume={saved}
            />
            {saved && (
              <Button variant="outline" onClick={() => onResumeFocus?.(saved)}>
                Resume interrupted task
              </Button>
            )}
          </div>
          <small className="text-muted-foreground">{data?.adaptive.reason}</small>
        </div>
        <div className="grid gap-1 border-t pt-2">
          <h4 className="text-xs font-semibold">NEXT</h4>
          {data?.adaptive.next ? (
            <p>
              {data.adaptive.next.title} ·{" "}
              {new Date(data.adaptive.next.start).toLocaleString([], {
                dateStyle: "short",
                timeStyle: "short",
                timeZone: data.zone,
              })}{" "}
              (scheduled)
            </p>
          ) : (
            <p>No upcoming timed commitment in the available data.</p>
          )}
          {adaptive.timeAware &&
            data?.adaptive.available !== null &&
            data?.adaptive.available !== undefined && (
              <small>
                {data.adaptive.available} minutes available, allowing five minutes to prepare. A
                scheduled event does not confirm attendance.
              </small>
            )}
        </div>
        <div className="grid gap-1 border-t pt-2">
          <h4 className="text-xs font-semibold">LATER</h4>
          {data?.adaptive.later.length ? (
            data.adaptive.later.map((t) => (
              <button
                key={t.id}
                className="break-words rounded p-1 text-left hover:bg-accent"
                onClick={() => onStart(t.title)}
              >
                {t.title}
              </button>
            ))
          ) : (
            <p>You can leave the rest for later.</p>
          )}
        </div>
        {data ? (
          <>
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
      <AdaptiveControls />
      <TodaySection id="memory">
        <WorkCheckpoints onResume={onResumeFocus} />
      </TodaySection>
      <TodaySection id="parking">
        <div className="grid gap-2 rounded-md border p-3">
          <ParkingButton />
          <Button
            variant="outline"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("pixelpals:inbox", { detail: { filter: "parked" } }),
              )
            }
          >
            Review parked thoughts
          </Button>
        </div>
      </TodaySection>
      <TodaySection id="focus">
        <FocusHub
          serverTodos={todos}
          onStart={onStart}
          onBrainDump={onBrainDump}
          onOpenTasks={todos.length ? () => location.assign("/today") : onOpenTasks}
          onOpenMail={onOpenMail}
          onResumeFocus={onResumeFocus}
        />
      </TodaySection>
    </>
  );
}
