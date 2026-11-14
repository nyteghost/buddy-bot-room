# S1 physical acceptance — CachyOS · KDE Plasma 6 · KWin Wayland · NVIDIA

**Only evidence gathered on the physical machine counts here.** The headless
CI (sway/weston/Xvfb, software rendering, virtual pointer) shows the code
works on *a* layer-shell compositor; it is **not** KWin, Plasma or NVIDIA
evidence. Installing the build on the owner's PC needs the owner's separate
authorization (see `../INSTALL-CACHYOS.md`).

## Before you start

| Item | Command / note |
| --- | --- |
| Exact build | `git rev-parse HEAD` in the checkout, or `pacman -Q pixel-pals-s1-overlay-dev` (version ends in `.g<SHA>`) |
| Helper | `H="bash qa/owner_kde_gates.sh"` (installed: `bash /usr/share/pixel-pals-s1/qa/owner_kde_gates.sh`) |
| Evidence folder | `~/pixel-pals-s1-evidence/<date>/` (created by the helper) |
| Kill switch | `pkill -TERM -f pixel-pals-s1-kwin-overlay` from a 2nd Konsole; if the desktop is unusable: Ctrl+Alt+F3 → log in → same command |
| Screenshots | `spectacle -b -n -o <file>.png` (mask notifications/usernames) |
| Report | fill `device-report-template.md` as you go |

Stop immediately and record **FAIL** on: any `S1_SPURIOUS_CLICK`, a click
that does not reach the window under an empty area, any black/grey/opaque
rectangle, a KWin crash/restart, or keyboard focus moving to the overlay.

## A. Environment (Gate 0)

- [ ] `$H env` → `env.log` shows `SESSION_TYPE: wayland`, Plasma/KWin version, NVIDIA driver, `zwlr_layer_shell_v1`, every output with scale
- [ ] `$H smoke` → `G0 PASS`; you saw the Pal appear and vanish after 5 s

## B. 100 click-through trials (Gate 1)

1. Konsole A: `python3 qa/underlay_click_counter.py | tee ~/pixel-pals-s1-evidence/<date>/g1-underlay.log`
   (grid of 100 numbered targets; runs via XWayland — it is "the desktop").
   If it hides the Pal (fullscreen X11 stacking), press Esc and maximise it instead; record which.
2. Konsole B: `$H run --speed 0 --layer top --seconds 900`
3. Click every numbered cell once, **outside** the Pal.

- [ ] underlay: `Pass-through: 100/100`, `unique target cells: 100/100`
- [ ] `$H summary` → `pal=0 spurious=0` for that run
- [ ] Moving variant: restart with `--speed 4`; click 20 cells the Pal has just left → all counted by the underlay, `spurious=0`

## C. 30 Pal hitbox interactions (Gate 2)

With `$H run --speed 0 --seconds 900`:

- [ ] 30 clicks on the blue disc → `pal=30`, underlay count unchanged, `spurious=0`
- [ ] Rim: 8 clicks just inside the edge → Pal; 8 clicks ~5 px outside → underlay
- [ ] Moving: `$H run --speed 4 --seconds 120`; 20 attempts on the moving Pal; record hits/20 (timing-dependent, not pass/fail on its own)

## D. 20 overlay lifecycle cycles (Gate 3)

- [ ] `$H lifecycle` → `20/20 process lifecycle cycles succeeded`
- [ ] Afterwards: no Pal anywhere, clicks work where it was, no KWin notification/restart

## E. KDE / KWin behaviour (KWin-specific, not covered by CI)

With `$H run --speed 4 --seconds 900` running, check and note each:

- [ ] Plasma panel: Pal never covers the panel; panel stays clickable (surface uses `exclusive_zone=0`)
- [ ] Overview / Desktop Grid (Meta+W / Meta+G): no crash; note whether the Pal is shown
- [ ] Virtual desktop switch (Ctrl+F1..F4 or Meta+Ctrl+arrows): Pal stays, no stuck input
- [ ] Alt+Tab and Meta (launcher) open and work normally over the Pal
- [ ] Lock screen (Meta+L) then unlock: Pal not visible on the lock screen; works after unlock
- [ ] `--layer bottom`: Pal hidden behind normal windows; visible on an empty desktop; clicks on it work only where it is visible
- [ ] Notifications/OSD (volume keys) appear normally

