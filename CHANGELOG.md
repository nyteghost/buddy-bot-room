## Beta — Focus Assist nonmodal dock correction

- Auto-minimize the optional floating Focus Assist companion when switching workspace windows; it can be reopened without losing the current step, model selection, or saved checkpoint.
- Prevent an expanded companion from blocking Pal Room quests, Focus Food and other windows. Extend browser regression to test the dock transition.

## Beta — Living World 2 first increment

- Default existing Pal themes to animated Living World, preserving a device-local Classic switch.
- Reuse the established walker for eight generated native-pixel compass directions and four walking phases.
- Add non-static themed room lighting, ambient specks, reflections and shadows, honoring reduced-motion/low-power behavior.
- Open desktop Home with Today on the left and Pal Room on the right; preserve explicitly saved custom layouts and mobile tab behavior.
- Add native Dungeon Crawler Carl fantasy sprite treatment instead of the unrelated Hellraiser fallback.
- Add focused regression tests and document remaining sprite-art/character-library work. No new AI backend permissions or Unraid deployment.

## Beta 1.0.948 — Approved recurrence and review controls

- Working Pals: separately approved recurrence, retained receipts, Pause all, foreground-chat priority and stale-result protection.
- Calendar: named/color-coded ICS imports with explicit consent, retained originals, visibility controls and subscription labels.
- Meetings: validated Whisper segment times, format compatibility fallback, click-to-listen and draft speaker corrections.
- Discord: optional Pal choice on the existing private local-AI bridge; Mimic stays excluded pending its privacy controls.
- Second Brain: exact keyword matching and accurate idempotent import counts.
- Preserve existing stores, originals and integrations. This milestone does not complete the full roadmap; see the master audit.

# Changelog

## Beta — Mimic, the ninth Pal (owner-inspired, not owner impersonation)

- Add an opt-in **Mimic** AI Pal, distinct from the original eight, with a 32×32 pixel-art treasure-chest sprite, purple tongue, independent thinking prop, room motion and consistent voice across themes.
- Build its character from the owner's supplied Discord writing-style profile plus observed ChatGPT collaboration patterns. Preserve natural directness, curiosity, practical troubleshooting, specific enthusiasm and occasional humor without robotic catchphrases.
- Default Mimic to Pal-only memories and no live calendar/mail/task context. Add explicit permission controls in Character settings; do not commit raw Discord exports or private chats.
- Include regression tests for persona, sprite, privacy defaults, and theme consistency. Mimic is clearly labeled as AI and does not post as the owner.
- Discord Companion still uses its existing owner-only assistant; Mimic-specific Discord commands are not implemented by this milestone.


## Beta — Reviewed-meeting action approval

- Add separate owner-confirmed creation of a Today task from an explicitly approved Meeting Review.
- Save deterministic idempotent task IDs and provenance; refuse stale/draft reviews and duplicate retries.
- No automatic task extraction, assignee inference, memory writes or reminders. Includes regression tests.


## Beta — Reviewable Meeting Threads Smart Linking

- Provide owner-requested deterministic keyword suggestions for unlinked reviewed meetings based on existing approved thread links.
- Show supporting approved source and matching terms; choosing one only fills the existing editor and still requires manual save.
- No automatic linking, unapproved-note ingestion, AI model calls, Discord sharing or new project permissions. Add owner and no-write regression tests.


## Beta — Meeting Threads source-grounded preparation

- Add manual **Prepare brief** for each explicitly linked reviewed meeting thread/project, with source receipts and a copyable bounded summary.
- Enforce owner-only API access and exact project filtering; omit unapproved/unlinked meetings and avoid inferred attendance or task ownership.
- Add tests for cross-project isolation and unauthorized requests. No automatic sharing, transcription, task creation or AI inference.


## Beta — Meeting Threads reviewed-only search and manual links

- Add owner-only search over **approved** meeting summaries and transcripts, with bounded excerpts and original-audio SHA-256 evidence receipts.
- Add explicit thread and optional project labels with stale-revision conflict checks, unlink controls, and a compact Capture Inbox view. Unreviewed transcripts are never indexed.
- No AI-generated links, inferred attendees, automatic task ownership, or cross-user project permissions are introduced.
- Later phases: transcript evidence verification, meeting-linked task approval, briefing suggestions, speaker diarization and more capable semantic search.


