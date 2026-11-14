# S1 device QA checklist — CachyOS · KDE Plasma 6 · Wayland · NVIDIA

Only evidence gathered **on the physical machine** counts here. Headless
wlroots CI results (`qa/wlroots_acceptance.py`) show the code works on *a*
layer-shell compositor; they are **not** KWin or NVIDIA evidence.

Binary below = `pixel-pals-s1-kwin-overlay` (installed) or
`cargo run --locked --` (checkout). Evidence folder:
`mkdir -p ~/pixel-pals-s1-evidence && cd ~/pixel-pals-s1-evidence`.
Fill `device-report-template.md` as you go. Mask notifications/usernames.

Kill switch for every step: `pkill -TERM -f pixel-pals-s1-kwin-overlay`
(second terminal or Ctrl+Alt+F3 TTY).

## Gate 0 — environment and build

- [ ] `bash qa/environment.sh | tee env.log` (installed: `/usr/share/pixel-pals-s1/qa/environment.sh`)
- [ ] `env.log` shows `SESSION_TYPE: wayland`, Plasma/KWin versions, NVIDIA driver, `zwlr_layer_shell_v1`, per-output scale
- [ ] `git rev-parse HEAD` (or `pacman -Q pixel-pals-s1-overlay-dev`) recorded
- [ ] Path B only: fmt/check/clippy/test all exit 0 (save output)
- [ ] `BIN --require-overlay --seconds 5 --speed 0 2>&1 | tee g0.log` prints `S1_READY` and `S1_ALLOCATED`, exits 0

## Gate 1 — 100 empty-region click-through trials

1. Terminal A: `python3 qa/underlay_click_counter.py | tee g1-underlay.log`
   (fullscreen grid; it runs via XWayland — that is fine, it is the "desktop").
2. Terminal B: `BIN --speed 0 --layer top --seconds 900 --trace-region 2>&1 | tee g1-overlay.log`
3. Click each of the 100 numbered cells once, **outside** the Pal.

- [ ] underlay shows `Pass-through: 100/100`, `unique target cells: 100/100`
- [ ] `grep -c S1_SPURIOUS_CLICK g1-overlay.log` → `0`
- [ ] `grep -c S1_PAL_CLICK g1-overlay.log` → `0`

> If the underlay sits *above* the top-layer overlay (KWin stacking for
> fullscreen X11 windows), the Pal will not be visible: record it and repeat
> with the underlay un-fullscreened (Esc, then maximise) — note which you used.

## Gate 2 — 30 Pal hitbox clicks (+ moving hitbox)

- [ ] With `--speed 0`: 30 clicks on the blue disc → `grep -c S1_PAL_CLICK` = 30; underlay count unchanged; 0 spurious
- [ ] Edge probe: 8 clicks just inside the rim → Pal; 8 clicks ~5 px outside → underlay
- [ ] `BIN --speed 4 --seconds 120 --trace-region`: 20 attempts to click the moving Pal; record hits; click repeatedly where the Pal **was** → must reach the underlay (0 spurious)

## Gate 3 — 20 overlay lifecycle cycles

- [ ] `bash qa/lifecycle_20.sh` (installed: `S1_BIN=/usr/bin/pixel-pals-s1-kwin-overlay bash /usr/share/pixel-pals-s1/qa/lifecycle_20.sh`) → `20/20`
- [ ] After the run: no Pal remains on screen, desktop clicks work where the Pal was, no KWin restart/notification
- [ ] `BIN --seconds 600` then `pkill -TERM -f pixel-pals-s1-kwin-overlay` → `S1_SIGNAL_EXIT`, surface disappears

## Gate 4 — transparency

- [ ] Patterned wallpaper or window behind. `spectacle -b -n -o before.png`; start overlay `--speed 0`; `spectacle -b -n -o during.png`; quit; `spectacle -b -n -o after.png`
- [ ] Only the Pal and faint home marker differ; no black/grey rectangle, no flicker at any time
- [ ] If Spectacle cannot capture layer surfaces, record that and use an OBS screencast instead — **do not mark PASS without an image**

## Gate 5 — fullscreen game behaviour (save your game first)

For each of `--layer top` and `--layer bottom`, and for **borderless** then **exclusive** fullscreen:

- [ ] Is the Pal visible over the game? (yes/no)
- [ ] Game mouse + keyboard work everywhere, including where the Pal is drawn
- [ ] Alt+Tab out and back works; no focus theft; no stutter/tearing you did not see without the overlay
- [ ] Any `S1_PAL_CLICK` while clicking in-game at the Pal spot? (record — that is interception)

Any game input interception = **FAIL** → stop overlay; the safe mode is `--town-only` / quit.

## Gate 6 — multi-monitor + hotplug

- [ ] `BIN --all-monitors --speed 0 --trace-region`: one `S1_READY`/`S1_ALLOCATED` per output; Pal centred on each
- [ ] Repeat Gate 1 (≥20 clicks) and Gate 2 (≥10 clicks) on **each** output
- [ ] `--monitor <CONNECTOR>` places the Pal on the named output
- [ ] Unplug/disable one output (System Settings → Display, or cable) → `S1_HOTPLUG_EXIT`, process exits, **no Pal left on any output**, clicks fine everywhere

## Gate 7 — fractional DPI

For each scale you actually use (100 %, 125 %, 150 %, 175 % …) and a mixed-scale pair if you have one:

- [ ] `S1_ALLOCATED … surface_scale=` matches the output scale
- [ ] Gate 1 (≥20) + Gate 2 edge probe pass; art and hitbox line up (no offset, no gap ring)
- [ ] Change scale **while running** → `S1_SCALE_CHANGED`/`S1_RESIZED`; hitbox still lines up

## Gate 8 — NVIDIA driver

- [ ] `nvidia-smi` before/after and `journalctl -b --since "-15 min" | grep -iE 'nvidia|kwin|xid'` saved
- [ ] No black overlay, Xid errors, GPU reset, kwin_wayland crash or restart during Gates 1–7

## Gate 9 — safe fallback

- [ ] `BIN --town-only --seconds 30` → small normal window only; desktop fully usable
- [ ] Plasma (X11) session, if available: `BIN --seconds 30` → `S1_SAFE_FALLBACK reason=Not a native Wayland GDK display` + town window; `--require-overlay` exits code 2
- [ ] `GDK_BACKEND=x11 BIN --require-overlay --seconds 5; echo $?` inside Wayland → `2`

## Verdict

Copy results into `device-report-template.md`: PASS / FAIL / UNVERIFIED per
gate, exact SHA, versions, log + image filenames. Persistent interception,
black/opaque overlay or compositor crash anywhere = **automatic FAIL**.
