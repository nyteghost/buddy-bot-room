# Independent Windows 11 hardware QA — S4 portable overlay

**Status: NOT STARTED on physical hardware.** CI (GitHub-hosted `windows-2025`, WARP software adapter,
admin account, single virtual display at 100%) only proves the items marked *CI* below.

Do **not** test on employer-managed hardware without written IT approval. Do not bypass SmartScreen,
AppLocker, WDAC, antivirus or other policies; record what they do.

For every item record PASS / FAIL / NOT TESTED plus: device model, Windows build, GPU + driver version,
monitor layout and per-monitor scaling, exact commit SHA, `PixelPals-Portable.zip` SHA-256 (from
`PixelPals-Portable.zip.sha256`), and the `Data/s4-last-run.log` + screenshots/video.

## 0. Preparation

- [ ] Download the CI artifact `PixelPals-Portable-<sha>` from the PR's "Desktop Town S4" workflow run; verify
      the ZIP SHA-256 and `BUILD-INFO.txt` commit.
- [ ] Use a standard (non-administrator) Windows 11 account. Optionally disconnect the network.

## 1. Portable launch (requirements 1–6)

- [ ] Extract to a writable folder (e.g. `Documents\PixelPals-Portable`). Double-click `PixelPals.exe`.
      Expect: no UAC prompt, no console window, no installer, Pal appears near the top-left of the primary
      monitor's work area. Record SmartScreen/WDAC outcome without bypassing.
- [ ] Run `scripts\test-portable.ps1 -ExtractedFolder <folder>` from the source tree (or copy the script) as
      the standard user. All checks PASS (read-only check may report SKIPPED only on privileged accounts).
      *CI: passes as admin on WARP.*
- [ ] Network disconnected: launch, toggle walking, right-click exit, relaunch. Pal position/click count persist.
- [ ] `Data\s4-last-run.log` shows `backend=Dx12`, the real adapter name, `alpha=PreMultiplied`. Record it.
      If D3D12 is refused, record the full fail-closed message (no black/opaque rectangle may appear).
- [ ] Task Manager: no service, no child processes, no elevated token (Details → "Elevated" column = No).
- [ ] Autoruns/registry check: no Run keys, services or scheduled tasks created.

## 1a. First-frame safety (F5) on the real GPU

Run from a PowerShell prompt in the extracted folder, with a visible app (e.g. Notepad) behind the overlay
position, and screen-record each run:

- [ ] `(Start-Process .\PixelPals.exe -ArgumentList '--smoke-test-ms=4000','--qa-fault-first-frame=timeout:never' -Wait -PassThru).ExitCode`
      → prints 4 within ~3 s (PixelPals.exe is a GUI-subsystem exe, so use `Start-Process -Wait`, not
      `$LASTEXITCODE`); **nothing appears**; clicks/typing in Notepad at the overlay position are
      unaffected throughout; `Data\s4-last-run.log` says `FIRST FRAME FAIL-CLOSED`; settings.json unchanged.
- [ ] Repeat with `lost:never`, `outdated:never`, `fatal:1`.
- [ ] `--qa-fault-first-frame=lost:3` (and `timeout:3`, `outdated:3`) → Pal appears normally after the
      retries, log shows `first frame presented after 4 attempt(s)`; no black/opaque/white flash beforehand.
- [ ] Optional: `test-portable.ps1` section 6 performs the same checks automatically with an external
      `IsWindowVisible`/`GetWindowRgnBox` observer; record its output on the physical machine.

## 2. Transparency and click-through (A6)

- [ ] Over a white and a dark wallpaper, the overlay shows only the Pal; no black, grey or white rectangle,
      including right after launch, after hide/show and after a DPI change.
- [ ] **100/100 empty-area clicks** inside the 640x360 overlay bounds but outside the silhouette reach a button
      in **another process** behind it (e.g. a test page or Notepad). Record coordinates.
- [ ] **30/30 Pal clicks** register (`PAL_CLICK n` in the log) and the app underneath receives none.
- [ ] Hover/scroll outside the silhouette goes to the underlying app.

## 3. Focus and z-order

- [ ] Type continuously in Notepad while clicking the Pal 10 times: keystrokes all land in Notepad
      (`WS_EX_NOACTIVATE`), Alt+Tab never shows Pixel Pals, no taskbar button.
- [ ] Overlay stays above ordinary windows; it does not cover the Start menu or UAC secure desktop.

## 4. Fullscreen and presentation suppression

- [ ] Borderless-fullscreen video (browser F11 / video player) on the overlay's monitor → overlay hides within
      ~0.5 s and returns after leaving fullscreen.
- [ ] Exclusive-fullscreen game (if permitted) → hidden; record game FPS with/without S4 (see PERFORMANCE.md).
- [ ] PowerPoint slideshow / Windows presentation settings → hidden.
- [ ] Clicking the desktop wallpaper or maximising Notepad (with and without auto-hide taskbar) → stays visible.
- [ ] Fullscreen app on a *different* monitor → overlay stays visible on its own monitor (exclusive D3D apps
      hide it everywhere by design).

## 5. DPI and monitors

- [ ] 100 / 125 / 150 / 175 / 200 % scaling where available: Pal physical size scales, region matches the drawn
      silhouette (repeat a 10-click sample at the edges of each part), log shows the correct `scale=`.
- [ ] Change scaling while running; move the overlay's monitor between mixed-DPI displays if possible.
- [ ] `--monitor-index=0` and `--monitor-index=1`; a monitor left of/above the primary (negative coordinates).
- [ ] Unplug/replug the overlay's monitor and change taskbar position/size: no crash, overlay stays on-screen.

## 6. Lifecycle and persistence (A12, A17, A18)

- [ ] 20 launch → walk → right-click-exit → relaunch cycles: no crash, focus theft, stuck topmost window or
      opaque rectangle; state persists each time.
- [ ] Replace only `PixelPals.exe` with a newer build: `Data\` state preserved. Roll back: still loads.
- [ ] Corrupt `Data\settings.json`: app exits (code 1), file unchanged, no window flash.
- [ ] Read-only folder (deny write on `Data\` for the standard user, or read-only USB): app runs, log/stderr warns,
      no writes anywhere else (check `%APPDATA%`, `%LOCALAPPDATA%`).
- [ ] Writable USB drive: extract, run, stop, eject/reinsert, run again → state preserved.
- [ ] Sleep/resume, lock/unlock and display off/on while running: overlay still transparent and clickable; if
      presentation fails it must disappear (log: `overlay hidden until a frame presents`) rather than show
      a stale/black rectangle, and reappear only after a fresh frame.

## 7. Security and scope

- [ ] Archive and `Data\` contain no passwords, tokens or account data.
- [ ] PR diff touches only `desktop-town/spikes/s4/**` and `.github/workflows/desktop-town-s4-windows.yml`.
- [ ] Record whether the clean machine has WebView2 (relevant only for a future Tauri build; S4 does not use it).

## Handoff

Provide the SHA, ZIP hash, filled checklist, logs, screenshots/video, performance sheet and a release
recommendation to PM. No Phase 1 integration until an explicit PM/owner gate.
