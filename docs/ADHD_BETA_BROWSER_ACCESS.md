# ADHD Assistant beta — direct browser access on CachyOS and iPhone

**Status:** Design and read-only inspection prepared. **Not deployed**. The existing `adhd-assistant-photo-beta` service is already running **healthy**, bound to Unraid loopback `127.0.0.1:18767`, with independent beta SQLite and local photo guidance through the gaming PC's Ollama.

## User outcome

Open the beta directly from **CachyOS Chromium/Firefox** and **iPhone Safari** using a private HTTPS URL, with an authentication challenge before ANY app content or `/api/bootstrap` reaches a browser. No SSH terminal in normal use. Keep the native app bound to loopback and keep production `buddy-bot-room`, `adhd-assistant`, `adhd-assistant-bridge`, `adhd-assistant-lan` and current Caddy `*:18765` listener untouched until an explicitly reviewed, additive route is ready.

## Read-only live inventory — required first

Download the pinned [audit wrapper](../tools/adhd-v02/run-adhd-beta-caddy-audit.sh) from the feature branch and run it in the **Unraid terminal**. It asks Caddy to adapt its *existing* configuration and sends that JSON via a memory-only pipe into an isolated Python parser. It outputs **only structural booleans and counts** (TLS policy, auth-before-proxy, rewritten headers, known native/beta loopback upstream). It does not print Caddy hostnames, password hashes, bearer tokens, IPs, certificate keys or raw config, and does not modify the Caddy container.

Also run these read-only Unraid checks:

```bash
ss -ltnp '( sport = :18768 )'
docker inspect --format 'caddy_network={{.HostConfig.NetworkMode}}' adhd-assistant-lan
docker inspect --format 'caddy_running={{.State.Running}}' adhd-assistant-lan
```

The port `18768` is an example **new** HTTPS beta listener, not reserved or verified. If occupied, pick another port without stopping any application.

## Design constraints

1. **TLS and iPhone trust:** Use a certificate already trusted by CachyOS and iPhone, or a private CA that is deliberately installed/trusted on both. Do not present a "Not Secure" HTTP or untrusted-certificate page for private room-photo upload. A Tailscale HTTPS URL, if Tailscale and both clients are enrolled and the route is approved, is another option; verify availability before deciding.
2. **Authentication:** Protect **every** beta path, including `/`, `/app.js`, `/api/bootstrap`, `/api/settings`, `/api/companion/photo-guidance`, backups and all other API endpoints, with Caddy `basic_auth` (or a verified existing identity gate) **before** proxying to the native app. No open LAN listener; prefer private-network access. Generate auth password hashes locally; never commit login credentials/hash to GitHub.
3. **Reverse proxy contract:** Proxy to `http://127.0.0.1:18767` from the trusted local Caddy process. The native app deliberately rejects non-loopback `Host` and `Origin`. If the existing proxy architecture uses header rewrites, rewrite *upstream Host* to `127.0.0.1:18767` and *upstream Origin* to `http://127.0.0.1:18767`; ensure the browser's external-origin requests never bypass the Caddy auth boundary. **Do not weaken the app's existing Host/Origin/token checks.**
4. **API privacy:** Deny direct beta `/bridge/v1/*` externally. Do not add broad CORS responses, leak `X-ADHD-Local-Token`, or log photo/AI request bodies. Keep native `/api/bootstrap` behind full authentication; its bearer is a session value, not an internet login.
5. **Explicit origin:** A dedicated private host/HTTPS port is simpler than a path under Pixel Pals, because the standalone web app uses root-relative JS/API paths and its own security policy. Don't put it at `/adhd-beta/` without a separate base-path implementation.
6. **Stability:** Never run `docker compose down`, restart Pixel Pals, change the 18765 production listener or its current certificate/Basic Auth configuration, or make the native beta listen on `0.0.0.0`. Prepare a backup of existing Caddy config and validate the *whole* candidate Caddyfile with `caddy validate` before any narrowly scoped hot reload. Check production and beta health immediately afterward; revert only the added route on unexpected regression.

## Candidate Caddy site (illustrative only; NOT ready for direct paste)

```caddyfile
# Use only after discovering the actual live hostname, TLS/cert, listener,
# auth configuration, available port and owner-approved private access method.
https://REPLACE_WITH_VERIFIED_PRIVATE_HOSTNAME:18768 {
    # Add confirmed existing trusted TLS configuration here.
    # A real trusted certificate must be configured; do not deploy placeholders.

    basic_auth {
        REPLACE_WITH_PRIVATE_USERNAME REPLACE_WITH_LOCAL_CADDY_HASH
    }

    @deny_bridge path /bridge/v1/*
    respond @deny_bridge 404

    reverse_proxy http://127.0.0.1:18767 {
        header_up Host 127.0.0.1:18767
        header_up Origin http://127.0.0.1:18767
        header_up -Authorization
    }
}
```

This is **not** a complete installed configuration. Browser Basic Auth is a perimeter boundary only when routed over trusted HTTPS. Caddy JSON inspection may reveal that an existing auth policy, host matcher, proxy rewrite or certificate arrangement requires a different secure route. **Never disable existing native restrictions just to make the site respond.**

## Required acceptance tests

- Unauthenticated `GET /`, `GET /api/bootstrap` and `POST /api/companion/photo-guidance` are denied by Caddy even with missing/invalid credentials.
- Authenticated CachyOS browser loads all assets, bootstraps a session, and can perform native API writes; browser Origin and Host are forwarded as expected without relaxing native checks.
- iPhone Safari on the approved private network sees a *trusted* HTTPS site, can sign in, choose/take a room photo, and request a small action from `qwen3-vl:4b`. Disconnected/invalid phone request rejected.
- Backend remains `127.0.0.1:18767` only; externally accessible direct port `18767` remains closed.
- Production Pixel Pals `8090`, native ADHD `8765`, Caddy `18765`, bridge and Whisper retain health, ports, mounts and auth behavior.
- Rollback is the removal of **only the added beta route** and a validated, scoped Caddy reload; no production data deletion.
- No live deployment/merge performed just by committing this guide.

Coordination: ADHD Assistant private issue #8 (Remember Yourself), private issue #6, native PR #7; Pixel Pals beta PR #36 and central issue #23.
