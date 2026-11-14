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
| A Environment + `$H smoke` | UNVERIFIED | |
| B 100/100 click-through (static) + 20 moving | UNVERIFIED | |
| C 30/30 Pal clicks + rim probe (+ moving hits /20) | UNVERIFIED | |
| D 20/20 lifecycle, nothing left behind | UNVERIFIED | |
| E KDE/KWin: panel, Overview, virtual desktops, Alt+Tab, lock screen, bottom layer, OSD | UNVERIFIED | |
| F NVIDIA transparency (ngl / vulkan / cairo), no Xid/reset | UNVERIFIED | |
| G Multi-monitor placement, per-output clicks, hotplug | UNVERIFIED | |
| H Fractional scale(s) tested: ___ ; live scale change outcome | UNVERIFIED | |
| I Fullscreen games: borderless / exclusive × top / bottom | UNVERIFIED | visible? intercepted? |
| J Focus preservation (typing, Pal clicks, no taskbar/Alt+Tab entry) | UNVERIFIED | |
| K Fail-closed: SIGTERM, SIGKILL, X11/strict, town-only, unknown monitor | UNVERIFIED | |

- Screenshot/recording before, during, after:
- Any compositor crash, persistent input interception or black overlay? (automatic FAIL):
- Independent QA disposition: **GO / NO-GO / BLOCKED**
- Recommended source changes:
- PM relay URL:
