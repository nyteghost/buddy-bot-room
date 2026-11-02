import { expect, it } from "vitest";
import { appEntry } from "@/lib/app-entry";
it("opens Today for home and unrelated query parameters", () => {
  expect(appEntry("")).toBe("today");
  expect(appEntry("?q=plan+my+day")).toBe("today");
});
it("preserves explicit chat and saved workspace destinations", () => {
  expect(appEntry("?chat=1")).toBe("chat");
  expect(appEntry("?workspace=1")).toBe("workspace");
  expect(appEntry("?chat=1&workspace=1")).toBe("chat");
});
