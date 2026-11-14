# Legacy Tauri wrapper IPC hardening — 2026-11-14

**Scope:** security/desktop-wrapper-ipc-hardening-20261114, based on beta
099f0698bddc494a5cdfd819f0d32944a766e341. Allowed paths only.
This is not the proposed, separate Desktop Town app. No web app, server,
production credentials, Unraid configuration or deployment is changed.

## Findings at pinned source

| Finding | Evidence | Assessment |
| --- | --- | --- |
| Remote frontend | src-tauri/tauri.conf.json: frontendDist=http://localhost:8090, devUrl=http://localhost:8080 | Confirmed remote content in the native webview |
| Remote capability | src-tauri/capabilities/default.json granted these origins core defaults | Confirmed grant; by itself does not prove exploitability of all custom commands |
| Privileged native commands | src-tauri/src/main.rs registered PTY shell, filesystem read/list/write, service and update helpers | Confirmed high-impact commands; hostile-origin reachability was not demonstrated |
| CSP | src-tauri/tauri.conf.json had csp=null | Confirmed |
| Ollama wildcard | src-tauri/src/main.rs set OLLAMA_ORIGINS to wildcard; packaging/README.md instructed it | Confirmed |
| Unsigned updater | run_update launched packaging/install.sh, which invoked packaging/pull.sh to fetch/merge without verification | Confirmed missing authenticity gate, not proof of malicious update |

Do not infer a demonstrated remote-to-custom-IPC exploit solely from these
configuration entries. Core/plugin permission grants and custom command
dispatch have distinct enforcement details. The new boundary eliminates the
exposure without attempting an exploit in a real user's session.

## Implemented hardening

1. src-tauri/tauri.conf.json bundles a minimal local frontend in src-tauri/ui
   rather than loading a remote web app, including in dev builds.
2. src-tauri/capabilities/default.json has zero native core/plugin grants,
   no remote allowlist and only the main window.
3. The Rust app registers no custom IPC commands. PTY, arbitrary file paths,
   process/service spawning, native Ollama proxying, source-directory
   disclosure and updater invocation are removed from the native surface.
4. A restrictive CSP allows self-only static resources, blocks network
   connections, frames, objects, forms, inline scripts and eval. The local UI
   contains no JavaScript, remote links or external resource loads.
5. The wrapper no longer starts Ollama with wildcard CORS. Packaging
   documentation gives a narrow local-browser origin example instead.
6. packaging/install.sh builds the current checkout without fetching source.
   packaging/pull.sh fails closed. Updating source requires independent,
   deliberate review of an exact revision and a separate manual action.

## Compatibility impact

**Breaking change:** The legacy wrapper no longer displays the live web
application. It displays a small informational page telling the user to open
Pixel Pals in a normal browser. The web app itself is unchanged.

**Breaking change:** Legacy Tauri-only features and calls (pty_spawn,
pty_write, pty_resize, system_stats, list_dir, read_text, write_note,
ollama_chat, ollama_tags, ollama_start, app_info, check_update and run_update)
cannot be invoked. This is intentional. The new Desktop Town must use a
separately designed, permission-scoped IPC contract to reintroduce any
native features with authorization, path constraints and consent.

**Breaking change:** The old one-step install no longer downloads code and
the in-app updater is removed. Manual source review is now required.

**Windows portability:** This is not the Windows 11 portable Desktop Town
project and does not claim PP-DT-002 through PP-DT-004's portable ZIP,
Data/ or WebView2 gates. This change neither installs on Windows nor
alters Linux production installations.

## Test matrix / independent QA

- src-tauri/tests/security_contract.rs checks: packaged frontend, absent
  remote capability, empty native permissions, non-null restrictive CSP,
  absent custom IPC, no injected executable HTML, disabled updater.
- .github/workflows/desktop-security.yml checks Rust fmt/check/clippy/test
  and packaging shell syntax. A separate existing web CI must remain green.
- Independent QA should compile a real packaged app, confirm it loads
  only local assets, and try hostile-origin IPC and navigation attempts.
  Confirm PTY, filesystem, process launch and updater are unavailable.
- Confirm no unsolicited Ollama process or network requests, verify launch
  without a running localhost:8090 service and separately verify the
  existing web UI still works normally in a browser.
- Test Linux CachyOS/Wayland and Windows only where supported by actual
  build dependencies. Do not claim a physical-device pass without evidence.

## Remaining risks

- The original web app, authentication, APIs, and server-side privileges
  remain out of scope. Browser access is not a comprehensive web audit.
- Tauri, WebKitGTK/WebView2, transitive native dependencies and OS runtime
  vulnerabilities remain. Monitor advisories and review lockfiles.
- Unused legacy Rust dependencies remain for now to avoid an unverified
  Cargo.lock rewrite; schedule dependency cleanup with a working Rust toolchain.
- There is no cryptographically signed automated update channel or fully
  attested build provenance; manual source review is not a signature.
- The installer still installs local packages/binaries when explicitly run.
  Nothing in this PR runs it or authorizes installation.
- Ollama CORS is not authentication: constrain bind addresses/firewall and
  never open the inference port to untrusted networks.
- CSP alone is not a navigation or authorization policy; IPC removal and
  no remote content are primary containment measures.
- Static configuration tests cannot establish end-to-end runtime security.
  Independent Core and QA approval is required before merge or installation.
