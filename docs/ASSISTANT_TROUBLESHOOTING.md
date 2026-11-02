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
