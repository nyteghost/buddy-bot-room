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

## 7. Corrected art: Desktop HD r4 and Mobile Pixel r2 (2026-11-08)

### Import and update
These checks used the real importer and server store against a new, empty temporary data folder. All passed:
- IDs are unchanged (`user-novahd256` r4, `user-novapixel01` r2). Each pack has one south idle frame and stays `prototype`.
- Installing r4 as a new character over r3 is refused (409). A stale expected revision is refused.
- The reviewed updates **HD r3 → r4** and **Pixel r1 → r2** are accepted.
- A same-revision overwrite (r4 → r4, r2 → r2) and a downgrade (r4 → r3) are refused.
- Exactly two cosmetic characters remain, and neither is enabled as a visitor.
- A history snapshot is written before each change. Rolling back from the pre-update export brings back r3 and r1, and both can then be updated again.
- Stand-in users, settings, and Nova chat, memory, task and permission files are byte-identical afterwards. The character store wrote only to `character-universe.json`, `character-assets/` and `character-history/`.
- The CI smoke repeats the update in the running app with synthetic packs: the same ID is kept, the update needs separate approval, and Nova's look mapping survives the update.

### Edge QA on the supplied PNGs (not modified)
The repair only removed pixels. No pixels were recoloured or added: 451 HD pixels and 168 Pixel pixels were made fully transparent.

| | Desktop HD r4 | Mobile Pixel r2 |
|---|---|---|
| Checkerboard between arms and torso | **fixed**: background now shows through (106 px and 81 px gaps) | **fixed** (68 px and 56 px gaps) |
| Detached specks | **fixed**: 1 component (was 92) | none |
| Feet and box | row 247, x90–165, y28–247 (unchanged) | row 247, x88–165, y28–247 (unchanged) |
| **New defect** | **two see-through notches punched into the grey rolled sleeve cuffs** (x98–103 and x153–157, y108–112; 20 px and 16 px). Cuff pixels were mistaken for checkerboard. You see black, white or cyan through the sleeves at 2× and above. | none |
| Remaining minor | about 450 near-invisible ghost pixels (alpha ≤ 26, contrast ≤ 13/255); the hard-cut gap edges are slightly jagged on cyan at 4× | about 120 faint white 2×2 blocks (alpha 27) along the hair and left-leg outline; a faint dotted outline on pure black at ≥ 2×, invisible at room size |

At room size (about 41–70 CSS px figure at desktop, and on a 390 px phone at 3×), neither style shows a halo or fragment in Office, Horror Mansion or Matrix. When the HD office is zoomed in, the HD sleeve notches are just visible.

**Requests for the Artistic Designer:**
- **HD r5:** restore the two cuff areas from r3 (just those pixels).
- **Optionally, Pixel r3:** clear the alpha-27 white blocks. Pixel art should have no partly transparent pixels.

### Integration observations (not art defects)
- **Seated stations:** in the existing Office room, Nova's station is a seated desk. With only a standing frame, the chair back covers most of her body. This is the expected single-frame limitation, and the planned sit-at-workstation pilot solves it.
- **Height:** in-room height matches the native Pals within about 10 %. Nova is slimmer, because the illustrated proportions differ from the chunky native sprites.
- **Themed names:** in Horror and Matrix, Nova's look carries that theme's name tag (Ghostface or Neo), because looks apply in every theme. The owner needs to decide whether looks should apply in themed worlds.
- **Phone labels:** at 390 px in the Horror room, the name tags of neighbouring Pals can overlap (Ghostface and The Slasher Fan). This is an existing Living World label-crowding issue, not specific to Nova.

## 8. Desktop HD r5 (2026-11-08)

### Art: verified independently
- r4 → r5 changes **exactly 36 pixels**. All of them lie inside the two cuff boxes (x98–103 and x153–157, y108–112), all were transparent in r4, and all now match r3 exactly at full opacity.
- Every other pixel is identical to r4, so the arm-gap clean-up is preserved.
- The figure is one connected shape and its feet are on row 247.
- The only see-through areas left inside the outline are the intended arm-to-torso gaps (106 px, 81 px and small gap continuations).
- About 450 ghost pixels at alpha ≤ 26 remain (contrast ≤ 13/255). They are not visible in any room.
- Mobile Pixel r2 is byte-identical to the previous r2 and was not reinstalled.

### Import and update
This used the real importer and server store in a fresh temporary data folder; 19/19 checks passed.
- The seeded state was HD r4 plus Pixel r2.
- Refused, as intended:
  - installing r5 as a new character;
  - an update against stale r3;
  - re-applying Pixel r2;
  - a downgrade from r5 to r4.
