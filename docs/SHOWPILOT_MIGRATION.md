# Pixel Pals → ShowPilot work-tools phase-out (beta)

**Decision:** ShowPilot is the independent home for convention-center operational tools. Pixel Pals focuses on personal AI, ADHD-friendly Focus Assist, projects, notes, automations, and its personal Second Brain.

## Stage 1 — visible migration notice (implemented)
The legacy Work Tools panel now labels itself as migrating and links to the standalone ShowPilot repository. Its tabs, imports and exports remain accessible. No existing user data is deleted or changed. This phase is deliberately reversible.

## Stage 2 — inventory, backup and parity verification (required before hiding)
- Compare Pixel Pals Events, My Shifts, Deck, Vendors and Floor Map with their ShowPilot replacements on sample files and exported output.
- Verify any browser-local saves can be exported and imported into ShowPilot, or preserve read-only access to them until converted.
- Review /work route, Work Tools navigation, @deck and @price commands, slash suggestions, task shortcuts, saved workspace layouts, and linked documentation.
- Confirm ShowPilot supports the correct **Cobb Galleria Centre (CGC) only** scope, not CEPAC.
- Keep Repo Watch in Pixel Pals if useful independently of event operations; it is not intrinsically a ShowPilot function.

## Stage 3 — hide legacy entry points (planned)
After parity and backup verification, replace prominent Work Tools navigation with a simple 'Open ShowPilot' link and a recoverable legacy-data/export option. Do not silently remove commands, files, or user saves. Keep unrelated personal tools.

## Stage 4 — remove unused code (planned)
Once migrated and confirmed, remove only dead CGC work-specific UI, parsing and scheduling dependencies, tests and help references. Use separate commits to make rollback straightforward. The old /work route should redirect or explain the move rather than break saved bookmarks. Retain personal calendar, tasks, notes, AI and any generally useful utilities.

## Boundaries
- Separate app repositories, build channels and release pipelines.
- Separate Obsidian namespaces: `PixelPals/` for personal memory and `ShowPilot/` for work memory.
- Never merge work event records, employee shifts or private work details into Pixel Pals personal memories automatically.
- Development changes first go to beta; promotion to main requires validation.

**Current status:** Stage 1 only. Remaining stages are not complete and no end-to-end test has been reported.
