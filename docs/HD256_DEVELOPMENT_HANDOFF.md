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

Implementation commit:649d7456e80df0bc9be1a61ddca5ccc2d61bbf4f.
Smoke correction and tested release:2d70e4ea174e03a7f54ca65974bce5a976faed27.

- GitHub CI42245998026: TypeScript,162 test files /1467 tests, production build
  and real browser smoke passed. Smoke includes v2/v3 ZIP preview, approval,
  rendered256px art, immutable owner asset access and backup export.
- First implementation smoke failed on outdated install-confirmation text; the
  corrected release above passed. No product failure is hidden by that result.
- Local full run including private pack verification:163 files /1491 tests passed.
  All24 private ZIPs passed the real application importer. Separate full server
  decoder checks passed for all272 supplied PNGs (273 assertions/tests).
- Local production build and TypeScript passed. Local Chromium cannot launch due
  to sandbox socket restrictions; real browser results above come from GitHub.
- Publish workflow42245998035 passed, including immutable tag verification:
  ghcr.io/nyteghost/buddy-bot-room:beta-2d70e4ea174e03a7f54ca65974bce5a976faed27
  digest sha256:ecaf7539c657d0e86a6bc3372e4fa3aa7591203fd6a7ea762ebb308c321ddd26
- No Unraid deployment or live-data migration was performed.

Temporary private-artifact tests are excluded from GitHub. Generated routeTree
changes from local build were excluded because they contain unrelated bridge
route generation. Private fan artwork is distributed separately, never committed.

## Next exact tasks

1. Use the immutable tested release above for review; obtain deployment approval.
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