## Beta — explicit local Whisper transcription of long recordings

- Introduce a separate owner-only local Whisper job for completed Meeting Vault audio: an explicit permission checkbox, Start/Pause/Resume/Reset controls, persisted per-segment checkpoints and crash recovery.
- Bundle ffmpeg and ffprobe in the Unraid image to convert up to 12 hours of approved recorded audio into bounded three-minute Whisper segments. The configured transcription endpoint must be local/private; no public Whisper/cloud fallback.
- After successful transcription, save only a **draft** transcript in Meeting Review, with approximate segment time ranges. The owner must still correct, approve and separately export notes to Obsidian.
- Protect reviewed transcripts from overwrites via revision checks; preserve original audio and completed segment texts on interruption. Add local URL, duration, consent and restart tests.
- Real Whisper inference, iPhone interruptions, accurate speaker diarization and word-level timestamps still require testing and later phases.


## Beta — Meeting Review and approved Obsidian meeting notes

- Add an owner-only Meeting Review panel for completed recordings with editable transcript, summary and speaker-correction drafts.
- Optional local Ollama summary is triggered only by the owner's separate click and is limited to a bounded single-pass transcript; transcripts and summaries never become tasks or permanent Memory Keeper entries automatically.
- Require distinct Save, Approve and Export actions. Protect revisions against simultaneous edits and write versioned Markdown notes into `Pixel Pals/Meetings` using exclusive creation; never overwrite hand-edited Obsidian notes.
- Include tests for owner access, stale saves, explicit approvals, local-only inference, export conflicts and symlinked vault folders.
- Original audio remains in Meeting Vault; this increment does **not** yet implement Whisper transcription of long recordings, accurate diarization, meeting-linked tasks or automatic reminders.


## Beta — Meeting Vault original-audio import foundation

- Introduce protected, owner-only Meeting Vault storage separate from 8 MB Capture Inbox voice clips, with up to 512 MB per recording.
- Add verified, idempotent 1 MB chunk uploads so interrupted iPhone audio imports can be resumed by reselecting the original file; reassemble and fingerprint the original audio on Unraid.
- Require an explicit recording/storage authorization checkbox, keep media in private filesystem directories, support authenticated streaming playback and deletion with confirmation.
- Accessible under Capture Inbox → Meeting Vault. Importing does **not** start transcription, create memories, notify Working Pals, link projects or write Obsidian notes.
- Still planned: local transcription, review and speaker corrections, Obsidian export, Meeting Threads, smart linking and Discord voice recording.


## Beta — Working Pals approval-first foundation

- Add private owner-only Working Pals jobs inbox in Settings. Propose, approve, run, pause, revoke and review each job explicitly.
- Store revisioned job records and outcomes in the existing Unraid persistent volume and use the shared inference job lane; interrupted runs require manual retry.
- No autonomous external actions, scheduled jobs, Discord-triggered execution, calendar/memory writes or notifications. First increment is local Ollama read-only summarization only.
- Add tests for owner authorization, permission boundaries, revision conflicts and recovery, and route documentation.


## Beta — Settings simplification and calendar reliability
- Reworked Settings: selected categories, search by service and field, connected/not set up filters, progressive help, same saved values and secret handling.
- Calendar: safer HTTPS-only public feed checks, no redirect following, bounded streaming, last-good offline snapshots in protected Unraid data, refresh-on-demand and sync status.
- Added RDATE recurring event support and tests for daylight saving, cancellations, moved instances and cached feed removal.
- Remaining: full named/uploaded ICS source manager, complex recurrence coverage, Working Pals and Meeting Memory.


## Beta — Discord Companion text integration (after 1.0.822)

- Add opt-in owner-only Discord slash commands (`/ask`, `/ping`, `/help`) using an outbound Gateway connection from Unraid. No public port or message-content intent.
- Route Discord questions through existing persistent General Chat and Memory Keeper, using local Ollama only; approved Second Brain retrieval remains separately opt-in.
- Add bot settings, secret token storage, setup testing, restricted guild/user IDs and private ephemeral command replies. Add authorization tests and setup documentation.
- Discord voice, meeting audio recording, working-Pals alerts and multi-Pal selection remain future work, not implemented here. Live Discord credentials and gateway behavior require installation testing.


