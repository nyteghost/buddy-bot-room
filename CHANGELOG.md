# Changelog

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
