import { describe, expect, it } from "vitest";
import { resolveMention } from "@/lib/agents";

describe("@mentions", () => {
  it("@calendar targets Sage only", () => expect(resolveMention("@calendar lunch Friday 1pm", "linux")).toBe("sage"));
  it("@gmail targets Nova", () => expect(resolveMention("@gmail summarize inbox", "assistant")).toBe("nova"));
  it("@terminal targets Tux", () => expect(resolveMention("@terminal fix pacman", "linux")).toBe("claude"));
  it("themed names work", () => expect(resolveMention("@neo hi", "matrix")).toBe("nova"));
  it("no mention means everyone", () => expect(resolveMention("hello all", "linux")).toBeNull());
});
