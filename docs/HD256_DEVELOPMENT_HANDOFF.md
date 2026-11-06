# HD256 Living Universe beta checkpoint — 2026-11-06

Scope: character import, storage, cosmetic rendering and Character Library only.
No production deployment. Shared Intelligence code, Compose, tokens, databases and
original artwork are not edited by this milestone.

## Implemented

- Data-only v3 character ZIPs: explicit 256px frames, eight named directions,
  timed clips, revision, movement metadata and prototype/production labels.
- Strict path, ZIP CRC, entry/count/expanded-size and PNG validation; server-side
  bounded scanline decoding verifies visible transparent artwork.
- Owner-only immutable SHA-256 PNG files under the existing data directory's
  character-assets folder. Metadata updates retain prior JSON snapshots under
  character-history. Assets are never garbage-collected by character removal.
- Explicit preview/selection/install and separate higher-version update approval.
  Same-ID v2 HD imports can upgrade to v3 with expected version zero. Classic32
  editing and existing v1/v2 imports remain supported.
- Portable JSON export includes image bytes; restore is explicit and atomic for
  up to100 characters, never silently overwrites IDs. Portable exports cap at32MiB;
  larger libraries require backup of the entire persistent data directory.
- Direction-aware timed playback uses existing room routes. Missing clips use
  same-direction idle, then south idle; it never fabricates or mirrors artwork.
- Touch/keyboard signature actions are cosmetic. Focus Mode, hidden tabs,
  reduced motion and low-power mode pause optional HD animation.
- Browser recovery export preserves the prior local library. Failed server writes
  do not present unsaved edits as saved; rapid enable changes are serialized.

## Supplied artwork

Private conversion output contains23 individual packs and one Carl/Jason/Violet
combined pack, preserving original IDs and PNG bytes.272 PNGs,244 unique hashes,
28 duplicate groups. All are prototypes. Carl/Jason/Violet have two walking
frames per direction, with single idle/run/emote/signature poses.12 other designs
have directional idle only;8 Cradle designs have south idle only. Full natural
walking, wave and celebration sets require further artwork. No source artwork
is checked into the public repository or overwritten.

Converter: tools/characters/build-hd256-pack.py --source HANDOFF --output NEW_DIR
(Pillow required; refuses an existing output directory).

## Verification and gates

Local full Vitest run:163 files,1491 tests passed, including a temporary private
artifact verification test covering all24 ZIPs through the real importer.
Production Vite/Nitro build passed. TypeScript identified one missing resolution
field in a test fixture; corrected and final TypeScript recheck passed. Runtime
regression recheck:6 tests passed. Published implementation:649d7456e80df0bc9be1a61ddca5ccc2d61bbf4f.
The temporary artifact test is not committed because it references private files.

Browser smoke expanded to cover v2/v3 preview, approval, rendering, owner asset
loading and export. Local Chromium launch is blocked by socket Operation not
permitted. Browser smoke and GitHub CI/Docker publication remain release gates;
no deployment readiness is claimed. Generated routeTree changes from local build
are excluded because they include unrelated Shared Intelligence route generation.

## Next exact tasks

1. Verify GitHub CI/browser smoke on the HD milestone commit; correct failures.
2. Inspect256px rendering and controls at desktop/mobile widths and Focus Mode.
3. Obtain owner visual acceptance of private prototype packs; expand supplied
   animation art without overwriting originals.
4. Improve environment interactions and species-specific locomotion; movement
   metadata currently records intended class, not a new species-specific rig.
5. Only after explicit deployment approval, test upgrade against a copied data
   directory, then follow the existing beta deployment procedure.

Parallel agents actually used: finish_storage, finish_runtime_ui, finish_packs.
They saved code and tests before usage-limit interruptions; root integrated and
retested their changes. Earlier recovery agent details remain in conversation.
