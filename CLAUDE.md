# Claude Code — Pixel Pals Living Universe / HD256

Read `AGENTS.md` and `docs/CLAUDE_LIVING_UNIVERSE_HANDOFF.md` **before** making any edits.

- **Working branch:** `claude/living-universe-hd256`. Verify checkout and commit hash first.
- **Target for eventual review:** `beta` through a draft pull request. Do not push to `main` or commit directly to `beta`.
- **Scope:** Visual-character / world code, character ZIP storage and safe import, animation, theme/environment interactions, accessibility and related regression tests only.
- **Out of scope:** `tools/adhd-v02/`, `docs/ADHD_*`, shared bridge, Caddy, Unraid installer/Compose, credential or account files, real private art, permissions, memory/AI tasks, and unrelated work modules.
- **Keep:** Classic mode, current nine Pal identities, data and revision compatibility, imported-art provenance, Focus Mode, hidden-tab, reduced-motion and low-power behavior.
- **Before claiming completion:** Run focused tests, TypeScript, build, CI/browser smoke and report which hardware visual checks still need the owner.
- **First action:** Inspect the real source and the recovered HD256 Work handoff; summarize completed, unfinished and blocked work, then implement the highest-value safe visual increment.

No unattended deployment, no secrets, no direct data migration, and no silent cross-team merges.

## Shared coordination channel

Project coordination issue: https://github.com/nyteghost/buddy-bot-room/issues/23

Read its scope and update protocol. When beginning or completing a meaningful
HD256 increment, update that issue or a linked draft PR with branch, commit,
completed tasks, test/CI evidence, blockers, and requests for cross-workstream
review. Do not assume this ChatGPT conversation is live-connected to Claude.
GitHub is the durable exchange; an automatic Claude Action / Codex review
integration still requires explicit owner configuration and authorization.
Do not enable recurring/paid model calls or self-merging loops by yourself.
