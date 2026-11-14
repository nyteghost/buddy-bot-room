# S1 overlay — CachyOS / KDE Plasma 6 / Wayland / NVIDIA: install, run, remove

> **Disposable research prototype.** Installing it on the owner's PC is the
> owner's own decision (PP-DT-001). It adds no services, autostart entries,
> desktop files or settings, touches no Pixel Pals data, Unraid or network,
> and `pacman -Rns` removes every file it installs.

Every block below is meant to be pasted into **Konsole** inside a
**Plasma (Wayland)** session. Lines starting with `#` are comments.

## What CI already proved, and what only your PC can prove

| Proven in headless CI (sway/weston/Xvfb, software rendering, virtual mouse) | Needs your physical PC |
| --- | --- |
| Builds with locked dependencies; unit/runtime tests; Arch package builds | KWin actually honouring the input region on a layer surface |
| 100/100 click-through, 30/30 Pal clicks, rim precision at 100/125/150/175 %, mixed DPI | Real NVIDIA transparency (no black box) with the GPU renderer |
| Drawn Pal centre = hitbox centre (≤1.5 px) at fractional scales | KDE panel, Overview, lock screen, virtual desktops |
| Idle Pal: zero repaints, zero region commits | Real idle CPU / power / GPU clocks on your hardware |
| 20 launch/exit cycles, SIGTERM, SIGKILL, hotplug, live scale/mode change fail closed | Physical monitor hotplug, your real scale factors |
| Keyboard focus never taken (sway) | Focus with KWin; fullscreen games; FPS impact |

## 1. Prerequisites (once)

```bash
# confirm the session type first — must print "wayland"
echo $XDG_SESSION_TYPE
# build tools + runtime libraries (all from the official Arch/CachyOS repos)
sudo pacman -S --needed base-devel git rust pkgconf gtk4 gtk4-layer-shell
# QA helpers (optional but used by the checklist)
sudo pacman -S --needed python tk wayland-utils spectacle mangohud nvidia-utils
```

## 2. Get the exact build you were asked to test

```bash
# replace the SHA with the one posted in PR #46 / Issue #37
S1_SHA=PUT_THE_SHA_HERE
git clone https://github.com/nyteghost/buddy-bot-room.git ~/src/buddy-bot-room
cd ~/src/buddy-bot-room
git fetch origin spike/desktop-town-kwin-overlay-20261114
git checkout --detach "$S1_SHA"
git rev-parse HEAD        # must print the same SHA — write it in the report
```

## 3. Install (pacman package, preferred)

```bash
cd ~/src/buddy-bot-room/desktop-town/spikes/s1/packaging/arch
makepkg -si               # downloads crates pinned by Cargo.lock, runs the tests, installs
pacman -Q pixel-pals-s1-overlay-dev     # version ends in .g<12-char SHA>
git -C ~/src/buddy-bot-room checkout -- desktop-town/spikes/s1/packaging/arch/PKGBUILD  # makepkg rewrote pkgver
```

<details><summary>Alternative: run from the checkout without installing</summary>

```bash
cd ~/src/buddy-bot-room/desktop-town/spikes/s1
cargo test --locked && cargo build --locked --release
export S1_BIN=$PWD/target/release/pixel-pals-s1-kwin-overlay
alias pixel-pals-s1-kwin-overlay="$S1_BIN"
```
</details>

## 4. Set up the helper (every new Konsole)

```bash
H="bash /usr/share/pixel-pals-s1/qa/owner_kde_gates.sh"
# (checkout instead of package: H="bash ~/src/buddy-bot-room/desktop-town/spikes/s1/qa/owner_kde_gates.sh")
$H env        # writes ~/pixel-pals-s1-evidence/<date>/env.log
```

## 5. First launch — safe, 60 seconds

Open a **second** Konsole and keep this ready (the kill switch):

```bash
pkill -TERM -f pixel-pals-s1-kwin-overlay
```

Then in the first Konsole:

```bash
$H smoke                                   # 5 s run; must end with "G0 PASS"
pixel-pals-s1-kwin-overlay --seconds 60 --speed 4 --trace-region
```

