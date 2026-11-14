# S1 — Native KDE Wayland click-through overlay (RESEARCH SPIKE)

**Do not merge, deploy, or install on a production machine.** Standalone GTK4
layer-shell experiment on the immutable `beta` baseline
`099f0698bddc494a5cdfd819f0d32944a766e341`. No Tauri/WebKit, app IPC,
permissions, network, user data, Unraid or AI provider usage.

| Need | Go to |
| --- | --- |
| Install / build on CachyOS | [`INSTALL-CACHYOS.md`](INSTALL-CACHYOS.md) |
| Owner hardware QA (100/30/20, KWin, NVIDIA alpha, monitors, DPI, games, focus, fail-closed) | [`qa/DEVICE-QA-CHECKLIST.md`](qa/DEVICE-QA-CHECKLIST.md) + helper `qa/owner_kde_gates.sh` |
| Report form for Independent Desktop QA | [`qa/device-report-template.md`](qa/device-report-template.md) |
| What was actually run, with CI links | [`TEST_EVIDENCE.md`](TEST_EVIDENCE.md) |

## What is implemented

- One transparent GTK4 layer-shell surface per selected output
  (`--monitor DP-1`, `--monitor-index N` or `--all-monitors`). **Top** layer
  by default; `--layer bottom` as an experiment. Four edge anchors,
  `exclusive_zone=0` (stays clear of panels), **no keyboard focus**, no
  window enumeration, no input grab.
- A 24 px-radius Pal disc walking left/right. Its **GDK input region** is
  recomputed from per-row scanlines whenever the Pal moves, translated into
  surface coordinates (`compute_point` + `surface_transform`), clipped to the
  surface, and committed only when it actually changed. All other pixels pass
  pointer events to whatever is underneath.
- **Event-driven rendering.** The full-output surface contains an empty resize
  sensor (never paints) and two small widgets in a `gtk::Fixed`: the Pal art
  (53 × 53 px) and a faint home marker. Moving the Pal repaints only the art
  widget; the drawn disc uses the same sub-pixel centre as the hitbox
  (CI-checked to ≤ 1.5 physical px at 100–175 %). Motion is time-based at
  `--fps` (default 30, 1–60; `--speed` keeps its old px-per-80 ms meaning),
  and a stall is capped at 0.25 s so the hitbox never teleports. **An idle
  Pal (`--speed 0`) runs no timer, repaints nothing and commits no region
  after the first frame** (CI-verified).
- `--stats N` logs per-output paints, fps, p50/p95/max frame interval
  (GDK frame clock), region commits, process CPU % of one core
  (`/proc/self/stat`), PSS/RSS (`/proc/self/smaps_rollup`) and the GSK
  renderer GTK chose (`GskGLRenderer` (ngl), `GskVulkanRenderer` or `GskCairoRenderer`).
- The region is **always** set with `Some(region)`: in gtk4-rs 0.11
  `set_input_region(None)` means "whole surface accepts input". Before
  allocation the region is empty; malformed geometry fails closed to empty.
- Click classification uses the same pixel rule as the compositor:
  `S1_PAL_CLICK` inside the region, `S1_SPURIOUS_CLICK` (= click-through
  failure) for any event delivered outside it.
- Transparent CSS/window/canvas; GTK computes the opaque region (empty).
- Bounded lifetime in **every** mode (`--seconds`, default 300, max 3600),
  clean exit on SIGINT/SIGTERM (`S1_SIGNAL_EXIT`).
- **One fail-closed teardown path** for timeout, signals, hotplug, monitor
  invalidation and compositor-initiated close (`S1_SURFACE_CLOSED`): stop
  timers, set an empty input region, hide every surface, log
  `S1_RELEASED count=N reason=…`, then quit. SIGKILL needs no code: the
  compositor destroys the surface (CI-verified).
- Output added/removed or a monitor invalidated → `S1_HOTPLUG_EXIT`, the
  whole process quits and releases all regions (fail closed; relaunch).
