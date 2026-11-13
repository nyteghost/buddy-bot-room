# Living Universe — Isometric ground engine (Step 1a)

Status: **library only.** No room, setting, stylesheet or smoke step imports these modules. They change nothing in Classic, Living World, Mobile Pixel or the current flat HD office. Step 1b (a visible grey-box room behind an off-by-default setting) is a separate request and waits for PR #34.

## Modules

| Module | Purpose |
| --- | --- |
| `src/lib/world-iso-projection.ts` | `WorldProjection` interface. `iso` is the approved 2:1 projection: 128 × 64 tiles, ground (0, 0) at world pixel (1216, 400), 64 px per tile of height. `flat` reproduces today's percent-based HD office maths. |
| `src/lib/world-iso-facing.ts` | Eight facings chosen from on-screen travel, at the 2:1 angles: e 0°, se 26.6°, s 90°, sw 153.4°, w 180°, nw 206.6°, n 270°, ne 333.4°. A 120 ms hold stops flicker. Art is never mirrored. |
| `src/lib/world-iso-ground.ts` | Ground plans: a walkable floor polygon, ground-box colliders and anchors. Plans must be sealed (validated, size-limited, deep-frozen) before any query. A* runs on half-tile lines plus clearance lines, every edge passes an exact swept-footprint test, and paths are smoothed. |
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

## Hardening after the Core and QA reviews of `2e1c9d1`

### Trusted plans (sealing)

- **Only sealed plans are walkable.** `worldIsoSealPlan(raw)` checks structure, size limits and geometry, then returns a deep-frozen private copy. `worldIsoValidatePlan(raw)` does the same and also checks ids, the door, anchor placement, reachability and seat links; its `report.plan` is the sealed copy when everything passed, otherwise `null`.
- **Every query on anything else fails closed.** Point, segment, grid, connector, route and path queries return `false`, `[]` or `null` for an unsealed plan.
- **The input is read once.** Each field is read a single time into plain objects, at most limit + 1 entries per list. Checks and the sealed copy both come from that capture, so input that changes between reads cannot pass with one value and be stored with another.
- **Nothing can go stale.** The sealed copy shares no object with the input, so later changes to the input do nothing. Grids and edges are cached per sealed plan. Grid lines and edge lists are frozen, and node points, routes and paths are returned as fresh copies.
- **Room packs (future loader):** parse the manifest, pass the ground plan to `worldIsoValidatePlan`, and use only `report.plan`. Re-validate to pick up an updated pack; the old sealed plan stays valid and unchanged until it is dropped.

### Path smoothing contract (`worldIsoSmoothPath`)

- **Input:** a path that is already walkable on a sealed plan.
- **Returns `null`, never a path, when:**
  - the plan is not sealed, or the radius is unsupported;
  - the path is not a non-empty list;
  - any waypoint is invalid (waypoints are never dropped or skipped);
  - any consecutive pair of waypoints fails the exact swept-footprint test, including two-point paths, or a single waypoint is not free.
- **Otherwise** it returns fresh points with the same first and last waypoint, and every returned segment has passed the exact swept-footprint test.
- `null` means "no verified path", the same result `worldIsoPath` uses.

### Footprint radius and positions

- **Supported radius:** a finite number from 0.1 to 1 tile, inclusive. The default is 0.3.
- **Anything else is refused:** `NaN`, ±`Infinity`, zero, negative, below 0.1, above 1 or not a number. Every query then answers blocked or no route, and the validator reports `radius-invalid`. Nothing is clamped silently.
- **Positions** must be finite numbers within ±1024 tiles. An invalid position is never free, clear or reachable.

### Size limits (`WORLD_ISO_LIMITS`), checked before allocation

| Limit | Value | The approved Office |
| --- | --- | --- |
| Absolute coordinate | 1024 tiles | 19 |
| Floor width and depth | 200 tiles each | 19 × 14 |
| Floor corners | 128 | 4 |
| Colliders | 128 | 14 |
| Anchors | 256 | 48 |
| Grid nodes | 200,000 | 3,294 |
| Grid work (nodes × obstacles) | 20,000,000 | 59,292 |
| Cached grids per plan | 4 radii | 1 |

