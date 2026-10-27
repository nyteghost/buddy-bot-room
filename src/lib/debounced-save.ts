import type { Clock } from "./stream-throttle";

/** Saves after things go quiet (delay), but never waits longer than maxWait while changes keep arriving,
 *  so a long streamed reply is still saved every couple of seconds. flush() writes at once (tab hidden, unmount). */
export function createDebouncedSaver(save: () => void, delay: number, maxWait: number, clock: Clock) {
  let timer: unknown = null;
  let firstDirty = 0;
  const fire = () => { timer = null; firstDirty = 0; save(); };
  return {
    schedule() {
      const now = clock.now();
      if (!firstDirty) firstDirty = now;
      if (timer !== null) clock.clearTimeout(timer);
      timer = clock.setTimeout(fire, Math.max(0, Math.min(delay, firstDirty + maxWait - now)));
    },
    flush() { if (timer === null) return; clock.clearTimeout(timer); fire(); },
    cancel() { if (timer !== null) clock.clearTimeout(timer); timer = null; firstDirty = 0; },
    get dirty() { return timer !== null; },
  };
}
