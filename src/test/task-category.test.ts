import { expect, it } from "vitest";
import { categorizeTask, isDuplicateTask } from "@/lib/task-category";
import type { Todo } from "@/lib/workbench";
it("organizes without inventing due dates or making new tasks",()=>{
 expect(categorizeTask("Finish work schedule")).toBe("Work");
 expect(categorizeTask("Pick up Kids")).toBe("People");
 expect(categorizeTask("Clean kitchen")).toBe("Home");
 const list:Todo[]=[{id:"1",text:"Pick up kids",done:false,at:1,dueDate:"2026-10-31"}];
 expect(isDuplicateTask(list,"pick-up KIDS", "2026-10-31")).toBe(true);
 expect(isDuplicateTask(list,"pick up kids","2026-11-01")).toBe(false);
 expect(list).toHaveLength(1);
});
