# Independent Windows 11 QA — pending real hardware

Do not test on employer-managed hardware without IT approval. Every item must be marked PASS, FAIL, or NOT TESTED with screenshot/log, device model, GPU driver, DPI, test ZIP hash and exact commit SHA.

## Native overlay

- [ ] Unprivileged clean Windows 11 extraction, double-click launch, no installation, elevation, registry or mandatory background service; record any system DLL/DXC shader dependency.
- [ ] Disconnect network. Open/toggle/close/relaunch; confirm Data/settings.json survives and no Unraid is required; run scripts/test-portable.ps1 as supplementary round-trip check.
- [ ] Real 100/100 empty-area clicks fall through to buttons on **a different process** behind the overlay. Sample across silhouette and outside the region, record coordinates.
- [ ] Real 30/30 silhouette clicks register in PAL_CLICK logs; underlying application receives none.
- [ ] Twenty full launch/hide/close/relaunch cycles, no crashes, focus theft, black region, stuck topmost window or opaque rectangle.
- [ ] Test ordinary windows, borderless fullscreen presentation/game, exclusive fullscreen game if permitted, video player; no unintended overlay during presentation.
- [ ] Test --monitor-index=0 and =1 when available, monitors with negative virtual screen coordinates, monitor hotplug and taskbar changes.
- [ ] Test 100/125/150/175/200% DPI where available, across mixed-DPI monitors; record window/sprite physical bounds and click registration before and after scale change.
- [ ] Verify NOACTIVATE focus behavior with keyboard typing in the underlying process.

## Portability & security

- [ ] Take the ZIP to a clean offline Windows 11 account; run with no admin and no installer, capture SmartScreen/WDAC/AppLocker outcomes without bypass.
- [ ] Binary-only replacement retains Data state. Roll back executable without altering data; test schema version behavior.
- [ ] Writable USB/removable-drive extraction/run, state remains after disconnect/reconnect while process is stopped.
- [ ] ACL-denied/read-only directory: no elevation, alternate write path, silent data loss or overwrite. Verify warning and explicit inability to persist.
- [ ] Corrupt settings: startup fails closed without deleting Data/settings.json.
- [ ] Inspect archive and Data/ for passwords/tokens: none expected or supported. Future DPAPI secure credential scheme is NOT implemented here.
- [ ] Native spike does not require WebView2; separately record whether clean host has WebView2 for future Tauri prototype.
- [ ] Confirm repository change scope is desktop-town/spikes/s4/** only, no production settings, deployment or Unraid mutations.

## Handoff

Unit tests are synthetic. No test on this list has been executed on an actual Windows machine yet. Independent QA must provide exact SHA, build logs, screenshot links, pass/fail matrix, performance sheet, compiler/runner version, and release recommendation to PM. No Phase 1 integration until explicit PM/owner release gate.
