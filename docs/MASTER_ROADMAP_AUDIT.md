# Master roadmap: implementation audit

Audited against the existing beta after streaming release 1.0.821. This is a staged implementation record, not a claim that the whole roadmap is complete.

## Preserve and extend

- Today already opens in the normal workspace window. Its planner persists in `today.json`; legacy Workbench tasks remain separate browser data.
- Focus Assist already provides small steps, quiet body doubling, pause/resume, and an explicit browser checkpoint.
- Capture Inbox already accepts text and short voice clips, shares the central Memory Keeper queue, and requires review before creating tasks or memories.
- General Chat already supports independent conversations, streaming, scoped retrieval, provider selection, and cancellation. These routes are unchanged here.
- Obsidian already has reviewed memory synchronization and conflict detection. It is not a place for unreviewed work-state snapshots.
- Calendar already has authenticated read-only feeds and a recurrence parser. Named uploaded calendars, refresh controls, persistent cache, and full exception coverage need further work.
- Existing general jobs are not a complete durable Working Pals permission/scheduling system. The durable central Keeper queue should be extended, not replaced with a competing memory service.
- Existing microphone/capture features are not a large-file Meeting Memory system. They do not yet provide resumable imports, verified original audio retention, meeting review, diarization, or meeting threads.

## Increment 1: core ADHD experience

Implemented code: compact NOW/NEXT/LATER; existing section visibility, ordering and collapse preferences; local fallback I'm Stuck; explicit favorite Pal and energy mode; time available before scheduled commitments; owner-only compact focus checkpoints in the existing Today store; version conflict detection and three previous versions; checkpoint editing/resume; distraction parking in the existing Capture Inbox. Focus changes save locally immediately and attempt a debounced server save. Focused mode suppresses companion check-ins and selected decorative motion.

Completion criteria: existing data survives migration, nonowners cannot access state, stale saves cannot overwrite newer work, parking creates no automatic tasks/memories/jobs, mobile and desktop interaction passes production smoke, normal chat streaming remains intact, CI and container publication verified.

Not complete: automatic voice commands, global project activity capture outside Focus Assist, page-close delivery guarantees, all ambient animation suppression, calendar transition notices. Today prioritizes server planner tasks; it does not silently migrate browser Workbench tasks. Unsupported future modules are not shown as working sections.

## Next increments and acceptance criteria

1. Calendar: named subscriptions/uploads, secret server storage, SSRF tests, recurrence exceptions/DST/cancellations, bounded persistent offline cache, sync/test/status UI. Do not activate employer feeds without authorization. Revoke the previously exposed link before use.
2. Working Pals: durable scoped job permissions, restart recovery, approve/revoke recurring missions, bounded foreground-first processing, pause/cancel/retry and honest source/change receipts. No self-granted permissions or unsolicited new missions.
3. Meeting foundation: authenticated chunked imports, integrity checks, duplicate-safe retry, protected original audio, separate local transcription, review state and approved conflict-safe Obsidian export. Test synthetic recordings and interrupted uploads.
4. Meeting intelligence: timestamp evidence, uncertain speaker assignments and manual corrections, approved linking, search, threads, briefing suggestions and separate task approval. Never infer attendance from a calendar entry.
5. Living World and voice: existing assets and activity state, compact Nook, explicit invitations, one speaker, opt-in continuous microphone sessions and honest foreground-only standby. Test iPhone permission and interruption behavior on hardware.

Each increment needs focused regression tests, full production validation, simple user documentation and a beta-only release. This audit does not enable work integrations or change separate ShowPilot/Vibelight repositories.

## Optional Discord Companion text increment

An opt-in Discord text front end has been added separately from the core ADHD/calendar/meeting phase order, after the Adaptive Today increment. It supports owner-only guild slash commands, private responses, local-Ollama General Chat continuity and server-side bot settings; it does not enable voice recording, Meeting Vault, multi-Pal selection or unsolicited actions. See [Discord Companion](DISCORD_COMPANION.md). Actual token registration and Discord client behavior must be checked with an owner account after the beta container is deployed.

## Calendar and Settings incremental beta update
- Settings navigation shows only one selected category, has a searchable integration/setting index and status filters. All original settings and private server credentials remain.
- ICS feeds now use HTTPS URL guards, 8 MB streaming limits, redirect blocking, protected hashed offline cache, refresh/test support, and clear stale state. Old removed/expired snapshots are purged.
- RDATE date instances, daylight-saving and cancellation tests added. Full named subscriptions, local ICS uploads, provider-specific complex RRULEs, and advanced network-level egress hardening remain.
- See SETTINGS_NAVIGATION.md and CALENDAR_ICS_BETA.md for usage and limits.

## Working Pals increment 1 — permission gate

Implemented on beta: owner-only propose/approve/run/pause/revoke, per-job revision conflict checking, per-job result and failure state, serialized durable JSON in BUDDY_DATA_DIR and reuse of the existing inference job lane. Restart-interrupted work is marked for manual retry rather than resumed silently. Only explicitly approved read-only local Ollama summaries run; no unsanctioned actions, external messaging or Obsidian/memory changes are permitted. See [Working Pals](WORKING_PALS_BETA.md). General scoped recurring missions, persistent mission runners, granular action permission grants and Working Pals inbox notifications remain future work.

