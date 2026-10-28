import { describe, expect, it } from "vitest";
import { CHAT_WINDOW, LOW_POWER_TICK_FACTOR, chatSlice, tickDelay } from "../lib/power-pure";
import { startPolling, type PollEnv } from "../lib/poll";
import { parseSlash } from "../lib/slash-commands";

describe("decorative timers", () => {
  it("stop while hidden, slow down in low-power mode", () => {
    expect(tickDelay(160, { hidden: false, lowPower: false })).toBe(160);
    expect(tickDelay(160, { hidden: false, lowPower: true })).toBe(160 * LOW_POWER_TICK_FACTOR);
    expect(tickDelay(160, { hidden: true, lowPower: false })).toBeNull();
    expect(tickDelay(160, { hidden: true, lowPower: true })).toBeNull();
  });
});

describe("long chats", () => {
  const list = Array.from({ length: 200 }, (_, i) => i);
  it("draws everything for a short chat", () => {
    expect(chatSlice([1, 2, 3], 0)).toEqual({ items: [1, 2, 3], hidden: 0 });
    expect(chatSlice(list.slice(0, CHAT_WINDOW), 0).hidden).toBe(0);
  });
  it("draws only the newest messages of a long chat and says how many are hidden", () => {
    const s = chatSlice(list, 0);
    expect(s.items.length).toBe(CHAT_WINDOW);
    expect(s.items.at(-1)).toBe(199);
    expect(s.hidden).toBe(200 - CHAT_WINDOW);
  });
  it("shows more when asked, never fewer than the window, never more than exist", () => {
    expect(chatSlice(list, 120).items.length).toBe(120);
    expect(chatSlice(list, 5).items.length).toBe(CHAT_WINDOW);
    expect(chatSlice(list, 9999)).toEqual({ items: list, hidden: 0 });
  });
});

describe("polling scale and /lowpower", () => {
  it("multiplies the wait between polls in low-power mode", () => {
    const waits: number[] = [];
    let fire: (() => void) | undefined;
    const env: PollEnv = { now: () => 0, hidden: () => false, setTimeout: (fn, ms) => { waits.push(ms); fire = fn; return 1; }, clearTimeout: () => undefined, onVisible: () => () => undefined, scale: () => 3 };
    const stop = startPolling(async () => true, 1000, { env, immediate: false });
    expect(waits).toEqual([3000]);
    stop();
    void fire;
  });
  it("parses the command", () => {
    expect(parseSlash("/lowpower on")).toEqual({ ok: true, action: { type: "lowpower", on: true } });
    expect(parseSlash("/lowpower off")).toEqual({ ok: true, action: { type: "lowpower", on: false } });
    expect(parseSlash("/lowpower")).toEqual({ ok: true, action: { type: "lowpower", on: null } });
    expect(parseSlash("/lowpower maybe")).toMatchObject({ ok: false });
  });
});
