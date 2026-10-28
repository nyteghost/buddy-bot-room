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

## Project workspaces (Release 3 item 15)
- `projects.ts` (pure helpers + browser store, key `pixel-pals-projects-v1`, cleaned on every read/write: known pals only, length caps, dependency loops removed). Project memories are NOT copied: they stay in `workbench.project[name]`. The active project is the existing `pixel-pals-active-project-v1`.
- Room integration: `projectBrief` is prepended to `memoryContext` (server cap raised 1500 -> 2400 chars; still labelled as data, not instructions); docs are filtered to the project's list when it has one; an effect seats the project's pals when the active project (or its team) changes, including on load; a run is logged after each completed discussion.
- Storage is additive; rolling back leaves the key unused.

## Ollama benchmarking (Release 3 item 16)
- `ollama-bench.ts` (pure: prompt set, `measure`, `summarize`, `avoidModels`, `measuredBest`, defensive `cleanResults`), `ollama-bench.server.ts` (`runSuite` with an injected `BenchApi`, real `httpBenchApi`, file store with atomic write, one-at-a-time lock). `/api/ollama` actions: `bench-suite` (NDJSON progress stream), `bench-results`, `bench-clear`. `resolveLocalModel` passes the avoid list to `bestInstalled`.
- Storage: `ollama-bench.json` in the data volume, newest 400 results (60 per model), schema version `v`; other versions are ignored. Deleting the file is always safe.

## Frontend efficiency (Release 3 item 17)
- `message-row.tsx`: one chat message as a `memo` component. Props are the message object (identity is stable for finished messages) plus a few primitives; click handlers go through `rowActions`, one object whose methods are refreshed every render so they never go stale.
- `power.ts` / `power-pure.ts`: `useCalmInterval` (decorative timers; stop when hidden, slower in low-power), `usePowerAttributes` (sets `data-hidden` / `data-lowpower` on `<html>` for CSS), `chatSlice` (newest 60 messages unless the user asks for more), `useEverTrue` (load a window's code on first open). Low-power is per device (`pixel-pals-lowpower-v1`, deliberately not in backups or account sync). `startPolling` multiplies waits by `env.scale()`.
- Code splitting: `ai-elements/message-markdown.tsx` holds streamdown and its plugins and is loaded by `React.lazy`; Work tools and Betas windows are lazy and mount on first open.

## Migrations and recovery (Release 3 item 18)
- `migrate.ts` (pure runner + record format), `migrations.ts` (the list; append only), `migrate.server.ts` (file adapter over the data folder, atomic writes, runs once per process from `bootJobs` and the dev server), `migrate-client.ts` (localStorage adapter, called when the room module loads).
- Record: `{version, pending?{id,attempts,saved}, skipped[], history[]}`. `pending` is written before a migration starts and removed after; finding it at start means the last run was cut off. `saved` holds the old values of the declared keys.
- Operating guide: `docs/UPDATING.md`.
- Dependency advisories: see the open finding in IMPLEMENTATION_PROGRESS.md (38 reported by `bun audit` on 2026-10-28, not yet triaged for reachability).

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
