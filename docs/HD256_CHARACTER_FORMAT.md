# HD256 character pack format (v3)

This is a cosmetic artwork contract for Pixel Pals. It does not authorize a
character to use AI, tools, accounts, private memories or the ADHD bridge.
Existing 32×32 v1 packs and nondirectional 256px v2 packs remain supported.

## Minimal pack

Put `character-pack.json` at the ZIP root and include the referenced PNG:

```json
{
  "format": "pixel-pals-character-addon",
  "version": 3,
  "name": "Example prototype",
  "characters": [{
    "id": "user-example01",
    "name": "Example Pal",
    "resolution": 256,
    "revision": 1,
    "artStatus": "prototype",
    "movement": "humanoid",
    "directions": {
      "s": {
        "idle": {
          "frames": [{"file": "art/idle-s.png", "durationMs": 1000}],
          "loop": true
        }
      }
    }
  }]
}
```

The PNG is a separate file, not an external URL or embedded executable. Use
ordinary stored or deflated ZIP entries. Do not nest the entire pack inside
another directory. A bundle of multiple import ZIPs must be unpacked first;
select one individual pack in Character Universe.

## Character identity and clips

| Field | Contract |
| --- | --- |
| `id` | `user-` followed by 8–40 lowercase letters/digits. Preserve it on updates. |
| `name` |2–40 characters, no control characters or angle brackets. |
| `revision` | Integer 1–1,000,000; increase it for a reviewed version update. |
| `artStatus` | `prototype` or `production-approved`. The latter is the pack author's label, not independent app certification. |
| `description` | Optional, up to 1200 characters; no controls or angle brackets. |
| `movement` | `humanoid`, `quadruped`, `flying`, `floating`, `rolling`. Currently descriptive; species-specific route rigs are unfinished. |
| Directions | `s`, `se`, `e`, `ne`, `n`, `nw`, `w`, `sw`. South is front-facing. |
| Actions | `idle`, `walk`, `run`, `turn`, `talk`, `wave`, `celebrate`, `emote`, `signature`, `rest`, `interaction`. |
| Clip | Nonempty `frames` plus a boolean `loop`. Each frame has only `file` and integer `durationMs` (40–10,000ms). |

South idle is mandatory. Each provided direction must include its own idle.
The production-approved label additionally requires idle for all eight directions.
Missing action artwork falls back to that direction's idle, then south idle.
When a pack has no art at all for a facing, the room first borrows the same action
from a supplied direction 45° away (nearer the front first), then that neighbour's idle.
The renderer does not mirror or invent directional frames. Supporting an action
in the format does not mean every room behavior currently triggers it.

Manual wave/signature actions hold position and facing. Starting with the gesture
follow-up, the hold lasts at least 1.7 seconds or the complete selected clip,
whichever is longer. Looping clips repeat during that hold; nonlooping clips keep
their final frame until the hold ends. Focus Mode pauses gesture and route time.
Calm Mode, hidden tabs, reduced motion and low-power mode also suspend optional
animation. The Character Library disables signature controls when those settings
pause the visitor. Select Playful mode to resume room actions.

## Artwork and size limits

- 256×256, noninterlaced,8-bit PNG. RGBA is recommended. Visible artwork and
  transparency are required; fully opaque or empty art is rejected by the server.
- No APNG, SVG, scripts, remote URLs or executable metadata.
- Maximum 520,000 bytes per PNG;32 frames per clip;512 frame references per character.
- Up to 12 characters per ZIP,64MiB ZIP size,96MiB expanded size,2048 entries,
  and 1MiB manifest. A character's unique encoded sources cap at 32MiB.
- Relative paths only, at most 160 characters. Use letters, digits, spaces, dots,
  underscores and hyphens in path segments. No absolute paths, backslashes,
  empty segments or `.`/`..` segments.

Keep full characters inside frame boundaries and preserve consistent foot anchors.
Do not relabel a single pose as a completed walking, wave or celebration cycle.
The supplied Carl/Jason/Violet packs are prototypes with two walking frames per
facing; missing wave/celebration artwork remains a separate art task.

## Approval, storage and updates

The owner previews a pack, selects characters and explicitly approves import.
Installation does not automatically enable a visitor. Existing IDs cannot be
silently replaced. A higher revision uses a separate reviewed update action;
v2 HD characters use revision zero for this explicit migration. Classic 32
characters are not silently converted into HD characters.

HD256 imports require signed-in owner storage. PNGs are immutable hash-addressed
files under the existing persistent data directory's `character-assets` folder.
Character metadata lives in `character-universe.json`, with previous metadata
snapshots in `character-history`. Removing a library entry retains asset files.

Use the owner's Export JSON control for a portable backup including artwork.
Portable UI imports/exports cap at 32MiB; larger libraries need a backup of the
entire persistent data directory. A restore adds reviewed missing characters;
it does not overwrite installed IDs or automatically enable them.

Any future Visiting Pals integration must obtain separate sharing approval and
respect Focus Mode. This format itself transfers no memories or tool permissions.

## Converting designer animation prototypes

`tools/characters/convert-hd256-animation-prototype.py` packages the Character Designer's
multi-frame prototype layouts (`pixel-pals-hd256-character-pack`, `pixel-pals-hd-asset-prototype`,
and per-direction `pixel-pals-hd-character-pack`) as one v3 ZIP per character. It reads the source
archive in place, copies PNG bytes unchanged, keeps `prototype` status, never invents or mirrors
frames, and refuses an existing output folder. Use `--ids ids.json` with the IDs already installed
and a higher `--revision` so the Character Library offers a reviewed version update. Designer action
names map to the closest Pixel Pals action (e.g. `laugh`/`roar` → celebrate, `heal`/`potion`/`ritual`
→ interaction, `strike`/`pounce`/`takeoff` → signature, the manifest's `signatureAction` → signature);
movers without `walk` use `roll`, `glide`, `fly` or `hover` as their walk clip. The conversion report
lists unmapped and missing actions. Generated packs contain private art: keep them out of git.
