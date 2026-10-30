import type { Todo } from "./workbench";
export type TaskBucket = "Work" | "Home" | "People" | "Health" | "Other";
export function categorizeTask(text: string): TaskBucket {
  if (/\b(work|shift|schedule|show|event|email|report|project|deadline|meeting|spreadsheet|office|client)\b/i.test(text)) return "Work";
  if (/\b(kids?|family|friend|call|birthday|message|visit|pickup|pick up)\b/i.test(text)) return "People";
  if (/\b(gym|exercise|workout|doctor|dentist|medication|walk|sleep|water)\b/i.test(text)) return "Health";
  if (/\b(clean|cook|shop|groceries|laundry|dishes|repair|house|home|trash|swingset)\b/i.test(text)) return "Home";
  return "Other";
}
export function isDuplicateTask(todos: readonly Todo[], title: string, dueDate?: string): boolean {
  const normalized = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return todos.some(t => !t.done && normalized(t.text) === normalized(title) && (t.dueDate ?? "") === (dueDate ?? ""));
}
