# Pixel Pals — Core Application audit (2026-11-07)

**Owner:** ChatGPT Core Application Developer  
**Branch:** `chatgpt/pixel-pals-core` (created from `beta` at `1821b456d967b1b554693a93c52aed3cbe4ad96f`)  
**Coordination:** [Issue #23](https://github.com/nyteghost/buddy-bot-room/issues/23)  
**Scope:** Today, General Chat, approved Working Pals, Calendar, Memory Keeper, Second Brain, Meeting Memory, core navigation/reliability. Excludes Claude's Living Universe/HD256 work, Character Designer art, standalone ADHD Assistant, Caddy/deployment, and ShowPilot.

## Audit method and verification limits

Read the `beta` source tree, `AGENTS.md`, `IMPLEMENTATION_PROGRESS.md`, `roadmap.md`, `docs/MASTER_ROADMAP_AUDIT.md` and relevant feature guides; examined current implementation modules and test files, recent PRs and Issue #23. The existing `beta` CI run [42371262924](https://github.com/nyteghost/buddy-bot-room/actions/runs/42371262924) passed dependency security gate, TypeScript, Vitest, builds and Chromium smoke on the audited baseline. **No new code has been built or tested as part of this documentation-only audit.** Real Unraid, Ollama/Whisper, Obsidian, phone, and employer integrations were not accessed or exercised. `roadmap.md` and historical phase notes contain stale “next” items; the current specialized guides and source take precedence.

## Implemented — do not reimplement

- **Today/Focus:** Home/Today, NOW/NEXT/LATER, focus support and checkpoint revision control; explicit Capture parking; separate browser Workbench tasks and server Today planner. `docs/ADAPTIVE_TODAY.md`.
- **General Chat:** owner-only durable independent conversations, drafts, archive/restore, streaming and cancellation, project association, cautious research/Today context and provider controls. `docs/GENERAL_CHAT.md`.
- **Memory Keeper:** one durable `memory-keeper.json` source with evidence-backed review queue, revisions, scopes, tombstones, retrieval cache, optional local model, export/merge restore and managed Obsidian mirror. `docs/MEMORY_KEEPER.md`.
- **Working Pals:** owner-only propose → approve → explicit run, local-only read-only questions, revision checks and persisted receipts. **An additional increment already added separately authorized hourly/daily/weekly recurring summaries**, pause-all and bounded result retention. `docs/WORKING_PALS_BETA.md`; `src/lib/working-pals.server.ts`.
- **Calendar:** read-only subscribed ICS feeds, guarded fetching/caching, named and colored imported snapshots and visibility controls, Today task/agenda support. Existing Today `WeekPanel` is a task-planning summary, **not** a full editable week/month calendar. `docs/CALENDAR_ICS_BETA.md`.
- **Meeting Memory:** owner-protected resumable Meeting Vault with audio integrity checks, opt-in local Whisper segmentation, draft review and manually corrected speaker segments, reviewed-only Threads/briefing/suggested links, explicit approved task → Today, versioned reviewed Obsidian exports. `docs/MASTER_ROADMAP_AUDIT.md`; meeting feature guides.
- **Second Brain:** opt-in approved notebook notes and cautious retrieval; explicitly reviewed use-as-memory, conflict checking and soft trash. `docs/SECOND_BRAIN.md`.
- **Navigation/reliability:** saved workspace layouts, settings search and connection checking, browser smoke, backup/migration mechanisms and baseline CI gates.

## Proposed next three implementation priorities (pending PM/owner approval)

### 1. Working Pals — owner-granted, source-bounded read-only missions

**Gap:** Scheduled read-only questions exist, but missions cannot securely use specifically approved Memory Keeper records, meeting reviews, project notes or other local sources. They have no granular per-source grant/expiry/revocation model or end-to-end evidence receipts for source use.

**First increment:** A reviewable, narrowly scoped, read-only **mission context grant** for one existing owner-authorized source type (prefer approved Memory Keeper records), with explicit selection, strict server-side grant checks per run, expiry/revocation and a source receipt. Do not create actions, cloud fallback, external messages, vault writes or implicit project access. Do not alter current recurring missions unless necessary for compatibility.

**Acceptance:** tests for nonowner denial, missing/expired/revoked grants, cross-scope/private-memory denial, revision racing, cancellation and receipt accuracy; existing recurring missions unchanged; no live user data in fixtures.

### 2. Today + Calendar — practical read-only week/month planning and save resilience

**Gap:** Users can see Today and a task-oriented week summary, but there is no full calendar week/month manager. Existing ICS snapshots/feeds are read-only. Browser Workbench to-dos are intentionally not silently migrated into the Today server planner; immediate tab closing may leave a debounced checkpoint only on the current device.

**First increment:** Add a responsive read-only calendar week/month view that reuses current authenticated agenda, feed/import visibility and task timestamps; date navigation, all-day and DST correctness, explicit stale-source labels, and a clear empty/offline state. Add a non-destructive checkpoint-save status/retry UX check around navigation. Keep any task-copy/migration user-approved and separately staged; never silently rewrite subscription or work-calendar data.

**Acceptance:** calendar and checkpoint tests for timezone/DST, duplicate sources, month boundaries, device widths, offline/stale state, revision conflicts and no data loss; CI browser smoke.

### 3. Memory Keeper + Second Brain — auditable recovery and conflict-safe migration

**Gap:** JSON export/merge restore and managed mirror are present, but an in-app Second Brain notebook export/restore and more complete legacy/Obsidian import/conflict-review workflow remain outstanding. Automatic wholesale ingestion of old chats/notes could violate scope and create duplicates.

**First increment:** An owner-only dry-run **review of candidate imports** from one supported existing source (e.g. approved Second Brain notes) with per-item provenance, duplicate/scope classification, preflight backup/export, explicit approval and cancel/undo path for newly imported records. Treat legacy content as untrusted; respect private scopes, tombstones, revisions and managed-note conflicts. Do not make Obsidian authoritative over `memory-keeper.json` or silently turn browser tasks into permanent memory.

**Acceptance:** synthetic import/reimport, idempotence, scope/owner/tombstone protection, symlink/path safety, conflicts, partial failure, cancelled import and restore tests. No destructive writes to original notes.

## Later queued work / blockers

- **Meeting intelligence:** reviewable long-transcript hierarchical summarization beyond current 16,000-character summary input, better timestamp evidence and speaker handling, separately approved action suggestions; requires real Whisper/audio/consent testing.
- **Core quality:** actual Unraid restart, mounted vault permissions/backup/restore, mobile/iPhone behavior, real local-model throughput and broader request-path regression coverage remain owner-device validation gates, not passed by fixture CI.
- **Calendar security:** full network DNS-to-connection pinning / egress checks remain; no employer feeds without IT authorization.
- **Other team conflict:** Claude's [draft PR #24](https://github.com/nyteghost/buddy-bot-room/pull/24) modifies `room.tsx`, `office-pal.tsx`, Living World CSS and room smoke. Avoid those shared paths until coordinated. Issue #23's old workstream table refers to ChatGPT's earlier ADHD work on `beta`; this new Core branch is separate and should be reflected in PM ownership records.
- **Release:** no branch merges or Unraid deployment. Any implementation goes on `chatgpt/pixel-pals-core`, with focused tests, draft PR(s) targeting `beta` and PM approval before integration.

## Next action

Ask PM to approve a priority and its first increment; then implement tests/code strictly on this branch. Issue #23 carries a compact audit handoff. This document records scope and evidence, **not** completion of any of the proposed features.
