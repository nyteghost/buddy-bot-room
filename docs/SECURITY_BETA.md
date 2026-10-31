# Beta dependency security follow-up

Audit date: October 31, 2026. Development and publishing remain on `beta`; promotion to `main` requires owner approval.

## Critical findings patched

| Dependency | Fixed version pinned | Advisory |
|---|---|---|
| DOMPurify (through Mermaid) | 3.4.17 | [SAFE_FOR_TEMPLATES shadow-root bypass](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) |
| shell-quote (through the Vite editor toolchain) | 1.12.0 | [Line-terminator command injection after comment tokens](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) |

The pins are in `package.json` overrides and `bun.lock`. They keep compatible major versions. The critical audit now reports zero findings. This is an audit result for the locked dependency tree, not a claim that the whole application has no security issues.

## Release checks

CI and beta image publishing both run `bun audit --audit-level critical` before TypeScript, tests and build. A critical finding or a failed audit request blocks these jobs. The complete dependency audit remains informational so lower-severity findings are still visible.

The post-patch full audit reports **35 findings: 17 high, 16 moderate, 2 low** across production and development dependencies. Further triage should determine runtime reachability and compatible upgrades, particularly for sanitization/rendering dependencies, HTTP clients and build tools. A forced major upgrade across the application is not part of this patch.

Validate the frozen lockfile install, unit/component suite, production build and browser smoke tests. Preserve spreadsheet/document viewing and diagram rendering when upgrading their dependency chains.
