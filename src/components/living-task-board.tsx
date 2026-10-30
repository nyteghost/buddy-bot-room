import { useMemo } from "react";
import { CalendarClock, CirclePlay, ListTodo, Pin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkbench } from "@/lib/workbench";
import { livingBoardTasks } from "@/lib/pal-room-board";
import "./pal-room-board.css";

export function LivingTaskBoard({ onStartTask, onOpenTasks, onBrainDump }: {
  onStartTask: (task: string) => void;
  onOpenTasks: () => void;
  onBrainDump: () => void;
}) {
  const { todos } = useWorkbench();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const tasks = useMemo(() => livingBoardTasks(todos, Date.now(), zone), [todos, zone]);
  const pending = todos.filter((item) => !item.done).length;
  return (
    <section className="living-task-board" aria-label="Living Task Board">
      <div className="living-task-board-heading">
        <div className="flex min-w-0 items-center gap-2">
          <span className="living-task-board-pin" aria-hidden="true"><Pin className="size-4" /></span>
          <div>
            <h3 className="text-sm font-semibold">Living Task Board</h3>
            <p className="text-xs text-muted-foreground">Just a few options. Pick one when you're ready.</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpenTasks} aria-label="Open all tasks">All tasks</Button>
      </div>
      {tasks.length > 0 ? (
        <ol className="living-task-board-items" aria-label="A few possible next tasks">
          {tasks.map((task, index) => (
            <li key={task.id} className={"living-task-note " + (index === 0 ? "living-task-note-first" : "")}>
              <div className="min-w-0 flex-1">
                <p className="living-task-note-title">{task.text}</p>
                {(task.taskDay || task.important) && (
                  <p className="living-task-note-meta">
                    {task.important && <><Sparkles className="size-3" /> Important</>}
                    {task.taskDay && <><CalendarClock className="size-3" /> {task.taskDay}</>}
                  </p>
                )}
              </div>
              <Button size="sm" variant={index === 0 ? "default" : "outline"} className="shrink-0" aria-label={"Start: " + task.text} onClick={() => onStartTask(task.text)}>
                <CirclePlay className="size-3.5" /> Start
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="living-task-board-empty">
          <p className="text-sm">Nothing waiting on the board.</p>
          <p className="text-xs text-muted-foreground">You can add a thought without organizing it first.</p>
        </div>
      )}
      <div className="living-task-board-footer">
        <Button variant="ghost" size="sm" onClick={onBrainDump}><ListTodo className="size-3.5" /> Add a thought</Button>
        {pending > tasks.length && <span className="text-xs text-muted-foreground">More tasks stay safely in Tasks</span>}
      </div>
      <p className="text-xs text-muted-foreground">Starting opens Just Start; it never marks a task done or changes reminders automatically.</p>
    </section>
  );
}
