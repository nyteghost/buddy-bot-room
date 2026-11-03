# Working Pals — approval-first beta foundation

The first Working Pals increment is a *private, owner-only* job inbox inside Pixel Pals Settings. It does not create independent AI memories or replace the Memory Keeper queue. It reuses the existing local-AI job lane.

## How to use
1. Open **Settings → Working Pals**.
2. Propose a job: give it a short title and question. Select Personal or a project label (project identifier is metadata, not permission to read project files).
3. Review the proposal, then press **Approve**. Approval **does not execute** it.
4. Press **Run approved job** to ask the configured local Ollama model to prepare a read-only summary. The result appears in the same private inbox.
5. Review the result. It is never automatically saved as a permanent memory, written to Obsidian, or sent to Discord.
6. Use **Revoke permission** to stop subsequent runs. Pause while running, then run again manually if desired.

## Safety, limitations and resilience
- Server checks the signed-in owner's account on every request. No public Discord command can create or run a mission.
- Each state change requires the latest revision; stale browser tabs cannot silently overwrite decisions.
- Jobs and results are persisted under `BUDDY_DATA_DIR/working-pals.json` with restrictive file permissions and therefore included in the normal app backup process; protect backups.
- Local AI is mandatory for these missions. The assistant receives only the question, not automatic memory, meeting, mail, calendar or vault contents. No fallback to paid or cloud AI.
- A restart does not resume an unfinished job automatically. It becomes **interrupted** and needs deliberate retry.
- This first increment **does not** implement: recurring missions, background autonomous actions, prompts from Discord, memory-linking, external notifications, arbitrary tools, file edits, or unattended authority escalation.
- For sensitive work data or meetings, obtain organizational approval before bringing information onto personal Unraid or Discord.

## Next increments
Granular job categories and resource grants, repeat schedules with explicit owner permission, source/change receipts, user-approved Obsidian exports, and an approval inbox linked to the Pal Nook. These will be built separately with security and failure tests.

## Approved recurring summaries

Approve the exact read-only question first, then separately approve an hourly, daily or weekly interval. Recurrence never grants access to project files or tools: the project label is organizational only. Local Ollama performs the summary; no cloud fallback, message sending or calendar changes occur.

Pause all Pal jobs disables recurrence and cancels active missions without removing results. Foreground General Chat has priority. Failed, cancelled and interrupted work needs explicit review before resuming; missed intervals do not produce catch-up bursts. Previous results are retained as receipts. At 100 receipts, further runs stop rather than deleting history. The existing working-pals.json file remains in the persistent data volume.