- Counts are checked first, then coordinates and extent, then geometry. The grid size is computed with arithmetic (`worldIsoGridBudget`) before any navigation array exists.
- An oversized plan gets a named problem (`floor-too-large`, `floor-too-many-corners`, `too-many-colliders`, `too-many-anchors`, `grid-too-large`) and no plan.

### Off-grid passages

- **Solution chosen:** bounded refinement. The grid is rectilinear: half-tile lines plus a clearance line one footprint + 0.005 tile away from each collider side and each floor corner, on both axes.
- **Guarantee:** an axis-aligned passage between colliders, or between a collider and an axis-aligned wall, or formed by axis-aligned floor edges, is found when it is at least 0.61 tile wide for the default footprint (2 × radius + 0.01), at any offset. Narrower than 0.6 is always refused.
- **Endpoints:** start and goal each connect to up to 24 verified nearby nodes (within 1.5 tiles), not one nearest node.
- **Cost stays bounded:** at most two extra lines per collider and per floor corner on each axis, inside the node and work limits above. The search is ordinary A* with the straight-line heuristic.
- **Not guaranteed:** passages bounded by slanted floor edges between 0.6 and 1.1 tiles wide may be missed, because clearance lines are axis-aligned. Room layouts should keep such passages at least 1.1 tiles wide. The validator reports any anchor that ends up unreachable.

## Depth order: guarantees and limits

- **Deterministic:** pairwise ground-box rule, then depth key, then id, for any input order.
- **Cycles:** valid boxes that do not intersect cannot produce an ordering cycle. Intersecting boxes can. The sort then releases the lowest-key item, never loops or throws, and reports `cycles` and `cycleIds`. A renderer must treat `cycles > 0` as a layout fault, not accepted output.
- **Diagnostics:** `worldIsoDepthProblems` reports duplicate ids, invalid boxes, unknown layers, unsliced props longer than 3 tiles and more than 512 items, without throwing.
- **Invalid items never stall drawing:** they are drawn after the valid items in id order and listed in `invalidIds`. Above 512 items only the key order is used.
- **Long furniture:** `worldIsoSliceBox` tiles the footprint exactly, returns the box unchanged for bad input and never returns more than 64 slices. Slicing two crossing long props removes their cycle.
- **Cost:** the pairwise pass is O(n²). A test bounds 15 characters plus 40 props at 5 ms on average. A renderer should re-sort only when positions change.
- **Needs the renderer and real art:** drawn extents of tall props, layers inside one prop (chair back, armrest, monitor), face visibility, cutting a sliced prop's picture to match its slices, and furniture that is not box-shaped.

## Walk playback: guarantees and limits

- **Contact frames** are zero-based: index 0 and 3 for the six-frame walk, `[0, floor(n / 2)]` in general.
- **`speed`** is a character's reference stride speed, which sets stride length. Instantaneous velocity never enters; only distance walked does.
- **Two drivers:**
  - stateless (`worldIsoWalkFrameIndex`), for a fixed clip and stride speed;
  - a per-character phase accumulator (`worldIsoWalkPhaseAdvance` with `worldIsoWalkFrameAtPhase`), which keeps the pose continuous when the stride speed or the facing's clip changes.
- **Standing still** holds the pose. Zero, negative and non-finite distance steps are ignored.
- **Stopping:** `worldIsoWalkPhaseToContact` gives the extra distance needed to land on a contact frame.
- **Reduced motion** shows frame 0 through every function.
- **Bad clips are safe:** frames with a non-positive or non-finite duration are never shown, and no function returns `NaN` or an out-of-range index.
- **Needs the renderer and real frames:** whether feet visibly slide, whether contact poses are drawn at the contact indices, walk-to-idle blending, and how acceleration looks.
