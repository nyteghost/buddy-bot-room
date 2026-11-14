# S4 Performance and Memory — findings, method, and pending hardware results

## 1. Memory footprint investigation (owner report PP-DT-WIN-HW-001: ~421 MiB)

### Source-level explanation

The overlay's own resources are tiny: a 640x360 BGRA swapchain (about 0.9 MiB per buffer, up to 3
buffers), one 1.1 KiB vertex buffer and one pipeline. The large figure came from **wgpu's D3D12
suballocator defaults**, not from the Pal:

* wgpu-hal maps `MemoryHints::Performance` (the wgpu default) to gpu-allocator's default
  `AllocationSizes`: a **256 MiB device-memory block and a 64 MiB host-visible block**.
  `MemoryHints::MemoryUsage` maps to 8 MiB / 4 MiB blocks.
* The first internal wgpu buffer and our vertex buffer each cause one block of each type to be
  created as a D3D12 heap. On an **integrated GPU those heaps are system RAM** (UMA), charged to the process.
* Driver and runtime DLLs (D3D12, DXGI, DirectComposition, the GPU user-mode driver, FXC) add a
  separate, driver-dependent baseline.

The prototype now requests `MemoryHints::MemoryUsage`. The overlay allocates only a few KiB, so
smaller blocks cost no measurable rendering performance. Use `--qa-memory-hints=performance` to
reproduce the old behaviour for A/B comparison.

Other checks made while investigating (details in §3):
* **Per-frame buffer creation removed.** One persistent vertex buffer is rewritten with
  `queue.write_buffer`.
* **No idle render loop.** Frames are drawn only on state change.
* **No retained staging or readback resources.**
* **Shutdown releases the device.** The final memory sample confirms the event-loop closure (and with
  it the wgpu device) was dropped (`gpu_released_before_final_sample=true`).
* **Not a leak.** The owner's two Task Manager readings were flat, and the CI soak tripwire (below)
  passes. The memory was a one-time reservation at device creation.

### Measurements available so far (GitHub `windows-2025` runner, WARP software adapter)

These are **CI-runner numbers, not the owner's Intel GPU**. WARP keeps "GPU" heaps in process memory,
so it shows the suballocator effect directly.

| Stage (private bytes, MiB) | `Performance` hints (old default) | `MemoryUsage` hints (new default) |
| --- | --- | --- |
| process start → wgpu adapter | 1.6 → 3.7 | 1.7 → 3.8 |
| after `request_device` | **391.0** (+387.3) | **82.4** (+78.6) |
| first frame presented | **392.4** | **84.7** |
| wgpu suballocator reserved at first frame | **320 MiB** | **12 MiB** |
| private working set at first frame | 5 | 6 |

The heaps were committed but mostly untouched on WARP, so private *bytes* moved far more than the
private *working set*. Task Manager's "Memory" column is the private working set. Whether the Intel
driver makes those heap pages resident (zeroing them would) is **unknown until measured on the owner's
machine**. The before/after on real hardware is the first item in the procedure below.

### Reproducible profiling method

Every normal run now writes, with no extra flags:
* `Data/s4-memory.json`: private bytes, working set, private working set (Task Manager "Memory")
  and peak working set at each stage: `process-start`, `event-loop`, `window`, `gpu-instance`,
  `gpu-surface`, `gpu-adapter`, `gpu-device`, `gpu-surface-configured`, `gpu-pipeline`, `first-frame`,
  `exit`, and `after-event-loop` (after the GPU device is released). It also records wgpu's own
  suballocator report (reserved and allocated bytes, block sizes), the adapter list and the memory hints.
* `Data/s4-last-run.log`: a one-line per-stage summary and the GPU-initialisation delta.

For sampling over time, use the read-only `QA\profile-memory.ps1` shipped in the ZIP. It needs no
admin rights and is locale-independent (it uses CIM performance classes). It separates:

| Column | Meaning |
| --- | --- |
| `private_bytes_mib` | commit charge private to the process |
| `private_ws_mib` | Task Manager "Memory" (private working set) |
| `working_set_mib` | includes shared DLL pages |
| `gpu_dedicated_mib` / `gpu_shared_mib` | GPU Process Memory counters (video memory, and system memory used by the GPU) |
| `cpu_pct_one_core` | CPU as % of ONE logical core |
| `gpu_3d_pct` | 3D engine utilisation |

```powershell
cd <extracted>\PixelPals-Portable
Unblock-File .\QA\*.ps1          # only if Windows marks the downloaded scripts as blocked
# A/B, 60 s each, idle (Pal not walking):
.\QA\profile-memory.ps1 -Exe .\PixelPals.exe -Arguments '--smoke-test-ms=60000','--qa-memory-hints=performance' -Seconds 65 -SummaryPath .\Data\ab-performance.json
copy .\Data\s4-memory.json .\Data\s4-memory-performance.json
.\QA\profile-memory.ps1 -Exe .\PixelPals.exe -Arguments '--smoke-test-ms=60000' -Seconds 65 -SummaryPath .\Data\ab-memory.json
copy .\Data\s4-memory.json .\Data\s4-memory-memoryusage.json
# Walking soak, 10 minutes:
.\QA\profile-memory.ps1 -Exe .\PixelPals.exe -Arguments '--smoke-test-ms=600000','--qa-walk' -Seconds 610 -WarmupSeconds 10 -SummaryPath .\Data\soak.json
# Normal interactive use, attach for 30 minutes:
.\QA\profile-memory.ps1 -AttachName PixelPals -Seconds 1800 -SummaryPath .\Data\interactive.json
```

