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
