import { it, expect } from "vitest";
import { assignMomentSpeaker, transcriptMoments } from "@/lib/transcript-moments";
it("recognizes bounded timestamp estimates without treating plain transcript text as timestamps", () => {
  expect(transcriptMoments("[00:03:01.250 - 00:03:03.500] Hello")[0]?.start).toBe(181.25);
  expect(transcriptMoments("Mention [00:00:00 - 00:01:00] time")).toEqual([]);
  expect(transcriptMoments("[00:04:00 - 00:03:00] Invalid")).toEqual([]);
});
it("changes only the explicitly selected speaker annotation and preserves timestamps and speech", () => {
  const text = "[00:00:01 - 00:00:05] Hello\n[00:00:05 - 00:00:08] Goodbye";
  const changed = assignMomentSpeaker(text, 0, "Alex");
  expect(changed).toContain("[00:00:01 - 00:00:05] {Speaker: Alex} Hello");
  expect(changed.split("\n")[1]).toBe(text.split("\n")[1]);
  expect(assignMomentSpeaker(changed, 0, "Sam")).not.toContain("Alex");
  expect(assignMomentSpeaker(text, 10, "Sam")).toBe(text);
});
