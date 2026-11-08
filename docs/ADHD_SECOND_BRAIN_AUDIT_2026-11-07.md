# ADHD Assistant Second Brain — Baseline Audit and Prioritized Roadmap

**Audit date:** 2026-11-07 (America/New_York)  
**Owner/workstream:** ADHD Assistant Second Brain Architect/Developer  
**Code repository inspected:** https://github.com/nyteghost/buddy-bot-room  
**Development baseline:** beta @ 1821b456d967b1b554693a93c52aed3cbe4ad96f  
**Existing ADHD feature branch:** chatgpt/adhd-assistant @ a0d8bce324e3fc6e72e3681791792a711d0dd89c  
**Existing draft PR:** #27 targeting beta  
**Coordination:** #23  
**Change type:** documentation-only audit; no runtime migrations, network changes, or production actions.

## 1. Evidence and confidence

This audit distinguishes four categories:

- **Repository-verified:** directly inspected GitHub branch/PR, source files, implementation documentation, and/or workflow configuration.
- **CI-verified:** a GitHub Actions job completed successfully using isolated fixtures; this does not verify the actual home server.
- **Host-observed, documented:** prior owner-run, read-only Unraid diagnostics and schema reports, recorded in repository documentation. This is not a fresh connection to Unraid.
- **Unverified/planned:** feature absent from reviewed implementation, or current live behavior not established. Do not convert these items to "installed" based on a written plan.

No direct SSH/Docker/Unraid session or access to running ADHD Assistant data was available during this audit. No private user records, native authentication secrets or company data were accessed.

## 2. Branches, PRs, tests and source ownership

- beta @ 1821b456: latest inspected shared Pixel Pals integration baseline. main is out of scope.
- chatgpt/adhd-assistant @ a0d8bce: existing ADHD branch, ahead of beta by five commits, behind by zero at audit time. Compare showed only four modified paths: tools/adhd-v02/audit_native_review_proxy.py, test_audit_native_review_proxy.py, run-native-proxy-audit.sh and run-complete-readonly-diagnostics.sh.
- PR #27 (open, draft) covers fail-closed static Caddy route analysis. It is NOT a native application deployment.
- PR #25 (open) is Pixel Pals Core Developer scope. PR #24 (open) is Claude HD256/Living Universe scope. Neither is owned by this workstream.
- ADHD PR #27 GitHub Actions CI run 42375530336: **test and smoke jobs both SUCCESS**. Steps include shell/Compose validation, mocked Unraid diagnostics, synthetic ADHD Caddy audit, synthetic inbox same-origin checks, dependency gate, TypeScript, Vitest, build, and Chromium smoke. Browser smoke exercises the repository's Pixel Pals test app, not the installed ADHD/Caddy browser origin.
- beta CI run 42371262924: test and smoke jobs both SUCCESS.
- A repository search scoped to the GitHub account did not identify a separately named ADHD Assistant repository. This is **not evidence that none exists**. The native Python ADHD Assistant v0.1 source is described as an installed Unraid code bind mount and is not a complete independently versioned source tree in the inspected Pixel Pals repository. Before modifying native code, identify its authoritative source repository or establish a new private source-of-truth with owner's approval.

Source evidence:
- https://github.com/nyteghost/buddy-bot-room/pull/27
- https://github.com/nyteghost/buddy-bot-room/actions/runs/42375530336
- https://github.com/nyteghost/buddy-bot-room/actions/runs/42371262924
- https://github.com/nyteghost/buddy-bot-room/issues/23
- docs/ADHD_UNIFIED_STACK_BETA.md
- docs/ADHD_TASK_INTAKE_BETA.md

## 3. Actual implementation inventory

### Standalone ADHD Assistant (host-observed, documented; not freshly inspected)
- Python/SQLite v0.1 dashboard is documented as running in a separate Docker container with code at /mnt/user/appdata/adhd-assistant/code and data at /mnt/user/appdata/adhd-assistant/data.
- Historical native source inspection identified Store methods for peer registration, backups, handoffs, approval, and audit; local HTTP API and native handoff approval existed.
- Native task table was inspected read-only with columns id, title, notes, due_at, status, project_id, source, created_at, updated_at. A source report verified status default 'open', notes default empty string, and no unique index on source.
- The projects table was reported with id, title, next_action, notes, status, created_at, updated_at.
- Full native app routes, UI, current database migration sequence, attachment handling, auth policy and installed version should be re-audited against the actual source before committing a major architecture change.
- Host-observed native bridge_enabled was unset and enabled native peer count was 0 on 2026-11-06. Do not assume these are still current.

