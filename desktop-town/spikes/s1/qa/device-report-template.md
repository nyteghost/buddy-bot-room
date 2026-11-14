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

| Gate | Result PASS / FAIL / UNVERIFIED | Evidence location / observations |
| --- | --- | --- |
| G0 environment + `S1_READY`/`S1_ALLOCATED` | UNVERIFIED | |
| G1 100/100 empty-region click-through | UNVERIFIED | |
| G2 30/30 Pal clicks (static) + rim probe | UNVERIFIED | |
| G2b moving hitbox (hits / 20, vacated spot passes) | UNVERIFIED | |
| G3 20/20 lifecycle cycles + no residual surface | UNVERIFIED | |
| G3b SIGTERM clean exit | UNVERIFIED | |
| G4 transparency / no black or opaque surface | UNVERIFIED | |
| G5 fullscreen borderless — top / bottom | UNVERIFIED | visible? input intercepted? |
| G5 fullscreen exclusive — top / bottom | UNVERIFIED | visible? input intercepted? |
| G6 multi-monitor placement (`--all-monitors`, `--monitor`) | UNVERIFIED | |
| G6 hotplug → `S1_HOTPLUG_EXIT`, nothing left behind | UNVERIFIED | |
| G7 fractional scale(s) tested: ___ | UNVERIFIED | |
| G7 live scale change | UNVERIFIED | |
| G8 NVIDIA stability (no Xid / reset / KWin restart) | UNVERIFIED | |
| G9 town-only / X11 / `--require-overlay` exit 2 | UNVERIFIED | |

- Screenshot/recording before, during, after:
- Any compositor crash, persistent input interception or black overlay? (automatic FAIL):
- Independent QA disposition: **GO / NO-GO / BLOCKED**
- Recommended source changes:
- PM relay URL:
