import { describe, expect, it } from "vitest";
import { ALL_MODES, type Mode } from "@/lib/agents";
import { MY_PALS_MODES, PAL_LOUNGE_MODES, activateChatMode, activeChatMode, chatRoomForMode, closeChatRoom, isChatRoomOpen, suggestAssist } from "@/lib/chat-room-layout";
const empty = () => Object.fromEntries(ALL_MODES.map((m) => [m, false])) as Record<Mode, boolean>;
describe("two room conversation navigation", () => {
  it("keeps all modes and their histories reachable via two rooms", () => {
    expect([...MY_PALS_MODES, ...PAL_LOUNGE_MODES].sort()).toEqual([...ALL_MODES].sort());
    expect(chatRoomForMode("solve")).toBe("my-pals");
    expect(chatRoomForMode("debate")).toBe("pal-lounge");
  });
  it("switches sub-modes without closing the other room", () => {
    let x = activateChatMode(empty(), "smart");
    x = activateChatMode(x, "roundtable");
    x = activateChatMode(x, "direct");
    expect(isChatRoomOpen(x, "my-pals")).toBe(true);
    expect(isChatRoomOpen(x, "pal-lounge")).toBe(true);
    expect(activeChatMode(x, "my-pals")).toBe("direct");
    expect(x.smart).toBe(false);
    expect(x.roundtable).toBe(true);
    x = closeChatRoom(x, "pal-lounge");
    expect(x.direct).toBe(true);
    expect(isChatRoomOpen(x, "pal-lounge")).toBe(false);
  });
  it("recommends a deliberate action, never executes a task from chat text", () => {
    expect(suggestAssist("I'm overwhelmed and can't start")).toBe("just-start");
    expect(suggestAssist("Remind me to pick up the kids tomorrow at 5")).toBe("brain-dump");
    expect(suggestAssist("Have all my Pals discuss this")).toBe("lounge");
    expect(suggestAssist("What is a deadline?")).toBeNull();
    expect(suggestAssist("/remind tomorrow 9am test")).toBeNull();
  });
});