### Bridge and task intake (repository-verified)
- tools/adhd-v02/bridge_v02.py provides a separate receiver/approval queue from the standalone ADHD native Store.
- Unified Compose guidance describes the bridge on private Docker networking, without published LAN/host port, while preserving ADHD dashboard and Caddy independently.
- The approved-task exporter and reconciliation prototypes exist, with synthetic tests. Raw-SQL task insertion is fixture-only/disabled. Preferred path is the native Store's create_handoff/approve_handoff methods and idempotent application-level approvals.
- Browser review UI and candidate route patch exist only in staged/development source. The native browser inbox is NOT authorized for live deployment.
- A Pixel Pals send receipt means accepted for ADHD-side review, not that a task was created or scheduled.

### Pixel Pals reusable functions (repository-verified beta; live device acceptance varies)
- General Chat and Memory Keeper: persistent chats, reviewed/scoped memories, source evidence, correction, archive/delete, private/project/conversation grants, local AI queue, keyword and optional embedding ranking.
- Capture Inbox: typed captures; local queued voice processing, reviewable task/idea/memory suggestions, Today planner integration. Voice and microphone paths require live iPhone/HTTPS tests.
- Second Brain: owner-reviewed Markdown notebook inside a bounded Obsidian vault; managed notes, version conflict handling, soft-trash, and restricted lookup. Obsidian is a mirror rather than the authoritative Memory Keeper database.
- Today / Focus Assist / Just Start, Meeting Vault, local transcription/review features and GitHub Journal exist in Pixel Pals beta. Their availability in the standalone ADHD dashboard is NOT established by these Pixel Pals docs.
- Repo Watch/GitHub Journal supports selected repository journal scans and Obsidian notes in beta, not general cross-app synchronization.
- Security hardening and source-level tests exist, but they do not certify every deployment path.

References: docs/MEMORY_KEEPER.md, docs/CAPTURE_INBOX.md, docs/SECOND_BRAIN.md, docs/GENERAL_CHAT.md, docs/GITHUB_JOURNAL_BETA.md, docs/ADHD_ROADMAP.md.

## 4. Storage architecture and duplication risks

Known sources of truth must stay separate:
1. **Native ADHD:** /data/adhd.sqlite3 in its private Unraid data mount for native tasks, projects, handoffs and other implemented records.
2. **ADHD sidecar bridge:** separate bridge-v02.sqlite3 queue and approval log. An approved sidecar entry is not automatically a native task.
3. **Pixel Pals:** its mounted /data contains chats.json, memory-keeper.json, capture.json, today.json and app-specific settings. These are independent stores.
4. **Managed Obsidian:** explicit, approved Markdown mirror; not a replacement for JSON/SQLite source data. Vault requires separate backups.

Never mount the same writable database into both apps, run cross-application direct SQL writes, make Obsidian a general unrestricted filesystem gateway, or silently import all historical chats. Use approved, durable handoff messages with source IDs, deduplication, schema versions, provenance and both-side audit receipts.

Migration should always run against a disposable copy, preserve the previous file and schema, include backward compatibility/migration checks, and provide a documented restore path before owner approval.

## 5. Local AI: implemented vs demonstrated

