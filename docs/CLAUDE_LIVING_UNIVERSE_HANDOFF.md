# Claude development handoff — Living Universe 2.0 / HD256

Prepared: 2026-11-07. Repository: `nyteghost/buddy-bot-room`.
**Work only on `claude/living-universe-hd256`, initially based on `beta` commit
`edae2e602489ff3dccf3dcfd567624b72b4dc31b`.** Do not push directly to
`beta` or `main`. This branch was created for Claude; creating the branch
does **not** run a Claude session or recover uncommitted Work workspace files.

## Mission

Complete the original Living Universe 2.0 / HD256 visual-character work with
a high-quality, actively animated world, while retaining all existing Pixel Pals
core functionality. Focus on original Pal designs, guest movement, character
ZIP importing, environment interactions, ergonomic desktop/mobile UI,
performance and accessibility. This is not an AI-agent-permission migration:
visual guests are cosmetic, not autonomous entities with tool access.

Do **not** claim the world is complete just because its existing model,
parser, atlas or runtime passes a fixture test. Inventory the remaining visual
asset and UX work and close it in small, testable increments.

## Read first

- `docs/HD256_DEVELOPMENT_HANDOFF.md`: definitive Work-session recovery and
  release notes, including what is complete and what remains visual QA.
- `docs/HD256_CHARACTER_FORMAT.md`: actual character ZIP v3 specification.
- `docs/LIVING_WORLD_2_BETA.md`: themes, room behavior, ambient effects,
  obstacle-aware routes, guests and visual-only interaction policy.
- `docs/CHARACTER_ZIP_IMPORT.md`: earlier v2 compatibility; v3 is later.
- `docs/MASTER_ROADMAP_AUDIT.md`: other outstanding feature boundaries.
- Existing tests under `src/test/world-*`,
  `src/test/character-*` and `tools/smoke/hd-character-zip.mjs`.

Key source modules:
`src/lib/world-hd.ts`, `src/lib/world-hd-animation.ts`,
`src/lib/world-navigation.ts`, `src/lib/world-animation.ts`,
`src/lib/character-zip.ts`, `src/lib/character-assets.server.ts`,
`src/lib/character-universe.server.ts`,
`src/components/world-visitor.tsx`,
`src/components/world-character-library.tsx`,
`src/components/world-guest.tsx`, `src/components/world-custom-guest.tsx`,
`src/components/world-atmosphere.tsx`,
`src/components/room-live.tsx` and related visual styles.

## Verified checkpoint — don't redo

The handoff document records an HD256 v3 implementation, owner-only
import/export with immutable SHA-256 PNG storage, directional 256px timed
clip playback, character history and revision checks, bounded ZIP validation,
Focus Mode/low-power/reduced-motion pauses and a private pack converter.
It records release `4aa09479a837f4816ca9074576a3ac9a837b4267`
with a passing CI run and browser smoke, including stationary gestures and
signature action release. These are source/documentation claims to verify
against the actual starting branch, not permission to deploy.

The artifact conversion notes record 24 private prototype packs; those
art files are **not** in the public repository. Do not make up missing
source art, alter its provenance or require uploading private assets to
a public service.

## Main unfinished assignments

1. Inspect existing room movement, gesture timing, world atmosphere,
   collisions, camera layers and responsive layout. Produce a short gap report
   distinguishing implemented functionality, missing real artwork and bugs.
2. Expand polished HD256 original-character animation where source art exists:
   coherent eight-direction walk cycles, pause/idle, wave, celebration and
   signature gestures. Never fake missing proprietary/private frames or claim
   idle poses are full animation. For absent source art, mark as prototypes and
   create separately identifiable original art only with approval.
3. Improve environmental life: interactive furniture and props, more natural
   scene-aware locomotion, unobtrusive character-to-character cues and
   theme-appropriate atmosphere. Preserve floor-plan collision and safe room
   routing. Never block navigation to mail, Today or other functional tools.
4. Validate display behavior for desktop and narrow/mobile widths, touch and
   keyboard, focus/low-power/reduced motion, and hidden-tab resumption.
5. Preserve safe data-only ZIP v2/v3 imports, approval and revision/rollback
   semantics, owner-only storage, no executable extensions, no overwrite of
   original PNGs, no data-loss on failed save, and no side effects on
   established AI Pal identities or memory.
6. Add focused tests and browser smoke for each new behavior; run TypeScript,
   unit tests, production build and CI, and report the exact pass/fail state.
   Provide an owner-readable visual QA checklist for iPhone/desktop.
7. When stable, open a **draft pull request targeting `beta`** for human
   review. Include screenshots/test evidence when available and plainly list
   remaining art, device QA or unverified acceptance items.

## Strict workstream boundaries

Claude **owns Living Universe / HD256 visual character source only**:
`src/components/world-*`, `src/components/room-live.tsx`, approved
`src/lib/world-*`, `src/lib/character-*`,
`src/test/world-*`, `src/test/character-*`,
`tools/characters/`, `tools/smoke/hd-character-zip.mjs`,
and associated documentation, tests and visual styles.
Changes to shared application navigation/layout require a minimal targeted
diff and an explicit note in the PR.

ChatGPT retains ownership of `tools/adhd-v02/`, `docs/ADHD_*`,
`src/lib/adhd-bridge*`, `src/routes/api.adhd-bridge*`,
Caddy/Unraid install scripts and work on ADHD Assistant authorization.
Do **not** edit those paths. Do not edit `.github/workflows/`,
`docker-compose*`, `main`, credentials, data volumes, production
settings, memory migration, Discord tokens or deployment config.

If a change genuinely requires a cross-owned file, explain the desired
edit and request review; do not silently change or cherry-pick it.
Do not merge from `beta` automatically while another developer may be
working; coordinate before rebase or conflict resolution.

## Safety and operational gates

- Work on the Claude branch, keep `main` untouched, and never deploy to
  the user's Unraid server or modify live appdata.
- Keep the original room, Classic mode, data records and nine established
  Pal identities compatible. Preserve user selections and backups.
- Visual guests remain cosmetic: no unattended emails, calls, file edits,
  background AI jobs, sensor access, memories, or tool permissions.
- Respect copyright and asset provenance: do not copy private proprietary art
  into public commits without permission.
- Make visible claims match real code/tests. A green CI is not a substitute
  for real hardware visual acceptance.

## First Claude reply requested

Report (a) actual branch/commit checked out, (b) what Work already committed,
(c) the top three unfinished HD256 items with affected code paths,
(d) an incremental implementation plan, and (e) any genuinely blocked
artwork or hardware acceptance. Then begin the highest-value safe code
increment and commit it to the Claude branch, followed by focused tests.
Do not require the owner to re-explain the project or run repetitive
terminal diagnostics.
