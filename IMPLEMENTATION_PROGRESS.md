# Implementation progress (branch `upgrade/local-first`)

Image for this branch: `ghcr.io/nyteghost/buddy-bot-room:beta` (main stays on `:latest`).

## Review findings (what already existed)
- Accounts + login (`accounts.server.ts`, `gate.server.ts`); keys are server-side and write-only (`settings-crypto.server.ts`).
- Memory/embeddings (`rag.ts`, `embed*.ts`), hardware/GPU tiers (`hardware.server.ts`, `gpu-tier.ts`), Ollama catalog (`model-catalog.ts`, `ollama.server.ts`), Unraid watcher (`unraid.server.ts`), backups, Tailscale.
- All model calls go through exactly two server files: `chat.server.ts` (rooms) and `ask.server.ts` (scheduled/Telegram questions). The browser sends the engine choice (and, for cloud engines, its own key) with each request.
- `room.tsx` is ~2,000 lines; `engine.ts` holds engine settings; no approval/audit system exists; no per-agent model assignment (the `model` on each agent is a legacy label).

## Phase 1 — Local-Only mode + reliability  (DONE, pending live test)
- [x] `src/lib/local-only.ts` (pure rules), `src/lib/ai/guard.server.ts` (one gate: engine kind AND real address must be the approved Ollama).
- [x] Optional switch, default OFF (`LOCAL_ONLY_AI=on` or Settings -> Local AI turns it on). Changed from default-on after review: free keys cost nothing, paid engines never run unattended, and default-on locked the app out until Ollama was connected.
- [x] `chat.server.ts`: cloud/custom engines get 403 `local-only` before any network call; guard re-checked right before the stream.
- [x] `ask.server.ts` (schedules, Telegram, vendor price AI): only Ollama while on; retries can't escape the guard.
- [x] Reliability: `src/lib/ai/reliability.ts` (transient detection, capped exponential backoff, cancellation, friendly errors, cached probe); Ollama pre-check gives a clear 503 message; 5-minute cap on local replies; scheduled asks retry connection errors only.
- [x] Local AI panel shows whether Local-Only is on.
- [x] Tests: `src/test/local-only.test.ts`, `src/test/ai-reliability.test.ts`.
- Validation: type check clean for touched files; pure logic verified with node shims. Full vitest/build run in GitHub CI (vitest can't be installed in the authoring sandbox).

## Release 1 (performance) — milestones, one commit each
- [x] M1 Streaming: throttled UI updates + debounced chat saves (`stream-throttle.ts`, `debounced-save.ts`, `scripts/bench-streaming.mts`, `src/test/stream-throttle.test.ts`). Numbers in `PERFORMANCE_REPORT.md`.
- [x] M2 Embedding cache: `embed-cache.ts`, `embed-store.ts` (IndexedDB), hybrid ranking, `scripts/bench-embeddings.mts`, `src/test/embed-cache.test.ts`. Numbers in `PERFORMANCE_REPORT.md`.
- [x] M3 Scheduler: `job-runner.ts`, `jobs.server.ts`, scheduler tick + `runSchedule` rewired, `scripts/bench-scheduler.mts`, `src/test/job-runner.test.ts`.
- [x] M4 Conversation storage: measured; speed is fine, so no migration. Quota (~5 MB) is the real limit; IndexedDB persistence is the recommended follow-up (see report).
- [x] M5 Polling: `poll.ts` applied to six client pollers, `scripts/bench-polling.mts`, `src/test/poll.test.ts`.

Release 1 is complete pending your live check and CI. 
## Release 2 — milestones
- [x] R2-1 Context budgeting: `context-budget.ts`, digest of older turns, per-engine window cap, `scripts/bench-context.mts`, `src/test/context-budget.test.ts`.
- [ ] R2-2 Ollama resource manager (VRAM, loaded models, keep-alive, queue).
- [ ] R2-3 Routing and "which model answered".
- [ ] R2-4 Smart multi-agent mode.
- [ ] R2-5 Memory (search, edit, explain, project/agent scopes).

## Next (not started)
1. Phase 2: split `room.tsx` (extract hooks/modules one at a time, behaviour identical).
2. Phase 3: per-character role + model assignment (actual model used shown per reply).
3. Phase 4: projects workspace and structured multi-agent workflow (sequential on the GPU, turn/time limits).
4. Phase 5: read-only Docker/Unraid diagnostics, then approval-gated actions with audit log.

## Extras (user requests during Release 2)
- [x] Chat: when your own Ollama can't be reached (or errors before any text), skip it and use the next cloud AI that is set up (`cloudFallbackChain`: free keys first, paid only if switched on and under the spend cap). Local-Only mode still blocks cloud AI on the server.
- [x] Notes tab: Obsidian vault link (`/api/vault`, owner only; settings `OBSIDIAN_VAULT_DIR`, `OBSIDIAN_NEW_FOLDER`; mount the vault into the container). Not yet tried against a real vault.
- [x] Mail performance (branch `perf/mail`, merged to beta): pooled IMAP connections, newest-page fetch by message number, server-side search operators, in-memory caches validated by UIDVALIDITY/UIDNEXT/EXISTS, frontend request sequencing, Load older, Back without reload. Tests `imap-pool`, `mailbox-pipeline`, `mail-send` (simulated servers). Numbers are from a simulated server only; see `MAIL_PERFORMANCE_REPORT.md`. IMAP IDLE not implemented.
