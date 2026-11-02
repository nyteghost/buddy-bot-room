# General Chat and Memory Keeper on Unraid

## Update the existing beta installation

1. Make a verified appdata backup and keep the current image/immutable tag for rollback.
2. In Docker → Compose Manager → **pixelpals**, keep the service image **ghcr.io/nyteghost/buddy-bot-room:beta**. Do not switch to latest/main.
3. Preserve the existing /data volume, credentials, accounts and .env. Keep **OLLAMA_URL=http://10.200.1.149:11434**; the verified PC/network/firewall setup needs no change.
4. Press **Compose Pull**, then **Compose Up** (or the corresponding Pull/Update then Up controls in your plugin). An ordinary container restart does not install a new image. Do not delete appdata or run down -v.
5. Open http://10.200.1.30:8090, sign in as owner, and refresh once. The existing Today window should appear first. General Chat is available in workspace navigation (mobile: More → General Chat).
6. Ask a short question; confirm the answering model. Create a second chat and switch back. Check Memory Center, review queued records and verify persistence after a normal restart.

## Required mounts

Keep your existing application data mapping. The container must see BUDDY_DATA_DIR=/data mapped to its persistent Unraid appdata directory. A host path in a setting is not accessible without a mount.

For the existing Homelab vault, add/keep this service volume mapping:

```yaml
volumes:
  - /mnt/user/appdata/obsidian/vaults/Homelab:/vault
```

Then set **Obsidian vault directory** to **/vault** in Setup → Obsidian. Turn **Mirror Memory Keeper into Obsidian** on only when ready. You may instead set OBSIDIAN_VAULT_DIR=/vault in Compose environment; environment values take precedence. The repository Unraid compose template already has the optional vault mount; check the actual Compose Manager project rather than replacing it wholesale.

The server process must be able to traverse/read/write the mounted vault. Notes default to owner-only. If Obsidian runs as a different container user, set **Obsidian group for managed memory notes** to that container's actual numeric GID, and ensure its process belongs to that group. Do not guess a GID or recursively chmod the entire vault. Pixel Pals then applies 2770 directories and 0660 files only to its managed Pixel Pals/Memory tree. A failed chown/write is reported as a sync failure; existing user notes are not overwritten.

For daily backups, keep a persistent /backups mapping outside /data and BUDDY_BACKUP_DIR=/backups. A backup on the same physical disk is not protection against disk failure. Use your existing secured backup workflow for credentials omitted by application backups.

## Ollama configuration

General Chat and Memory Keeper use the Pixel Pals backend to contact your existing remote Ollama. Mobile browsers do not need access to port 11434. Set the main local chat model to qwen3.5:9b in AI settings. The independently selected memory model must be installed; choose one of your existing suitable chat models, or Auto. The displayed app-host CPU/RAM are Unraid resources, not evidence of the remote GPU. No GPU model is inferred from an IP address.

If the PC is off, conversations/memory still remain on Unraid. Keyword retrieval and management remain available. Local answers and new AI checkpoints wait for Ollama unless a configured permitted key provider can answer. Local-Only blocks cloud fallback. For minimum GPU use, pause Keeper or set collection Off until needed.

## Rollback

Pin the previous verified beta image tag/digest and Compose Up with the same volumes. New assistant rows are isolated from legacy routes; older beta code has not been tested to preserve these new rows during writes. Back up before rollback and do not use an older version to edit chats.json. Keep the newer data snapshot for forward recovery.

## Current beta additions

After updating, configure Web search (SearXNG) and local Dictation (Whisper) in Settings → Integrations if wanted. No additional services or network changes are applied automatically. Text capture works without either service. Live microphone recording requires HTTPS; HTTP supports memo upload. See [current information](CURRENT_INFORMATION.md) and [Capture Inbox](CAPTURE_INBOX.md).