You should see a small blue Pal with two eyes walking left/right across the
middle of the screen, and a very faint teal bar under the centre. Expected
terminal lines: `S1_OUTPUT …`, `S1_READY … renderer=Gsk…Renderer`,
`S1_ALLOCATED …`, `S1_REGION …`. It closes itself after 60 s (`S1_RELEASED`).

## 6. Everyday commands

| Purpose | Command |
| --- | --- |
| Overlay that stands still (best for click tests) | `$H run --speed 0 --seconds 900` |
| Walking Pal | `$H run --speed 4 --seconds 900` |
| Every monitor | `$H run --all-monitors --speed 0 --seconds 900` |
| One named monitor (names from `S1_OUTPUT` lines) | `$H run --monitor DP-1 --speed 0` |
| Behind normal windows | `$H run --layer bottom --speed 4` |
| Measure CPU / PSS / frame pacing | `$H run --speed 4 --stats 10 --seconds 120` |
| Idle cost (60 s) | `$H idle` |
| NVIDIA power / clocks (3 × 60 s) | `$H power` |
| 20 launch/exit cycles | `$H lifecycle` |
| Fail-closed checks | `$H failclosed` |
| Counts from today's logs | `$H summary` |
| Safe window without overlay | `pixel-pals-s1-kwin-overlay --town-only --seconds 30` |

`--speed` is pixels per 80 ms (4 ≈ 50 px/s); motion and hitbox update at
`--fps` (default 30). An idle Pal (`--speed 0`) runs no timers and repaints
nothing.

## 7. Safe shutdown and cleanup

```bash
pkill -TERM -f pixel-pals-s1-kwin-overlay          # normal stop (logs S1_SIGNAL_EXIT, S1_RELEASED)
pgrep -fa pixel-pals-s1-kwin-overlay || echo "none running"
# desktop unusable? Ctrl+Alt+F3 → log in → run the pkill line → Ctrl+Alt+F1 (or F2) back
sudo pacman -Rns pixel-pals-s1-overlay-dev         # remove the package completely
pacman -Q pixel-pals-s1-overlay-dev 2>/dev/null || echo "removed"
# your evidence stays in ~/pixel-pals-s1-evidence (delete it yourself when done)
```

Every run also stops by itself (`--seconds`, default 300, max 3600).

## 8. Troubleshooting

| Symptom | Meaning / what to do |
| --- | --- |
| `S1_SAFE_FALLBACK reason=Not a native Wayland GDK display` | X11 session or `GDK_BACKEND=x11` set. Log into **Plasma (Wayland)**; `unset GDK_BACKEND`. |
| `S1_SAFE_FALLBACK reason=Compositor lacks layer-shell protocol` | `wayland-info \| grep zwlr_layer_shell` empty → report it; roaming cannot be tested. |
| `S1_SAFE_FALLBACK reason=Requested monitor unavailable …` | Wrong `--monitor` name/index; copy a connector from the `S1_OUTPUT` lines. |
| Black or grey rectangle instead of transparency | **FAIL** — stop. Retry once each with `GSK_RENDERER=ngl`, `GSK_RENDERER=vulkan`, `GSK_RENDERER=cairo` in front of the command; record which renderer (also printed in `S1_READY`). Save `journalctl -b --since "-10 min" \| grep -iE 'nvidia\|NVRM\|Xid\|kwin'`. |
| Clicks blocked anywhere except on the Pal | **FAIL** — stop with the kill switch; note any `S1_SPURIOUS_CLICK` lines. |
| Pal invisible while a game/video is fullscreen | Expected on KWin for the default top layer (see README "Window stacking"). Not a failure. |
| Pal disappears when a monitor is plugged/unplugged or the surface is closed | Expected fail-closed behaviour (`S1_HOTPLUG_EXIT` / `S1_SURFACE_CLOSED`); relaunch. |
| `makepkg` fails in `prepare()` with a lockfile error | Your checkout is not the exact SHA or was modified: `git status`, `git checkout --detach "$S1_SHA"`. |
| `cargo` too old | `rustc --version` must be ≥ 1.92: `sudo pacman -Syu rust`. |

Then work through [`qa/DEVICE-QA-CHECKLIST.md`](qa/DEVICE-QA-CHECKLIST.md)
and fill in [`qa/device-report-template.md`](qa/device-report-template.md).
