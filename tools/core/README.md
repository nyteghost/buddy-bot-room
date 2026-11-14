# tools/core — agent coordination tools (Claude-owned half)

Python 3.9+ stdlib only. Read-only against GitHub except `relay post --confirm`.
Not part of the Pixel Pals app. Formats: [`tools/CONTRACTS.md`](../CONTRACTS.md).
Ownership checks reuse ChatGPT's `tools/guard` (PR #50); without it, `verify-claim`
exits 2 and lifecycle tests are skipped.

| Tool | What it does |
|---|---|
| `pp-context` | Session bootstrap: base head, open PRs with exact-SHA CI, latest #37 relays, failed runs, this checkout's agent |
| `relay generate` | Builds a canonical `pixel-pals-relay:v1` handoff from git + evidence files |
| `relay parse` | Lists relay blocks in #37 as claims (canonical or not) |
| `relay post --confirm` | Publishes a canonical handoff to #37 (dry run without `--confirm`) |
| `verify-claim` | Independently checks assignment, commit, branch, exact-SHA CI and file ownership |
| `pp-test` | Runs available checks, writes `pp-test-results/v1` with evidence levels |

## Typical agent session

```bash
python3 tools/core/pp-context                         # where are we?
python3 tools/core/relay parse --limit 10             # what did others claim?
python3 tools/core/verify-claim --branch chatgpt/dev-tooling \
  --sha <40-hex> --agent chatgpt-dev-tooling          # don't trust; verify
# ... do the work, commit, push ...
python3 tools/core/pp-test --preset tooling           # or app / desktop / all
python3 tools/core/relay generate --from claude-dev-tooling \
  --to "pixel-pals-project-manager, owner" --status "READY FOR QA / DRAFT" \
  --pr <url> --test-results tools/out/test-results.json --output tools/out/handoff.md
python3 tools/core/relay post --file tools/out/handoff.md            # review (dry run)
python3 tools/core/relay post --file tools/out/handoff.md --confirm  # publish
```

## Tests

```bash
python3 -B -m unittest discover -s tools/core -p 'test_*.py' -v
```

Offline: a throwaway git repo, a synthetic agent assignment and a fixture GitHub
backend (`PP_GH_FIXTURES`). Covers parsing, CI rollup, schemas and the full
publish → retrieve → verify lifecycle with failure cases (failed/pending/other-SHA CI,
out-of-scope files, policy tampering, commit not on branch, wrong agent, stale tests).

## Environment

| Variable | Use |
|---|---|
| `PP_REPO` | `owner/repo` (default: from `origin`, else `nyteghost/buddy-bot-room`) |
| `PP_GH_BACKEND` | force `gh`, `http` or `fixtures` |
| `GH_TOKEN` / `GITHUB_TOKEN` | auth for the `http` backend |
| `PP_GH_FIXTURES` | fixture directory (tests) |

`tools/out/` holds generated evidence; don't commit it.
