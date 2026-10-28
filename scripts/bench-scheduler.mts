// NOTE: run with `npx tsx scripts/bench-scheduler.mts` (src uses extensionless imports).
// Scheduler benchmark. Run: npx tsx scripts/bench-scheduler.mts
// A slow model answer (scaled: 600 ms stands for 60 s) runs while the 30 s tick keeps firing (scaled: every 30 ms).
// Measures when the reminders check gets to run and how many copies of the slow job run at once. Uses the real job runner.
import { createJobRunner } from "../src/lib/job-runner.ts";
const wait = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const SLOW = 600, TICK = 30;

async function old() {
  let active = 0, peak = 0, ticks = 0; const reminderStarts: number[] = []; const t0 = performance.now();
  const tick = async () => { // previous behaviour: sequential awaits, no overlap guard
    ticks++; active++; peak = Math.max(peak, active);
    await wait(SLOW); // tickSchedules awaiting the model
    reminderStarts.push(performance.now() - t0);
    active--;
  };
  const timer = setInterval(() => { void tick(); }, TICK);
  await wait(TICK * 25); clearInterval(timer); await wait(SLOW + 50);
  return { ticks, peak, firstReminder: Math.round(reminderStarts[0] ?? 0), reminders: reminderStarts.length };
}
async function now() {
  const r = createJobRunner();
  let active = 0, peak = 0, ticks = 0; const reminderStarts: number[] = []; const t0 = performance.now();
  const tick = async () => {
    ticks++;
    void r.run("schedules", async () => { active++; peak = Math.max(peak, active); await wait(SLOW); active--; }, { timeoutMs: 5000 });
    await r.run("reminders", async () => { reminderStarts.push(performance.now() - t0); }, { timeoutMs: 1000 });
  };
  const timer = setInterval(() => { void r.run("scheduler-tick", tick, { timeoutMs: 5000 }); }, TICK);
  await wait(TICK * 25); clearInterval(timer); await wait(SLOW + 50);
  return { ticks, peak, firstReminder: Math.round(reminderStarts[0] ?? 0), reminders: reminderStarts.length };
}
console.log("OLD ", JSON.stringify(await old()));
console.log("NEW ", JSON.stringify(await now()));
