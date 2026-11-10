# Pixel Pals — Step 1b isolated grey-box preview (stages 1–3)

**Status:** Draft implementation, dependent on Step 1a PR #40, not mounted in the app. Stage 4 remains unapproved.

## Files and boundaries

- `world-presentation.ts` adds `isoOffice` to the existing **per-device** appearance setting, sanitized to `false` when missing, malformed or old; the current renderer still selects `worldUsesHdOffice` and never calls `worldUsesIsoOffice`.
- `world-iso-schedule.ts` maps stable Pal IDs to nine desk anchors, six uniquely assigned visitor homes, and deterministic ambient targets. **Real activity is an input, never fabricated by ambient scheduling.**
- `world-iso-crowd.ts` implements collision-checked ground-space movement and actor reservations on the sealed Step 1a plan. It is not an integration with the existing flat `WorldCrowd`.
- `world-iso-scene.ts` projects a 19×14 synthetic floor and grey-box furniture and computes a deterministic depth order.
- `world-iso-office.tsx` is a standalone React preview with the six existing HD Office props, plus optional externally supplied camera/viewport/fallback. It uses SVG placeholders, not private or production assets; it is **not imported in room.tsx**.
- Tests cover preference migration, desktop/phone safeguards, stable seat/visitor mapping, honest task status, crowd clearance, depth ordering and isolated component rendering.

## Limitations before Stage 4

- The crowd reservation engine is conservative: it prevents overlap/swaps, but **deadlock-freedom and all 25-second recovery cases are not yet proved**. Simulate doorway rush, opposing actors and blocked seats with independent stress tests before enabling this in a room.
- Preview sprites are circles, labels and direction rays only. Art-layer chair backs, tall furniture and actual HD256 foot contact/occlusion are not established by the SVG grey box.
- The component's internal camera support is a contract only. Real Fit, Follow, zoom, pan and popup UI behavior require deliberate integration with PR #34 and device tests.
- A React error boundary only catches synchronous render errors; the component has a separate asynchronous simulation fail-off guard. Stage 4 must mount the **existing flat HD Office** if the preview fails, rather than showing only the placeholder notice.
- Physical iPhone Safari performance is untested. Phone widths, low-power and data-saver hints are explicitly ineligible for the preview.
- No new importer, asset pack, permission, memory, activity authority or persisted server data exists here.
- A separate release gate is needed for dynamic 15-actor stress, real FPS/heap profiling and real art.

## Safe sequencing

1. Independent Core + QA accept Step 1a at `a244409c279d7e1986899bfb02ba53b99cac664c` or its reviewed successor.
2. Review this stacked Step 1b draft and run full TypeScript, unit, build and existing browser smoke.
3. Resolve PR #34 through UX QA, preserving HD/Pixel/Classic and full-window Room Settings.
4. **Only after separate owner approval:** Stage 4 wiring (room mount, checkbox, style and smoke). Then Gate 1 desktop and physical phone testing.
5. No merge into beta/main, no Unraid deployment, and no private artwork in GitHub as part of stages 1–3.
