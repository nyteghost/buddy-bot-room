# Living Universe — Isometric ground engine (Step 1a)

Status: **library only.** No room, setting, stylesheet or smoke step imports these modules. They change nothing in Classic, Living World, Mobile Pixel or the current flat HD office. Step 1b (a visible grey-box room behind an off-by-default setting) is a separate request and waits for PR #34.

## Modules

| Module | Purpose |
| --- | --- |
| `src/lib/world-iso-projection.ts` | `WorldProjection` interface. `iso` is the approved 2:1 projection: 128 × 64 tiles, ground (0, 0) at world pixel (1216, 400), 64 px per tile of height. `flat` reproduces today's percent-based HD office maths. |
| `src/lib/world-iso-facing.ts` | Eight facings chosen from on-screen travel, at the 2:1 angles: e 0°, se 26.6°, s 90°, sw 153.4°, w 180°, nw 206.6°, n 270°, ne 333.4°. A 120 ms hold stops flicker. Art is never mirrored. |
| `src/lib/world-iso-ground.ts` | Ground plans: a walkable floor polygon, ground-box colliders and anchors. Also a 0.3-tile footprint, half-tile A* (no corner cutting), path smoothing and a plan validator. |
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
