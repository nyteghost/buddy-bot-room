# HD256 rollout — Milestone 1: selected HD256 characters in the room (Track A, #26)

Branch `claude/living-universe-hd256`, draft PR #24. Development only: nothing here installs into a
live library, merges, or deploys.

## What Milestone 1 delivers

- **Imported HD256 v3 characters walk the calibrated room floor** with directional clips, feet on
  their floor point, depth sorting and the Pals' scale (HD frames at 76px desktop / 48px phone,
  because HD humanoids fill ~90% of the 256px frame).
- **Honest fallbacks:** missing facings borrow the same clip from a supplied facing 45° away, then
  idle. Front-only packs keep their front walk instead of sliding. Nothing is mirrored or invented.
  In-room actors carry `data-hd-fallback="facing" | "clip" | "facing+clip"` when art is borrowed.
- **Owner-facing pack coverage** in ZIP review and Library cards, for example:
  "Prototype · 8/8 facings · 2-frame walk in 8/8 · single poses: run, signature, emote · missing:
  wave, talk, celebrate … (room uses idle or a nearby facing)".
- **Revert without deleting:** Library "In room" / "Add" removes or restores the actor. The 6-visitor
  cap, owner approval, original Pals and Classic mode are unchanged.
- **Revision collision resolved:** the designer's revision-1 packs for the 23 original handoff IDs
  contain the same PNGs as the earlier Work revision 1, but different clip timing, descriptions
  and three movement classes (Imani, Mongo, Tairn). The real server refuses them both as installs
  (409) and as updates (400) if revision 1 is already installed. `tools/characters/bump-hd256-revision.py`
  makes revision-2 copies (manifest only; PNG bytes verified identical); they update cleanly with
  history snapshots kept. DBS / Resident Evil / Silent Hill packs upgrade from v2 at revision 1.

## Evidence

- CI smoke (synthetic art): import → approve → enable → real 256px `<img>` in the room → walks and
  turns to ≥2 facings → feet within 3px of the floor point while standing → signature hold →
  export → disable removes it → enable restores it → delete.
- Real server handler on disposable storage with the private packs: install / refused same-revision
  update / revision-2 update / v2→v3 upgrade.
- Harness renders (real stylesheet, backdrops, sprites and private frames; **not** the running app)
  of Carl, Leon Kennedy and Goku with the Pals in the control-room, mansion and office themes at
  640px and a real 390px phone viewport. Shared with the owner, not committed.

## Owner demo on a disposable instance (no live data)

Use the PR build with an empty data folder on any computer, not the Unraid appdata:

```sh
git checkout claude/living-universe-hd256 && bun install --frozen-lockfile
BUDDY_SELF_HOSTED=1 NITRO_PRESET=node-server NODE_ENV=production bun run build
mkdir -p /tmp/pixelpals-hd-demo
BUDDY_SELF_HOSTED=1 BUDDY_DATA_DIR=/tmp/pixelpals-hd-demo BUDDY_PASSWORD=pick-a-test-code \
  UPDATE_CHECK=0 MODEL_FEED=0 PORT=8099 NODE_ENV=production bun .output/server/index.mjs
```

Open `http://localhost:8099`, create the owner account with the test code, open Pal Room →
Character Library, choose **one** demo ZIP at a time, review the coverage line, approve, then
**Add** it to the room. Demo set (private, delivered in chat):

| Pack | Why it is in the demo |
| --- | --- |
| `carl.zip` (revision 2) | 8 illustrated facings, 2-frame walk, single-pose run/signature |
| `resident_evil_leon_kennedy.zip` | 8 synthesized facings, animated idle/walk/run |
| `dbs_goku.zip` | front-only, animated walk/wave/celebrate/signature |

## Desktop and iPhone checklist

1. Each character walks between several spots; legs move while walking, never sliding frozen.
2. Facing matches the direction of travel (Carl and Leon). Goku stays front-facing but steps.
3. Feet sit on the floor, never on furniture; characters further back draw behind nearer ones.
4. Size looks similar to the Pals; labels readable; Mail/Calendar/Board buttons never covered.
5. Tap the character: wave hold. Signature button: Carl/Goku play their signature in place.
6. Focus Mode, Calm mode, reduced motion and low power freeze movement and resume without jumping.
7. Library **In room** → actor disappears; **Add** → returns. Classic mode still shows the old room.
8. Afterwards delete `/tmp/pixelpals-hd-demo`.

## Remaining for later milestones

Hand-authored walk/wave/talk/celebrate art (designer); HD256 visuals for the nine Pals and eight
built-in guests (Track B, opt-in mapping with 32px fallback); dynamic collision avoidance between
moving characters.
