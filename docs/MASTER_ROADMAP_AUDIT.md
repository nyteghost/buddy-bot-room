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
