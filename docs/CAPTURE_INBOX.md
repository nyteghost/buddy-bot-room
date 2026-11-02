# Capture Inbox and Today at a glance

Capture one thought without organizing it first. Open **Capture Inbox** from workspace navigation or Today (mobile: More). Save text, or explicitly record/upload a voice memo and press Save voice memo. Text drafts stay on the current browser; saved captures live in the existing `capture.json` on Unraid.

## Review before action

Local suggestions can identify a task, idea or memory, with a source quote, small first step, optional time estimate and materials. Suggestions may be wrong: edit and approve them. Nothing becomes a task or shared memory merely because AI suggested it. Entering review pauses background changes to that capture.

- Tasks go to the existing persistent Today planner. **Save and help me start** also opens Focus Assist.
- Ideas and memories go to the central Memory Keeper. Private is the default. Choose Global or an authorized Project explicitly when appropriate.
- Archive/delete affects the source capture, not a task or memory you already approved. Manage those separately in Today or Memory Center.

Approved target creation is idempotent across retries. Capacity is 100 saved captures, 4,000 text characters and 8 MB per recording; a full inbox refuses new saves. Remove reviewed source captures to make room. The legacy browser task list remains separate; Today's focus suggestions can read both lists without rewriting them.

## Local AI and voice

Settings → Integrations contains local Ollama/Memory Keeper and Whisper configuration. Capture processing uses the shared single-worker queue and the independently configured Memory Keeper model. No cloud transcription or AI fallback is used. Turning capture processing Off preserves text for manual review. Turning Memory Keeper Off also pauses capture processing.

Live recording needs browser microphone permission and a secure origin, normally HTTPS. At `http://10.200.1.30:8090`, use text or upload an existing supported voice memo. Recordings stop when the window is hidden; saving/uploading requires a click. Clips are bounded to two minutes in the recorder and 8 MB on the server. A transcript over 4,000 characters is refused rather than truncated; keep the original and split it into shorter clips.

Configure your own local OpenAI-compatible Whisper service under Settings → Integrations → Dictation. No service is installed automatically. If Whisper or the Ollama PC is offline, saved work remains on Unraid and jobs back off for later retry. Failed suggestions remain manually reviewable; Retry is explicit. Corrupt storage fails closed rather than replacing existing data with an empty file.

Raw audio is private owner-only data and cannot be credential-scrubbed. It is stored with restrictive filesystem permissions until successful transcription, archive or deletion. Recognizable credentials are scrubbed from text/transcripts. Scrubbing cannot detect every secret. Backups can retain older copies, and a filesystem failure can prevent audio cleanup; inspect storage/backups if guaranteed removal is needed.

## Today and weekly review

Today remains the opening workspace window. Its at-a-glance card shows up to three eligible open planner tasks, the next available calendar item, pending captures, and a saved Global idea when present. Private and project ideas are excluded from this general briefing. Calendar failure leaves the other sections usable.

Expand **Gentle weekly review** for completed-task counts and older open tasks. Review/reschedule in the existing planner. These cards use local deterministic rules, not AI calls; they never delete or reschedule tasks automatically and do not send new notifications.

## Obsidian and recovery

Approved non-private memories use the existing managed Obsidian synchronization. Related-note links use bounded keyword matches within the same scope/project/conversation; private records do not mirror. Existing manual-edit conflict handling still applies. Ideas are marked as ideas rather than verified facts.

Keep `/data` on persistent Unraid storage. Keep the existing backup/restore configuration and back up the data volume, including `capture.json`, `capture-audio`, `today.json`, chats and the existing Memory Keeper store. Test restoration separately before relying on a backup. Approved memory records follow existing Memory Center export/recovery rules; no competing memory database is introduced.

Browser tests use controlled Whisper/Ollama/search fixtures. Real microphone permission, model quality and your live services still need a device check after deployment.