## Beta 1.0.822 — Adaptive Today foundation

- Add compact NOW/NEXT/LATER, offline I'm Stuck, everyday Pal and energy preferences, optional available-time suggestions, and server-persisted section visibility/order/collapse.
- Extend the existing Today store with owner-only Focus Assist checkpoints, local fallback, revision conflict protection, editing, resume and three previous versions.
- Park unrelated thoughts in the existing Capture Inbox without automatic inference, task creation, permanent memories or pending counters.
- Preserve General Chat streaming, original planner/browser tasks, windowed navigation and reviewed Obsidian workflows.
- Document the master-roadmap audit and remaining calendar, Working Pals, Meeting Memory and voice increments. These are not included as completed features.


## Beta 1.0.821 — Streaming General Chat replies

- Show temporary, scrubbed answer previews as providers generate text, on desktop and mobile, while preserving the existing JSON API for older callers.
- Stop/disconnect cancels inference; incomplete replies are not committed or processed by Memory Keeper. Retain follow-up drafts and per-conversation previews across navigation.
- Preserve final model, memory and web-source receipts. Recheck memory authorization during previews and durable conversation revision before saving. Hold credential-like content until final scrubbing.
- Bound/throttle preview updates, prevent slow-reader preview buildup and reject incomplete provider streams. Add cancellation, privacy, fallback, UTF-8 boundary and browser regression coverage.

## Beta 1.0.820 — Current information and reviewed captures

- Add visible General Chat Web Auto/On/Off, current date/time-zone context, actual search source receipts and truthful search failures. Run independent health, memory and search lookups concurrently.
- Register saveable SearXNG and local Whisper integration settings.
- Add owner-only persistent text/voice Capture Inbox with local queued suggestions, explicit review, idempotent Today task approval and private-default Memory Keeper records.
- Add deterministic Today briefing, gentle weekly review and same-scope Obsidian related-note links.
- Extend automated and desktop/mobile browser coverage. See docs/CURRENT_INFORMATION.md and docs/CAPTURE_INBOX.md for configuration and limits.

## Beta 1.0.819 — Workspace chat and integration settings

- Make Settings → Integrations explicit; open Seerr configuration directly from its request dialog. Save existing address/key fields securely without a restart, and verify the API key with a read-only authenticated test.
- Show General Chat and Memory Center in the existing movable, resizable workspace window instead of a separate full-screen page. Maximize, restore, hide and saved geometry use the shared window manager.
- Preserve drafts and running answers while hidden; keep Today as home and support chat direct links. Remove duplicate account/provider headers; existing workspace controls remain available.

## Beta 1.0.818 — Today opens first

- Open the existing Today window by default on desktop and mobile, including when a previous session closed it.
- Keep General Chat available through navigation and /?chat=1; /?workspace=1 resumes the saved workspace. Chat drafts, messages, named layouts and window geometry are preserved.

## Beta 1.0.817 — Compact local memory processing

- Memory Keeper explicitly requests non-thinking JSON output, preserving its bounded summary budget on supported Ollama reasoning models. Main conversational model behavior stays under the existing AI settings.

## Beta 1.0.816 — General Chat, Memory Keeper and chat credential scrubbing

- Added persistent independent conversations, default General Chat / Ask Anything, search, pin/archive/recoverable trash, project organization, separate drafts and compact continuation.
- Added one local asynchronous Memory Keeper with review-first extraction, scoped durable records, checkpoints, keyword/optional semantic retrieval, source tracking, contradictions and deletion invalidation.
- Added owner-only Memory Center with editing, approval, history, export/restore, queue controls and managed Obsidian synchronization/recovery.
- Reused remote Ollama backend routing, installed-model checks, existing configured providers, Local-Only policy and authorized read-only search/Today context.
- Added recognizable credential scrubbing before chat inference/persistence, optional standalone-email masking and live-history cleanup. Provider settings keys remain intact. Detection does not cover all possible secrets or images.
- Preserved existing Pals, Food Focus, settings, original chats and separate ShowPilot/Vibelight projects. External second-brain repository remains design inspiration rather than a runtime dependency.

See docs/GENERAL_CHAT.md and docs/MEMORY_KEEPER.md for behavior and limits. Build number follows commit count; confirm the published beta build before deploying.
