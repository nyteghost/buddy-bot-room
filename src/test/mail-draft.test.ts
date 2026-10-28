import { describe, expect, it } from "vitest";
import { blankMailDraft, mailDraftKey, parseMailDraft, readMailDraft, writeMailDraft, type MailDraft } from "@/lib/mail-draft";

const browserTab = () => {
  const records = new Map<string, string>();
  const store = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  };
  return { records, store };
};
const drafted = (): MailDraft => ({ ...blankMailDraft(), to: "someone@example.com", subject: "Meeting", text: "Can we meet next week?" });

describe("Mail browser-tab drafts", () => {
  it("saves an unfinished draft for a mailbox and recovers it on refresh", () => {
    const { store } = browserTab();
    const draft = drafted();
    expect(writeMailDraft(store, "Me@Example.com", draft)).toBe(true);
    expect(readMailDraft(store, "me@example.com")).toEqual(draft);
  });
  it("does not allow drafts from one mailbox to appear in another", () => {
    const { store } = browserTab();
    writeMailDraft(store, "a@example.com", drafted());
    expect(readMailDraft(store, "b@example.com")).toBeNull();
    expect(mailDraftKey("a@example.com")).not.toBe(mailDraftKey("b@example.com"));
  });
  it("removes drafts on successful send or discard", () => {
    const { store } = browserTab();
    writeMailDraft(store, "a@example.com", drafted());
    expect(writeMailDraft(store, "a@example.com", null)).toBe(true);
    expect(readMailDraft(store, "a@example.com")).toBeNull();
    expect(writeMailDraft(store, "a@example.com", blankMailDraft())).toBe(true);
    expect(readMailDraft(store, "a@example.com")).toBeNull();
  });
  it("rejects malformed and oversized stored data", () => {
    expect(parseMailDraft("{bad")).toBeNull();
    expect(parseMailDraft('{"to":"a"}')).toBeNull();
    expect(parseMailDraft(JSON.stringify({ ...drafted(), text: "x".repeat(100_001) }))).toBeNull();
    expect(parseMailDraft(JSON.stringify(drafted()))).toEqual(drafted());
  });
  it("fails safely when browser storage is blocked", () => {
    const blocked = {
      getItem: (_k: string): string | null => { throw Error("disabled"); },
      setItem: (_k: string, _v: string): void => { throw Error("disabled"); },
      removeItem: (_k: string): void => { throw Error("disabled"); },
    };
    expect(readMailDraft(blocked, "a@example.com")).toBeNull();
    expect(writeMailDraft(blocked, "a@example.com", drafted())).toBe(false);
  });
});