Attach `Data\*.json`, the CSVs printed in the summaries, and `Data\s4-last-run.log` to the QA report.

## 2. Memory categories — what each number is

| Category | Where it comes from in S4 | How to see it |
| --- | --- | --- |
| **Private committed bytes** | wgpu D3D12 suballocation heaps (main item; see §1), wgpu/driver CPU-side state, Rust heap | `private_bytes` per stage in `s4-memory.json`; `private_bytes_mib` in profile-memory |
| **Private working set** (Task Manager "Memory") | the resident part of the above | `private_working_set` per stage; `private_ws_mib` |
| **Shared working set** | resident DLL images: D3D12, DXGI, DirectComposition, GPU user-mode driver, FXC, winit/Win32 | `shared_working_set` per stage (= working set − private working set); `shared_ws_mib` |
| **wgpu initialisation** | private-bytes delta `window → first-frame` (logged as `MEM wgpu/driver initialisation`) | `gpu_init_private_mib` in `s4-memory.json` |
| **DirectX 12 heaps** | wgpu allocator report: reserved vs allocated bytes and block sizes | `gpu_allocator` in `s4-memory.json` |
| **Surface / swapchain** | 640x360 BGRA8 × (latency + 1) buffers = 1.76 MiB at 100 % (7.03 MiB at 200 %); in GPU/shared memory, not private bytes | `swapchain_estimate_bytes` (estimate); `gpu_shared_mib` / `gpu_dedicated_mib` |
| **GPU-local / shared GPU memory** | swapchain, heaps placed in video memory | `gpu_dedicated_mib`, `gpu_shared_mib` (GPU Process Memory counters) |

## 3. Rendering efficiency and power — decisions

| Topic | Current behaviour | Decision and reason |
| --- | --- | --- |
| Idle rendering | No frames while idle (CI: 2 frames in 10 s idle) | Keep. Redraw only on state change, resize or DPI change. |
| Paused / hidden | Hidden overlay: no animation ticks, no frames; probe slows to 1 Hz | Keep. Unit-tested in `schedule.rs`. |
| Frame pacing (walking) | 33 ms timer tick → one redraw → `Fifo` present | Keep. About 30 fps; Fifo never tears and blocks at most one vblank. Present-interval p95 must be measured with PresentMon on hardware. |
| Swapchain depth | **Changed** from `desired_maximum_frame_latency` 2 to **1** (3 → 2 buffers) | On-demand ≤30 fps rendering gains nothing from a second queued frame. This saves one buffer (0.9 MiB at 100 %) and a frame of latency. |
| GPU submissions | One submit per presented frame; one `write_buffer` of ≤1.1 KiB; no per-frame buffer creation | Keep. Allocation churn was removed in the previous revision. |
| Buffers/textures | 1 vertex buffer, swapchain images only; no staging or readback resources retained | Keep. |
| Fullscreen probe | 2 Hz while visible, 1 Hz while hidden | Keep polling. An event hook on foreground change would miss in-place fullscreen (YouTube resizes its existing window). A location-change hook fires system-wide on every window/cursor move, which would cost more wake-ups than the poll. |
| Working-set trimming (`EmptyWorkingSet`) | not used | **Rejected.** It only moves pages to standby and makes Task Manager look smaller, at the cost of page faults. It does not reduce commit. |
| Shutdown | Event-loop closure (device, surface, window) dropped before the final sample; `gpu_released_before_final_sample=true` in CI | Keep. Verified by the CI check `gpu-objects-released-on-exit`. |

Power consumption itself (package power, GPU power state) was **not measured**. It needs hardware tools
(e.g. Windows Energy usage, HWiNFO or Intel Power Gadget, as approved). The wake-up bounds above are the
software-side input to that measurement: ≤2 wake-ups/s idle, ≤1/s hidden, ≤32/s walking.

`Data/s4-render-sample.json` holds CPU-side render+submit+present call durations only. These are not
GPU time, FPS or present-to-present pacing.

## 4. Hardware results table (fill only from real device logs)

Budgets are the provisional PP-DT-001 Phase 0 targets, not new targets.

| Metric | Desktop baseline | S4 idle | S4 walking | PP-DT-001 target | Result |
| --- | --- | --- | --- | --- | --- |
| CPU % of one logical core | — | TBD | TBD | idle ≤2 %, walking ≤5 % | NOT TESTED |
| Shared working set MiB (driver/runtime DLLs) | — | TBD | TBD | report | NOT TESTED |
| Private working set MiB (Task Manager) | — | TBD (`MemoryUsage`) / ~421 (`Performance`, owner) | TBD | ≤350 MiB | PENDING re-test |
| Private bytes MiB | — | TBD | TBD | report | NOT TESTED |
| GPU dedicated / shared MiB | TBD | TBD | TBD | report delta | NOT TESTED |
| GPU 3D engine % | TBD | TBD | TBD | report | NOT TESTED |
| Present interval p95 ms (PresentMon) | — | N/A (no frames) | TBD | ≤33.3 ms | NOT TESTED |
| Game avg FPS / 1 % low loss | TBD | TBD | TBD | ≤3 % / ≤5 % | NOT TESTED |

A failure is a valid spike result. Do not fill rows from CI-runner numbers.
