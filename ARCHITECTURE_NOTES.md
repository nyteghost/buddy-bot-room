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
