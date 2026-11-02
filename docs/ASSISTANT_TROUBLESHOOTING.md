# General Chat troubleshooting

- **Owner sign-in required:** General Chat and Memory Center are owner-only in this beta. Enable persistent local accounts; original Pals remains available through Pixel Pals workspace.
- **Ollama offline:** use Connect Ollama → Test connection. This status is checked by Unraid, not by direct browser access. With a known working connection, check selected model availability and Local-Only policy before changing networking.
- **Model unavailable:** choose an installed replacement in conversation/model settings. An intentional manual assignment is not silently replaced.
- **Memory not used:** confirm the record is active, relevant, in the correct project/conversation, or explicitly granted if private. Pending records are never supplied. Cloud replies omit retrieved memory/checkpoints unless cloud-memory permission is enabled. Open the reply's memory inspector.
- **Checkpoint missing:** Ollama may be offline, processing paused or a memory correction may have invalidated the old checkpoint. Queue a checkpoint; original messages remain stored. Check failed jobs and Retry queued jobs. Do not assume unprocessed old instructions fit in the current context window.
- **Chat changed/busy:** another tab or background checkpoint updated the revision. Reload/select the conversation; your local draft remains. Avoid sending the same chat simultaneously from two devices. Independent chats may answer concurrently.
- **Vault sync failure:** check the actual /vault mount, writable permissions, optional correct group ID, and the status in Memory Center. Existing/manual notes are never blindly overwritten. Explicit manual import requires review; metadata cannot grant access.
- **Invalid database:** keep the original file and restore a verified backup. Do not replace it with an empty JSON object. Markdown recovery is limited, private and pending; it is not a full backup restore.
- **Credential text visible:** only recognizable text patterns are covered. Use Scrub existing chat history for live stores, separately review backups/exports/vault conflicts, and rotate exposed secrets. Images/encoded strings/unlabelled passwords can evade detection. AI provider keys belong in settings credential fields.
- **General answer appears all at once:** this release buffers the server answer so receipt, persistence and authorization can be validated together. Existing Pals retains streaming.

See [[GENERAL_CHAT]], [[MEMORY_KEEPER]], [[ASSISTANT_UNRAID]] and [[ASSISTANT_ARCHITECTURE]]. These are plain Markdown and can be copied into an Obsidian documentation folder.

## Current-information answers and Capture Inbox

If General Chat says it cannot verify current information, expand its web status. Set Web search mode to On for a question Auto did not recognize. Configure and Test SearXNG in Settings → Integrations, including JSON results support on the search server. A working Ollama connection does not itself supply live search. See [current information](CURRENT_INFORMATION.md).

If a voice memo stays queued, verify local Whisper settings and that Memory Keeper/capture processing are enabled. The app remains usable with text/manual review while the PC is off. HTTP origins normally cannot record a live microphone: upload a memo or use HTTPS. Keep overly long recordings and split them into shorter clips; the worker refuses to silently truncate their transcripts. See [Capture Inbox](CAPTURE_INBOX.md).

## Replies appear all at once

Beta 1.0.821 enables streaming in General Chat automatically. Check the displayed build after pulling/updating and refresh the browser. Credential-like output intentionally waits for full scrubbing. Initial health, context and web lookups still finish before the provider starts. A reverse proxy can buffer responses despite the application's no-buffering headers; disable buffering for `/api/assistant` in that proxy. A slow provider/model load also delays the first text. No live RTX 3080 benchmark is implied by browser fixture tests.

### Today says another device changed the saved state

The save was refused to protect newer work. Keep or copy your editor text, use Refresh saved Today, then apply your change again. Focus Assist retains a browser checkpoint if the server save fails. See [Adaptive Today](ADAPTIVE_TODAY.md) for limits and recovery.