## F. NVIDIA transparency (Gate 4 + 8)

Put a patterned wallpaper or a window with fine detail behind the Pal.

- [ ] `before.png` → `$H run --speed 0 --seconds 120` → `during.png` → stop → `after.png`: only Pal + faint home marker differ; no black/grey box, no halo, no flicker
- [ ] Repeat with each GTK renderer and note differences:
      `GSK_RENDERER=ngl …`, `GSK_RENDERER=vulkan …`, `GSK_RENDERER=cairo …` (prefix the `$H run` command)
- [ ] `nvidia-smi` before/after; `journalctl -b --since "-20 min" | grep -iE 'nvidia|NVRM|Xid|kwin'` saved — no Xid, GPU reset or kwin_wayland crash
- [ ] If Spectacle cannot capture layer surfaces: record that and use an OBS screencast; no image = **UNVERIFIED**, never PASS

## G. Multiple monitors + hotplug (Gate 6)

- [ ] `$H run --all-monitors --speed 0`: one `S1_READY` + `S1_ALLOCATED` per output, Pal centred on each
- [ ] On **each** output: ≥20 empty-area clicks reach the window below; ≥10 Pal clicks log `S1_PAL_CLICK monitor=<connector>`
- [ ] `--monitor <CONNECTOR>` (names from `S1_OUTPUT` lines) places the Pal on that output only
- [ ] Disable/unplug one output (System Settings → Display or cable): `S1_HOTPLUG_EXIT`, process exits, **no Pal left on any output**, clicks fine everywhere

## H. Fractional scaling (Gate 7)

For each scale you actually use (100/125/150/175 %) and a mixed-scale pair if available:

- [ ] `S1_ALLOCATED … surface_scale=` equals the output scale
- [ ] 20 empty clicks + rim probe pass; art and hitbox line up (no offset, no gap ring)
- [ ] Change scale **while running** (System Settings → Display → Scale → Apply): either the overlay stays up and logs `S1_SCALE_CHANGED`/`S1_RESIZED` with a correctly aligned hitbox, or it exits with `S1_HOTPLUG_EXIT` leaving nothing behind — record which

## I. Fullscreen games (Gate 5) — save your game first

For `--layer top` and `--layer bottom`, each with **borderless** and **exclusive** fullscreen:

- [ ] Is the Pal visible over the game? (yes/no; headless sway: no)
- [ ] Mouse + keyboard work everywhere in the game, including where the Pal would be
- [ ] `$H summary`: no `S1_PAL_CLICK` while you were only clicking in-game
- [ ] Alt+Tab out/in works; no stutter/tearing beyond the no-overlay baseline (compare a run without S1)

Any in-game input interception = **FAIL**; mitigation is quit / `--town-only`.

## J. Focus preservation (Gate 8)

- [ ] Click into a text editor (Kate) and start typing; in another Konsole launch `$H run --speed 4 --seconds 120` **without clicking anything** → typing continues in Kate uninterrupted
- [ ] Click the Pal 5 times, then type immediately → text goes to Kate (the Pal never takes keyboard focus; layer keyboard mode is `None`)
- [ ] The task bar never shows an entry for the overlay; Alt+Tab never offers it

## K. Fail-closed behaviour (Gates 6, 9)

- [ ] `$H failclosed`: SIGTERM PASS; after SIGKILL the Pal is gone and the spot is clickable (answer `y`); `strict-x11-exit=2`; `default-x11-exit=0` with a town-only window; `town-only-exit=0`; `unknown-monitor-exit=2`; "town-only windows shown (expect 2): 2"
- [ ] Plasma X11 session (if installed): `pixel-pals-s1-kwin-overlay --seconds 20` → `S1_SAFE_FALLBACK reason=Not a native Wayland GDK display` + small town window only

## Verdict

Record PASS / FAIL / UNVERIFIED per section in `device-report-template.md`
with the exact SHA, versions, log and image filenames. Persistent
interception, a black/opaque overlay, focus theft or a compositor crash
anywhere = **automatic FAIL** / NO-GO.