- Pixel Pals supports configured Ollama and separately selected local Memory Keeper models; local memory processing queues and text search can survive Ollama downtime. It has no implicit cloud fallback for Local-Only memory work.
- Ollama networking and browser-inaccessible GPU details are described in docs/ASSISTANT_UNRAID.md. This audit did NOT run a real RTX 3080 inference or benchmark the user's current models.
- Transcription through a configured local Whisper-compatible service and optional embeddings are implemented in Pixel Pals beta; availability/quality in standalone ADHD remains unverified.
- Future Strata/OpenAI-compatible local provider is **planned** (Issue #30). No installation, provider configuration or model routing changes are authorized now.
- Any added inference router must enforce Local-Only server-side, use explicit per-domain provider allowlists, and fail closed if only cloud providers are available.

## 6. Security and privacy risks / release blockers

**P0: Native Caddy/browser authorization hold**
- Native _local() was observed to check X-ADHD-Local-Token with constant-time comparison and enforce loopback Host/Origin rules. Caddy also employs access controls; actual rewrite behavior on the intended browser origin is not established.
- A past redacted Caddy static audit returned zero candidate upstreams for the configured host. This may be a host mismatch or unsupported matcher; it is NOT proof of a vulnerability or functional route.
- PR #27 strengthens fail-closed audit behavior. Static marker presence is insufficient; isolated end-to-end authenticated/unauthenticated/CSRF HTTP tests and correct actual browser-host verification remain required.
- Do NOT strip Origin, disable native token checks, expose a new bridge port, or modify Caddy/live app to force a pass.

**P0: Source control and recovery**
- Identify authoritative native ADHD source, installed startup path and rollback method; obtain redacted schema/version inventory and verify consistent SQLite/vault backups and one restore rehearsal in a disposable environment.
- Do not disclose personal record titles, corporate data, Basic Auth hashes, bearer tokens or credential values in issue comments/logs.
- Ensure any previously exposed credentials are revoked/rotated by the owner.

**P0: Domain isolation**
- Personal/private, development, work, external provider and Pixel Pals shared data require server-enforced scope checks and separate credentials. Filter authorization before candidate retrieval, embeddings, ranking, AI context packing and cache reuse; re-check before output.
- Tokens for apps/agents must be scoped, rotatable, revocable, short-lived where possible, and auditable. Denied requests must not reveal document existence. AI suggestions are untrusted, not new permissions.
- Work/CGC data is not automatically transferred to the home Unraid server. Any company material or Microsoft 365 integration needs applicable IT authorization and explicit per-source consent. ShowPilot remains an independent offline-first Windows work tool. Any CGC scheduling excludes CEPAC.

**P1: Retention and provider exposure**
- Define deletion for primary record, indexed text, embeddings, previews, cache, exports and backup retention. Revocation cannot undo information already sent to an external model.
- SQLite is not encrypted by default; propose protected Unraid volume permissions and encrypted off-device backups; separate secrets from memory export and from GitHub.
- Do not assume LAN/Tailscale access alone is authorization. Authentication, CSRF protection, HTTP security and device logout remain necessary.

## 7. Target architecture (proposal, NOT implemented)

- **Native ADHD service:** primary owner-facing Capture / Today / Search / Projects / Knowledge UI. Keep existing Python and SQLite until architecture review proves a rewrite is necessary.
- **ADHD knowledge service:** domain-separated records and document blobs on Unraid; immutable source refs; audit trail; versioned migrations; full-text indexes; optional local embeddings/vector indexes. Start with SQLite FTS5 rather than premature infrastructure expansion.
- **Review worker:** queue for transcription, extraction, suggestions and index updates. AI-derived facts become proposals with source quotes and verification state; no silent cross-scope promotion.
- **Secure connector gateway:** app-specific credentials, per-domain read/write scopes, explicit consent, short-lived authorization, event receipts, idempotency and revocation; no direct cross-app database mounts.
- **Local inference adapter:** Ollama first, OpenAI-compatible local providers as an optional interface; Strata future; cloud default denied for private/local-only material.
- **Independent Pixel Pals:** uses its existing Memory Keeper; may request specifically approved scoped references, never blanket replication.
- **Work enclave:** work data stays on authorized corporate equipment by default; only reviewed, policy-permitted metadata is eligible for personal transfer.
- **Backups:** data snapshots, independent Obsidian/attachment copies, restore drills, encrypted off-device copies and recovery of config/secrets through separately protected owner procedures.

### Proposed minimum record fields
record_id, security_domain, owner_id, project_id, kind, title, body_ref, source_app, source_uri/source_id, source_timestamp, created_at, updated_at, trust_state, sensitivity, retention_policy, content_revision, integrity_hash, deleted_at, audit_ref. Keep raw attachments outside general conversational context; use derived text only after review and allowlist checks. A record's classification travels with excerpts and derived embeddings.

### Proposed service contracts
- Capabilities are explicit, e.g. task.read, task.propose, memory.search, memory.read, project.summary, handoff.create.
- Every request binds principal, app identity, owner, project scope, maximum disclosure, expiration and an audited request ID. Neither an imported character nor an AI response can grant itself capabilities.
- Reads return limited, source-linked records; writes are proposals until owner confirmation; retries are idempotent using client-generated correlation/source IDs; revocation immediately blocks future retrieval.
- Offline behavior: enqueue only permitted durable drafts; never claim completed action without confirmed receiver receipt and optional separate task-created receipt.
- No external provider gets Local-Only records, direct storage paths or access tokens.

## 8. Revised phased roadmap and acceptance gates

### Phase 0 — Baseline and security prerequisites (next)
- Confirm authoritative standalone ADHD source ownership/repository, current container/runtime, database schema, data mounts and actual Caddy browser authority from sanitized host diagnostics.
- Complete PR #27 review and isolated real HTTP/Caddy auth/CSRF fixture; do not deploy native inbox until owner-approved backup/rollback and verified browser path.
- Document source-of-truth map, existing feature tests, backup restore and safe branch strategy.
- **Exit:** exact native source/version known; reproducible isolated app; redacted route/auth tests; restore tested; no loss or exposure.

### Phase 1 — Core Second Brain
- Preserve native tasks/projects and add universal text/URL/file capture, attachments, review queue, source evidence, per-domain durable storage and full-text search.
- Reuse Pixel Pals patterns/contracts without copying its private records or rewriting Memory Keeper.
- **Exit:** one capture → durable save → keyword search → source retrieval cycle survives restarts; cross-domain denial, duplicate intake, import, delete and restore tests pass.

### Phase 2 — ADHD daily productivity
- Calm Today, priorities, next action, reminders, project grouping, recovery shelf and optional calendar preview.
- Reuse approved Just Start/Focus concepts. One primary recommended action; no punitive streaks or excessive notifications.
- **Exit:** offline Today works, manual overrides persist, reminders are optional, recover/resume verified across browser reloads.

### Phase 3 — Intelligent memory
- Permission-filtered hybrid search, local embeddings, source-grounded chat retrieval, corrections/versioning, relationship proposals and memory maintenance.
- **Exit:** retrieval attribution, contradiction review, revocation and stale-index purge tests pass; no fabricated provenance.

### Phase 4 — Connected applications
- GitHub read-only project journal first; then owner-approved personal calendar, notes, email and documents. Corporate connectors require separate organizational approval.
- Each source has an explicit allowlist, read scopes, sync state, rate limits, deletion behavior and disconnect test.
- **Exit:** disconnect stops sync and retrieval; duplicate sync idempotent; token not exposed; no unauthorized write.

### Phase 5 — Pixel Pals shared intelligence
- Finish ADHD-native reviewed handoff, source-bounded Memory/Project API, per-Pal/agent grants, audit and revocation. Both apps remain usable independently.
- **Exit:** authorized retrieval works, unauthorized requests reveal nothing, offline retries safe, user approval enforced, no shared writable DB.

### Phase 6 — Advanced local AI and optional automation
- Configurable local providers, measured GPU/RAM budget, optional future Strata interface, source-grounded summaries, supervised tasks and scheduling.
- **Exit:** Local-Only never routes to cloud; AI offline degrades gracefully; explicit authorization, budget and rollback tests pass. No paid services or autonomous agent coding enabled without owner approval.

## 9. Workstream boundaries and immediate next assignment

**This workstream owns:** native ADHD Second Brain architecture, isolated source inspection, native store integration, permission model, safe data design, developer tests/docs and a dedicated ADHD branch.

**Do not touch without coordination:** Pixel Pals Core memory internals, Living Universe/HD assets, ShowPilot work data/UI, main/beta branches, GitHub agent workflows, production Unraid containers or credentials.

**Immediate safe next task:** obtain a sanitized, read-only inventory of the installed native ADHD source/routes and browser hostname/proxy behavior, then reproduce native API/auth against an isolated fixture. Use existing tools/adhd-v02 native preflight/audit scripts and PR #27 fixes; do not bypass the known deployment hold. Coordinate with the PM through Issue #23.

**Owner approvals still required:** standalone repository/source decision, live read-only access/inventory if needed, any data migration or new package, any company-work data connection, any network/auth change, any merge, and any deployment.

## 10. Milestone reporting template

- Completed:
- Branch + exact commit SHA / draft PR:
- Evidence (repo, CI or host-observed):
- Tests (command, run link, result):
- Preserved data/features:
- Security/privacy consideration:
- Unfinished / blocker:
- Production deployment readiness:
- Owner/PM decision requested:
- Next smallest verifiable assignment:

**Current milestone:** Audit/documentation only. No native app source changes, no production migration, no live Caddy change and no new external integration.  

## 11. Tracked environment-file hygiene check (redacted, source-only)

The public Pixel Pals repository's beta branch contains a tracked root .env file (361 bytes). A redacted source check found six nonempty configuration assignments. None had an obviously credential-labeled variable name or matched the limited token/opaque-secret patterns checked. **This is not a comprehensive secret scan and does not prove values are safe to publish.** A maintainer should review this committed file and relevant history privately before adding provider credentials or new integration secrets. Never add live tokens to tracked files; prefer ignored local configuration, runtime secrets and documented redacted examples. No environment values were printed, changed, or copied into this report.
