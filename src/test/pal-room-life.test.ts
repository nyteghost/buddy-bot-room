import { describe, expect, it } from "vitest";
import { palActivity, PAL_ROOM_MOOD_KEY } from "@/lib/pal-room-life";
import { livingBoardTasks } from "@/lib/pal-room-board";
import type { Todo } from "@/lib/workbench";

const d = (id: string, text: string, extras: Partial<Todo> = {}): Todo => ({ id, text, at: 1, done: false, ...extras });
describe("Living Pal Room", () => {
  it("keeps each pal's ambient activities predictable and purely decorative", () => {
    expect(palActivity("byte", 0)).toEqual({ emoji: "💻", text: "Tinkering with a computer" });
    expect(palActivity("byte", 1)).not.toEqual(palActivity("byte", 0));
    expect(palActivity("saiyan", 0).text).toMatch(/power-up/);
    expect(palActivity("sage", 0).text).toMatch(/Reading/);
    expect(PAL_ROOM_MOOD_KEY).toMatch(/playful/);
  });
  it("shows at most three unfinished tasks, giving due items a gentle first position", () => {
    const now = Date.parse("2026-10-30T17:00:00Z");
    const tasks = [
      d("a", "Plan a trip"),
      d("b", "Tomorrow task", { dueDate: "2026-10-31" }),
      d("c", "Pick up kids", { dueDate: "2026-10-30", scheduledAt: Date.parse("2026-10-30T21:00:00Z") }),
      d("d", "Ignored", { done: true }),
      d("e", "Important", { important: true }),
      d("f", "Overdue", { dueDate: "2026-10-28" }),
    ];
    expect(livingBoardTasks(tasks, now, "America/New_York").map(t => t.id)).toEqual(["c", "f", "e"]);
    expect(livingBoardTasks(tasks, now, "America/New_York", 1).map(t=>t.id)).toEqual(["c"]);
    expect(livingBoardTasks([], now, "America/New_York")).toEqual([]);
  });
  it("retains due dates and reminder identifiers without changing source tasks", () => {
    const tasks=[d("one", "Pick up kids", { important: true, reminderId: "abcd1234", reminderAt: Date.parse("2026-10-31T21:00:00Z") })];
    const result = livingBoardTasks(tasks, Date.parse("2026-10-30T17:00:00Z"), "America/New_York");
    expect(result[0]?.reminderId).toBe("abcd1234");
    expect(result[0]?.taskDay).toBe("2026-10-31");
    expect(tasks[0]?.done).toBe(false);
  });
});
