# S1 physical acceptance — CachyOS · KDE Plasma 6 · KWin Wayland · NVIDIA

**Only what you observe on the physical PC counts here.** CI ran the same
gates on headless sway/weston with software rendering and a virtual mouse
(see `TEST_EVIDENCE.md` and the PR); that is **not** KWin, Plasma or NVIDIA
evidence. Install first with [`../INSTALL-CACHYOS.md`](../INSTALL-CACHYOS.md)
(owner authorization required).

## Before you start (paste into every new Konsole)

```bash
H="bash /usr/share/pixel-pals-s1/qa/owner_kde_gates.sh"
E=~/pixel-pals-s1-evidence/$(date +%Y%m%d); mkdir -p "$E"; cd "$E"
pacman -Q pixel-pals-s1-overlay-dev        # copy the version (contains the SHA) into the report
```

- **Kill switch (2nd Konsole):** `pkill -TERM -f pixel-pals-s1-kwin-overlay` · desktop stuck → Ctrl+Alt+F3, log in, same command.
- **Screenshot:** `spectacle -b -n -o NAME.png` (mask notifications/usernames).
- **Stop immediately and mark FAIL** on: any `S1_SPURIOUS_CLICK`, a click under an empty area that does not reach the window below, a black/grey/opaque rectangle, keyboard focus moving to the overlay, or a KWin crash/restart.
- Fill in `device-report-template.md` as you go (PASS / FAIL / UNVERIFIED per section).

## A. Environment and first launch

```bash
$H env
$H smoke            # must print "G0 PASS"
```

- [ ] `env.log`: `SESSION_TYPE: wayland`, Plasma/KWin version, NVIDIA driver, `zwlr_layer_shell_v1`, every output with its scale
- [ ] You saw the Pal appear and vanish after 5 s; `S1_READY … renderer=` names a GPU renderer (`GskGLRenderer` = ngl, or `GskVulkanRenderer`; `GskCairoRenderer` = software); write it down

## B. Transparency on NVIDIA

Put a busy wallpaper or a window with fine text behind the screen centre.

```bash
spectacle -b -n -o before.png
pixel-pals-s1-kwin-overlay --speed 0 --seconds 40 & sleep 5
spectacle -b -n -o during.png; sleep 36
spectacle -b -n -o after.png
# repeat with each renderer; note any difference
for r in ngl vulkan cairo; do GSK_RENDERER=$r pixel-pals-s1-kwin-overlay --speed 4 --seconds 20 2>&1 | grep -E 'S1_READY|CRITICAL|WARNING'; done
journalctl -b --since "-10 min" | grep -iE 'nvidia|NVRM|Xid|kwin' > journal-B.txt; wc -l journal-B.txt
```

- [ ] `during.png` differs from `before.png` only at the Pal disc and the faint teal bar; no black/grey box, halo, flicker or tearing (watch the walking Pal for 20 s)
- [ ] `after.png` matches `before.png` (nothing left on screen)
- [ ] All three renderers transparent (note any that are not), `journal-B.txt` has no Xid/NVRM errors
- [ ] If Spectacle does not capture the Pal at all: record that and use an OBS recording; no image = **UNVERIFIED**, never PASS

## C. 100 click-through trials

Konsole 1 — the "desktop" with 100 numbered targets (it runs via XWayland; that is fine):

```bash
python3 /usr/share/pixel-pals-s1/qa/underlay_click_counter.py | tee "$E/g1-underlay.log"
```

Konsole 2 — the overlay:

```bash
$H run --speed 0 --layer top --seconds 900
```

Click each numbered cell once, **not** on the Pal. If the counter hides the Pal (it is fullscreen), press Esc, maximise it instead, and note that.

- [ ] Counter shows `Pass-through: 100/100` and `unique target cells: 100/100`
- [ ] `$H summary` → that run shows `pal=0 spurious=0`
- [ ] Moving: stop, run `$H run --speed 4 --seconds 300`, click 20 cells the Pal has **just walked off** → counter +20, `spurious=0`

## D. 30 Pal hitbox interactions

```bash
$H run --speed 0 --seconds 900
```

- [ ] 30 clicks on the blue disc → `$H summary` shows `pal=30`, counter unchanged, `spurious=0`
- [ ] 8 clicks just inside the rim → Pal; 8 clicks ~5 px outside the rim → counter (hitbox = drawn disc)
- [ ] Moving (`$H run --speed 4 --seconds 300`): 20 attempts on the walking Pal; write hits/20 (timing-dependent)

## E. 20 launch/exit cycles + clean shutdown

```bash
$H lifecycle        # must end "20/20 process lifecycle cycles succeeded"
$H failclosed       # SIGTERM, SIGKILL (answer y/n), X11 + strict fallback, unknown monitor
pgrep -fa pixel-pals-s1-kwin-overlay || echo "none running"
```

- [ ] `20/20`, and afterwards no Pal anywhere; clicks work where it was; no KWin notification/restart
- [ ] `failclosed` log: `SIGTERM PASS`, SIGKILL answer `y`, `strict-x11-exit=2`, `default-x11-exit=0`, `town-only-exit=0`, `unknown-monitor-exit=2`, `town-only windows shown (expect 2): 2`
- [ ] `none running` at the end

