# Beta 1.0.818 validation and handoff

## Implemented

Since beta 1.0.818, the existing Today window is home. General Chat / Ask Anything remains available in navigation, with independent durable conversations, per-chat drafts, project association, pin/archive/recoverable trash, history search, automatic first-question titles and fresh continuation. The original workspace stays available and mounted.

One local Memory Keeper provides durable incremental jobs, source-backed review candidates, checkpoints, scoped memory and keyword/optional hybrid retrieval. Memory Center supplies management, correction, history, export/restore, private grants and Obsidian synchronization with manual conflict review. Existing saved server chats can be explicitly copied rather than destructively migrated.

Recognizable credential text is scrubbed before AI chat inference and new persistence in General Chat, Pals and Food Focus step questions. Existing live histories can be scrubbed explicitly. Provider credentials in intentional settings fields remain intact. Optional email masking is available.

## Actual development checks

- Full automated suite: 1,262 tests across 119 files passed. New coverage includes credentials/typing/idempotence, independent conversations/concurrency, authorized retrieval, private/project filtering, manual model rejection, Auto fallback, Local-Only, legacy-store forgery/sharing prevention, local worker queues, offline retry, evidence checks, Obsidian conflicts/recovery/symlinks and backup/restore.
- TypeScript noEmit passed; self-hosted production build passed.
- Changed TypeScript lint passed with the repository's existing formatting rule disabled; six existing Room hook/directive warnings remain. Full repository lint is not clean (10,846 errors, 10,799 formatting errors in the measured run); this release does not reformat unrelated files or claim full lint passes.
- Today startup/reload passed on desktop and mobile after closing Today in the previous session; explicit General Chat links still work.
- Production Chromium smoke passed for existing Pal modes, Focus Assist, Food Focus/restaurant/cooking chat, Mail, Second Brain, mobile navigation, Connect Ollama, authenticated server routing, Local-Only, new General Chat drafts/scrubbing/Memory Center and no horizontal overflow at 320/390/700 px.
- A real development server-process restart preserved the owner session, independent conversations and saved answer using the same persistent data directory. This was not an actual Unraid Docker restart.
- A 1,000-record synthetic keyword retrieval run took about 2 ms/query; see ASSISTANT_ARCHITECTURE.md for measurement scope.

Browser inference uses an isolated local Ollama protocol fixture, not the user's gaming PC. GitHub Actions and immutable Docker-image verification must pass for the exact pushed commit before declaring that beta ready to pull. Their final status is recorded in the release handoff, not inferred from these local checks.

## Remaining limitations

This is an owner-only beta, not shared multi-user project permissions. The new General Chat buffers answers; original Pals still streams. Semantic candidates and cache are bounded and optional, rather than a full semantic index of the vault. Organization uses conservative title/project cues; AI related-chat grouping and automatic archival suggestions are not implemented. Character budgets approximate tokens. Legacy tool chats are not all automatically ingested into Memory Keeper.

Credential detection cannot guarantee removal of unlabelled passwords, uncommon/encoded secrets, images, previous external copies or backups. Obsidian conflict files are preserved for review. Private memory is not mirrored. Checkpoint extraction/contradiction matching can be imperfect and should be reviewed. Real model quality, GPU contention with other apps, the user's actual mounts/permissions and an actual Unraid restart remain deployment checks.

## Deployment and usage

Follow [ASSISTANT_UNRAID.md](ASSISTANT_UNRAID.md). Keep beta, Pull then Up in Compose Manager pixelpals, preserve /data and existing environment. Do not change the working Ollama network. Mount the Homelab vault as /vault before enabling mirroring, and use the actual Obsidian container group if group access is required. Guides: [General Chat](GENERAL_CHAT.md), [Memory Keeper](MEMORY_KEEPER.md), [Troubleshooting](ASSISTANT_TROUBLESHOOTING.md).
