# Pixel Pals legacy desktop shell (CachyOS / Arch)

**Security change:** The native wrapper now uses a small bundled informational UI.
It does not embed the web application, expose terminal/file commands or update itself.
The existing web application remains unchanged; open its normal address (for example
http://localhost:8090) in a regular browser to use all web features.

## Build / install from an already reviewed checkout

Clone the repository using your normal authenticated GitHub workflow. Review the
**exact commit** you intend to build. From the checked-out repository root:

    bash packaging/install.sh

This installer builds what is already on disk. It **does not fetch updates**.
It may install missing system build dependencies and the resulting local binary;
review the script before running it. To avoid changing an installed binary, use
a normal local Tauri build command instead.

## Updates — manual review required

The old packaging/pull.sh path is disabled, including FORCE mode. The in-app
git-pull-and-build action no longer exists. For a future update, obtain the
candidate revision with git manually, inspect its changes and security checks,
record the exact approved SHA, check out that revision, and only then build it.
**There is no signed automatic release/update channel.** Do not treat an
unverified branch tip as a trusted update.

## Ollama

The desktop shell does not start or manage Ollama. Existing web/server-side
Ollama connections are unaffected by this native wrapper change. When an
explicit browser-to-Ollama CORS allowance is required, grant only the origins
you actually use. Example for a localhost-only web app:

    OLLAMA_ORIGINS="http://localhost:8090,http://127.0.0.1:8090" ollama serve

Do not use a wildcard origin. Avoid exposing the Ollama port to untrusted
interfaces. See docs/security/desktop-wrapper-hardening.md for compatibility
notes, verification steps and remaining limitations.
