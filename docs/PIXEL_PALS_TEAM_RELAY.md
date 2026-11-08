# Pixel Pals Team Relay — free GitHub coordination

**Status:** Proposed workflow in draft PR. Not active until reviewed and merged to GitHub's default branch (`main`). No AI inference, paid APIs, Claude sessions, Unraid access, code execution requests, merge or deployment.

## What it does

- A lightweight GitHub Actions job reads public metadata for open PRs, their latest known CI run, and trusted handoff comments in Issues [#23](https://github.com/nyteghost/buddy-bot-room/issues/23) and [#26](https://github.com/nyteghost/buddy-bot-room/issues/26).
- It creates **one** team-inbox status comment in Issue #23, then **edits** that same comment only when content changes.
- Runs after approved handoff comments and CI completion; an additional daily check reconciles changes, with an optional manual trigger.
- Uses the repository-provided `GITHUB_TOKEN`; no API key or new external account.
- It posts links to source comments, **not the comment bodies**. Do not put any private content in this public repository.
- It does **not** send notifications to or awaken separate ChatGPT/Claude chats. A developer must open their chat/agent and read the board or issue.

## Handoff contract

A developer/PM posts a public-safe GitHub comment to Issue #23 (general) or #26 (Living Universe), including:

```text
<!-- pixel-pals-relay:v1 -->
From: core
To: pm, qa
Status: ready-for-review
Summary: PR #25 is ready for review.
Next: QA to inspect tests and report regressions.
<!-- /pixel-pals-relay -->

Report details: branch, SHA, changed scope, tests, blockers and the request.
```

Recognized `From`/`To` role tokens: `pm, claude, artist, core, adhd, qa, architect, infra, brainstorm`.

Statuses: `progress, blocked, ready-for-review, decision-needed, complete`.

Only comments from the repository owner or GitHub-recognized members/collaborators, posted by actual user accounts, enter the relay index. Bot posts and public strangers remain outside the routed list. Authorship does **not** constitute permission to execute changes.

## Safety and activation gates

- Scoped workflow permissions: repository contents/read, Actions/read, PR/read and Issues/write (for the single board comment).
- Explicit `main` checkout; never execute instructions/code from issue comments or PR heads.
- Does not require GitHub App installations, API keys, AI models or a self-hosted runner.
- `publish.yml` is adjusted to ignore this workflow, its script and docs on pushes to `main`. This prevents activating the relay alone from building/publishing container images.
- Existing `beta` application CI and project branches remain unchanged.
- GitHub treats workflows in a new branch as inactive for these events until their code is present on the default branch.
- **Owner review and explicit merge authorization are required** before activation. Once merged, use Actions → **Pixel Pals Team Relay (free)** → **Run workflow** for the first refresh, inspect the Issue #23 comment, and test a harmless handoff comment.

## Shared files: two locations with different permissions

**ChatGPT Project Library (created):** `/Pixel Pals/Team Shared Files/`
- `00 Inbox`: new files awaiting review
- `10 Handoffs`: private deliverables to pass to collaborators
- `20 Private Artwork`: unapproved character/source artwork
- `30 QA Evidence`: screenshots, logs and test recordings
- `40 Architecture`: internal architecture references
- `50 Releases`: approved bundles and rollback records

Files in the ChatGPT Library are **not automatically reachable from Claude**. Do not post their private contents to the public repository.

**For actual ChatGPT↔Claude file access:** create a dedicated, access-controlled **private repository** (e.g. `nyteghost/pixel-pals-private-handoffs`) or another private file service both agents have permission to read. The user must approve/create it and authorize both integrations; no such private repository is assumed to exist. Consider per-repository access, release files, Git LFS/storage limits, and revocation. Keep secrets, credentials, employer/personal information and production appdata out of it unless a separate data-handling review approves otherwise.

The Team Relay should link to **sanitized filenames/IDs only**, never attach private assets or secret URLs. The file store and coordination board are deliberately separate.

## Limitations

- Open PR listing is bounded to the first 100 GitHub results and latest 100 workflow runs.
- Issue comments are scanned in batches, up to 300 per source issue.
- Status depends on GitHub Actions service health and permissions.
- The board is a snapshot and does not claim to prove a feature is production ready.
- The relay does not install, launch, or pay for coding agents.
