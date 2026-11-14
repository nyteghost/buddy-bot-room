# Pixel Pals — S2 rendering benchmark / independent QA

**Safety boundary:** This is a Phase-0 rendering feasibility experiment from immutable beta `099f0698bddc494a5cdfd819f0d32944a766e341`, isolated under `desktop-town/spikes/s2/**`. It is **not production**, **not** the layer-shell overlay and **not** a final Canvas-versus-wgpu decision. Nothing installs to Unraid, Strata or the Pixel Pals web app.

## What is included

- Bundled local Tauri 2 + Vite Canvas renderer; a transparent undecorated top-level window (not click-through).
- One immutable input `Scene` contract, `staticRevision` to invalidate tile cache, independent synthetic `TownSimulation.seek(elapsedMs)` for absolute-time motion (does not depend on renderer lifecycle). Scene changes must increment `revision`, and ground/building changes must increment `staticRevision`.
- Actors have stable IDs, world-space coordinates, facing, stride and sprite color. The renderer computes local screen projection and painter depth and never modifies world state. Hitboxes, overlay windows, input capture, AI and voice are intentionally absent.
- Isometric ground in a transparent offscreen tile cache; moving Pal damage is restored in bounded clipped regions; scene-building and actors are painted back-to-front per world-depth. Ground/building shadows, transparent sprite edges and multiple synthetic walking actors (0 to 128, default 1).
- Dynamic 60/30 FPS scheduler, zero animation RAF requests while paused/idle, visibility suspension with previously requested walking restored when visible, and capped frame deltas for imperative stepping. Absolute-time synthetic scene resumes from current elapsed time after hide; there is no hidden animation timer.
- Single timer only in explicit 60-second or 1800-second benchmark mode; bounded timing series (last 4096 samples) and cumulative actual render FPS. `window.s2Perf()` is optional developer-console inspector; no network/IPC services.
- Standalone `scripts/offline-test.mjs` node:test suite, `scripts/test_measure_linux.py` telemetry checks, plus Vitest core and Canvas mock tests. Linux `scripts/measure_linux.py` reads the Tauri process-tree `/proc` CPU and PSS and labels the NVIDIA GPU measurement **system-wide**.

## Reproducible clean build — steps and current blockers

**Prerequisites (CachyOS / Arch):** Rust stable with Cargo and rustfmt/clippy, Node.js ≥22.6 plus npm, Python 3.11+, C/C++ toolchain, `pkgconf`, GTK3, WebKitGTK 4.1 development headers, Ayatana appindicator, librsvg, libxdo, OpenSSL headers, patchelf and NVIDIA tools. Confirm package names on the owner's current CachyOS repositories rather than blindly installing; a plausible base is:

```sh
sudo pacman -Syu
sudo pacman -S --needed base-devel nodejs npm python rustup pkgconf gtk3 webkit2gtk-4.1 libayatana-appindicator librsvg libxdo openssl patchelf
rustup default stable
rustup component add rustfmt clippy
```

Verify `pkg-config --modversion gtk+-3.0 webkit2gtk-4.1`, `node -v`, `npm -v`, `rustc -V`, `cargo -V`, `nvidia-smi`. Linux GUI execution requires an actual Plasma/Wayland graphical session. A headless GitHub Actions runner can compile but does **not** satisfy NVIDIA/KDE acceptance.

From repository root:

```sh
cd desktop-town/spikes/s2
# One-time maintainer lockfile generation on a network-connected build environment:
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
(cd src-tauri && cargo generate-lockfile)
# IMPORTANT: have independent reviewer inspect and commit BOTH exact lockfiles
# before running the frozen CI/QA build.
npm ci
npm run typecheck
npm test
npm run test:offline
python3 -B scripts/test_measure_linux.py
npm run build
(cd src-tauri && cargo fmt --all -- --check)
(cd src-tauri && cargo check --locked)
(cd src-tauri && cargo clippy --locked --all-targets -- -D warnings)
(cd src-tauri && cargo test --locked)
npm run tauri:build
```

**Current limitation:** `package-lock.json` and `src-tauri/Cargo.lock` cannot be generated or reviewed in the developer's disconnected runtime. The repository's unrelated root `bun.lock` and `src-tauri/Cargo.lock` are **not substitutes**. `npm ci` correctly fails without a matching lockfile. The isolated CI definition is staged at `ci/s2-renderer.yml.example`; placing it in `.github/workflows/` is out of S2's authorized path and explicitly requires PM approval. The existing root CI does not build or test S2. **Do not mark reproducible build/CI PASS until an S2-targeted run succeeds on exact locked SHA.**

## Owner-run benchmark (Linux KDE Plasma 6 / Wayland / NVIDIA)

From the S2 directory, run `npm run tauri:dev`. This opens **S2 only** with a transparent window (press Alt+F4 to close; it does not install a service). Click **Set count** (1 / 8 / 16 / 32 / 64 / 128) to choose scaling. Then use **Idle 60s**, **Walk 60s** or **Soak 30m**. Each action loads the same local bundled prototype in a known benchmark mode and prints structured `S2_BENCHMARK_RESULT` JSON to the visible panel and WebKit Inspector console.

In a second terminal:

```sh
echo "$XDG_CURRENT_DESKTOP $XDG_SESSION_TYPE"
nvidia-smi
kscreen-doctor -o
# Use ACTUAL Tauri executable PID, not npm, vite or shell:
pgrep -af 'pixel-pals-desktop-s2'
# Substitute the PID found above. Start sampler immediately before clicking the selected benchmark button:
python3 scripts/measure_linux.py --pid <TAURI_PID> --phase idle --seconds 60 --output measurements/idle-1.json
python3 scripts/measure_linux.py --pid <TAURI_PID> --phase walk --seconds 60 --output measurements/walk-1.json
python3 scripts/measure_linux.py --pid <TAURI_PID> --phase soak --seconds 1800 --output measurements/soak-1.json
```

Repeat for 8/16/32/64/128 synthetic actors; use a separate set of files for each actor count. **Important:** sample the stable process after startup and during the matching UI phase. If a Tauri app is restarted, re-identify PID. The sampler recursively enumerates WebKit helper children, reports mean/peak CPU as % of **one logical core**, peak PSS in MiB, process-exit status, and GPU utilization / VRAM from `nvidia-smi`. `missingPss=true` invalidates PSS acceptance. NVIDIA utilization/VRAM numbers are **system totals**, not app-attributed: capture a GPU baseline before the run, note competing jobs, compute deltas rather than claim an absolute per-app number.

Collect for each run: visible JSON, Python JSON, `nvidia-smi` baseline, `journalctl --user`/WebKit stderr for crashes, and screenshot showing real desktop behind the town and no persistent black rectangle. Take an extra screenshot at fractional scale (e.g. 150%) and after fullscreen-window entry/exit, if possible. Verify a fullscreen game hides or allows the normal window appropriately; **do not assume this standard Tauri window is an overlay**. Capture actual fullscreen behavior and frame continuity. For the 30-minute soak, record process PID changes/crashes and PSS growth. If the app or WebKit renderer crashes, fail stability even if the root process survives.

The **rendering JSON** reports drawn frame count, overall FPS, p95 interval/draw cost for the **most recent 4096 frames**, and idle RAF requests (must be zero). The **Linux sampler** reports actual OS telemetry separately. A 30-minute soak does not create a giant JS timing array. For reproducibility include the SHA, monitor/scale mode, package versions, WebKitGTK version, GPU driver, compositor state and background workload. `measurements/` is gitignored.

## Acceptance and distinction between evidence types

| Gate | Target | Required evidence | Current status |
|---|---|---|---|
| Clean frontend install/build | `npm ci`, `tsc`, Vitest, Vite PASS from committed lock | Isolated CI or owner console | BLOCKED: no lockfile |
| Rust build | fmt/check/clippy/test PASS with `--locked` | Linux CI console | BLOCKED: no toolchain/lock |
| Independent offline tests | All node:test cases PASS | npm-free Node 22 console | Pending exact-source rerun |
| Idle CPU | ≤2% of one logical core | process-tree mean after warmup | UNMEASURED |
| Application PSS | ≤350 MiB excl. AI | complete process-tree `smaps_rollup` peak | UNMEASURED |
| Walking FPS | ≥30 rendered frames/s | benchmark JSON for 1 and scaling matrix | UNMEASURED |
| p95 frame interval | ≤33.3 ms | benchmark JSON, 4096-frame window | UNMEASURED |
| Idle rendering | 0 scheduled animation frames | offline/Vitest + 60s device JSON | Source implemented; device untested |
| Window transparency | no persistent opaque/black rectangle | real KDE/NVIDIA screenshots | UNTESTED |
| Stability | no WebKit crashes in 1800s | process samples and logs | UNTESTED |
| Fullscreen behavior | safe / documented | real fullscreen test and screenshot | UNTESTED |
| GPU/VRAM cost | baseline/delta reported | NVIDIA system telemetry + process caveats | UNMEASURED |

**Stop/go:** This is a source-only performance spike pending independent QA. Gate G0 needs exact locked builds, reproducible automated tests and measured physical device acceptance. Do not merge into beta/main or deploy.

## Renderer-neutral architecture assessment and PR #48 coordination

S2 `Scene` is a read-only **presentation snapshot** with numerical isometric world coordinates and actor identity/motion; `SceneRenderer` handles `resize/render/dispose` and never owns simulation, user input, AI or voice. The synthetic simulation is local to the spike and **must not be copied to S4**. S4 Rust/wgpu should consume a platform-independent serializable scene protocol at a later architecture gate, not duplicate this synthetic implementation. The present TS interfaces cannot cross the Rust boundary without a versioned data schema; recommend PM later authorize a shared contract with protocol version, stable actor IDs, fixed coordinate units, static/dynamic revisions, monotonic timestamps, sprite atlas descriptors, hitbox and pointer event messages, and renderer-neutral measurement semantics. Keep native desktop/overlay, hit-test and input permissions outside render data and outside the AI/voice service.

The Canvas 2D engine needs on-device measurement against PR #48's wgpu prototype before a permanent renderer choice. Do not modify PR #48, S1 PR #46, the original Tauri wrapper, or authoritative engine.

## Independent Performance QA handoff

1. Fetch exact S2 SHA; verify diff is *only* `desktop-town/spikes/s2/**` and PR stays draft.
2. Resolve and independently review lockfiles on an approved connected machine; PM approves activation of isolated CI workflow if needed.
3. Run the complete frozen frontend/Rust matrix, Vitest, independent Node smoke, and the Linux app.
4. Measure 60s idle, 60s walking at 1/8/16/32/64/128, 30m soak, alpha/fractional scaling and fullscreen. Capture actual logs/screenshots and fail any missing PSS/telemetry or crash.
5. Compare wgpu and Canvas with identical scene/protocol after the separate shared-interface gate, then issue a clearly labeled PASS/FAIL/UNTESTED report to Issue #37. No hardware results may be inferred from CI success.