- The reviewed update **r4 → r5** was accepted. One history snapshot was written first, and r5 persisted after a re-read.
- Pixel r2 was untouched.
- There are still exactly two cosmetic characters and no visitor.
- A rollback to r4 from the export, followed by the update to r5 again, gives an identical r5.
- The stand-in user, settings, chat, memory, task and permission files are byte-identical. The character store wrote only its own files.

### In-room inspection
These are component-harness captures at 3× device pixels, not the deployed app.
- **The cuffs are solid** in every render: HD office at full zoom, the Office Living World, Horror Mansion and Matrix, on a 1280 px desktop and in a 390 px phone viewport.
- The arm gaps show the room behind them.
- No halos, fragments or low-alpha ghosts are visible.
- Feet sit on the floor point.
- Nova is 61–70 CSS px in Living World rooms on desktop and 41–47 CSS px at 390 px. That is within about 10 % of the native Pals.

### Defects found this round
- **Fixed (functional):** in a calm or still HD office (Calm, Focus, reduced motion, hidden or low power), *Follow* eased by one frame and then stopped, so a followed Pal could stay off screen. This was most visible at 390 px with HD forced. Following now snaps to the Pal when nothing animates, and a unit test covers it.
- **Open (not art):**
  - Nova's station in the Office Living World is a seated desk. The chair and monitor hide most of the standing-only frame; this needs the sit-at-workstation pilot.
  - When HD is forced on a phone, the HD office toolbar covers the top of the scene at high zoom.
  - With 6 visitors, the HD office and the 390 px Horror room get crowded: overlapping visitors and colliding name tags. This existed before and is not specific to Nova.
  - In themed rooms, Nova's look carries the theme's name tag (Ghostface, Neo). This needs an owner decision.

## 9. Regression fixes before acceptance testing (2026-11-08)

### P1 — Built-in guests disappeared in the HD office (fixed)
- **Reproduced in the running app:** CI run 42493630876 at `6036e79`. The smoke step that turns on the HD office with Green Jacket Guy and Moon Mage enabled failed, because neither guest was drawn.
- **Cause:** `room.tsx` hid the Living World guests whenever `hdWorld` was on, but the HD office was only given *custom* characters.
- **Fix:** `src/lib/world-hd-visitors.ts` now builds the HD office's visitor list. It works as follows:
  - every enabled visitor is included, built-in or custom, in the order it was enabled;
  - the list stops at six, the existing limit;
  - each visitor appears once, even if its ID is listed twice;
  - unknown or deleted IDs are skipped;
  - a character used as a Pal's look is never listed as a visitor.
- Built-in guests keep their own pixel art and name and are described as ambient. They have no identity, memory or permissions.
- The Living World, Pixel and Classic code paths are unchanged.
- **Tests:**
  - a unit test of the list rules;
  - an HD office render test;
  - a smoke test in the running app. It checks that each built-in guest is drawn exactly once, that the Living World copies are not drawn underneath, and that the guests come back when the HD office is turned off.

### P2 — Appearance mapping reliability
- **Two tabs:** look maps now follow the other tab through `storage` events. That includes another tab clearing everything.
- **One character, one Pal:** a character dresses at most one Pal, across both Desktop HD and Mobile Pixel. Giving it to another Pal removes it from the first. It can still be the same Pal's look in both presentations. Stored conflicts are repaired on load, and the Desktop HD map wins.
- **Removed art:** if a look's character is missing, the Pal uses its other look, and then the original. Deleting a character in the Library also removes its mappings.
- Switching between HD, Pixel and the original, then back again, leaves other saved data byte-identical.

### P3 — Usability
- **Phones with HD forced:** the camera toolbar folds behind one 40 px button, labelled, with `aria-expanded` and `aria-controls`. When open, its targets are 40 px. Pinch, drag and tap-to-follow work without it.
- **HD office name tags:** tags no longer overlap. The followed Pal or a Pal doing real work is placed first, then others from front to back. A tag that overlaps is stacked, and hidden after four attempts.
- **Earlier fix (`c0d936e`):** Follow snaps to the Pal in a calm or reduced-motion room.
- **Not changed (outside this scope):** name-tag crowding in the existing Living World rooms on phones (Horror with six visitors). The tag in Horror and Matrix that names the theme persona (Ghostface, Neo) over Nova's look needs an owner decision.

### P4 — Nova r5/r2 on the current code
- The disposable real-importer run, with the private r5/r2 ZIPs, was repeated at `23de27d`: 19/19 checks passed.
- The art files are unchanged since the §8 check (36 cuff pixels, no checkerboard).
- Private-art captures come from the component harness: real components, CSS and backdrops. They are not the deployed app, and the 390 px views are a browser viewport, not a physical iPhone.
- Running-app CI evidence uses synthetic stand-in packs only.
