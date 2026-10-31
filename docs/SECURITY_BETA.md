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

## Second triage pass

The follow-up updates Vite to 8.1.6, Vitest to 4.1.12 and Zod to the patched 4.6 line. It also applies compatible transitive updates for brace-expansion, js-yaml, undici, nanoid, source-map-js, seroval and launch-editor. The application's Zod usage is a bounded integer quantity schema; existing AI SDK peer ranges accept Zod 4. Existing spreadsheet, chat, document and production-build checks remain required after the migration.

The current complete audit is **4 findings: 0 critical, 0 high, 3 moderate, 1 low**. CI and beta publishing now gate at `bun audit --audit-level high`. Earlier counts above describe the prior patch, not the current tree.

| Remaining dependency | Severity | Triage and next action |
|---|---|---|
| esbuild 0.18.20 | Moderate | Nested under Drizzle's `@esbuild-kit/esm-loader` development toolchain. The production Docker target runs the compiled app and does not start this package's development `serve()` API. Upgrade the parent loader/toolchain; do not force its pre-1.0 esbuild API across versions. [Advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). |
| minimatch (older supported parent ranges) | Moderate | Used through build globbing and spreadsheet/archive dependencies. The advisory describes attacker-controlled pattern amplification; request handlers do not intentionally accept arbitrary glob patterns. A patched version requires a major API migration in these parents. Keep open until parent upgrades and archive tests pass. [Advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249). |
| uuid 8.3.2 | Moderate | ExcelJS conditional-formatting code calls `v4()` without an output buffer; the advisory concerns `v3/v5/v6` with caller-provided buffers. Do not claim the package is fully patched. Upgrade with the spreadsheet dependency and retain workbook round-trip checks. [Advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq). |
| KaTeX 0.16 line | Low | Transitive math/diagram rendering. Exploitation requires pre-existing prototype pollution or control over renderer-option prototypes; this review does not establish that such a path exists in Pixel Pals. Upgrade the rendering parents to support 0.18.2+ and add hostile-math rendering checks. Retain this as an open finding. [Advisory](https://github.com/advisories/GHSA-238p-pmpm-9mq7). |

These are triage conclusions from the dependency paths and observed call sites, not a complete security audit. They do not replace real-device testing or owner approval for stable promotion.
