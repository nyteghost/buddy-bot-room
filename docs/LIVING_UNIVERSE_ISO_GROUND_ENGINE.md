# Living Universe — Isometric ground engine (Step 1a)

Status: **library only.** No room, setting, stylesheet or smoke step imports these modules. They change nothing in Classic, Living World, Mobile Pixel or the current flat HD office. Step 1b (a visible grey-box room behind an off-by-default setting) is a separate request and waits for PR #34.

## Modules

| Module | Purpose |
| --- | --- |
| `src/lib/world-iso-projection.ts` | `WorldProjection` interface. `iso` is the approved 2:1 projection: 128 × 64 tiles, ground (0, 0) at world pixel (1216, 400), 64 px per tile of height. `flat` reproduces today's percent-based HD office maths. |
| `src/lib/world-iso-facing.ts` | Eight facings chosen from on-screen travel, at the 2:1 angles: e 0°, se 26.6°, s 90°, sw 153.4°, w 180°, nw 206.6°, n 270°, ne 333.4°. A 120 ms hold stops flicker. Art is never mirrored. |
| `src/lib/world-iso-ground.ts` | Ground plans: a walkable floor polygon, ground-box colliders and anchors. Also a 0.3-tile footprint, half-tile A* whose every edge passes an exact swept-footprint test, path smoothing, and a plan validator that fails closed on malformed geometry. |
| `src/lib/world-iso-depth.ts` | Draw order using the ground-box rule plus a deterministic topological sort. Decals are drawn first and overhangs last. Includes a slicing helper for props longer than 3 tiles. |
| `src/lib/world-iso-gait.ts` | Distance-based walk playback (pure helper; nothing calls it yet). |
| `src/lib/world-iso-greybox.ts` | Synthetic 19 × 14 Office plan, coordinates only. It has 9 seats facing SE/SW with chairs on the wall side, standing fallbacks, 6 visitor homes, 4 chat pairs and the flat office's anchor ids. |

## Conventions locked by tests

- **Units:** ground coordinates are tiles (`u`, `v`). +u runs down-right on screen and +v runs down-left. Depth is `u + v`, with larger values nearer the viewer.
- **Walk contact frames are zero-based.** In the approved six-frame walk (one full two-step cycle), the contact poses are **index 0 and index 3**. Counting from one, these are frames 1 and 4.
- **Import vs playback:**
  - Character Universe v3 frame `durationMs` values are validated and stored by the importer, unchanged.
  - Today's rooms play clips by elapsed time (`worldHdFrameAt`).
  - The isometric helper reads the same durations as one stride cycle at the reference speed of 1.6 tiles/s, and chooses the frame from the distance walked. A 6 × 120 ms walk covers 1.152 tiles per cycle.
  - Nothing in the import format changes.
- **Facing:** diagonal facings are true three-quarter views (body turned 45° from the front). Only the on-screen direction of travel follows the 26.6° floor lines.

## Not in Step 1a

- No renderer, UI or setting.
- No room-pack loader.
- No art.
- No storage or schema change.
- No change to `world-crowd`. A ground-space crowd simulation (9 + 6 actors over 20 simulated minutes) needs a crowd adapter in ground units. It is proposed for Step 1b, so the current crowd code stays untouched.
- Performance and real-iPhone checks start at Gate 1.

## Corrections after the PM review of `660a0ee`

- **Path optimality:** all path quantities are in tiles: node positions, edge costs (0.5 and 0.5·√2) and the octile heuristic (`worldIsoOctileTiles`). Tests compare A* with a plain Dijkstra search on six obstacle layouts and require the same distance. They also check that the heuristic never over-estimates.
- **Swept footprint:** every grid edge, orthogonal or diagonal, is accepted only if the whole 0.3-tile disc stays clear along it. The test is exact (segment-to-box and segment-to-floor-edge distance) and replaces the earlier 0.05-tile sampling. Smoothed segments use the same test. An independent dense-sampling check in the tests confirms every raw edge and every smoothed segment.
- **Validation:** the validator never throws. It rejects:
  - self-intersecting floors;
  - zero-area floors, slivers and repeated corners;
  - non-finite or missing geometry;
  - malformed colliders;
  - malformed anchors;
  - a door anchor whose kind is not `door`.
- **Fail closed:** on a plan with bad geometry there is no navigation grid, no point is free, and path queries return `null`.

## Depth order: what is and is not verified

Verified with synthetic ground boxes:

- The order is deterministic for any input order. Ties break by depth key, then id.
- Intersecting boxes are ordered by the fallback key without throwing.
- The tested cases are correct: the far end of a long desk, a character seated between chair and desk, a character behind or in front of a tall shelf, the decal and overhang layers, and sliced long props.

Not verifiable until real furniture art and sprite sizes exist (Step 1b / Gate 1):

- **Drawn extents:** the sort knows ground footprints only. It has no sprite height, pixel bounds or `anchorPx`. A tall prop's picture can cover screen area outside its footprint's `u − v` range, and the sort places no constraint there.
- **Parts of one object:** chair backs, armrests, monitors and sofa backs are separate layers of the same prop. Their order relative to a seated character comes from the room pack's named layers, not from this sort.
- **Face visibility:** whether a monitor or chair back hides a seated face depends on the art's heights.
- **Props that are not boxes:** L-shaped or round furniture must be split into boxes; the right split depends on the art.
- **Characters close together:** two characters nearer than a sprite width are ordered by depth key; whether that looks right depends on sprite proportions.

The synthetic depth tests do not establish visual correctness.
