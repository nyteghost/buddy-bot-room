# S2 — isolated Canvas 2D desktop performance spike

**Authority:** PP-DT-001 to PP-DT-004, Issue #37. **Base:** `099f0698bddc494a5cdfd819f0d32944a766e341`. **Scope:** `desktop-town/spikes/s2/**` only. NOT Pixel Pals production, NOT the final rendering architecture.

## What this tests

A separate Tauri 2 executable bundles a local Vite-built frontend. Canvas 2D draws a deliberately tiny isometric town with procedural animated Pal; a transparent window and transparent canvas permit a composited desktop background (subject to compositor). A single simulation owns scene state and exposes renderer-neutral `Scene`, `Actor`, and `SceneRenderer` interfaces, for eventual wgpu comparison. Static geometry is cached on a separate transparent canvas; moving Pal damage regions are cleared/restored and repainted. No re-render occurs with the Pal stopped. Walking uses capped deltas and adaptive 60/30 FPS. No fetch, AI integration, credential storage, plugin permission, or IPC command is present.

**This is a regular Tauri top-level window, NOT a Wayland layer-shell/click-through overlay.** Free roaming and precise hitboxes belong to S1/S4; transparent content alone does not provide click-through. Windows ZIP portability is a Phase 1/S4 acceptance gate, NOT validated by S2. This prototype must not be claimed to pass those gates.

## Reproduce on CachyOS / KDE Plasma / NVIDIA

1. Install a compatible Tauri 2 Linux toolchain, GTK3/WebKitGTK development libraries, Rust stable and Node 20+. From this directory run `npm install` and `npm run typecheck && npm test && npm run build`.
2. Run `cd src-tauri && cargo fmt --check && cargo check && cargo clippy --all-targets -- -D warnings && cargo test`, return to this directory, then `npm run tauri:dev`. Observe transparent exterior (no opaque window background) and try **Walk Pal / Pause Pal**.
3. To collect **walking** metrics, launch `npm run tauri:dev` with the webview URL parameter `?benchmark=walk&seconds=60` (e.g. temporarily set Tauri `devUrl` to `http://127.0.0.1:14222/?benchmark=walk&seconds=60`, without committing that change). Capture `S2_BENCHMARK_RESULT` from WebKit Inspector after 60 seconds, or copy the JSON shown in the bottom left. For **idle**, use `?benchmark=idle&seconds=60`. `idleRafRequests` must be `0`.
4. For each phase, identify the **Tauri app process**, not the Vite server: `pgrep -af pixel-pals-desktop-s2`. Run `python3 scripts/measure_linux.py --pid <TAURI_PID> --phase idle --seconds 60 --output measurements/idle.json` (repeat with `walk`). Include the Tauri process and recursive child WebKit processes; no external inference services are included. `smaps_rollup` access must be available for complete PSS. Inspect `missingPss` before asserting memory acceptance.
5. For soak: launch with `?benchmark=walk&seconds=1800`, run `python3 scripts/measure_linux.py --pid <TAURI_PID> --phase soak --seconds 1800 --output measurements/soak.json`. Check nonzero exit, WebKit errors (`journalctl --user`, stderr), system logs, and screenshots. Confirm that all child processes survive as expected for 30 min. Set UI to idle afterward.
6. Record OS and display stack: `echo "$XDG_CURRENT_DESKTOP $XDG_SESSION_TYPE"; nvidia-smi; kscreen-doctor -o`. Repeat on an NVIDIA-enabled system and, if available, compare integrated GPU. Make sure no game or heavy external AI load contaminates measurements. The `nvidia-smi` sampled values are **system-wide**, not attributable to the Tauri process; collect an idle baseline and delta and state competing GPU loads.

For comparable release-mode GPU/memory numbers, use `npm run build && npm run tauri:build` and profile the generated executable. Do not treat floating dependency versions as a pinned reproducible build: generate and commit a lockfile on a package-connected machine before formal QA, record `node --version`, `npm --version`, `cargo --version`, `webkit2gtk-driver` / WebKitGTK package versions and exact source SHA.

## Acceptance table (requires on-device evidence)

| Gate | Target | Evidence | Initial state |
|---|---|---|---|
| Idle CPU | ≤2% **one logical core** | sampler `cpuMeanOneLogicalCorePercent`, plus peak | UNMEASURED |
| Total PSS | ≤350 MiB for Tauri + WebKit process tree | sampler `pssPeakMiB`, `missingPss=false` | UNMEASURED |
| Walking FPS | ≥30 rendered FPS | WebKit `S2_BENCHMARK_RESULT.fps` | UNMEASURED |
| Walking p95 frame interval | ≤33.3ms | `p95FrameIntervalMs` | UNMEASURED |
| No continuous idle RAF | 0 requests while idle | Vitest scheduler; `idleRafRequests=0` | Source designed; device untested |
| Transparent window | No persistent opaque area | KDE desktop screen capture | UNTESTED |
| 30m soak | No WebKit crashes | 1800-second process samples + logs | UNTESTED |
| GPU cost | Measure delta, not pretend zero | `nvidia-smi` baseline vs phase | UNMEASURED |

**Do not report device gates PASS based on a development/browser smoke.** WebKitGTK, KDE compositor, NVIDIA and real PSS cannot be validated in a headless Chromium test. CPU metric is sample-window average of one core, not overall CPU%; startup excluded by waiting for UI idle before measurement. `fps` counts actual renders and `p95FrameIntervalMs` is distinct from CPU draw time.

## Independent Performance QA handoff

Review exact branch/commit, changed-path isolation, no remote-origin/IPC regression, TypeScript + Vitest, Rust check/clippy/test, direct window alpha screenshots, idle 60s, walking 60s and full 30m soak on owner KDE/NVIDIA, before any acceptance claim. Re-run from a clean checkout on pinned SHA. Separately compare wgpu on S4 on Windows 11 and ensure renderer is replaceable without rewriting scene simulation. Fail if over budget after optimization; keep PR draft, never merge or deploy without PM/owner approval.
