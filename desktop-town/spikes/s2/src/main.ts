import { FrameScheduler, PerfMetrics, TownSimulation, VisibilityGate, type PerfSnapshot } from './core';
import { CanvasTownRenderer } from './renderer';
import './style.css';

declare global { interface Window { s2Perf?: () => PerfSnapshot & { running: boolean; targetFps: number; actorCount: number } } }
const canvas = document.querySelector<HTMLCanvasElement>('#town');
const toggle = document.querySelector<HTMLButtonElement>('#toggle');
const status = document.querySelector<HTMLElement>('#status');
const result = document.querySelector<HTMLElement>('#result');
if (!canvas || !toggle || !status || !result) throw new Error('S2 page markup missing');
const params = new URLSearchParams(location.search);
const requestedCount = Number(params.get('actors') ?? '1');
if (!Number.isSafeInteger(requestedCount) || requestedCount < 0 || requestedCount > 128) throw new RangeError('actors must be 0..128');
const sim = new TownSimulation(requestedCount), renderer = new CanvasTownRenderer(canvas), perf = new PerfMetrics();
const simulationEpoch = performance.now();
function currentScene() { sim.seek(Math.max(0, performance.now() - simulationEpoch)); return sim.snapshot(); }
let rafRequests = 0;
let idleRafRequests = 0;
let benchmarkTimer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const scheduler = new FrameScheduler(
  cb => { rafRequests++; return requestAnimationFrame(cb); },
  id => cancelAnimationFrame(id),
  (dt, t) => {
    // The synthetic world is an absolute-time source: renderer visibility does not own its clock.
    sim.seek(Math.max(0, t - simulationEpoch)); const start = performance.now();
    const drawn = renderer.render(sim.snapshot());
    const cost = performance.now() - start;
    if (drawn) perf.record(t, cost);
    return cost;
  }
);
const gate = new VisibilityGate(scheduler);
gate.setVisible(!document.hidden);
function resize(): void { if (disposed) return; renderer.resize(innerWidth, innerHeight, devicePixelRatio); renderer.render(currentScene(), true); }
function syncStatus(): void {
  toggle!.textContent = gate.wantsWalking ? 'Pause Pal' : 'Walk Pal';
  status!.textContent = scheduler.running ? `Walking ${sim.count} Pals — adaptive 30/60 FPS` : gate.wantsWalking ? 'Hidden — drawing suspended, will resume' : 'Idle — zero scheduled animation frames';
}
function setWalking(walk: boolean): void { gate.setWanted(walk); syncStatus(); }
toggle.addEventListener('click', () => setWalking(!gate.wantsWalking));
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (disposed) return;
  gate.setVisible(!document.hidden);
  if (!document.hidden) resize(); // restore after compositor/WebKit content loss
  syncStatus();
});
window.addEventListener('pageshow', event => { if (event.persisted && disposed) location.reload(); });
window.addEventListener('pagehide', () => {
  disposed = true; gate.setWanted(false); if (benchmarkTimer !== undefined) clearTimeout(benchmarkTimer);
  renderer.dispose(); window.s2Perf = undefined;
}, { once: true });
window.s2Perf = () => ({ ...perf.snapshot(idleRafRequests), running: scheduler.running, targetFps: scheduler.targetFps, actorCount: sim.count });
resize(); setWalking(false);

// Explicit benchmark mode uses one timer; normal idle has no timers or animation callbacks.
if (params.has('benchmark')) {
  const mode = params.get('benchmark');
  const seconds = Number(params.get('seconds') ?? '60');
  if (mode !== 'walk' && mode !== 'idle') throw new Error('benchmark must be walk or idle');
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 1800) throw new RangeError('seconds must be 1..1800');
  perf.reset(); rafRequests = 0;
  setWalking(mode === 'walk');
  const start = performance.now();
  benchmarkTimer = setTimeout(() => {
    gate.setWanted(false);
    if (mode === 'idle') idleRafRequests = rafRequests;
    syncStatus();
    const payload = {
      mode, durationMs: performance.now() - start, ...perf.snapshot(idleRafRequests),
      actorCount: sim.count, renderer: 'canvas2d', userAgent: navigator.userAgent,
      pixelRatio: devicePixelRatio, viewport: [innerWidth, innerHeight],
      note: 'p95 covers last 4096 intervals; FPS spans all draws. OS CPU/PSS/GPU measured externally.'
    };
    result!.textContent = JSON.stringify(payload, null, 2);
    result!.hidden = false;
    console.info('S2_BENCHMARK_RESULT', payload);
  }, seconds * 1000);
}
