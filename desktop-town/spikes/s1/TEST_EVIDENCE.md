# S1 — test evidence recorded 2026-11-14

## Source and baseline

- Base commit: `099f0698bddc494a5cdfd819f0d32944a766e341` (immutable `beta` baseline specified by PM).
- Scope: `desktop-town/README.md`, `desktop-town/spikes/s1/**` only.
- Source inspection and API reference checks: `gtk4-layer-shell 0.8.1`, GTK4/GDK4 input regions, layer-shell monitor API. **API documentation is not a device test.**
- No production code paths or running systems were altered.

## Actual commands executed in isolated build container

| Command | Result | Detail |
| --- | --- | --- |
| `python3 -m py_compile qa/underlay_click_counter.py` | PASS | Syntax checked |
| `bash -n qa/lifecycle_20.sh qa/environment.sh` | PASS | Shell parse checked |
| `cargo --version` | BLOCKED | `bash: cargo: command not found` (exit 127) |
| `cargo fmt --all -- --check` | BLOCKED | `bash: cargo: command not found` (exit 127) |
| `cargo check` | BLOCKED | `bash: cargo: command not found` (exit 127) |
| `cargo clippy --all-targets -- -D warnings` | BLOCKED | `bash: cargo: command not found` (exit 127) |
| `cargo test` | BLOCKED | `bash: cargo: command not found` (exit 127) |
| Wayland/KWin/GDK runtime tests | UNVERIFIED | No KDE Wayland compositor, NVIDIA GPU, GTK4 dev headers/libs in build container |
| 100/100 pass-through, 30/30 Pal, 20 cycles, fullscreen, mixed DPI, multi-output | UNVERIFIED | Requires CachyOS owner hardware and Independent Desktop QA |

**Important:** This PR must remain draft pending real Cargo build, lockfile generation/commit,
actual hardware tests, any required source corrections, and independent QA signoff.
See `README.md` and `qa/` for reproducible device procedure.
