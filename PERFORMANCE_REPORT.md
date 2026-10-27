# Performance report (branch `upgrade/local-first`)

Rules: numbers below are either counted from the real code path on a simulated clock, or timed on the authoring sandbox. Nothing is a browser profile unless it says so. Run the benchmarks yourself to compare on your machine.

## M1. Chat streaming: UI updates and browser saves

**Finding (confirmed in code):** every streamed token called `setMessages(...)`, which changed `chats`, and an effect then ran `JSON.stringify(chats)` + `localStorage.setItem` for *all five mode windows* on every token.

**Change:** `src/lib/stream-throttle.ts` (first token immediately, then at most one UI update per 50 ms, last token always delivered) and `src/lib/debounced-save.ts` (save 400 ms after things go quiet, never later than 2 s during a long reply; flushed on tab hide, page close, unmount and before a backup export). Cancelling a reply still flushes what had streamed.

**Benchmark:** `npx tsx scripts/bench-streaming.mts` (one reply of 1,200 tokens at 25 ms/token, ~30 s, on top of an existing history of 1.5 KB messages). "OLD" is the previous behaviour modelled as one update + one full save per token; "NEW" runs the real new modules on a fake clock. Stringify time is measured, not estimated.

| history | OLD updates | OLD saves | OLD data serialized | OLD stringify time | NEW updates | NEW saves | NEW data serialized | NEW stringify time |
|---|---|---|---|---|---|---|---|---|
| short (4 msgs) | 1200 | 1200 | 7.7 MB | 35 ms | 601 | 15 | 0.1 MB | ~0 ms |
| medium (40) | 1200 | 1200 | 76.9 MB | 619 ms | 601 | 15 | 1.0 MB | 8 ms |
| long (400) | 1200 | 1200 | 769.5 MB | 2333 ms | 601 | 15 | 9.6 MB | 29 ms |

Saves drop by ~98 % and UI updates by ~50 % with no added delay on the first token.

**Not measured:** real React render counts and frame times (needs a browser profile of the running app). Check in Chrome DevTools > Performance while a long reply streams.

## M2. Document search: embedding work

**Findings (confirmed in code):**
1. Every question embedded the question plus up to 24 candidate passages again (`smart-docs.ts` -> `/api/embed`), nothing was kept.
2. Candidates were the top 12 keyword matches, then "the remaining chunks in order", so passages near the end of a large collection were never even considered for meaning-ranking unless the keywords hit.

**Change:** `src/lib/embed-cache.ts` (content-hash keys per embedding model, hybrid keyword + meaning ranking by reciprocal-rank fusion, candidate picking that uses already-cached passages first and spreads new ones across the whole collection), `src/lib/embed-store.ts` (IndexedDB cache in the browser with in-memory fallback, capped at 8,000 vectors), `/api/embed` now also returns the model name. Changing the embedding model, or editing a passage, only re-embeds what changed. Falls back to keyword search exactly as before if Local AI is down.

**Benchmark:** `npx tsx scripts/bench-embeddings.mts` (400 passages, 8 questions, fake embedder: counts work, not Ollama speed).

| pass | OLD texts embedded | NEW texts embedded |
|---|---|---|
| first session, 8 questions | 200 | 113 |
| same documents again (cache kept) | 200 | 8 (only the questions) |

The ranking compute adds ~11-17 ms per question on this sandbox (keyword scoring over all passages). Real Ollama embedding latency was not measured (no Ollama in the authoring sandbox); the saving is the number of embedding calls, which on your GPU also means fewer embedding-model loads next to the chat model.

**Not done on purpose:** background embedding of whole collections. On a single GPU it would compete with chat inference and can evict the chat model from VRAM; passages get embedded lazily as questions touch them.

## M3. Background scheduler: overlap and blocking

**Findings (confirmed in code):**
1. The 30 s ticker called `tick()` with no re-entry guard, so a tick that took longer than 30 s overlapped the next ones.
2. `tick()` awaited everything in sequence, and `tickSchedules` (which waits for a whole model answer, possibly minutes) came *before* reminders, update checks, CalDAV, mail alerts and add-ons. One slow answer therefore delayed all of them.
3. A manual "run now" of a scheduled task could run at the same time as the timed one, and two model jobs (a scheduled task and the morning brief) could hit the GPU together.

**Change:** `src/lib/job-runner.ts` + `src/lib/jobs.server.ts` (one runner per server process, events in the server log). One run per job id at a time (a still-running job is skipped and logged), a lane that runs model work one at a time (`inference`), per-job timeouts that abort and free the slot, cancellation, optional capped retries with exponential backoff. The ticker now runs the quick checks side by side and starts the slow ones (backup, scheduled tasks, weekly review, morning brief) without waiting for them. Missed daily jobs after a restart are still caught the same day by the existing "due and not yet run today" rule.

**Benchmark:** `npx tsx scripts/bench-scheduler.mts` (real job runner; a slow answer scaled to 600 ms stands for 60 s, tick every 30 ms stands for 30 s).

| | ticks overlapping at peak | first reminders check ran after | reminders checks completed |
|---|---|---|---|
| OLD (sequential, no guard) | 20 | 630 ms (~63 s scaled) | 24 |
| NEW | 1 | 32 ms (~3 s scaled) | 24 |

"OLD" is a model of the previous control flow, not the old file executed; the NEW row uses the real runner with the new control flow. Not measured: a real multi-minute Ollama answer.

**Known limits:** a run that ignores its abort signal keeps running in the background after a timeout (the slot is freed so the scheduler is never stuck, and the timeout is logged); a task marked as run just before a hard crash is not retried until the next day.

## M4. Conversation storage: measured, deliberately not migrated

Chats are one JSON document in `localStorage` (all five mode windows), loaded once at start and (after M1) saved at most every 2 s while a reply streams. Measured on the authoring sandbox (`node -e` with 1.5 KB messages, 5 windows):

| messages per window | stored | load (JSON.parse) | save (JSON.stringify) |
|---|---|---|---|
| 4 | 0.03 MB | 0.1 ms | 0.1 ms |
| 40 | 0.32 MB | 0.6 ms | 1.0 ms |
| 400 | 3.21 MB | 6.0 ms | 11.0 ms |
| 1500 | 12.03 MB | 30.1 ms | 47.3 ms |

**Decision:** speed is not a problem, so no SQLite migration (it would add a migration risk to everyone's saved chats for no measurable gain). The real limit is the browser's `localStorage` quota (about 5 MB), which the 400-per-window case is already close to; the app already shows "Browser storage is full" and offers server-side storage. **Recommended follow-up if you hit that:** move chat persistence to IndexedDB (no 5 MB cap) behind the same debounced saver. Not started.

## M5. Polling

**Finding (confirmed in code):** background refreshers used plain `setInterval` and kept firing in hidden tabs and while their service was off (Ollama status probe every 5 s forever, phone captures and task sync every 60 s, mail/Unraid summary every 5 min, desktop update check every 30 min).

**Change:** `src/lib/poll.ts` `startPolling`: no requests while the tab is hidden (catches up when it becomes visible), never two in flight, doubling delays while a service keeps failing (Ollama probe up to 60 s, phone captures up to 10 min). Applied to `ollama-mascot`, `room.tsx` (captures), `task-sync`, `room-live`, `inbox-panels`, `update-popup`. Server-side: the Unraid watcher already has a `running` guard and the model/provider feeds poll every 6 h, so they were left alone.

**Benchmark:** `npx tsx scripts/bench-polling.mts` (real `startPolling` on a fake clock; one hour with the tab visible 15 min and hidden 45 min; the OLD column is a plain interval, which ignores visibility).

| poller | OLD requests/hour | NEW requests/hour |
|---|---|---|
| Ollama status probe, Ollama off | 721 | 17 |
| Ollama status probe, Ollama on | 721 | 180 |
| Phone captures and task sync | 61 | 15 |
| Mail/Unraid summary | 13 | 3 |

Not measured: battery or CPU effect on a phone.
