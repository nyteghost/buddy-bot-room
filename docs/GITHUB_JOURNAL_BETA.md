# GitHub Journal — Pixel Pals Second Brain (beta)

The **Repo Watch** screen gains an opt-in GitHub-to-Obsidian journal. This is an additive project-documentation lane, not a replacement for reviewed personal memories or Working Pals permission gates.

## What it does

- By default it is **off**. This owner's `docker-compose.unraid-beta.yml` explicitly opts in with `GITHUB_JOURNAL_ENABLED=1`, applying only when no prior saved configuration exists. The owner may also enable or disable it under Repo Watch and click **Scan Now**.
- It runs once daily at **03:00 America/New_York** (editable). If Unraid restarts after that time, it catches up on the next scheduler tick. No missed-day burst.
- It reads each selected repo's default branch and beta branches, up to 12 per repo. The first scan saves a **baseline of up to 10 recent commits** per branch, not a complete backfill. Later scans compare persisted per-branch commit SHAs.
- It writes a separate Markdown note for each changed branch, with source commit links and a GitHub comparison link. Example: `Projects/GitHub/nyteghost--showpilot/Updates/2026-11-03-beta-<sha>.md`.
- Writes use create-only semantics. If a note already exists, it must match the recorded HEAD before the checkpoint advances. Your pre-existing notes are never overwritten or deleted.
- Checkpoints and configuration are stored atomically in `BUDDY_DATA_DIR/github-journal.json` (included in your normal persistent appdata backup).
- It uses the existing `BUDDY_DATA_DIR/repos.json` Repo Watch list. If that file **does not exist**, the initial default watch set is Pixel Pals, Vibelight, Vibebeam, ShowPilot, RTP Approval System, and CGC Zone Monitor. An existing empty list is respected.
- GitHub is always read-only. `GITHUB_TOKEN` is optional for public repositories and required for private repos; provide a **read-only fine-grained token** for specifically approved repositories. Never put the token in the notes or frontend.
- Optional local AI explanations are **off by default**. If enabled, only commit messages (not source code, PDFs or diffs) go to the configured local Ollama model. Generated summaries are explicitly marked unverified.
- The notes are project documentation, not approved user memory. No automatic personal-memory promotion or work task creation.

## Required Unraid Docker configuration

Your existing Obsidian vault on the Unraid host is `/mnt/user/appdata/obsidian/vaults/Homelab`.

The Pixel Pals container needs a **read/write bind mount** to that specific vault, for example:

    /mnt/user/appdata/obsidian/vaults/Homelab:/obsidian-vault:rw

Then add `OBSIDIAN_VAULT_DIR=/obsidian-vault` to the Pixel Pals container environment. The supplied Unraid beta compose already mounts this vault at `/vault` and sets `OBSIDIAN_VAULT_DIR=/vault`, so you needn't add a second mount if using that stack. Restart/recreate the Pixel Pals container using the normal deployment procedure after updating the beta image. Do not replace your existing BUDDY_DATA_DIR mapping or Obsidian container. The directory must be writable by the Pixel Pals container's UID; inspect permissions before changing them. Do not `chmod -R 777` or change ownership blindly.

GitHub private repos require `GITHUB_TOKEN` in the Pixel Pals server environment. Prefer a token with read-only Metadata and Contents permissions for only the repositories you approve. GitHub's branch/compare APIs may need additional read-only access depending on your organization's policy. Do not put private code or company secrets in a public repository.

## Use

1. Update the Pixel Pals **beta** container after verifying CI succeeds.
2. Open **Repo Watch**; add/remove tracked repositories as desired. Review organizational permissions before enabling work projects.
3. Set the daily time (default 03:00 ET), choose whether local-only AI summaries are permitted, and click **Save journal settings**.
4. Click **Scan Now** for the first baseline. Keep the page open or refresh later to read result/errors. Each successful checkpoint is persisted independently.
5. In Obsidian open `Projects/GitHub/` to browse dated notes.

Disable the journal in Repo Watch to stop new scheduled scans. Disabling doesn't delete notes or checkpoints. No destructive migration is performed. The scanner intentionally doesn't infer test/deployment success merely from a commit message.

### Limitations

- It monitors the manually selected Repo Watch list rather than automatically subscribing to all newly created repos. Add new ones in Repo Watch.
- Branch discovery reads up to the first 100 branches and limits selected beta/default branches to 12. A compare result can be truncated by GitHub; the note says so.
- If an older baseline commit has been deleted by a force push, GitHub compare can fail: error is shown and the previous checkpoint is preserved for manual resolution.
- Automated validation of this implementation does not prove the Unraid bind mount, token permissions, or live local Ollama operation. Confirm these on the host.

For the supplied `docker-compose.unraid-beta.yml` the journal is approved and enabled on first startup through `GITHUB_JOURNAL_ENABLED=1`. Existing saved preferences win (a previous manual disable stays disabled). This beta compose uses `BETA_GITHUB_TOKEN` for private repos. The normal `docker-compose.unraid.yml` remains opt-in using `GITHUB_JOURNAL_ENABLED=1` in its env file. Live GitHub access and vault permissions are not validated by CI.
