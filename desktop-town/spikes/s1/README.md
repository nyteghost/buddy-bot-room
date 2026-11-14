# S1 — Native KDE Wayland click-through overlay (RESEARCH SPIKE)

**Do not merge, deploy, or install on a production machine.** Standalone GTK4
layer-shell experiment on the immutable `beta` baseline
`099f0698bddc494a5cdfd819f0d32944a766e341`. No Tauri/WebKit, app IPC,
permissions, network, user data, Unraid or AI provider usage.

| Need | Go to |
| --- | --- |
| Install / build on CachyOS | [`INSTALL-CACHYOS.md`](INSTALL-CACHYOS.md) |
| Owner hardware QA (100/30/20, monitors, DPI, games, NVIDIA, fallback) | [`qa/DEVICE-QA-CHECKLIST.md`](qa/DEVICE-QA-CHECKLIST.md) |
| Report form for Independent Desktop QA | [`qa/device-report-template.md`](qa/device-report-template.md) |
| What was actually run, with CI links | [`TEST_EVIDENCE.md`](TEST_EVIDENCE.md) |

## What is implemented

- One transparent GTK4 layer-shell surface per selected output
  (`--monitor DP-1`, `--monitor-index N` or `--all-monitors`). **Top** layer
  by default; `--layer bottom` as an experiment. Four edge anchors,
  `exclusive_zone=0` (stays clear of panels), **no keyboard focus**, no
  window enumeration, no input grab.
- A moving 24 px-radius Pal disc. Its **GDK input region** is recomputed from
  per-row scanlines on every 80 ms tick, translated into surface coordinates
  (`compute_point` + `surface_transform`) and clipped to the surface. All
  other pixels pass pointer events to whatever is underneath.
- The region is **always** set with `Some(region)`: in gtk4-rs 0.11
  `set_input_region(None)` means "whole surface accepts input". Before
  allocation the region is empty; malformed geometry fails closed to empty.
- Click classification uses the same pixel rule as the compositor:
  `S1_PAL_CLICK` inside the region, `S1_SPURIOUS_CLICK` (= click-through
  failure) for any event delivered outside it.
- Transparent CSS/window/canvas; GTK computes the opaque region (empty).
- Bounded lifetime in **every** mode (`--seconds`, default 300, max 3600),
  clean exit on SIGINT/SIGTERM (`S1_SIGNAL_EXIT`).
- Output added/removed or a monitor invalidated → `S1_HOTPLUG_EXIT`, the
  whole process quits and releases all regions (fail closed; relaunch).
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
- fullscreen-window interaction recorded as information.

`qa/wlr-clicker/` is the QA-only virtual pointer (zwlr_virtual_pointer_v1).
KWin does not offer that protocol to clients, so on KDE the same gates are
performed by a human with `qa/DEVICE-QA-CHECKLIST.md`.

**A wlroots pass is not a KWin, Plasma or NVIDIA pass.**

## Fullscreen games — behaviour and risk

- Wayland gives ordinary clients no portable way to learn that another
  client is fullscreen, so S1 does **not** auto-hide.
- On headless sway, a focused fullscreen window covered the Pal for both
  `--layer top` and `--layer bottom`, and the click went to the fullscreen
  window (CI evidence). **KWin may differ.** The owner must record actual
  KWin behaviour with borderless and exclusive fullscreen (checklist Gate 5).
- S1 deliberately does not offer the layer-shell `overlay` layer, which is
  designed to sit above fullscreen surfaces.
- If any in-game interception is observed: stop the overlay; the supported
  mitigation is town-only / quit until a game-mode policy is designed.

## Known limitations and remaining blockers

1. **No KDE/KWin, NVIDIA or physical-monitor evidence yet.** All runtime
   evidence is from headless wlroots in CI. KWin's handling of
   `wl_surface.set_input_region` on layer surfaces, NVIDIA explicit sync,
   real fractional-scale rounding and real hotplug remain owner gates.
2. **Fullscreen behaviour on KWin is unknown** (see above).
3. **Hotplug quits** instead of re-targeting; relaunch is required. Monitor
   selection by connector is stable; `--monitor-index` is not.
4. **Software rendering in CI** (Mesa EGL unavailable → GTK falls back);
   GPU-path rendering is only exercised on the owner's machine.
5. **Input region update cadence** is 80 ms. A click that lands within a
   frame of the Pal moving can hit the old/new position; CI saw 20/20 hits
   at 100 px/s, but this is a timing property, not a guarantee.
6. Panels: `exclusive_zone=0` keeps the surface clear of panels that reserve
   space, so the Pal never roams over the Plasma panel.
7. The `--qa-underlay` window and `qa/underlay_click_counter.py` are test
   aids only; the Python counter runs through XWayland on KDE.
8. The repository has **no LICENSE file**; `MIT` in Cargo.toml/PKGBUILD is
   inherited from the original spike and must be confirmed by the owner.
9. CPU Cairo drawing, no performance gate or 30-minute soak (S2 scope).
10. CI config lives in `ci/`; enabling it on the repository is a separate
    owner/PM decision.

**Independent QA verdict requested:** PASS/FAIL/UNVERIFIED per gate with
physical metadata and log/screenshot proof, the exact SHA, and an explicit
recommendation to the PM on proceeding past Phase 0.
