import { useEffect, useRef, useSyncExternalStore } from "react";
import { boolPref } from "./prefs";
import { tickDelay } from "./power-pure";
export { CHAT_WINDOW, LOW_POWER_POLL_FACTOR, LOW_POWER_TICK_FACTOR, chatSlice, tickDelay } from "./power-pure";

/**
 * Keeping the app light when nobody is looking at it, and an optional low-power mode for phones and laptops on battery.
 *  - While the tab is hidden, decorative timers (pals walking around, rotating speech lines, countdown redraws) stop; they catch up once on return.
 *  - Low-power mode (opt in, `/lowpower`) slows those timers down, pauses purely decorative looping animations and polls the server less often.
 *    Streaming replies, the "thinking" indicator and every feature work exactly the same.
 */
export const LOWPOWER_KEY = "pixel-pals-lowpower-v1";
export const lowPower = boolPref(LOWPOWER_KEY, false);
/** In low-power mode background polling waits this many times longer. */

const subscribeVisible = (l: () => void) => {
  document.addEventListener("visibilitychange", l);
  return () => document.removeEventListener("visibilitychange", l);
};
/** True while the tab is hidden or minimised. */
export const useTabHidden = (): boolean => useSyncExternalStore(subscribeVisible, () => document.visibilityState === "hidden", () => false);

/** Like setInterval for decorative updates: stops while the tab is hidden, slows down in low-power mode, and fires once when you come back. */
export function useCalmInterval(callback: () => void, baseMs: number, enabled = true, slowInLowPower = true): void {
  const hidden = useTabHidden();
  const low = lowPower.use();
  const saved = useRef(callback);
  saved.current = callback;
  const delay = enabled ? tickDelay(baseMs, { hidden, lowPower: low && slowInLowPower }) : null;
  useEffect(() => {
    if (delay === null) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
  const wasHidden = useRef(hidden);
  useEffect(() => {
    if (wasHidden.current && !hidden && enabled) saved.current();
    wasHidden.current = hidden;
  }, [hidden, enabled]);
}

/** Mirrors the state on <html> so CSS can pause animations (data-hidden, data-lowpower). Call once near the top of the app. */
export function usePowerAttributes(): void {
  const hidden = useTabHidden();
  const low = lowPower.use();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset["hidden"] = hidden ? "1" : "0";
    root.dataset["lowpower"] = low ? "1" : "0";
  }, [hidden, low]);
}


/** Becomes true the first time `value` is true and stays true (used to load a window's code only once it has been opened). */
export function useEverTrue(value: boolean): boolean {
  const seen = useRef(false);
  if (value) seen.current = true;
  return seen.current;
}
