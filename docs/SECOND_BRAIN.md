# Second Brain for Pixel Pals (beta foundation)

Pixel Pals already has browser memory and an optional mounted Obsidian vault. This feature is an **additional**, opt-in memory foundation, not a replacement for existing memories, and not yet a completed app integration.

## Implemented in this change
- `src/lib/second-brain.ts`: typed Markdown memory categories, a fixed PixelPals subfolder namespace, safe note-path construction, lightweight offline keyword retrieval, capped context formatting, and explicit memory proposals.
- `src/lib/second-brain.test.ts`: unit tests for isolation, search, context labeling, and proposals.
- No cloud service, model, extra dependency, database migration, user-data access, automatic memory collection, or chat behavior change is introduced.

## Planned integration (not implemented yet)
1. Build an owner-authenticated server adapter for the existing mounted /vault location; validate real paths and prevent symlink traversal. Create notes only under `/vault/PixelPals/`; leave any ShowPilot folder alone. Never let an HTTP request supply a vault root.
2. Add a Settings → Second Brain opt-in panel. Show the resolved vault status, allow a safe create/search/edit/trash workflow, and a preview/approve queue for proposed memories. Turn automatic extraction OFF by default. Treat personal or sensitive information as requiring explicit review.
3. Bridge confirmed personal preferences, projects, and Focus Assist session progress into the notebook using minimal summaries; never scrape or save complete conversations automatically.
4. Add a retrieval toggle for chat and Focus Assist. Limit retrieved excerpts, label them untrusted, and apply privacy rules before ever supplying them to a model. No cloud notebook context by default.
5. Add easy backup/export and restore checks; consider optional Obsidian linking and stale-note/conflict review.
6. Verify local/Unraid installation, accounts, tests, and end-to-end write/search/restart/restore before promoting to main.

## Notes
The upstream `NicholasSpisak/second-brain` is inspiration, not a dependency or installed runtime component. This code does **not** automatically install that project or claim its features.
The currently configured Unraid compose mounts a vault at `/vault`; confirm deployment permissions, ownership, backup policy, and whether the intended vault is appropriate before enabling writes.

**Status: foundation only, not user-ready.** No settings switch or automatic memory learning has been activated.
