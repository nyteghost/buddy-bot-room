# Adaptive Today

Today stays a normal Pixel Pals window. On mobile, open Home.

## Begin with one thing

NOW offers a server-planner task and one small first step. Start opens a quiet Focus Assist companion. Make it easier reduces the step. I'm Stuck works without AI: choose what feels difficult, then try one tiny action.

NEXT shows an available timed calendar event, reminder or planner task. It is scheduled information, not proof of attendance. LATER shows at most two other planner tasks. Browser-only Workbench tasks remain in My Tasks and Focus Assist; this update does not merge them into the server planner.

Customize Today lets you choose Low energy, Normal or Focused, an everyday Pal, and optional available-time display. Low energy favors smaller tasks. Focused suppresses companion check-ins and selected decoration. It does not mute important reminders. Time estimates allow five minutes of preparation and are only suggestions.

Use the section heading to expand/collapse it. Customize Today has visibility checkboxes and accessible move-up/down buttons. Preferences persist on Unraid. Refresh saved Today to load another device's changes. Hidden section content stays mounted so drafts are retained.

## Save and resume

During Focus Assist, each changed step is saved in this browser immediately and queued for an Unraid save after a short pause. The status tells you whether the server save succeeded. Save on Unraid retries explicitly. Save my place remains the existing browser-only action.

Today → Memory and Resume lists server checkpoints. Resume this step returns to the compact focus session. Edit checkpoint can attach an existing project and record state, decisions, blockers, sources and an exact next step. Three prior versions can be restored. Deleting a checkpoint requires confirmation and removes its history; tasks and conversations are unchanged. Use a backup to recover deleted records.

Existing browser checkpoints can be copied to Unraid explicitly. Work checkpoints are not automatically permanent memories, chat context, or Obsidian notes. At most 30 are kept; reaching the limit asks you to remove one rather than silently discarding work.

A conflicting save from another device is refused. Your editor remains open and your focus fallback remains in the browser. Copy any pending edits before refreshing and retrying. Closing immediately before the debounced server save may leave only the browser copy; wait for the saved status before switching devices.

## Park a thought

Park a thought opens a small form without ending focus. Save and return keeps your task in place. Today → Distraction Parking Lot → Review parked thoughts opens those items in Capture Inbox. They do not add to the ordinary pending counter or run background AI. Review them when convenient; approving a task or permanent memory remains explicit.

Capture a thought still opens the existing text/voice capture workflow. Parking currently accepts text; voice commands and wake phrases are not part of this increment.

## Storage and recovery

Owner sign-in and a persistent `BUDDY_DATA_DIR` are required. Preferences and checkpoints extend the existing `today.json`; parked items extend the existing `capture.json`. There is no new database or Docker mount. Existing backup/restore procedures apply. Keep the app data volume mounted when updating the container.

Recognizable credentials are scrubbed from new checkpoint and parked text. This is not a guarantee that every secret can be recognized. Do not use the feature as a password manager.

If Unraid is unreachable, the current Focus Assist step and deterministic help still work; server preferences and saved checkpoints cannot refresh. Recover the browser checkpoint before clearing site data.

## Device checks

After deployment, verify Home at your iPhone's normal text size, an active focus session while parking a thought, saving and resuming from a second signed-in device, and a refresh after restarting the container. These checks use synthetic personal tasks; no employer information is required. Real iPhone suspension and the user's Unraid storage cannot be reproduced by browser fixtures.
