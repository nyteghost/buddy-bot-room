import { zoneDateKey } from "./day-overview";
import type { Todo } from "./workbench";

export type RoomTask = Todo & { taskDay: string | null };
/** A small subset, not another overwhelming full task list.
 * Priority: due/overdue, important, then ordinary; stable by capture order. */
export function livingBoardTasks(todos: readonly Todo[], now: number, zone: string, limit = 3): RoomTask[] {
  if (limit < 1) return [];
  const today = zoneDateKey(now, zone);
  return todos.filter((todo) => !todo.done && !!todo.text.trim()).map((todo, i) => {
    const taskDay = todo.dueDate ?? (todo.scheduledAt ? zoneDateKey(todo.scheduledAt, zone)
      : todo.reminderAt ? zoneDateKey(todo.reminderAt, zone) : null);
    const due = !!taskDay && taskDay <= today;
    return { ...todo, taskDay, _order: i, _rank: due ? 0 : todo.important ? 1 : !taskDay ? 2 : 3 };
  }).sort((a, b) => a._rank - b._rank || a._order - b._order)
    .slice(0, Math.min(3, limit)).map(({ _order: _o, _rank: _r, ...todo }) => todo);
}
