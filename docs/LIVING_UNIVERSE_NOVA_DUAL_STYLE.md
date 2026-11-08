# Nova dual-style (Desktop HD + Mobile Pixel): integration notes and artwork request

Status: development only, on `claude/living-universe-hd256` (draft PR #24). Private artwork is **not** in this repository.

## 1. What was delivered (private handoff, 2026-11-07)

| Style | Character ID | Revision | Art supplied |
|---|---|---|---|
| Desktop HD | `user-novahd256` | 3 | one 256×256 RGBA PNG, front (south) idle, 1 frame |
| Mobile Pixel | `user-novapixel01` | 1 | one 256×256 RGBA PNG (128-grid × 2), front (south) idle, 1 frame |

Both are `artStatus: "prototype"`, `height: "adult"`, `movement: "humanoid"`. The historical r1 (8 directions) and r2 (3 directions) packs are kept only for revision testing and are not used as production art.

## 2. Import validation (real importer, disposable data folder)

The real `parseCharacterZip` and the real Character Universe server store (`character-universe.server.ts`) ran against a new, empty `BUDDY_DATA_DIR` in a temporary folder. Real appdata was never used.

- The outer handoff ZIP is refused, as intended ("Character packs may contain only PNG art and data files"). Only the two inner ZIPs import.
- Both inner ZIPs parse as v3, each with one character, one facing (s) and one idle frame, and pass `validateCustomCharacter`.
- Revision rules:
  - Installing r3 over an installed r1 as a *new* character is refused (409, no overwrite).
  - A stale expected version is refused.
  - The reviewed update r1 → r3 is accepted.
  - A downgrade r3 → r2 is refused.
- Mobile Pixel installs as a separate character.
- Neither style is enabled as a room visitor automatically.
- A history snapshot is written before every change, and the JSON export contains both characters with their PNGs.
- Removing, restoring from the export, and removing both all work.
  - After removal, Nova falls back to the original sprite.
  - The content-addressed PNG files stay in `character-assets/` so history snapshots can still be restored. This is by design, but worth knowing for storage clean-up.

## 3. Artwork QA findings (for the Artistic Designer)

Measured on the supplied 256×256 PNGs:

| | Desktop HD r3 | Mobile Pixel r1 |
|---|---|---|
| Visible box | x 90–165, y 28–247 (220 px tall) | x 88–165, y 28–247 (220 px tall) |
| Feet baseline | row 247 (8 px margin), centred at x≈128 | row 247 (8 px margin), centred at x≈126 |
| Semi-transparent pixels | 23 % of visible (smooth edges) | 3 % (crisp) |
| Detached specks | **91 tiny islands, 174 px** around the silhouette | none |
| **Background left inside the figure** | **yes — light checkerboard patches between each arm and the torso (≈60 px and ≈46 px)** | **yes — the same white strips beside both hands (≈64 px and ≈52 px), plus small light pixels at the boots** |

The enclosed patches come from the generator's checkerboard, which was rendered into RGB. Connectivity-based extraction cannot remove background that is enclosed by the figure. On dark rooms they read as white glare next to the hands. In horror and matrix rooms they are clearly visible. I have not edited the supplied art. Please remove these patches in the next revision and deliver true-alpha masters.

Scale: both styles share the same height (220 px) and baseline (row 247). In the room they line up with the native Pals at the same in-room height ("adult").

## 4. One Nova, two appearances (cosmetic only)

No change to the v3 pack format is needed. The two styles stay **two separate v3 characters**, and the per-device appearance mapping ties them to the one built-in Pal:

- `pixel-pals-pal-skins-v1`: Desktop HD look per Pal. This is the existing key, so earlier settings keep working.
- `pixel-pals-pal-skins-pixel-v1`: Mobile Pixel look per Pal.
- Room Appearance chooses which look a device shows:
  - Auto gives Pixel at ≤700 px or with Save-Data, otherwise HD.
  - The device can also be forced to HD or Pixel.
- If one look is missing, the other is used. If both are missing, or the character was removed, the original Nova sprite is used.
- The Library offers both "Desktop HD look for…" and "Mobile Pixel look for…". Room appearance → **Pal appearances** shows each Pal's two looks, the look this device shows, an honest art note, and **Restore original**.
- A character used as a Pal's look is drawn only as that Pal, never also as a separate visitor.

Nothing about the Pal changes. The Pal ID stays `nova`, and its name, personality, prompts, conversations, memories, tasks, permissions and provider settings are untouched. Unit tests check that unrelated stored data is byte-identical after switching and restoring.

**Compatibility:** the change is additive. Existing installs keep their HD looks, and the Living World on desktop shows them as before. On phones, the Pixel look is preferred when one is set. Classic mode ignores looks.

**Limitation:** looks are saved per device (browser storage). Syncing them through the server would mean changing owner data and needs owner approval first.

**Optional future format extension (not implemented):** a pack could declare `appearanceOf: { pal: "nova", style: "pixel" }` so that importing suggests the mapping. Older importers would reject the unknown key, so this needs a version bump (v4) and owner approval.

## 5. Animation honesty

Both styles supply one front idle frame only:

- In the room, walking, sitting, desk work, chatting and greeting all reuse that frame. The character slides when moving, and faces the camera even at a desk.
- The UI says exactly this: "front idle only — walking, sitting, desk work and greetings reuse this one frame (not animated)". It appears in Pal appearances, in the HD office's screen-reader list, and in the Library's coverage line.
- Real-work indicators come only from real app state: an active reply, or a Focus session.

## 6. Frames needed once the owner approves the look in the running app

These apply to each style (Desktop HD and Mobile Pixel) and follow the v3 format:

- 256×256 RGBA, true alpha, feet on row 247, same scale as r3/r1.
- No mirroring: the renderer never flips art, so every listed facing must be drawn.
- Limits: at most 32 frames per clip and 512 per character.

The 8 facings are s, se, e, ne, n, nw, w, sw.

| Clip (v3 action) | Facings | Frames each | Frames | Used in the room for |
|---|---|---|---|---|
| `idle` | all 8 | 4 (breathing loop) | 32 | standing, waiting, looking at the window or board |
| `walk` | all 8 | 8 (min 6) | 64 | moving between desk, sofa, kitchen and other Pals |
| `turn` | all 8 | 2 | 16 | looking around (window, board, shelf) |
| `talk` | all 8 | 4 | 32 | chatting with another Pal; "Responding to you" |
| `interaction` | n, s, e, w | 6 | 24 | seated at the workstation (n = typing seen from behind) and using furniture |
| `rest` | s, se, sw, e, w | 4 | 20 | sitting or relaxing on the sofa and chairs; night rest |
| `wave` | s, se, sw, e, w | 6 | 30 | greeting a Pal or the user |
| `celebrate` | s | 8 | 8 | task done (cosmetic; only after a real completion) |
| **Total per style** | | | **226** | (well inside the 512 limit) |

Optional extras: `signature` (s, 8 frames) and `emote`. A seated-desk idle facing n is the single most important pose for the HD office. In the meantime, keep Desktop HD and Mobile Pixel consistent in hair, goggles, headphones, star, gloves and boots.

Fixes for the next revision:

- remove the enclosed background patches (section 3);
- remove the specks (HD);
- deliver true-alpha layered or flat masters instead of RGB checkerboard.