- Monitor selection is a pure, unit-tested function: an unknown connector,
  out-of-range index, or any output with unusable geometry/scale selects
  nothing and falls back safely (KWin itself closes layer surfaces with
  invalid geometry).
  Mode/scale change on the same output → logged
  (`S1_MONITOR_GEOMETRY`/`S1_MONITOR_SCALE`/`S1_SCALE_CHANGED`) and the
  region is recomputed in logical coordinates.
- Safe fallback: not a native Wayland GDK display, no layer-shell, no input
  shapes, or requested monitor missing → small ordinary **town-only window**
  (`S1_TOWN_ONLY_READY`), never a fullscreen overlay. `--require-overlay`
  exits **2** instead (QA automation). `--town-only` forces it.
- QA aids: `--trace-region` logs every region change; `--qa-underlay` is an
  ordinary click-counting window used as "the desktop" in automated runs.

Not in scope: Tauri integration, a cross-platform window abstraction,
Windows (S4), `wgpu` (renderer only — cannot place windows or set input
regions), performance (S2).

## Build (developer)

```bash
sudo pacman -S --needed base-devel rust pkgconf gtk4 gtk4-layer-shell
cd desktop-town/spikes/s1
cargo fmt --all -- --check
cargo check  --locked --all-targets
cargo clippy --locked --all-targets -- -D warnings
cargo test   --locked                      # unit + CLI tests; GTK runtime test SKIPs without a session
cargo run    --locked -- --seconds 60 --speed 0 --trace-region
```

Requirements: Rust ≥ 1.92, GTK ≥ 4.14 (`v4_14` feature), gtk4-layer-shell
C library ≥ 1.0. Verified versions are listed in `TEST_EVIDENCE.md`.
`Cargo.lock` is committed and reviewed; `--locked` is mandatory.

## Automated verification (CI, headless — not KDE)

`ci/s1-linux.yml` (stored in this spike path; PP-DT-001 does not allow S1
to add `.github/workflows/`) runs in an `archlinux:base-devel` container:
fmt/check/clippy/test/build, RustSec audit, GTK runtime tests under headless
**sway** (layer-shell present) and headless **weston** (no wlr-layer-shell →
must fall back), an **Xvfb/X11** fallback check, a `makepkg` + `namcap`
package build, and `qa/wlroots_acceptance.py`:

- 100 virtual-pointer clicks outside the Pal must reach an underlay window;
  30 clicks on the Pal must reach the overlay; 8-direction rim probes at
  r−4 / r+4; tracked clicks on a moving Pal plus a click on its vacated spot;
- `grim` pixel diff before/during/after (changes allowed only on Pal + marker);
- lifecycle cycles followed by a click proving no residual input region;
- 100 %, 125 %, 150 % and a **mixed 100 % + 150 % dual-output** run with
  output unplug (hotplug fail-closed);
- keyboard focus unchanged by overlay map and Pal clicks (sway tree);
- SIGKILL leaves no surface/region; live scale and mode changes on the same
  output (overlay re-applies its region, or exits fail-closed);
- drawn disc centroid vs input-region centre in the screenshot (≤ 1.5 physical px);
- idle Pal: zero repaints and zero region commits per `--stats` window;
- moving pacing/CPU/PSS recorded as information (software renderer — not a benchmark);
- fullscreen-window interaction recorded as information.

Unit tests cover input-region rasterisation and boundaries, widget→surface
translation and clipping, art/hitbox alignment for sub-pixel centres,
time-based motion and stall capping, shrink re-clamping, monitor selection and
geometry validation, the fallback decision table (all 16 capability
combinations), CLI validation, frame-interval percentiles and `/proc` parsing.
`qa/test_mangohud_compare.py` tests the owner's FPS comparison tool.

`qa/wlr-clicker/` is the QA-only virtual pointer (zwlr_virtual_pointer_v1).
KWin does not offer that protocol to clients, so on KDE the same gates are
performed by a human with `qa/DEVICE-QA-CHECKLIST.md`.

**A wlroots pass is not a KWin, Plasma or NVIDIA pass.**

## Window stacking, fullscreen games and Wayland limits

