# S1 — Native KDE Wayland click-through overlay (RESEARCH SPIKE)

**Do not merge, deploy, or install on a production machine.** Standalone GTK4
layer-shell experiment on the immutable `beta` baseline `099f0698bddc494a5cdfd819f0d32944a766e341`.
No Tauri/WebKit, app IPC, permissions, network, user data, Unraid or AI provider usage.

## What is implemented

- One transparent, layer-shell surface per selected monitor. **Top** layer by
  default for visible desktop roaming; optional **bottom** layer for a lower
  z-order experiment. Four edge anchors, `exclusive_zone=0`, **no keyboard
  focus**, no desktop window enumeration or input grab.
- Moving blue circle representing a Pal; Cairo input region recomputed from
  scanlines of its *current* circular hitbox on every motion tick. The rest of
  the screen must pass pointer events to underlying windows. An unobtrusive
  home marker does **not** intercept clicks. Each Pal click prints
  `S1_PAL_CLICK monitor=… count=…`; unexpected events print
  `S1_SPURIOUS_CLICK` (FAIL).
- Input region starts empty until allocation and is never set to `None`
  (`None` would make the entire overlay interactive). Empty opaque region;
  transparent CSS/window/canvas; bounded 5-minute default auto-exit.
- Opt-in `--all-monitors` gives each output a separate surface. Output
  hotplug **terminates the process** to release all regions rather than
  attempting unvalidated live coordinate remapping.
- No layer-shell, no Wayland, or no supported GDK input regions:
  **normal small town-only fallback window**, never an opaque fullscreen
  overlay. `--require-overlay` deliberately exits nonzero for QA automation.

This does **not** establish integration with Tauri or a cross-platform
windowing abstraction. Windows 11 portable overlays require a separate Win32
spike. `wgpu` can replace the art renderer later, but cannot supply window
placement, input regions or compositor layering itself.

## Installation on CachyOS / Arch (owner-controlled test only)

```bash
sudo pacman -S --needed base-devel rust pkgconf gtk4 gtk4-layer-shell python tk
cd desktop-town/spikes/s1
bash qa/environment.sh | tee s1-environment.log
cargo generate-lockfile
cargo fmt --all -- --check
cargo check --locked
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo run --locked -- --seconds 300 --speed 4 --layer top
```

If `gtk4-layer-shell` is not packaged for this exact system, install it
using your approved system package or the upstream project instructions; do
not bypass the input-region guard. Requires Rust >=1.93 (the binding version
requires it), GTK4 and `gtk4-layer-shell` C library and a KDE Wayland session.
Verify commands print `S1_READY` rather than `S1_SAFE_FALLBACK`. If fallback
appears, **do not** count desktop-roaming tests as a pass.

Manual quick modes:

```bash
cargo run --locked -- --town-only                # safe, normal window
cargo run --locked -- --seconds 300 --speed 0 --layer top
cargo run --locked -- --seconds 90 --speed 4 --layer bottom
cargo run --locked -- --seconds 90 --all-monitors --layer top
cargo run --locked -- --seconds 90 --require-overlay
```

**If the screen goes opaque or clicks are blocked, kill this process from a
separate terminal or TTY** (`pkill -f '^target/debug/pixel-pals-s1-kwin-overlay'`
if appropriate). When necessary, switch to another TTY with Ctrl+Alt+F3 and
terminate the process. Do not proceed to fullscreen or gaming trials until
ordinary desktop clicks are demonstrably safe.

## Reproducible owner QA matrix

Write every observation in `qa/evidence/s1-device-results.md` (a local
untracked file), with GPU/driver, KWin/Plasma version, session, monitor modes,
scale, S1 SHA, stdout logs and screenshot/recording filenames. **No
hardware claims can be made without physical device evidence.**

