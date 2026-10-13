import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDiscussions, writeDiscussions, savedDiscussionsKey, type SavedDiscussion } from "@/lib/saved-discussions";
const fixture: SavedDiscussion = { id: "test-discussion", title: "A shared quest", theme: "finalfantasy", mode: "solve", updatedAt: new Date().toISOString(), messages: [{ id: "message", role: "user", parts: [{ type: "text", text: "Plan a garden" }] }] };
describe("browser-only saved discussions", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  it("reopens saved snapshots with theme, discussion mode and all messages", () => {
    writeDiscussions([fixture]);
    expect(readDiscussions()).toEqual([fixture]);
    expect(localStorage.getItem("pixel-pals-conversation-v1")).toBeNull();
  });
  it("supports multiple independent discussions and deletion", () => {
    writeDiscussions([fixture, { ...fixture, id: "second", title: "Second" }]);
    writeDiscussions(readDiscussions().filter(row => row.id !== fixture.id));
    expect(readDiscussions().map(row => row.id)).toEqual(["second"]);
  });
  it("does not overwrite malformed saved data", () => {
    localStorage.setItem(savedDiscussionsKey, '[{"id":"broken"}]');
    expect(() => readDiscussions()).toThrow("Existing data has not been changed");
    expect(localStorage.getItem(savedDiscussionsKey)).toBe('[{"id":"broken"}]');
  });
  it("reports quota failures instead of claiming success", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => writeDiscussions([fixture])).toThrow("Browser storage is full or unavailable");
  });
});