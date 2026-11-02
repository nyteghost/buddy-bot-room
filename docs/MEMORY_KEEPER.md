# Memory Keeper user guide

Pixel Pals has one internal local Memory Keeper for the new General Chat conversations. It is not another chatbot and does not run one model per conversation. Persistent records remain on Unraid when the gaming PC is off.

## Enable and configure

Use Setup → Local AI for **Memory Keeper background processing**, its independent model, optional embedding model and context/batch limits. Use Setup → Obsidian for vault, mirroring, version retention and optional vault group. An environment variable overrides the corresponding saved setting. General Chat requires owner sign-in, local accounts and a mounted BUDDY_DATA_DIR. The existing Pals workspace is still available without these requirements.

Auto memory-model selection chooses a smaller installed non-coder/non-embedding model. You can specify an exact installed Ollama model. Memory jobs explicitly request non-thinking JSON output on models that support it, so the bounded output budget is used for the checkpoint. No download happens automatically. A missing selection or offline Ollama leaves jobs queued; it does not use a paid cloud model for memory processing. One job runs at a time after an idle delay and is aborted/yielded when a General Chat answer starts. Avoid selecting a large memory model on a 10 GB card while other GPU applications are running. Scheduling cannot control other applications or all legacy Pal inference.

Review is the default per-chat collection setting. Suggested facts include exact user-message evidence. AI output is unverified; explicit corrections receive precedence. Contradictions need explicit resolution. A checkpoint tracks overview, decisions, unfinished tasks and questions. Invalid JSON, credentials or invalid evidence are not accepted as facts. Failed processing never discards the original transcript.

## Scopes

| Scope | Where a record may be retrieved |
| --- | --- |
| Global | Relevant questions across owner conversations |
| Project | Conversations explicitly associated with that same project |
| Conversation | The originating conversation only |
| Private | Only conversations explicitly granted that record in Conversation controls |

Private grants and scope changes require approval. Project suggestions do not grant access. This beta is owner-only: it does not implement shared multi-user project groups. Retrieved records are labelled untrusted information, never elevated instructions. Scope filtering happens before semantic or keyword ranking, and again before returning an answer. A memory inspector shows the still-authorized records associated with a reply.

## Memory Center

Open **Memory Center** from General Chat. It reports Ollama connectivity, configured memory model, processing state, queue, counts, storage bytes, last success, vector cache and vault sync status. Search includes pending and archived records. You can create, correct, approve, pin, archive, delete, restore archived records, inspect sources and restore earlier versions within their original scope. Changes across scopes require the editor and explicit approval.

Deletion purges the record text, source quotes and versions from the live memory database, leaving a fingerprint tombstone to prevent automatic re-extraction. Related source messages are suppressed from future model context; the original transcript remains visible as history. Corrections/restrictions invalidate old checkpoints and memory-backed replies for future context. Use **Queue checkpoint** to rebuild when needed. Revocation cannot retract context already received by a model/provider. Backups and external copies require separate management.

Keywords work without Ollama. Configuring an installed embedding model enables hybrid semantic/keyword scoring with a five-second embedding deadline, bounded candidate batches and keyword fallback. The vector cache is incremental, not an exhaustive full-vault semantic index. **Rebuild retrieval index** clears cached vectors, which rebuild on demand. No automatic full-vault ingestion occurs.

## Backups, export and restore

Use **Export memory and conversations** for a JSON archive. Keep it private. Restore merges valid records for review, preserves existing IDs/tombstones, and restores non-conflicting conversations archived with collection off and private grants cleared. Restore does not overwrite an existing chat. Approve desired scope before using restored records.

The existing daily backup includes chats.json and memory-keeper.json under BUDDY_DATA_DIR. Configure BUDDY_BACKUP_DIR outside that folder and mount it persistently; verify a completed backup before updating. The normal backup intentionally excludes app-secrets.json and Google tokens. A full recovery therefore also requires your separately secured credentials, accounts and deployment configuration. Prefer stopping the container for a consistent volume snapshot, especially during writes. Restore via the existing backup controls; restart afterwards. Restoring an older backup can restore old history and permissions: review and scrub it before using AI.

A corrupt memory database is preserved and fails closed; it is never silently reset. Restore a known-good backup rather than deleting it. Managed Obsidian Markdown can be recovered into private pending records if the database is lost, but Markdown recovery cannot recreate missing private records, conversation transcripts, tombstones or the original permission model. JSON backups are the full durable source.

## Limits

Up to 300 General Chat conversations, 2,000 memory records and 100 projects. A conversation stops accepting new turns at 5,000 messages or roughly 1.9 MB instead of silently deleting data; export and continue in a fresh chat. The queue is bounded at 100 and resumes unprocessed eligible conversations after restart. Batches and context use conservative character budgets rather than exact model tokenizer counts. Version retention is configurable from 1–20. This beta does not auto-delete or auto-merge chats, or apply inactive-chat organization without your review. Existing Pals/Food Focus chats retain their original flows; saved server conversations can be explicitly copied into General Chat. Memory Keeper does not automatically collect every legacy tool conversation.

## Current beta additions

Reviewed Capture Inbox ideas/memories use this same store, with source capture/suggestion references and private scope by default. Approved non-private Obsidian notes can include up to three keyword-related notes inside the same authorization scope. See [Capture Inbox](CAPTURE_INBOX.md).
