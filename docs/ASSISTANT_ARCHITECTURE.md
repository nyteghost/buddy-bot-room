# General Chat architecture — beta

General Chat is additive to the original mounted workspace. The owner-authenticated /api/assistant route stores conversation rows with optional assistant metadata in the existing chats.json. Legacy chat routes exclude these rows and refuse sharing, replacement or deletion of assistant IDs. Existing legacy rows are not silently migrated or destroyed. Explicit import makes a copy.

memory-keeper.json is the single schema-versioned durable memory source, queue and derived vector cache. Store transactions serialize atomic writes, use owner-only permissions and preserve corrupt input on failure. No second competing conversation database or external Second Brain agent is installed. Version 1 starts empty when the new file does not exist; old chats retain their existing schema and gain assistant metadata only through explicit copy/creation.

The request path scrubs credential-like chat text, checks owner access and conversation revision, selects available configured providers, filters memory by scope, ranks a bounded candidate set and calls the existing chat handler with server-authored context. Search and Today snapshots reuse existing authenticated read-only handlers. The optional context argument is server code, not accepted from the public request body. Model/provider keys are request configuration and never passed to chat scrubbers or saved in the conversation. Memory is withheld from cloud contexts by default; explicit opt-in does not bypass Local-Only.

One asynchronous worker incrementally handles completed turns after an idle delay. Its durable queue records epochs and attempts. Active foreground General Chat answers preempt the worker. It requests strict local JSON, checks exact user evidence, deduplicates by scope, holds contradictions and updates checkpoints. Memory changes increment an epoch; stale checkpoints, continuations and memory-derived replies cannot re-enter future model context. Deleted source IDs and forgotten text fingerprints prevent routine rediscovery. Raw transcripts remain as visible history.

Obsidian is a readable managed mirror, not a replacement for the authoritative JSON. Content hashes detect manual edits. Synchronization only writes managed ID filenames beneath the configured container vault; symlink checks prevent accidental traversal. Conflicts remain untouched and are surfaced. Explicit manual import is pending/unverified, without trusting edited metadata. Recovery is private pending. Optional group permissions affect only managed folders/files.

New files: assistant.ts (types/retrieval), assistant.server.ts (owner API/routing), keeper-store.server.ts (durability/sync), memory-keeper.server.ts (worker), chat-scrub.ts (shared credential detection), assistant-client.ts (browser requests), general-chat.tsx / memory-center.tsx / pixel-pals-app.tsx (UI). All existing provider, Food Focus, ShowPilot separation and Second Brain interfaces remain intact.

## Verified and remaining checks

Automated tests cover isolation, relevance, private/project boundaries, revisions, queue processing, foreground preemption, offline behavior, evidence checks, Obsidian conflicts/symlinks/recovery and scrubbers. Browser smoke uses an isolated Ollama protocol fixture and disposable data/vault. It verifies routing and UI, not real-model answer quality. A process restart test verifies persisted chats independently of a browser. Live CachyOS GPU performance, real Obsidian container permissions and actual Unraid Docker restarts require deployment validation. Main and separate ShowPilot/Vibelight repositories are outside this change.

## Retrieval measurement

Synthetic local Bun run: 1,000 scoped records, 100 keyword retrievals in 202 ms total (about 2 ms/query); serialized state 356,993 bytes, whole benchmark process RSS about 44 MB. This measures pure retrieval in this development environment, not Unraid throughput or Ollama/GPU inference. Full production browser and restart checks are recorded in the beta release report.
