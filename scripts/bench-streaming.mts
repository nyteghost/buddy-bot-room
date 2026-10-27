// Streaming write benchmark. Run: node --experimental-strip-types scripts/bench-streaming.mts
// Models one streamed reply (token every 25 ms for 1200 tokens ~ 30 s) on top of short, medium and long chat histories and counts
// how many UI state updates and localStorage saves the old behaviour (every token) and the new one (throttled + debounced) cause.
// Serialization time is measured for real (JSON.stringify on this machine); counts come from the simulated clock.
import { createThrottle, type Clock } from "../src/lib/stream-throttle.ts";
import { createDebouncedSaver } from "../src/lib/debounced-save.ts";

function fakeClock() {
  let t = 0, id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = { now: () => t, setTimeout: (fn, ms) => { timers.set(++id, { at: t + ms, fn }); return id; }, clearTimeout: (h) => { timers.delete(h as number); } };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); t = next[1].at; next[1].fn();
    }
    t = end;
  };
  return { clock, advance };
}
const msg = (i: number) => ({ id: `m${i}`, role: i % 2 ? "assistant" : "user", parts: [{ type: "text", text: "x".repeat(1500) }], metadata: { agentId: "a", round: 1 } });
const TOKENS = 1200, GAP = 25;
const rows: string[] = ["history | tokens | OLD updates | OLD saves | OLD MB serialized | OLD stringify ms | NEW updates | NEW saves | NEW MB serialized | NEW stringify ms"];
for (const [label, n] of [["short (4 msgs)", 4], ["medium (40)", 40], ["long (400)", 400]] as const) {
  const history = Array.from({ length: n }, (_, i) => msg(i));
  const chatBytes = JSON.stringify(history).length;
  const cost = (() => { const s = performance.now(); for (let i = 0; i < 20; i++) JSON.stringify(history); return (performance.now() - s) / 20; })();
  // OLD: every token is a state update and every update re-serializes all chats.
  const oldUpdates = TOKENS, oldSaves = TOKENS;
  // NEW
  const { clock, advance } = fakeClock();
  let updates = 0, saves = 0;
  const saver = createDebouncedSaver(() => { saves++; }, 500, 2000, clock);
  const th = createThrottle<number>(() => { updates++; saver.schedule(); }, 50, clock);
  for (let i = 1; i <= TOKENS; i++) { th.push(i); advance(GAP); }
  th.flush(); saver.flush();
  const mb = (c: number) => ((c * chatBytes) / 1e6).toFixed(1);
  rows.push(`${label} | ${TOKENS} | ${oldUpdates} | ${oldSaves} | ${mb(oldSaves)} | ${(oldSaves * cost).toFixed(0)} | ${updates} | ${saves} | ${mb(saves)} | ${(saves * cost).toFixed(0)}`);
}
console.log(rows.join("\n"));
