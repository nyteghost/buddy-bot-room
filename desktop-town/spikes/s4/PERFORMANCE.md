# S4 Performance Measurement Plan — results PENDING

**No measured CPU, GPU, RAM or frame pacing values are available.** The app optionally writes Data/s4-render-sample.json after exit with CPU-side render/submission/present *call duration only*. This is NOT GPU duration, end-to-end frame latency, actual FPS or gaming contention. Do not use it to claim acceptance.

1. On an authorized clean Windows 11 host, record build SHA, ZIP SHA256, OS version, CPU, GPU/driver, display refresh, RAM, monitor topology and per-monitor DPI. Disconnect the network for the offline scenario.
2. Collect 30 or more sample points for the no-PixelPals baseline, then 5-minute PixelPals idle and 5-minute active walking. Record sampling interval, tools and whether CPU % is per process or per logical core. Use Windows Task Manager/Performance Monitor (or approved equivalent) for working set, private bytes, GPU engine %, dedicated GPU memory.
3. Record true present-to-present frame intervals and p95 (e.g. approved PresentMon tooling). Observe full desktop idle and walking frame scheduling, screenshot any black or opaque overlay.
4. Compare GPU utilization/memory and game FPS (average, 1% lows) with and without S4, including borderless and exclusive fullscreen where permitted. Report whether fullscreen hiding succeeded. Log the selected wgpu D3D12/Vulkan/GL backend.
5. Include results at 100%, 125%, 150%, 175%, 200% scaling when hardware supports them and per-monitor physical coordinates.

| Metric | Desktop baseline | S4 idle | S4 walking | Result |
| --- | --- | --- | --- | --- |
| CPU % (defined basis) | TBD | TBD | TBD | NOT TESTED |
| GPU utilization % | TBD | TBD | TBD | NOT TESTED |
| Private working set MiB | TBD | TBD | TBD | NOT TESTED |
| GPU dedicated MiB | TBD | TBD | TBD | NOT TESTED |
| Present interval p95 ms | TBD | N/A if no frames | TBD | NOT TESTED |
| Measured FPS | TBD | N/A if suspended | TBD | NOT TESTED |

Zero measurements may be filled only with actual device logs; failure is a useful spike result. A native D3D12 swapchain that rejects non-opaque alpha is not a pass.
