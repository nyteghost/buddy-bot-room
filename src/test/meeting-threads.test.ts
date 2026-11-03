import { describe, expect, it } from "vitest";
import { matchingExcerpt, parseThreadInput, validMeetingThreadLink } from "@/lib/meeting-threads";
const id="e6d9db14-4a7a-477a-95a1-ff3c5d2dd422";
describe("Meeting Threads pure permission and search helpers",()=>{
  it("only accepts bounded explicit owner thread labels",()=>{
    expect(parseThreadInput(" Weekly planning ","showpilot")).toEqual({thread:"Weekly planning",project:"showpilot"});
    expect(parseThreadInput("", "showpilot")).toBeNull();
    expect(parseThreadInput("Thread","../outside")).toBeNull();
    expect(parseThreadInput("T".repeat(81),"")).toBeNull();
    expect(parseThreadInput("Thread\nSecond","")).toBeNull();
    const link={meetingId:id,thread:"Weekly planning",project:"showpilot",revision:1,
      linkedAt:"2026-11-02T10:00:00Z",updatedAt:"2026-11-02T10:00:00Z",source:"owner-reviewed"};
    expect(validMeetingThreadLink(link)).toBe(true);
    expect(validMeetingThreadLink({...link,project:"../outside"})).toBe(false);
  });
  it("only returns matching approved text and a bounded context excerpt",()=>{
    expect(matchingExcerpt("lantern","Other title","No mention","Blue Lantern is the project.")).toContain("Blue Lantern");
    expect(matchingExcerpt("not present","Other title","No mention","Blue Lantern")).toBeNull();
    expect(matchingExcerpt("blue lantern","Other","Summary","Blue Lantern")).toContain("Blue Lantern");
    expect(matchingExcerpt("","Planning","Summary text","Raw long transcript")).toBe("Summary text");
  });
});
