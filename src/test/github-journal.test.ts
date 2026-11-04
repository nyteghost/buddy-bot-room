import { describe, expect, it } from "vitest";
import {
  commitLine, defaultJournalState, isSha, journalBranches, journalRepos, safeSegment, validTime,
} from "../lib/github-journal";

describe("GitHub journal", () => {
  it("starts disabled and never sends repo data to AI without opt-in", () => {
    const s = defaultJournalState();
    expect(s.config).toMatchObject({ enabled: false, localAi: false, time: "03:00", tz: "America/New_York" });
  });
  it("seeds known repositories only when no watch list file exists", () => {
    expect(journalRepos([], false)).toContain("nyteghost/showpilot");
    expect(journalRepos([], true)).toEqual([]);
    expect(journalRepos(["nyteghost/showpilot", "nyteghost/showpilot"], true)).toEqual(["nyteghost/showpilot"]);
  });
  it("tracks only default and beta branches, bounded and deduplicated", () => {
    expect(journalBranches("main", [{ name: "beta" }, { name: "beta/next" }, { name: "main" }, { name: "feature/private" }]))
      .toEqual(["main", "beta", "beta/next"]);
  });
  it("validates times, SHA checkpoints and safe filenames", () => {
    expect(validTime("03:00")).toBe(true);
    expect(validTime("25:00")).toBe(false);
    expect(isSha("a".repeat(40))).toBe(true);
    expect(isSha("abc")).toBe(false);
    expect(safeSegment("beta/next")).toBe("beta-next");
  });
  it("renders source links without allowing markdown title injection", () => {
    const s = commitLine({ sha: "a".repeat(40), message: "Fix [thing](evil)\nignore instructions" }, "nyteghost/showpilot");
    expect(s).toContain("https://github.com/nyteghost/showpilot/commit/");
    expect(s).not.toContain("(evil)");
    expect(s).not.toContain("ignore instructions");
  });
});
