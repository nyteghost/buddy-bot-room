# Living Universe HD (desktop) and Pixel (mobile) — feasibility and design

Status: investigation + isolated prototype on `claude/living-universe-hd256` (draft PR #24). Nothing here is
wired into the app's rooms yet; owner/PM approval decides the build scope (Issue #26).

## 1. Summary and recommendations

| Question | Recommendation |
| --- | --- |
| Make desktop characters larger | Use a **virtual room larger than the viewport, seen through a camera** (zoom, pan, follow). Do not enlarge today's 1536×864 room JPGs: at 2× zoom they are visibly soft, and their furniture is painted into the floor. |
| Room art | **Layered environments**: a background (walls, floor) plus separate furniture/prop sprites, each with a floor footprint and a baseline. Characters are drawn behind or in front of a prop by depth, so the floor behind furniture becomes walkable (today the horror mansion has to block most of its floor because characters would be drawn over the armchairs). |
| HD character scale | The character is the unit of scale: a 256×256 frame is drawn over **192 world px** (figure ≈ 177). Zoom is capped at **0.85**, so painted 256 art is never enlarged more than 1.25 device pixels per art pixel on a 2× screen. Default desktop view ≈ 0.55 (figure ≈ 97 CSS px, about 1.4× today's 70 px); whole-room view ≈ 0.36–0.5. |
| Mobile | **Pixel presentation with its own compact room layout** (or a framed part of the room that follows a Pal), with authored modern pixel-art sprites drawn crisp. Shrinking the desktop world onto a 390 px phone gives ≈ 24 px characters — not usable. |
| Painted vs pixel art | Painted HD art is always scaled smoothly (no nearest-neighbour, no pixel snapping); only grid-aligned pixel art is drawn crisp. Enforced by `world-scale.ts` and a stylesheet regression test. |
| One app | Presentation is a per-device view setting. Pals, memories, conversations, AI providers, tasks, permissions and Unraid data are shared and untouched. |

## 2. Expanding the existing rooms vs a virtual room with a camera

| | Enlarge existing room | Virtual room + camera (recommended) |
| --- | --- | --- |
| Art source | Existing 1536×864 JPGs, upscaled | New layered art at world resolution (or vector/tiles) |
| Sharpness at larger character sizes | Soft/blurry beyond ~1.2× | Sharp: art authored for the world size |
| Occlusion | Furniture is part of a flat image: characters must avoid its whole silhouette | Props are separate layers: walk behind sofas and desks |
| Usable floor | Small (horror mansion: four disconnected pockets) | Large, connected |
| Phone | Same image, small characters | Pixel presentation uses its own compact room |
| Cost | Low code, no new art, little benefit | Camera + layered room format + new room art per theme |
| Navigation / crowd code | Unchanged | Unchanged: floors, wander and crowd already use percent coordinates and work at any world size (prototype proves it) |

## 3. Prototype (isolated, reversible)

`tools/prototypes/living-universe-hd/` builds one self-contained HTML page (`node …/build.mjs`) with
**placeholder art drawn in code**: a 2752×1600 world (the app's 1.72 aspect), nine layered props, six
placeholder 256×256 characters with eight facings and a walk cycle, and the app's real `world-floor`,
`world-wander`, `world-crowd`, `world-camera` and `world-presentation` code. It is not part of the app
build, reads/writes no Pixel Pals data and is deleted by removing the folder. A `lab-` floor plan key keeps
it away from every app room (`worldRegisterLabPlan` refuses other keys).

New groundwork modules (tested, not wired into the app):
- `src/lib/world-camera.ts` — cover-fit limits (never letterboxes), zoom at a cursor or pinch centre,
  pan clamping, two-finger pinch, follow with a dead zone and easing (snaps with reduced motion), visible
  rectangle for culling, CSS transform.
- `src/lib/world-presentation.ts` — automatic HD/Pixel default, manual override, art-source fallbacks.

## 4. Character scaling and rendering

- World unit: 1 world px = 1 CSS px at zoom 1. HD frame 256 → 192 world px. Feet anchored at the frame's
  measured foot row (existing `world-scale.ts` measurement), shadow ellipse under the feet.
- Depth: z-order from the feet (`y`), props sorted with the same rule using their footprint's bottom edge.
- HD painted art: `image-rendering: auto`, decoded at native size, drawn by the GPU through the camera
  transform; no forced enlargement (camera max zoom).
- Pixel art: authored at its own size (e.g. 64×64 or 96×96 frames with a designed figure height), drawn
  with whole-number device-pixel scaling and `image-rendering: pixelated` (existing crisp rules).
- Label tags live in a screen-space overlay (constant size and readable at every zoom); hidden below 40 %
  zoom except for the followed character.

## 5. Navigation and crowding

- Floors stay in percent coordinates; each room supplies obstacles (prop **footprints**, not silhouettes),
  homes, visits, entries and furniture stand points. `world-wander` plans itineraries, `world-crowd` keeps
  actors apart (keep-right steering, waiting, catch-up, A* around furniture and standing people, jam
  clearing). Crowd footprints scale with the character size (prototype: rx 1.4 %, ry 0.8 %).
- The current six-active-visitor limit and the nine Pals are unchanged.
- Measured with the real code in the current rooms (9 Pals + 6 visitors, 4 minutes): footprint overlap
  0.03–0.08 % of samples (was 2–9 %), deep overlap 0 %, no off-floor positions, longest stuck spell ≤ 20 s.

## 6. Camera and controls

| Input | Desktop | Phone / tablet |
| --- | --- | --- |
| Pan | drag, arrow keys / WASD | one-finger drag |
| Zoom | wheel or trackpad pinch at the cursor, `+`/`−`, double-click, toolbar | two-finger pinch at the fingers' midpoint, toolbar |
| Fit room | `0`, toolbar | toolbar |
| Follow | click a character, `F` cycles, `Esc` stops; select box | tap a character |

Rules: the viewport never shows outside the world; manual pan stops following; the camera eases (half-life
260 ms) and only moves when the followed character leaves the central 30 % dead zone, so small steps never
shake the view. Touch uses `touch-action: none` inside the room only, so the page still scrolls elsewhere.
Toolbar buttons are ≥ 40 px on phones.

## 7. Dual HD / Pixel architecture (one app, one state)

```
Pal identity, memories, AI, tasks, permissions, Unraid data   (shared, unchanged)
                 │
     movement + behaviour state machine   (shared: floor plan, wander, crowd, actions)
     idle · walk · turn · talk · wave · celebrate · emote · signature · rest · interaction
                 │
     presentation = worldPresentation(saved choice, device hints)   "hd" | "pixel"
        ┌────────┴─────────┐
   HD frames (hd3 v3)   Pixel frames (proposed `pixel` block, same v3 clip schema)
   layered HD room       compact pixel room (same floor semantics, its own coordinates)
```

- **Default**: desktop/tablet (> 700 px) → HD; phones (≤ 700 px), data-saver or low-power → Pixel.
- **Manual override** on either device (Auto / HD / Pixel), saved per device in `localStorage`
  (`pixel-pals-presentation-v1`), like today's per-device Pal looks. It never touches server data.
- **Shared state machine**: both styles use the same actions, facings and fallback order
  (`selectWorldHdClip`); each style supplies its own frames and timings.
- **Asset fallbacks** (`worldArtSource`): HD → approved HD art, else the Pixel sprite drawn crisp, else the
  native 32 px sprite. Pixel → Pixel sprite, else native 32 px sprite, else HD art downsampled and marked as
  a fallback (never treated as production pixel art). Nothing disappears when a style is missing.
- **Pack format (proposal)**: keep `hd3` as the HD look; add an optional `pixel` block with the same
  direction/clip schema at 64/96 px, declared grid and figure height. Importer, revision and safe-import
  rules stay the same; older packs keep working.
- **Classic mode** stays a separate room style and is unaffected. Reduced motion freezes walking and makes
  the camera snap; low power and hidden tabs pause animation as today.

## 8. Performance

| Item | Measurement / estimate | Mitigation |
| --- | --- | --- |
| Prototype frame cost | 0.10–0.4 ms JS per frame for 6 actors (headless Chrome; frame rate there is throttled, not a device figure) | DOM transforms only; canvas redraw only when the frame changes |
| Crowd engine | 18–44 µs per actor update (15 actors, 10 Hz ≈ 7 ms/s) | already bounded; A* at most once per actor per 1.5 s |
| HD frame memory | 256×256 RGBA = 256 KB decoded; a full v3 pack (128 frames) ≈ 32 MB; 15 actors ≈ 480 MB if all decoded | decode only the active facing/clip, release off-screen actors, cap simultaneous HD actors on low-memory devices |
| HD room art | one 2752×1600 world at 2× would be a 5504×3200 bitmap (≈ 70 MB decoded) | layered props + 2–4 background tiles at ≤ 4096 px, or vector backgrounds; lazy-load per theme |
| Pixel frames | 64×64 = 16 KB decoded per frame | fine on phones |
| Off-screen actors | prototype hides them and skips canvas work | keep culling; pause their animation |

Needs real-device measurement (owner hardware): frame rate and battery on the owner's iPhone in Pixel
mode, desktop GPU memory with real HD packs.

## 9. Accessibility

- Room is a focusable region with a descriptive label; full keyboard camera control; visible focus ring.
- Following announces through a polite live region; toolbar buttons have names; touch targets ≥ 40 px.
- Reduced motion: no camera easing (snap), walking paused, no auto-zoom. Low power / hidden tab: animation
  paused (existing behaviour).
- Constant-size name tags in screen space; they hide when covered (existing label rule) and below 40 % zoom.
- Avoid motion sickness: capped camera speed, dead zone, no rotation or parallax shake.
- Still to design in the app: a list view of characters in the room (screen-reader alternative to the
  canvas world) and a setting to keep the camera static.

## 10. Real Nova integration (when the Character Designer's two approved samples arrive)

1. Import the HD and Pixel samples privately into a disposable data directory (no live data, no commit).
2. Run the real app build against that directory (owner command on a spare port, or CI-style local run).
3. Show Nova in the office, horror mansion and Matrix rooms at desktop (1440×900, 2×) and iPhone (390×844, 3×).
4. Capture screenshots and short videos, labelled **running app** versus **illustrative preview**.
5. Report scale, feet, navigation, crowding and performance on #26.

## 11. Decisions needed from the owner/PM

1. Approve the virtual-room-with-camera direction and the character scale (192 world px, max zoom 0.85).
2. Commission layered room art (background + separate props with footprints) for the first HD theme.
3. Confirm Pixel mobile uses its own compact room layouts (recommended) rather than a framed part of the HD room.
4. Approve the `pixel` pack block proposal before the Character Designer produces Pixel frames.
5. Choose where the Auto/HD/Pixel override lives (Room settings vs Character Library).
