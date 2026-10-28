# Architecture notes (branch `upgrade/local-first`)

## Release 1 changes
- **Streaming UI** (`src/lib/stream-throttle.ts`, `src/lib/debounced-save.ts`, `room.tsx`): reply text is pushed to React at most every 50 ms (first token immediate, last always delivered); the chat save to `localStorage` is debounced (400 ms quiet, 2 s max) and flushed on tab hide, page close, unmount and before backup export.
- **Document search** (`src/lib/embed-cache.ts`, `embed-store.ts`, `smart-docs.ts`): vectors are cached in IndexedDB `pixel-pals-embeddings` (`vecs`: key `model|hash(text)` -> `{v: Float32Array, t}`, `meta`: `model`), capped at 8,000 entries (oldest pruned to 6,000). Safe to delete: it rebuilds lazily. `/api/embed` returns `{embeddings, model}`.
- **Background jobs** (`src/lib/job-runner.ts`, `jobs.server.ts`, `scheduler.server.ts`, `schedules.server.ts`): one run per job id; `inference` lane runs model jobs one at a time; timeouts abort and free the slot; events go to the server log (Settings > log).
- **Polling** (`src/lib/poll.ts`): visible-tab only, no overlap, backoff on failure.

## Storage formats / migrations
No data format changed for existing users. The IndexedDB cache is new and disposable. Chats stay in `localStorage` (`pixel-pals-conversations-v2`), see M4 in `PERFORMANCE_REPORT.md`.

## Rollback
Each milestone is a single commit on `upgrade/local-first`; `git revert <sha>` undoes one without touching the others. The `:latest` image (main) is unaffected.

## Agent orchestration (Smart Team)
- Modes live in `Mode` (`agents.ts`); `smart` is additive, existing modes are unchanged. Saved chats from before simply have no `smart` conversation.
- `smart-team.ts` is pure: `profileTask` (keyword/length rules), `planSmartTeam` (who speaks, in order), `shouldRun` (skip reviewer/coordinator when not useful), `isRepeat` (word overlap), `buildHandoff` (bounded notes from earlier turns), `outOfTime`. No model call is used to route.
- `room.tsx` runs the planned turns sequentially in the existing turn loop (so Stop/abort, retry chain, Local-Only and `keepLocal` rules all still apply); the server adds the role instruction and the hand-off (labelled as data) to the system prompt.
- Settings (`pixel-pals-smart-v1`, browser storage only): max turns 1-6, time limit 20-900 s, single-pal switch, per-role pal.

## Ollama model management
- `ollama-resources.ts` (pure) + `ollama-runtime.server.ts` (prepare/load with keep-alive, out-of-memory fallback to the largest smaller installed model, keep-alive re-armed after each reply). Host GPU comes from `OLLAMA_VRAM_GB` when Ollama is on another machine. Reply metadata carries `model` and `fellBackFrom`; the UI shows `via`.

## Memory
- Storage unchanged: `pixel-pals-workbench-v1` in browser localStorage (`memories` shared, `pal[id]` private to one pal, new optional `project[name]`). New optional entry fields: `pinned`, `digest`. Old data loads as is; rolling back leaves the extra fields ignored.
- Prompt memory = `promptContextFor` -> `pickMemories`: everything if it fits the budget (same text as before), otherwise ranked by keyword (IDF-weighted word stems) + optional meaning score (`memoryBoost`, only computed when over budget) + recency + scope. Other pals' private memories are never visible to a pal. Active project: `pixel-pals-active-project-v1`.

## Character overrides (Release 3 item 14)
- `character-overrides.ts`: pure `cleanOverrides` / `withOverride` plus a small localStorage store (`pixel-pals-characters-v1`, included in backups and account sync). Fields per pal: `name`, `role`, `tone`, `memory` (`all` default, `own`, `none`), `realData` (false blocks calendar/mail/task text for that pal).
- Wording overrides are applied inside `themePersona` for the normal theme only; hellraiser, horror and every themed cast are untouched. The browser sends `personas` with each chat request; `chat.server.ts` re-cleans it and passes it explicitly (no shared server state, accounts stay separate). Memory access is enforced where the prompt text is built (`visibleMemories` -> `promptContextFor`); real data is withheld in `realDataFor`. Nothing here weakens Local-Only mode or the 'mail/calendar never go to cloud' rule.
- Storage is additive: old data has no such key; rolling back leaves it ignored.

## Security boundaries (audit, Release 3 item 12)
Already in place before this pass: optional shared-password gate or built-in accounts (signed sessions, owner-only windows), secrets kept server-side in `app-secrets.json` (mode 600, never returned to the browser), `redact()` on logs/bug reports, Local-Only AI enforced on the server, SSRF checks on custom provider URLs, read-only Unraid monitoring (no admin or shell operations exist, so nothing needs approval), mail attachments served `private, no-store` with a sandbox CSP.

Changed in this pass:
- Shared-password sessions are signed tokens with a 30-day expiry (key in `BUDDY_DATA_DIR/gate.key`, mode 600; changing `BUDDY_PASSWORD` signs everyone out). The old cookie was a bare SHA-256 of the password, valid forever. Everyone signs in once after the update.
- Sign-in attempts: 8 per address and 40 per server per 10 minutes (`rate-limit.ts`), because `X-Forwarded-For` can be faked by anyone who reaches the port. Side effect: someone guessing wrongly 40 times can lock you out for up to 10 minutes.
- Every response gets `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` unless it sets its own policy; `ALLOW_FRAMING=1` turns the framing part off.
- The test-key button sends nothing to cloud providers in Local-Only mode.
- Compose files publish the stack's Ollama (it has no password) on `127.0.0.1` by default (`OLLAMA_BIND`). Copy the new line into your own compose file to adopt it.

Known gaps, not changed (each needs a design decision or live testing):
- Cloud provider API keys entered in engine settings live in browser storage and are synced to your account file on the server; moving them to the server-only secret store is a migration.
- No Origin/CSRF token check on API POSTs (cookies are `SameSite=Lax`, which blocks cross-site POSTs in current browsers).
- No full Content-Security-Policy (the app relies on inline styles, a PDF worker and blob URLs).
- Prompt injection: documents, web results, mail and hand-offs are passed to the model labelled as data and the pals have no tools that change anything, so the worst case is a misleading answer, not an action.

## Room component split (Release 3 item 13, in progress)
`room.tsx` still holds the UI state and the turn loop; the decisions inside it now live in small pure modules with tests:
- `turn-plan.ts`: who speaks in what order for each mode (roundtable, broadcast, solve, debate, direct, campaign, summary, smart).
- `turn-dispatch.ts`: which AI answers a turn and the fallback order, including the rule that mail/calendar/task details never reach a cloud AI.
- `mode-meta.ts`: labels, help, placeholders and suggestions per mode, plus `perMode()` so a new mode needs one entry per table instead of edits across the component.
- `smart-team.ts`, `memory-rank.ts`, `ollama-runtime.server.ts`, `ollama-resources.ts`: see their sections above.
Still inside `room.tsx` and good next candidates: building the request body per turn, the streaming `consume` loop, the slash-command handler (`runSlash`).
