# Pixel Pals Agent Guardrails — ChatGPT-owned half

Provisional coordination tools for Issue #37. This folder is not part of the Pixel Pals app/runtime.

## Shared contract

Claude owns tools/core/** and tools/CONTRACTS.md on branch claude/dev-tooling. These tools use:
- ownership.yml — version: 1, agents.<id>.branches and .paths, shared_readonly
- tools/out/scope-check-findings.json and tools/out/security-lint-findings.json — pp-findings/v1
- exit 0 = clean, 1 = findings, 2 = tool error

The mapping is YAML-compatible JSON flow so it works with Python 3 stdlib and conventional YAML readers. **UNCONFIRMED** assignments in ownership.yml need owner review before becoming a mandatory merge gate.

## Local usage (Python 3, Git installed; no server)

    python3 -m unittest discover -s tools/guard -p 'test_*.py' -v
    python3 tools/guard/scope-check --branch chatgpt/dev-tooling --agent chatgpt-dev-tooling --base origin/beta
    python3 tools/guard/security-lint --branch chatgpt/dev-tooling --base origin/beta
    python3 tools/guard/install-hooks

The installer refuses to overwrite an existing pre-commit hook. It checks *staged* files only; the full PR delta is separately checked in CI. Other agents invoke with their assigned branch (or --branch on detached CI HEAD). Output files under tools/out/ are generated evidence, not source; do not commit or upload secrets in them.

The static security scanner reports suspicious source patterns and has both false positives and false negatives. It does NOT establish that native IPC, cloud provider settings, updaters, or runtime permissions are secure. Manual adversarial QA remains necessary.

## Workflows

- pp-tooling-tests.yml: isolated guard unit tests and policy check on this draft PR. No paid AI calls.
- pp-relay-check.yml: after integration on the repository default branch, listens to Issue #37 relay comment events; calls tools/core/verify-claim only if available. Read-only; no feedback comments, merges or deployments. **It cannot run from a beta-targeting draft PR while the GitHub default branch is main.**
- pp-portable-validate.yml: manually validated prior S4 CI artifact, with explicit artifact run ID and name. Attempts ephemeral non-admin Windows execution; failure to run as non-admin is a FAIL, not success. File-boundary and service-registry checks are best-effort only and not proof of complete host containment. Windows hosted runners are not physical GPU acceptance.

No workflow installs on the owner's PC or touches Unraid.
