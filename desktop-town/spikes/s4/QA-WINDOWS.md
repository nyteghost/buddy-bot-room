# Windows 11 hardware QA — S4 portable overlay

Do **not** test on employer-managed hardware without written IT approval. Do not bypass SmartScreen,
AppLocker, WDAC or antivirus; record what they do.

For every item, record PASS / FAIL / NOT TESTED, plus:
* device model and Windows build;
* every GPU and its driver, and which GPU drives each monitor;
* monitor layout and per-monitor scaling;
* exact commit SHA and `PixelPals-Portable.zip` SHA-256;
* `Data\s4-last-run.log`, `Data\s4-memory.json`, and screenshots/video.

All helper scripts are read-only apart from `Data\` and ship in the ZIP under `QA\`.
`PixelPals.exe` is a GUI-subsystem program, so read exit codes with
`(Start-Process .\PixelPals.exe -ArgumentList … -Wait -PassThru).ExitCode`.

## Evidence status

| Area | CI runner (windows-2025, WARP, admin, 1024x768 @100 %) | Owner hardware (PP-DT-WIN-HW-001, `24ab26d`) | Still required on hardware |
| --- | --- | --- | --- |
| Portable launch, no installer/admin, Data/ beside exe | PASS (asInvoker manifest, extracted ZIP) | PASS (Documents/OneDrive folder) | standard-user account + SmartScreen/WDAC record |
| D3D12 + DirectComposition PreMultiplied alpha | PASS (WARP) | PASS (Intel integrated) | discrete GPU, other vendors |
| First-frame fail-closed (F5) | PASS (fault injection + external HWND observer) | not run | §1 |
| Transparent-area click-through | not testable | PASS (browser control) | §3 100/100 count, other processes |
| Pal hit-testing while moving | unit tests only | left/right click PASS | §3 30/30 + moving sample |
| Fullscreen hiding | policy unit tests | PASS (YouTube browser fullscreen) | §5 games, exclusive fullscreen, slideshow |
| Persistence across restart / exe replacement | PASS | PASS (restart) | USB, read-only |
| 20 launch/exit cycles | PASS (20/20, no orphans or temp files) | not run | §2 |
| Memory | per-stage report; MemoryUsage 84.7 MiB vs Performance 392.4 MiB private bytes at first frame; 30 s walking soak +0.9 MiB | ~421 MiB Task Manager (Performance-hints build) | §4 re-measure new build + A/B |
| CPU/GPU idle and walking | WARP numbers only (not meaningful) | 0 % at sampled instants | §6 with profile-memory.ps1 |
| Multi-monitor / mixed DPI / hotplug | geometry + placement unit tests | single 3440x1440 @100 % | §7, §8 |
| Gaming FPS / frametime / VRAM | none | none | §10 |
| Integrated vs discrete selection | policy unit tests | Intel integrated selected | §9 |

## 1. First-frame safety (F5)

Keep Notepad open behind the overlay position and screen recording on.
- [ ] `--smoke-test-ms=4000 --qa-fault-first-frame=timeout:never` → exit code **4** within ~3 s.
      Nothing ever appears, and typing and clicking in Notepad are unaffected.
      The log contains `FIRST FRAME FAIL-CLOSED`, and `settings.json` is unchanged.
      Repeat with `lost:never`, `outdated:never` and `fatal:1`.
- [ ] `--qa-fault-first-frame=lost:3` (and `timeout:3`, `outdated:3`) → the Pal appears normally.
      The log shows `first frame presented after 4 attempt(s)`, with no black, white or opaque flash before it.
- [ ] Or run `.\QA\test-portable.ps1 -ExtractedFolder .`; its section 6 automates this with an external observer.

**Pass:** every case behaves as stated. **Fail:** any visible rectangle, any intercepted click, or any other exit code.

## 2. 20 launch/exit cycles

Repeat 20 times:
1. Double-click `PixelPals.exe` and wait until the Pal is visible.
2. Left-click the Pal so it walks, and wait 5 s.
3. Right-click the Pal to exit.
4. Confirm in Task Manager that `PixelPals.exe` is gone.

Optionally, first run `.\QA\test-portable.ps1 -ExtractedFolder .`, which performs 20 automated smoke cycles.

**Pass:**
- 20/20 launches show the Pal within 3 s, and 20/20 right-clicks exit.
- No orphan process, crash dialog, black/opaque rectangle, focus theft or stuck topmost window.
- The Pal's position is restored each time.
- No `.settings-*.tmp` file is left in `Data\`.

**Fail:** any single violation. Record the cycle number and the log.

## 3. Click-through and moving hitboxes

- [ ] **100/100 empty-area clicks:** inside the 640x360 overlay bounds but outside the Pal, click a button in
      another application 100 times. Vary positions, including the 1–3 px ring around the Pal.
      **Pass:** 100/100 reach the underlying app. **Fail:** any click swallowed.
- [ ] **30/30 Pal clicks** on a stationary Pal (ears, body, legs): each logs `PAL_CLICK n`, and the underlying
      app receives none. **Pass:** 30/30.
- [ ] **Moving hitbox:** while the Pal walks, click its body 20 times and the space it just left 20 times.
      **Pass:** body clicks toggle walking (logged), and clicks on the vacated space reach the app underneath.
- [ ] **Focus:** type continuously in Notepad while clicking the Pal 10 times.
      **Pass:** no keystroke is lost, there is no taskbar button, and Alt+Tab never lists Pixel Pals.

## 4. Memory (re-test of the ~421 MiB observation)

Run the A/B and soak commands in PERFORMANCE.md §1, and record Task Manager "Memory" too.
- [ ] Compare `Data\s4-memory-performance.json` with `Data\s4-memory-memoryusage.json`. Report `private_bytes`,
      `private_working_set` and `shared_working_set` at `gpu-device` and `first-frame`, the `gpu_allocator`
      reserved bytes, and `gpu_init_private_mib`.
- [ ] Task Manager "Memory" for the default (MemoryUsage) build after 1 minute idle.
- [ ] Extended stability: a 10-minute walking soak plus a 30-minute interactive attach (`-AttachName PixelPals`).

**Pass:** private working set ≤350 MiB (the PP-DT-001 provisional target), and no sustained upward trend
(`growth_last_minus_first` within a few MiB after the first minute).
**Fail:** above the target, or steady growth across the soak. Report the numbers either way; do not round them to a verdict.

## 5. Fullscreen applications and games

The overlay hides because of an explicit policy, not z-order. The log says
`fullscreen policy: overlay hidden, reason=…`.
- [ ] Browser fullscreen video (YouTube) → hidden within ~0.5 s with `reason=CoversMonitor`, and returns after exit.
- [ ] PowerPoint slideshow / Windows presentation settings → hidden.
- [ ] Borderless-fullscreen game → hidden (`CoversMonitor`).
- [ ] Exclusive-fullscreen game, if one is available → hidden (`ExclusiveD3d`).
- [ ] Wallpaper click and maximised Notepad (with and without an auto-hide taskbar) → **stays visible**.
- [ ] Fullscreen app on a different monitor → the overlay stays visible on its own monitor.
      By design, an exclusive D3D app hides it on every monitor.

**Pass:** every case behaves as stated and logs the stated reason.
**Fail:** the overlay is visible over a fullscreen app, or hidden for an ordinary window.

## 6. CPU and GPU usage, idle and walking

Idle run:
`.\QA\profile-memory.ps1 -Exe .\PixelPals.exe -Arguments '--smoke-test-ms=300000' -Seconds 305`
Walking run: the same command with `'--qa-walk'` added to the arguments.

**Pass:** idle median `cpu_pct_one_core` ≤2 % and walking ≤5 % (PP-DT-001). Report `gpu_3d_pct` (no target) and
GPU dedicated/shared MiB. **Fail:** above target.

Frame pacing: use PresentMon (approved tooling only) while walking. The p95 present interval must be ≤33.3 ms.

Power (optional, approved tools only): compare package/GPU power for desktop idle, S4 idle and S4 walking
(e.g. Windows Settings → System → Power & battery → Battery usage on laptops, or HWiNFO). Report only;
there is no PP-DT-001 power target.

## 7. Multiple monitors

- [ ] `--monitor-index=0` and `--monitor-index=1`, including a monitor left of or above the primary (negative coordinates).

**Pass:** the overlay appears inside the chosen monitor's work area (log line `monitor=… work=… overlay=…@x,y`),
and click-through and hitboxes behave as in §3 on that monitor.

## 8. Mixed DPI and display disconnect/reconnect

- [ ] Test 100 / 125 / 150 / 175 / 200 % where available. Change scaling while running, and move between mixed-DPI
      monitors if possible.
      **Pass:** the Pal's physical size scales, the log shows `DPI change: scale=…`, a 10-click edge sample per part
      registers (§3), and there is no blur, black or opaque area.
- [ ] Unplug and replug the overlay's monitor; sleep/resume; lock/unlock; display off/on.
      **Pass:** no crash, and the overlay ends up on a connected monitor. If presentation fails, it hides
      (`overlay hidden until a frame presents`) and returns only after a fresh frame.

## 9. Integrated vs discrete GPU selection

The log lists every `adapter candidate:` and the `adapter policy=`.
- [ ] Default (`low-power`): record the chosen adapter. Expected: the integrated GPU when one is present.
- [ ] `--gpu-preference=high-performance`: record the chosen adapter. Expected: the discrete GPU when one is present.
- [ ] On a machine whose monitor is wired to the discrete GPU, compare both preferences using §4, §6 and §10.
      An integrated adapter may need a cross-adapter copy by DWM.

**Pass:** the selection matches the documented policy, and both modes stay transparent and click-through.
Recommend a default only from these measurements.

## 10. Gaming FPS, frametime and VRAM

Pick one approved game and repeat each run 3 times:
- (a) no Pixel Pals;
- (b) Pixel Pals idle on another monitor, or hidden by the fullscreen policy;
- (c) Pixel Pals walking on a non-game monitor.

Record, for both GPU preferences:
- average FPS and 1 % low FPS;
- frametime p95 (PresentMon or the game's own tool);
- dedicated VRAM (Task Manager, or `gpu_dedicated_mib` from profile-memory).

**Pass:** average FPS loss ≤3 % and 1 %-low loss ≤5 % compared with (a) (PP-DT-001).
**Fail:** above those limits, or the overlay visible over the game.

## 11. Portability and security (unchanged)

- [ ] Standard user: no UAC prompt; Task Manager "Elevated" = No; no services, Run keys or scheduled tasks.
- [ ] Read-only `Data\`, USB, exe replacement and corrupt settings behave as documented in README.md.
- [ ] The archive and `Data\` contain no passwords, tokens or account data.

## Handoff

Provide the SHA, ZIP hash, filled checklist, logs, JSON/CSV files, screenshots/video and a recommendation to PM.
No Phase 1 integration until an explicit PM/owner gate.
