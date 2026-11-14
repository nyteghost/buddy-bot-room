import { FrameScheduler, PerfMetrics, TownSimulation, type PerfSnapshot } from './core';
import { CanvasTownRenderer } from './renderer';
import './style.css';
declare global { interface Window { s2Perf?: () => PerfSnapshot & { running: boolean; targetFps: number } } }
const canvas = document.querySelector<HTMLCanvasElement>('#town');
const toggle = document.querySelector<HTMLButtonElement>('#toggle');
const status = document.querySelector<HTMLElement>('#status');
const result = document.querySelector<HTMLElement>('#result');
if (!canvas || !toggle || !status || !result) throw new Error('S2 page markup missing');
const sim = new TownSimulation(), renderer = new CanvasTownRenderer(canvas), perf = new PerfMetrics();
let rafRequests = 0; let inactiveRequests = 0;
let benchmarkTimer: ReturnType<typeof setTimeout> | undefined;
const scheduler = new FrameScheduler(cb => { rafRequests++; return requestAnimationFrame(cb) }, cancelAnimationFrame, (dt, t) => {
  sim.step(dt); const start = performance.now(); renderer.render(sim.snapshot()); const cost = performance.now() - start; perf.record(t, cost); return cost;
});
function resize(): void { renderer.resize(innerWidth, innerHeight, devicePixelRatio); renderer.render(sim.snapshot(), true) }
function setWalking(walk: boolean): void {
  if (walk && !document.hidden) scheduler.start(); else scheduler.stop();
  toggle!.textContent = scheduler.running ? 'Pause Pal' : 'Walk Pal';
  status!.textContent = scheduler.running ? 'Walking — adaptive 30/60 FPS' : 'Idle — zero scheduled animation frames';
}
toggle.addEventListener('click', () => setWalking(!scheduler.running));
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => { if (document.hidden) { setWalking(false); } });
window.addEventListener('pagehide', () => { scheduler.stop(); if (benchmarkTimer) clearTimeout(benchmarkTimer); renderer.dispose() });
window.s2Perf = () => ({ ...perf.snapshot(inactiveRequests), running: scheduler.running, targetFps: scheduler.targetFps });
resize(); setWalking(false);
// Explicit benchmark mode is the only use of a timer; normal idle has no scheduler or polling.
const params = new URLSearchParams(location.search);
if (params.has('benchmark')) {
  const mode = params.get('benchmark');
  const seconds = Math.max(1, Math.min(1800, Number(params.get('seconds') || 60)));
  if (mode !== 'walk' && mode !== 'idle') throw new Error('benchmark must be walk or idle');
  perf.reset(); rafRequests = 0;
  setWalking(mode === 'walk');
  const start = performance.now();
  benchmarkTimer = setTimeout(() => {
    setWalking(false);
    // Never claim OS CPU/PSS/GPU from JavaScript; those come from the Linux sampler.
    const payload = { mode, durationMs: performance.now() - start, ...perf.snapshot(mode === 'idle' ? rafRequests : inactiveRequests), renderer: 'canvas2d', userAgent: navigator.userAgent, pixelRatio: devicePixelRatio, viewport: [innerWidth, innerHeight] };
    result!.textContent = JSON.stringify(payload, null, 2);
    result!.hidden = false;
    console.info('S2_BENCHMARK_RESULT', payload);
  }, seconds * 1000);
}
