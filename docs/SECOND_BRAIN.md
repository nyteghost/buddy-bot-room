# Second Brain for Pixel Pals (beta)

Second Brain is an optional, owner-controlled notebook in the mounted Obsidian vault. Open **Notes → Second Brain → Connect to Obsidian**. `OBSIDIAN_VAULT_DIR` identifies the server mount; requests cannot choose another vault.

## Available in beta

- Create, search, edit and soft-trash approved Markdown notes under `PixelPals/Preferences`, `Projects`, `Focus Sessions`, `Decisions`, and `Lessons Learned`.
- Content revisions detect edits made directly in Obsidian even when the note's frontmatter timestamp is unchanged. A conflict keeps your browser draft; copy it, refresh the list, and review the latest note before editing again.
- Editing a title keeps the existing filename. Notes renamed in Obsidian remain editable if the filename retains its `--<id>.md` suffix. Categories are fixed while editing an existing note.
- Focus Assist's **Review in Second Brain** prepares a minimal task/checkpoint summary in Notes. Review, remove private details, and choose **Edit and approve**, then **Save approved note**. No automatic notebook write or conversation capture occurs.
- The optional per-browser **local-only Second Brain chat retrieval** switch defaults off. Relevant short excerpts are labelled untrusted data; cloud engines do not receive notebook excerpts through this feature.
- **Use as Pal memory** copies the chosen note into browser memory by explicit action. Browser Pal memories and the separate Obsidian Memory Markdown bridge remain available.

## Data boundaries and recovery

ShowPilot and other vault directories are outside the notebook namespace. Symlinked notebook directories are rejected before creating children. New files use exclusive creation; edits use a temporary file and replacement. Soft-deleted notes go to the vault's `.trash` folder, which must be a real directory, not a symlink.

Back up the mounted vault separately from Pixel Pals' `/data` volume. The app's data-volume backup does not automatically include a separately mounted `/vault`. Restore a trashed note with Obsidian or your file manager; retain its `--<id>.md` suffix and category folder. Back up both the beta data and the vault before testing an update.

## Still requiring validation or future work

- Real Unraid filesystem permissions and Obsidian editing/restart/restore tests on the owner's installation.
- An in-app notebook export/restore workflow and richer proposal history.
- Explicitly scoped integrations with preview and undo. No autonomous external-app edits are enabled.

`NicholasSpisak/second-brain` is inspiration only, not an installed dependency. Automatic extraction and complete conversation archiving are not enabled by this feature.


## General Chat beta integration

See [General Chat](GENERAL_CHAT.md), [Memory Keeper](MEMORY_KEEPER.md) and [Unraid deployment](ASSISTANT_UNRAID.md) for the new centralized service, container mounts, privacy scopes, backup/restore and remote Ollama settings. The existing Second Brain notes and external repository inspiration remain separate from the managed memory mirror; no external autonomous agent is installed.