| Gate | Test sequence | Pass threshold |
| --- | --- | --- |
| Gate 0 | `qa/environment.sh`, `cargo check`, `cargo clippy`, `cargo test`, `S1_READY` | All exit successfully; native protocol verified |
| 1 — pass-through | Launch `python3 qa/underlay_click_counter.py`, *then* overlay `--speed 0 --layer top --seconds 600`. Click each of 100 numbered cells once **outside** Pal; watch console | Exactly **100/100** underlying clicks; no `S1_SPURIOUS_CLICK` |
| 2 — Pal clicks | With overlay `--speed 0`, click blue Pal 30 times, avoiding gaps/margins. Repeat movement `--speed 4` and attempt tracked clicks | **30/30** static Pal clicks logged, plus moving-hitbox observations. No interception outside Pal |
| 3 — lifecycle | `bash qa/lifecycle_20.sh`; inspect surface after every close | **20/20** ready/exit cycles; no residual overlay, crash or warning |
| 4 — transparency | Put a patterned desktop/window below overlay. Capture screenshot before, during and after; inspect black/opaque pixels | Background visible and unchanged everywhere other than Pal/home art; no persistent black/opaque surface |
| 5 — fullscreen | Save game first. Run a borderless fullscreen and then exclusive fullscreen game with overlay `--layer top` and `--layer bottom` separately. Test game keyboard/mouse, Alt+Tab, screen transitions and returning to desktop; inspect logs | Record whether overlay is above/below, games capture clicks correctly, no focus theft; **failure if interception**. If unsafe, terminate overlay and document town-only workaround |
| 6 — monitors | Repeat underlay, Pal, transparency and disconnect/reconnect with `--all-monitors` on each physical output | Correct output placement and **fail-closed** process termination on hotplug; no stuck surfaces |
| 7 — scaling | Repeat underlay/click tests at 100%, 125%, 150% (only supported modes) and mixed-scale multi-monitor | Hitbox, art and inputs line up in GDK logical coordinates; record rounding/artifact gaps |
| 8 — NVIDIA | Log driver and GPU; use `nvidia-smi`, observe flicker/tearing/device reset or rendering changes during test | No black surface, gpu/driver reset, or compositor restart |
| 9 — fallback | `--town-only`; then test X11/unsupported session without `--require-overlay`, and strict flag with it | Only bounded, ordinary window; no fullscreen overlay or input capture; strict test exits nonzero |

**Important: Wayland prevents ordinary apps from enumerating all other
windows/fullscreen state portably.** This spike does **not** automatically
hide over games; top-layer fullscreen behavior is compositor-dependent. A
future gaming-mode compositor/window-policy integration must be explicitly
verified. `--layer bottom` is an experiment, **not** a promise of safe gaming
compatibility. Town-only/quit remains the safety fallback.

### Evidence capture

```bash
mkdir -p qa/evidence
# Start app from terminal and capture its stdout/stderr:
cargo run --locked -- --seconds 300 --speed 4 --layer top 2>&1 | tee qa/evidence/overlay.log
# KDE Spectacle (while overlay is visible):
spectacle -b -n -o qa/evidence/s1-overlay.png
# Optional: record with OBS Studio using the desktop portal; provide fps/scale.
# Capture a second screenshot after the process quits, in the same scene.
```

Mask any personal notifications/usernames in images before sharing. If
Spectacle fails to capture layer surfaces, document that failure and record
with the Wayland screencast portal/OBS. Do not label absent screenshots a
pass. `underlay_click_counter.py` is a human-driven audit aid, not automated
mouse-injection into KWin.

## Known unverified limitations / independent Desktop QA handoff

1. **No local Rust/GTK toolchain in the originating environment**, so Cargo
   compile/clippy/tests were NOT run there. The source is a PR candidate,
   **not** a verified native build. Run all commands on CachyOS before
   promotion; fix compile/version issues on the same isolated branch.
2. `GdkSurface::set_input_region` must be tested under actual KWin Wayland
   with GTK4 layer-shell, NVIDIA and fractional scaling. A successful API
   call is not evidence of click-through. Surface/GTK repaint may overwrite
   the region; watch for transient click interception during motion.
3. Fullscreen games are **unverified**. No reliable portable Wayland
   fullscreen detection, no automatic hide, no keyboard shortcut grab.
4. Monitor enumeration uses GDK monitor indices, not stable connectors.
   Output hotplug ends all overlays; relaunch is required. Multi-monitor
   and fractional input mapping require real mixed-DPI evidence.
5. The prototype uses GTK Cairo CPU drawing. `wgpu`/Tauri/WebKit and
   packaged CachyOS artifacts are **not evaluated** in S1.
6. S1 has no performance gate/30-minute soak. Rendering performance and
   true living-town state are reserved for S2 / Phase 1.

**Independent QA verdict requested:** PASS/FAIL/UNVERIFIED for each gate,
physical test metadata and log/screenshot proof, final changed SHA, and
an explicit recommendation to the PM whether to proceed past Phase 0.