## Meeting Memory increment 1 — protected original-audio vault

Implemented on beta: owner-only Meeting Vault inside Capture Inbox, consent checkbox, 512 MB supported audio limit, SHA-256 verified 1 MiB resumable chunks, idempotent duplicate chunk retry, on-disk assembly and recorded digest, authenticated audio playback and revision-checked confirmed deletion. Storage is separated by recording in BUDDY_DATA_DIR/meeting-vault and kept private by filesystem permissions. This is only the recording-storage foundation; there is no transcription, speaker diarization, review inbox, approved Obsidian export or Discord voice ingestion yet. Real iPhone lock/background behavior and network interruption need hardware testing. [Setup and limitations](MEETING_VAULT_BETA.md).

## Meeting Memory increment 2 — manual transcript review and approved export

Implemented on beta: an owner-only Meeting Review panel under completed Meeting Vault recordings. Editable transcript, summary and speaker-note drafts are protected by revision CAS, and optional local-Ollama draft summarization requires an explicit request. Approving the reviewed transcript and summary is a separate action from exporting a versioned, conflict-safe `Pixel Pals/Meetings/<id>-r<revision>.md` Obsidian note. Neither approval nor export creates tasks, memory records or unsolicited notifications. Current local summary input limit is 16,000 characters; longer transcripts need a future chunked summarization pass. Local Whisper transcription and speaker diarization remain outstanding. [Review behavior](MEETING_REVIEW_BETA.md).

## Meeting Memory increment 3 — explicit private Whisper transcription

Added owner-only, opt-in long-recording transcription using the existing configured local Whisper endpoint. Docker image includes ffmpeg/ffprobe for bounded three-minute mono PCM segments. The worker uses the shared inference lane, saves segment transcript checkpoints on Unraid, can pause/resume, and marks crashed work interrupted rather than silently restarting. The owner must separately confirm permission before transferring audio to the local Whisper server. Completed output is a **draft** transcript only, guarded by meeting review revisions; no automatic summary, note, task, memory or Discord action. Approximate segment intervals are not word-precise evidence or verified speaker labels. Local Whisper operation and mobile behavior require installation tests. [Whisper guide](MEETING_WHISPER_BETA.md).

## Meeting Intelligence increment 1 — reviewed-only Meeting Threads

Implemented on beta: an owner-only Meeting Threads view in Capture Inbox, exact-term search across approved meeting reviews, source title and audio-SHA receipts, and explicit thread/project label assignment with revision CAS and unlink. Draft/unreviewed transcripts do not enter the index; project labels are organization metadata and do not grant memory/project authorization. This is a minimal search/grouping foundation, not inferred attendance, automatic cross-project linking, verified word timestamps, action ownership or meeting-generated tasks. [Meeting Threads](MEETING_THREADS_BETA.md).

## Meeting Intelligence increment 2 — manually requested source-grounded preparation

Implemented on beta: private owner-only, on-demand Meeting Threads brief of up to 12 approved meeting summaries, exact thread/project filtering, source receipts (meeting ID, approved date, audio SHA-256 and link revision), and copy-to-clipboard. The brief never searches draft notes, grants Discord permissions or infers attendance or action ownership. It does not autonomously monitor calendars or invoke the AI. [Meeting Threads guide](MEETING_THREADS_BETA.md). Future: reviewable Smart Linking, timestamp corrections, approved action item extraction, calendar-scoped suggestions and richer hybrid memory retrieval.

## Meeting Intelligence increment 3 — opt-in Smart Linking proposals

Implemented on beta: owner-only, on-demand keyword-overlap suggestions from linked, approved meetings to unlinked approved meetings. The UI displays supporting reviewed meeting titles and matched keywords; it fills an editable proposal but does not save until the owner explicitly confirms via the pre-existing revision-checked link API. Suggested project labels are organizational metadata only; no new project permissions are granted. Still outstanding: semantic/hybrid search, timestamp-verified source quotations, independent meeting action-item approval, smart calendar matching and fully tested mobile voice flows.

## Meeting Intelligence increment 4 — owner-confirmed meeting action → Today

Implemented on beta: after a review is approved, the owner can explicitly enter an action title, optional notes, check a separate confirmation and create a single idempotent Today task. The Today source is marked `meeting`; notes retain the meeting ID and approved review revision. Draft reviews, unauthorized sessions, stale revisions and non-confirmed requests are refused. No AI-generated assignments, automatic due dates, calendar changes, reminders, or permanent memories. [Review guide](MEETING_REVIEW_BETA.md).

## Personal Pal milestone — Mimic

Implemented on beta: independent ninth Pal **Mimic** with a 32×32 native pixel-art chest sprite, owner-inspired conversation profile, preserved voice across themes, opt-in seating, direct chat selection, character settings and own-only default memory / no live-data permissions. Distilled profile: [MIMIC_PERSONA.md](MIMIC_PERSONA.md). Raw Discord exports, ChatGPT history and sensitive identifiers have **not** been imported into the app or repository. This is a transparent AI character, not the owner or their spokesperson. Still to do: on-device visual QA across mobile/desktop widths, preferred sound/animation polish, and optional owner-approved Mimic Discord command/memory permissions. Do not update Unraid until the beta CI and image publish for the final commit pass.
