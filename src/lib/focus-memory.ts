import type { FocusSession } from "./focus-companion";
import { makeMemoryProposal } from "./second-brain";

/** Reviewable summary only; no conversation transcript or automatic vault write. */
export function focusMemoryProposal(session: FocusSession) {
  return makeMemoryProposal({
    category: "Focus Sessions", title: session.task.slice(0, 100), source: "task-progress", sensitive: true,
    body: `Task: ${session.task}\n\nCompleted steps:\n${session.completed.length ? session.completed.map(step => "- " + step).join("\n") : "- None recorded yet"}\n\nNext small step (${session.stepNumber}): ${session.step}`,
  });
}
