# S4 Performance Measurement Plan — hardware results PENDING

**No hardware CPU, GPU, RAM or frame-pacing values exist yet.** The CI runner uses the WARP software
rasterizer on a virtual machine, so its timings are meaningless for budgets.

What CI does show (behavioural, not a budget): a 4-second idle smoke run presents only the initial frame(s)
(`frames_presented` in `Data/s4-smoke.json` stays in single digits), i.e. there is no continuous render loop
while the Pal is idle.

`Data/s4-render-sample.json` (written on exit) contains CPU-side render+submit+present call durations only.
It is NOT GPU time, end-to-end latency, FPS or game contention and must not be used for acceptance.

## Procedure (authorized clean Windows 11 host)

1. Record build SHA, ZIP SHA-256, Windows build, CPU, GPU + driver, refresh rate, RAM, monitor topology and
   per-monitor DPI, and the `backend=`/`adapter=` line from `Data/s4-last-run.log`. Disconnect the network
   for the offline scenario.
2. Collect ≥30 samples each for: desktop baseline (no S4), S4 idle 5 min, S4 walking 5 min (left-click the Pal
   again whenever it reaches the end). State the sampling interval, tool, and whether CPU % is per process
   or per logical core. Use Task Manager / Performance Monitor (or approved equivalent) for CPU, private
   working set, GPU engine %, dedicated GPU memory.
3. Present-to-present intervals and p95 with approved tooling (e.g. PresentMon) for idle and walking.
4. Game contention (if permitted): average FPS and 1% lows with and without S4 in borderless and exclusive
   fullscreen; note whether S4 hid itself.
5. Repeat key rows at 100/125/150/175/200 % where hardware allows.

| Metric | Desktop baseline | S4 idle | S4 walking | Budget (PP-DT-001) | Result |
| --- | --- | --- | --- | --- | --- |
| CPU % (one logical core basis) | TBD | TBD | TBD | idle ≤2 %, walking ≤5 % | NOT TESTED |
| Private working set MiB | TBD | TBD | TBD | ≤350 MiB | NOT TESTED |
| GPU utilisation % / dedicated MiB delta | TBD | TBD | TBD | report delta | NOT TESTED |
| Present interval p95 ms | TBD | N/A (no frames) | TBD | ≤33.3 ms | NOT TESTED |
| Walking FPS | — | — | TBD | ≥30 fps | NOT TESTED |
| Game avg FPS / 1 % low loss | TBD | TBD | TBD | ≤3 % / ≤5 % | NOT TESTED |

Only real device logs may fill this table; a failure is a valid spike result. A swapchain that only offers
opaque alpha is a FAIL, not a pass.
