# Mobile UI 3.0 and continuity beta

Development and testing stay on `beta`. `main` and the production `:latest` image require owner approval before promotion.

## Changes

- Shared mobile tool shell: full-width panels, touch-sized controls, 16px form text, visible keyboard focus, no desktop resize/maximize controls, and reduced-motion handling.
- Four core navigation buttons remain Home, Tasks, Pals and More. More also reaches Documents, Recorder, Fun, Playtests and Settings. Opening a tool hides other workspace windows while preserving their mounted state; Escape dismisses More and returns focus.
- Mail 2.0 uses the window's own width: a single list/reader flow on phones, two panes in medium windows, and folders/list/reader in large windows. Search, attachments, draft recovery, reply, manual send confirmations, move/delete and Brain Dump review remain available.
- Older-page responses cannot contaminate a newer search in the same folder. Unsent draft changes persist immediately in tab storage, and changing recipients or subject resets send confirmation.
- Focus Assist can prepare an explicit Second Brain summary for review. Notebook edits compare content revisions and preserve filenames, including externally renamed notes.
- Fresh installations create the configured data directory before running migrations. TypeScript is now a required CI and publishing check; the committed route registry includes the existing memory/focus endpoints.
- Beta Docker publishing receives the tested Git SHA and verifies the immutable `beta-<sha>` tag's digest after publishing. It does not publish `:latest`.

## Pal animation follow-up

The existing character artwork now supports layered head/body/leg poses, alternating walk cycles, individual pacing, looking around, greetings, stretches, working poses and short celebrations. Room movement eases at waypoints and pauses in hidden windows. Enable **Playful** in Pal Room for ambient poses; Calm remains the default. Reduced-motion preferences disable the decorative animations, including when changed while the app is running. Low-power mode pauses decorative loops and walking. The artwork, voices, theme identities and station duties remain unchanged; these visual poses perform no real machine or app actions.

## Release checks

Run the full Vitest suite, `tsc --noEmit`, a self-hosted production build, and `tools/smoke/smoke.mjs` against throwaway data. Browser checks include mobile widths 320, 390 and 700px. Both GitHub CI and Publish beta image must succeed for the same commit before pulling.

On Unraid, use the existing separate beta stack (`pixelpals-beta`, port 8091) and image `ghcr.io/nyteghost/buddy-bot-room:beta`, or pin the verified immutable `beta-<full-commit>` tag. Keep the production container and its mounts unchanged. Back up beta `/data` and the mounted Obsidian vault separately; both applications can access the vault, so use test notes for initial checks.

## Owner checks after pulling

1. Confirm the version label matches the tested beta revision.
2. On a phone, open each tool from More; check keyboard input, scrolling and returning Home.
3. Use a disposable note in Second Brain: save, edit its body in Obsidian, confirm a stale edit is refused, reload and edit again, then trash and restore it.
4. Use test mail to check reading, attachments, draft recovery and confirmation controls. No real mailbox operation is performed by automated smoke tests.
5. Start a small Focus Assist task, save your place, prepare a notebook summary, and approve it only after review.

Optional local message-body summaries, full vault export/restore, richer visual time planning, and external app integrations remain on the roadmap. They are not claimed complete by this release.

## Security and Home resume follow-up

Critical dependency findings are patched and a critical-severity audit is now a publishing gate. See [SECURITY_BETA.md](SECURITY_BETA.md) for fixed versions and the remaining lower-severity findings.

After **Save my place** in Focus Assist, Home displays **Where was I?** with the saved task and next tiny step. **Resume my saved step** restores the saved Pal, mode, completed steps and step number without a model call. The app asks before replacing a different active focus session. Dismissing or finishing clears only the checkpoint, preserving tasks and notes. Saving is explicit, browser-local and synchronizes open tabs in that browser; it does not automatically capture chats, mail drafts or workspace state.
