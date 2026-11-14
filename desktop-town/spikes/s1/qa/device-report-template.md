# S1 KDE / Wayland Independent Desktop QA report

- Owner/operator:
- Date:
- Exact branch SHA (`git rev-parse HEAD` or `pacman -Q pixel-pals-s1-overlay-dev`):
- Install path used: A (pacman package) / B (cargo checkout)
- OS / kernel / Plasma / KWin (`qa/environment.sh`):
- GPU model / NVIDIA driver / explicit sync on?:
- GTK4 / gtk4-layer-shell / Rust versions:
- Outputs — connector / resolution / refresh / scale (per output):
- `XDG_SESSION_TYPE` / `zwlr_layer_shell_v1` present:
- Cargo fmt / check / clippy / test result and logs (path B):
- Headless CI run consulted (URL) — informational only, not hardware evidence:

| Section (DEVICE-QA-CHECKLIST.md) | Result PASS / FAIL / UNVERIFIED | Evidence location / observations |
| --- | --- | --- |
| A Environment + `$H smoke`; renderer = ___ | UNVERIFIED | |
| B NVIDIA transparency (ngl / vulkan / cairo), journal clean | UNVERIFIED | |
| C 100/100 click-through (+ 20 moving) | UNVERIFIED | |
| D 30/30 Pal clicks + rim probe (moving hits ___/20) | UNVERIFIED | |
| E 20/20 lifecycle + fail-closed + nothing running | UNVERIFIED | |
| F KDE/KWin: panel, Overview, desktops, Alt+Tab, lock, OSD, bottom layer | UNVERIFIED | |
| G Focus preservation | UNVERIFIED | |
| H Fullscreen video / borderless / exclusive (visible? intercepted?) + MangoHud deltas | UNVERIFIED | |
| I Multi-monitor placement, per-output clicks, hotplug | UNVERIFIED | |
| J Fractional scale(s) ___ ; live scale change outcome | UNVERIFIED | |
| K Idle cpu_pct ___ / pss_kib ___ ; walking fps ___ p95_ms ___ ; power per phase | UNVERIFIED | |

- Screenshot/recording before, during, after:
- Any compositor crash, persistent input interception or black overlay? (automatic FAIL):
- Independent QA disposition: **GO / NO-GO / BLOCKED**
- Recommended source changes:
- PM relay URL:
