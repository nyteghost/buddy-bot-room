// NOTE: run with `npx tsx scripts/bench-polling.mts` (src uses extensionless imports).
// Polling benchmark. Run: npx tsx scripts/bench-polling.mts
// One hour of an open Pixel Pals tab where the tab is visible for 15 minutes and in the background for 45, and Ollama is switched off.
// Counts requests from the real startPolling against the old behaviour (a plain setInterval). Fake clock, fake requests.
import { startPolling, type PollEnv } from "../src/lib/poll.ts";
function sim(visibleMin: number, fn: (env: PollEnv, task: () => Promise<boolean>, ms: number) => void, taskOk: boolean, ms: number) {
  let t = 0, id = 0, hidden = false; const timers = new Map<number, { at: number; fn: () => void }>(); const vis: (() => void)[] = [];
  const env: PollEnv = { now: () => t, hidden: () => hidden, setTimeout: (f, d) => { timers.set(++id, { at: t + d, fn: f }); return id; }, clearTimeout: (h) => { timers.delete(h as number); }, onVisible: (f) => { vis.push(f); return () => undefined; } };
  let requests = 0;
  fn(env, async () => { requests++; return taskOk; }, ms);
  return { run: async () => {
    const end = 3600_000;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    hidden = false;
    for (;;) {
      const nx = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!nx || nx[1].at > end) break;
      timers.delete(nx[0]); t = nx[1].at;
      const wasHidden = hidden; hidden = t >= visibleMin * 60_000;
      if (wasHidden !== hidden && !hidden) vis.forEach((v) => v());
      nx[1].fn(); for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    return requests;
  } };
}
const oldPoll = (env: PollEnv, task: () => Promise<boolean>, ms: number) => { void task(); const tick = () => { void task(); env.setTimeout(tick, ms); }; env.setTimeout(tick, ms); };
const newPoll = (maxMs?: number) => (env: PollEnv, task: () => Promise<boolean>, ms: number) => { startPolling(task, ms, { env, ...(maxMs ? { maxMs } : {}) }); };
const cases: [string, number, boolean, number | undefined][] = [["Ollama status probe, Ollama OFF (5 s)", 5000, false, 60_000], ["Ollama status probe, Ollama ON (5 s)", 5000, true, 60_000], ["Phone captures + task sync (60 s each)", 60_000, true, undefined], ["Mail/Unraid summary (5 min)", 300_000, true, undefined]];
const rows = ["poller | OLD requests/hour | NEW requests/hour"];
for (const [name, ms, ok, max] of cases) {
  rows.push(`${name} | ${await sim(60, oldPoll, ok, ms).run()} | ${await sim(15, newPoll(max), ok, ms).run()}`);
}
console.log("tab visible 15 min, hidden 45 min (OLD ignores visibility, so its count is the same either way)");
console.log(rows.join("\n"));
