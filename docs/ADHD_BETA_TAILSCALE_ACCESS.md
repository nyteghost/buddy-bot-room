# ADHD Assistant Photo Beta — Tailscale HTTPS without iPhone CA installation

**Status:** Implementation prepared in draft Pixel Pals PR #39, **not installed yet**. Requires owner-run, commit-pinned installer; no existing Pixel Pals or production Caddy changes are authorized.

## Verified Unraid and mobile environment (2026-11-08)

Owner's live `tailscale serve status` showed **`https://tower.tarpon-drum.ts.net:8443 (tailnet only)` → `http://127.0.0.1:8090`**, already serving Pixel Pals. The new independent beta HTTPS Caddy gateway is running at `https://10.200.1.30:18768` and authenticated `/api/bootstrap` returns **401 unauthenticated** with verified TLS using its own Caddy root CA. Beta application remains on host-loopback `127.0.0.1:18767`, and the original production Caddy is on port 18765.

The iPhone screenshots show Tailscale MagicDNS hostname over cellular data, so a **separate Tailscale Serve HTTPS endpoint** is preferable to installing a new self-managed root CA on iPhone or CachyOS. Tailscale Serve automatically provisions publicly trusted TLS certificates for the tailnet hostname, while keeping the endpoint tailnet-only. Tailscale's *Serve* HTTPS port option supports independent ports; its *Funnel* public relay port restrictions are a separate feature we must not invoke.

## Proposed new route

```text
CachyOS / iPhone with Tailscale enabled
       https://tower.tarpon-drum.ts.net:8444
            | tailnet-only; Tailscale HTTPS
            v
 Tailscale Serve --bg --https=8444
            | http://127.0.0.1:18769 (loopback only)
            v
 Existing beta-only Caddy container adhd-assistant-photo-gateway
            | SAME Basic Auth username and bcrypt hash as LAN beta site
            | exact Origin allow for https://tower.tarpon-drum.ts.net:8444
            | deny external /bridge/v1/*; upstream Host/Origin rewrite
            v
 ADHD Assistant Photo Beta 127.0.0.1:18767
            |
 Gaming-PC Ollama qwen3-vl:4b
```

**Existing `:8443` Pixel Pals service MUST stay exactly unchanged.** No production Caddyfile edit/reload/restart, no Tailscale Serve `reset`, no Funnel/public exposure, no direct Tailscale Serve proxy to the unauthenticated native beta port 18767.

## Guarded owner installation

Review `tools/adhd-v02/install-adhd-photo-tailnet-serve.sh` before running. Download and execute a **commit-pinned** GitHub raw script from Unraid terminal, ideally over secure CachyOS SSH. No GitHub token or new password is needed. The installer:
1. Checks that existing Tailscale Serve **8443 → Pixel Pals 8090** is present, **8444** is not configured, and local ports 8444/18769 are not listening.
2. Confirms existing beta gateway and native beta running; checks that its public CA verifies LAN HTTPS, with unauthenticated `/api/bootstrap` returning 401.
3. Extracts **only the existing beta gateway Basic Auth username and bcrypt hash** from the beta-only Caddyfile and duplicates it into a candidate additional listener. The hash stays in private files, never appears in console, CLI arguments, GitHub or logs.
4. Adds a loopback-only `:18769` HTTP listener to the **existing beta-only Caddyfile**; Tailscale provides TLS before it reaches this loopback. The second listener uses Basic Auth on all paths, denies foreign origins, denies external bridge, and rewrites to native loopback 18767.
5. Validates the complete candidate in a disposable offline Caddy sandbox with writable unprivileged UID 99 tmpfs storage, a fix proven by the owner's prior diagnostic.
6. Requires typing **`ADD ADHD TAILNET BETA`**. Only then makes a timestamped private backup of the **beta-only** Caddyfile, installs the candidate and **briefly restarts only** `adhd-assistant-photo-gateway` (never production Caddy), then checks the added loopback listener denies unauthenticated bootstrap (401).
7. Adds only **one** additional Tailscale Serve listener with `tailscale serve --bg --https=8444 http://127.0.0.1:18769` and verifies both `8443` and `8444` mappings still exist. `--bg` persists across Tailscale restarts per its documentation.
8. The existing `https://10.200.1.30:18768` LAN beta site remains available and private, and its separate Caddy root CA/keys are unchanged.

**Rollback:** `tailscale serve --https=8444 off` removes **only** the ADHD listener while preserving Pixel Pals `:8443`; do **not** run `tailscale serve reset` or `tailscale funnel`. For complete rollback, restore the private timestamped beta-only Caddyfile backup and restart only `adhd-assistant-photo-gateway`; never restart or modify the production `adhd-assistant-lan` container. If the installer reports an unexpected state, stop and inspect first.

## Acceptance tests after owner installation

- `tailscale serve status` still lists Pixel Pals on `8443` and ADHD photo beta on `8444`, both marked tailnet only.
- From CachyOS and iPhone *with Tailscale connected*, browse `https://tower.tarpon-drum.ts.net:8444`. Browser shows a **trusted certificate with no manual root CA installation**; otherwise stop.
- Unauthenticated app shell and `/api/bootstrap` are denied; beta username/password prompts and authenticated app assets/API work without CORS or unexpected redirects.
- **Do It With Me** opens, `Start without a photo` works, and an explicitly chosen non-sensitive room photo can be uploaded to the gaming-PC vision model `qwen3-vl:4b` and return a useful tiny action. No cloud fallback/automatic photo retention.
- On iPhone over cellular with Tailscale VPN on, the site still loads and photo capture works. Tailnet access is not public internet exposure.
- Pixel Pals `:8443`, native ADHD and bridge, production Caddy `:18765`, and photo beta/gateway remain healthy and unchanged in their original functionality. No full-stack Compose Up/Down, port forwarding, or service removal.

**Reference:** [Tailscale Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve) and [Tailscale Serve overview](https://tailscale.com/docs/features/tailscale-serve). This is a draft implementation: true certificate trust, actual iPhone access, route authentication and image model quality still require owner-run testing.
