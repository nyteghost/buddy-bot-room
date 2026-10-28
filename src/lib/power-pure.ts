/** The decision logic behind power.ts, free of React so it can be tested on its own. */
/** In low-power mode background polling waits this many times longer. */
export const LOW_POWER_POLL_FACTOR = 3;
export const LOW_POWER_TICK_FACTOR = 4;

/** Delay for a decorative timer right now, or null when it should not run at all (tab hidden). */
export function tickDelay(baseMs: number, state: { hidden: boolean; lowPower: boolean }): number | null {
  if (state.hidden) return null;
  return state.lowPower ? baseMs * LOW_POWER_TICK_FACTOR : baseMs;
}

/** How many of the newest messages are drawn at once in a long chat. Older ones stay in the chat (and in saved copies) behind a "show earlier" button. */
export const CHAT_WINDOW = 60;
export function chatSlice<T>(messages: readonly T[], shown: number): { items: readonly T[]; hidden: number } {
  const n = Math.max(CHAT_WINDOW, shown);
  return messages.length <= n ? { items: messages, hidden: 0 } : { items: messages.slice(messages.length - n), hidden: messages.length - n };
}
