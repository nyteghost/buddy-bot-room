import { describe, expect, it } from "vitest";
import { focusMemoryProposal } from "@/lib/focus-memory";
describe("reviewable Focus Assist continuity", () => {
  it("includes the checkpoint and completed steps as an unsaved, sensitive proposal", () => {
    const proposal = focusMemoryProposal({ task: "Write a report", step: "Write one sentence", completed: ["Open a document"], stepNumber: 2, mode: "quiet", pal: "echo" });
    expect(proposal.category).toBe("Focus Sessions");
    expect(proposal.body).toContain("- Open a document");
    expect(proposal.body).toContain("Next small step (2): Write one sentence");
    expect(proposal.sensitive).toBe(true);
  });
});