## F. KDE / KWin behaviour

With `$H run --speed 4 --seconds 900` running:

- [ ] Plasma panel never covered; panel stays clickable (overlay keeps clear of panel space)
- [ ] Overview (Meta+W) and virtual desktop switching (Meta+Ctrl+←/→): no crash; note whether the Pal shows
- [ ] Alt+Tab and the launcher (Meta) work normally; the overlay never appears in Alt+Tab or the task bar
- [ ] Lock (Meta+L) and unlock: Pal not on the lock screen; normal afterwards
- [ ] Volume/brightness OSD and notifications appear normally
- [ ] `--layer bottom` run: Pal hidden behind windows, visible on an empty desktop area, clickable only where visible

## G. Focus preservation

- [ ] Click into Kate and keep typing; from another Konsole start `$H run --speed 4 --seconds 120` without touching the mouse → typing continues in Kate
- [ ] Click the Pal 5 times, then type immediately → text still goes to Kate

## H. Fullscreen video and games (save your game first)

KWin draws fullscreen windows above the *top* layer by design, so the Pal is
expected to be **hidden** under a fullscreen game with the default layer.

For each: browser video fullscreen (F), one game borderless-fullscreen, the same game exclusive-fullscreen:

```bash
$H run --speed 4 --seconds 900            # then switch to the fullscreen app
```

- [ ] Pal visible over it? (expected: no) — record yes/no
- [ ] Mouse + keyboard work everywhere in the app, including where the Pal walks; `$H summary` shows no new `pal=` clicks
- [ ] Alt+Tab out/in works; Pal visible again on the desktop
- [ ] FPS impact (MangoHud): play the **same** scene ~2 min twice — without S1, then with S1 running:

```bash
# in Steam → game → Properties → Launch options:  MANGOHUD_CONFIG=output_folder=$HOME/pixel-pals-s1-evidence,autostart_log=1,log_duration=120 mangohud %command%
python3 /usr/share/pixel-pals-s1/qa/mangohud_compare.py BASELINE.csv WITH_S1.csv
```

  Targets: average FPS loss ≤ 3 %, 1 % low loss ≤ 5 %. Repeat 3× per condition; report medians, not a single run.

## I. Multiple monitors and hotplug

```bash
$H run --all-monitors --speed 0 --seconds 900
```

- [ ] One `S1_READY` + `S1_ALLOCATED` per output; Pal centred on each
- [ ] On **each** output: 20 empty-area clicks reach the window below; 10 Pal clicks log `S1_PAL_CLICK monitor=<connector>`
- [ ] `$H run --monitor <CONNECTOR> --speed 0` (connector from `S1_OUTPUT`) → Pal only on that output
- [ ] Disable one output (System Settings → Display & Monitor) or unplug it → `S1_HOTPLUG_EXIT` (or `S1_SURFACE_CLOSED`), process exits, **no Pal left on any output**, clicks fine everywhere

## J. Fractional scaling

For each scale you use (100/125/150/175 %) and a mixed pair if available:

```bash
$H run --speed 0 --seconds 900 --monitor <CONNECTOR>
```

- [ ] `S1_ALLOCATED … surface_scale=` equals the scale set in System Settings
- [ ] 20 empty clicks pass; rim probe (8 in / 8 out) correct; disc and hitbox line up (no offset, no ring gap)
- [ ] Change the scale **while running** and Apply → either `S1_SCALE_CHANGED`/`S1_RESIZED` with an aligned hitbox, or `S1_HOTPLUG_EXIT` with nothing left behind — record which

## K. NVIDIA idle cost, power and resource use

```bash
$H idle             # 60 s idle Pal
$H power            # 3 × 60 s: no overlay / idle Pal / walking Pal (nvidia-smi every 1 s)
$H run --speed 4 --stats 10 --seconds 120     # walking Pal: fps, p95 frame interval, CPU %, PSS
nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv
```

- [ ] `idle`: every window after the first shows `frames=0 region_updates=0`; record `cpu_pct` (target ≤ 2.00 % of one core) and `pss_kib` (target ≤ 358400 KiB = 350 MiB)
- [ ] `power`: record power_W / clock_MHz / pstate for each phase; idle-pal should not keep the GPU in a higher P-state than baseline (note if it does)
- [ ] walking: record `fps` (target ≥ 30 at `--fps 30`), `p95_ms` (target ≤ 33.3), `cpu_pct`, `pss_kib`, `renderer`
- [ ] After every run ends, `pgrep -fa pixel-pals-s1-kwin-overlay` is empty and the GPU process list no longer shows it

These are **your** measurements; the CI numbers in the PR come from a
software renderer on a cloud VM and do not predict them.

## Verdict

Copy each section's result into `device-report-template.md` with the SHA,
versions, log and image file names. Any interception, opaque surface, focus
theft or compositor crash = **automatic FAIL / NO-GO**.