**KWin layer mapping (from KWin source):** `layershellv1window.cpp` maps the
layer-shell *background* → `DesktopLayer`, *bottom* → `BelowLayer`, *top* →
`AboveLayer`, *overlay* → `OverlayLayer`
([lxr](https://lxr.kde.org/source/plasma/kwin/src/layershellv1window.cpp)).
KWin treats a top-layer surface being hidden under a fullscreen client as
intended behaviour; only the *overlay* layer goes above fullscreen windows
([KDE bug 510544](https://bugs.kde.org/show_bug.cgi?id=510544), RESOLVED NOT A BUG).

Consequences for S1 (default `--layer top`):

- Over normal windows and the desktop: Pal visible and clickable.
- Over an **active fullscreen window/game**: Pal expected **hidden**, and the
  game receives all input. This matches headless sway (CI INFO gate) and is
  the safest behaviour for games. It is compositor stacking, not detection:
  S1 cannot know a game is running.
- S1 deliberately never uses the *overlay* layer.
- KWin only activates top/overlay layer surfaces that want keyboard input;
  S1 uses `KeyboardMode::None`, so it should never take focus (owner gate G).

**Wayland limitations (explicitly unsupported):**

| Not possible / not done | Why | S1 behaviour |
| --- | --- | --- |
| Global cursor position, other windows' geometry | Wayland clients cannot query them | Pal walks on its own path; no window-aware roaming |
| Detecting fullscreen games / other apps | No portable protocol | relies on KWin stacking (above) |
| Moving one surface across outputs | layer surfaces are bound to one output | one surface per output; hotplug quits |
| Placing over the Plasma panel | `exclusive_zone=0` keeps clear of reserved panel space | Pal stays in the work area |
| Keyboard/global hotkeys | would need focus or a portal | none |
| Synthesising input on KWin (automation) | KWin does not offer wlr virtual-pointer to clients | physical QA is manual |

**NVIDIA notes:** GTK renders with its GPU renderer when available; S1 logs
which one (`renderer=` in `S1_READY`/`S1_STATS`). Owner gates B and K compare
`GSK_RENDERER=ngl|vulkan|cairo` for transparency and measure idle/walking
CPU, PSS, frame pacing and `nvidia-smi` power/clocks. No NVIDIA result
exists yet.

## Known limitations and remaining blockers

1. **No KDE/KWin, NVIDIA or physical-monitor evidence yet.** All runtime
   evidence is headless wlroots in CI (software rendering, virtual pointer).
2. **Fullscreen**: hidden under fullscreen apps by KWin design for the top
   layer (source + KDE bug above); not yet observed on the owner's KWin.
3. **Hotplug quits** instead of re-targeting; relaunch is required.
   `--monitor CONNECTOR` is stable, `--monitor-index` is not.
4. **CI numbers are not performance results**: CI uses a software renderer
   on a cloud VM; idle/fps/CPU/PSS/power must be measured on the owner's PC
   (`qa/owner_kde_gates.sh idle|power`, `--stats`, `qa/mangohud_compare.py`).
5. **Moving hitbox** updates at `--fps` (default 30). A click within one
   frame of the Pal moving can land on the old/new position — a timing
   property, not a guarantee.
6. Panels: the Pal never roams over the Plasma panel (by design).
7. `--qa-underlay` and `qa/underlay_click_counter.py` are test aids only.
8. The repository has **no LICENSE file**; `MIT` in Cargo.toml/PKGBUILD is
   inherited from the original spike and must be confirmed by the owner.
9. No 30-minute soak yet (owner gate K can be extended with `--seconds 1800 --stats 60`).
10. CI config lives in `ci/`; S1 has no approved active workflow path
    (PP-DT-005 approved S2/S4 only); it runs from a disposable probe branch.
11. Standalone GTK4 process — **not** proof of Tauri layer-shell integration.

**Independent QA verdict requested:** PASS/FAIL/UNVERIFIED per checklist
section with physical metadata and log/screenshot proof, the exact SHA, and a
recommendation to the PM.
