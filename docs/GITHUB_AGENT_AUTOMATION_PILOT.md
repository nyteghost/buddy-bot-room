# Pixel Pals — GitHub-triggered Claude Code pilot (not active)

Prepared 2026-11-07. Repository `nyteghost/buddy-bot-room`.

## Status and scope

- Feature branch: `chatgpt/claude-actions-pilot`, initially based on default branch `main`.
- The pilot is **not active until the owner reviews and merges its draft PR into `main`**. Do not commit directly to `main`.
- New workflow: `.github/workflows/claude-issue-pilot.yml`.
- Trigger: ONLY a `labeled` event on **Issue #28**, when the label is exactly `agent:claude` and the actor is GitHub owner `nyteghost`.
- No schedule, polling, bot triggers, auto-merge or Unraid deployment. Job timeout: 25 minutes; Claude max turns: 8; Claude budget parameter: USD 2 per run. Actual account/provider billing and quota still require owner review.
- Development branches are created from `beta`, not `main`. The pilot may create ONLY `docs/AI_AGENT_PILOT_NOTES.md`. A post-run GitHub compare check refuses to open a draft PR if any other file changed. A failed check does not roll back a remote commit, so review is still required.
- Uses GitHub-hosted runners. There is no new Unraid service or exposed port. The 47 private art packs and owner secrets must not be placed in issues or public PRs.

## Owner setup, in order

1. Review the draft automation PR (target `main`). Pay attention to the new workflow and one change to `publish.yml` that adds `.github/workflows/**` to its `paths-ignore`: configuration-only changes should not trigger Docker image publication. App-code pushes still publish as before.
2. Open https://github.com/apps/claude and choose **Configure / Install**. Give access **only** to `nyteghost/buddy-bot-room`, not all repositories. Approve only the permissions you understand.
3. Obtain one supported Claude credential. For direct API use https://console.anthropic.com/settings/keys and be aware of separate usage charges. Alternatively a supported Claude Code OAuth token may be available from `claude setup-token` for eligible accounts; check current Anthropic terms/eligibility.
4. In https://github.com/nyteghost/buddy-bot-room/settings/secrets/actions choose **New repository secret**, then create exactly one of `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. **Do not paste it into issues, this chat, code, or build logs.**
5. In the repository's Settings → Actions → General, inspect **Workflow permissions**. Automatic PR creation by the job's `GITHUB_TOKEN` may require “Allow GitHub Actions to create and approve pull requests.” This setting grants a broad capability to workflows; keep disabled for the first branch-creation test if you prefer. The pilot PR-creation step is explicitly nonfatal if this permission is absent, and the workflow still runs the test/build. Do not enable without understanding its scope.
6. After verifying the workflow, secret and repository permissions, **approve merging the draft automation PR into main**. The workflow must exist on the default branch for issue-label triggers. The existing CI and publish workflows remain in place.
7. Open https://github.com/nyteghost/buddy-bot-room/issues/28 and **only now** add the `agent:claude` label, using the owner GitHub account. If the label does not yet exist, create it under the repository's Labels settings first; do not label issue #26 (real HD256 rollout) during the pilot.
8. Check repository Actions → “Claude Code - owner-labeled docs pilot.” Verify one run, the generated `claude/` branch, whether a draft PR to `beta` was created, the test/build results, and the issue comment linking to that run.
9. Treat all generated code and comments as proposals. Do not enable auto-merge, auto-approval, auto-deploy or unlimited retries.

## Important GitHub event limitation

A PR created using the standard `GITHUB_TOKEN` generally does **not** itself trigger another GitHub Actions workflow. For that reason, the pilot **explicitly runs `bun run test` and `bun run build` inside its own runner** after Claude's branch is verified. This does not yet demonstrate that the repository's separate full CI browser-smoke workflow automatically ran on the PR. That requires its own follow-up design/validation (such as a GitHub App-created PR event), not an unsupported success claim.

## Next phase only after successful pilot

Expand the owner-only trigger from Issue #28 to approved `agent:claude` labels on non-sensitive tasks, with finite concurrency and per-issue run limits, branch ownership policy, draft PRs to `beta`, and independent review. Investigate OpenAI Codex GitHub review as a **distinct coding agent**; ordinary ChatGPT chats cannot be started by a GitHub webhook. Private visual-art production must remain a reviewed, offline file handoff. Use project Issue #23 for status. No credentials or costly bots are enabled by merely reviewing this draft.
