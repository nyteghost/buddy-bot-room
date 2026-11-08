# Living Universe HD — camera lab (isolated prototype)

A disposable proof of concept for the desktop **Living Universe HD** direction (Issue #26): a larger virtual
room seen through a camera (zoom, pan, follow), with characters drawn from 256×256 frames moving naturally
using the app's real floor, wander and crowd code. **All art is placeholder, drawn in code** — no assets,
no private character art, no network, no saved data.

```bash
node tools/prototypes/living-universe-hd/build.mjs        # → tools/prototypes/living-universe-hd/dist/index.html (git-ignored)
```

Open `dist/index.html` in any browser. It is not part of the app build, not linked from the app and does not
read or write Pixel Pals data. Remove the feature by deleting this folder (plus the unused groundwork
modules listed below if they are not adopted).

What it bundles from `src/lib` (transpiled with TypeScript, unchanged):
`world-floor` (the lab registers its own `lab-` floor plan; app rooms cannot be replaced), `world-wander`,
`world-crowd`, `world-camera`, `world-presentation`.

Controls: drag / one finger to pan, wheel / trackpad pinch / two fingers to zoom at the pointer, double-click
to zoom in, click or tap a character to follow, keyboard (focus the room) arrows/WASD, `+`/`−`, `0` fit,
`F` follow next, `Esc` stop following. URL options for repeatable captures: `?static=1&t=15000&zoom=0.55&follow=1&look=hd|pixel`.

Findings and the dual HD/Pixel architecture are in `docs/LIVING_UNIVERSE_HD_PIXEL_DESIGN.md`.
