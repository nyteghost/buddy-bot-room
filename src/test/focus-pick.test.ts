import { describe, it, expect } from "vitest";
import { chooseFocusTask, approximateTaskMinutes } from "@/lib/focus-pick";
import type { Todo } from "@/lib/workbench";
const task=(id:string,text:string,extra:Partial<Todo>={}):Todo=>({id,text,at:1,done:false,...extra});
const options={now:Date.parse("2026-10-30T15:00:00Z"),zone:"America/New_York",minutes:15,energy:"low" as const};
describe("Pick for Me",()=>{
  it("prioritizes due/important tasks, skips finished and never modifies data",()=>{
    const tasks=[task("a","Build a swingset"),task("b","Reply to Brian",{important:true}),task("c","Already completed",{done:true}),task("d","Check tomorrow's schedule",{dueDate:"2026-10-30"})];
    expect(chooseFocusTask(tasks,options)?.task.id).toBe("d");
    expect(tasks[3]?.done).toBe(false);
    expect(chooseFocusTask(tasks,{...options,skipIds:["d"]})?.task.id).toBe("b");
  });
  it("selects a small low-energy task over a larger project when neither is urgent",()=>{
    const tasks=[task("a","Build a swingset"),task("b","Check email")];
    expect(chooseFocusTask(tasks,options)?.task.id).toBe("b");
    expect(approximateTaskMinutes("Build furniture")).toBeGreaterThan(approximateTaskMinutes("Reply to mail"));
  });
  it("does not surface future, completed or empty tasks as false urgency",()=>{
    const next=chooseFocusTask([task("x","Mail report",{dueDate:"2026-12-15"}),task("y","",{})],options);
    expect(next?.task.id).toBe("x");
    expect(next?.isDue).toBe(false);
    expect(chooseFocusTask([task("z","Done",{done:true})],options)).toBeNull();
  });
});
