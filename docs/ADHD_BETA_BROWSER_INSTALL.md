# ADHD Assistant Photo Beta — safe direct browser access

## Status — 2026-11-08

**Independent HTTPS gateway draft prepared, not yet installed.**

The owner ran the initial HTTPS installer which attempted to append a site to the *existing* `adhd-assistant-lan` production Caddy container. Although Caddy `adapt` and `validate` passed, `caddy reload` failed. The installer reported restoring its original Caddyfile from its timestamped backup. Root cause not yet confirmed; Caddy may have its admin API disabled or inaccessible. Never repeat the old `/tmp/install-adhd-beta-https.sh` or restart production Caddy to fix this. Its public branch entrypoint `install-adhd-beta-browser-gateway.sh` is now retired and fails closed.

**Verified live:** Pixel Pals `buddy-bot-room`, native `adhd-assistant`, the bridge and photo-beta service are running. The photo beta responds `{"ok":true}` at host-loopback `127.0.0.1:18767`. Caddy serves existing ADHD on port 18765. Port 18768 was unused at last check. The owner's phone and desktop clients are **iPhone Safari and CachyOS**, not Windows.

## Safer architecture

Use **one new isolated Caddy container** `adhd-assistant-photo-gateway` in the **SAME existing Compose project `pixelpals`**, with its own Caddyfile, TLS internal CA, config/data mounts and LAN-only listener. It does not edit, reload, stop, mount volumes from or share certificates with the production Caddy.

```text
CachyOS or iPhone on private home LAN
         HTTPS and unique Basic Auth
         https://10.200.1.30:18768
                  |
         NEW beta-only Caddy
                  |
        localhost 127.0.0.1:18767
                  |
        ADHD Assistant Photo Beta
                  |
        gaming PC Ollama qwen3-vl:4b
```

The gateway sets `admin off` and `auto_https disable_redirects` so it does not conflict with other host ports 2019, 80, or 443. It binds only `10.200.1.30:18768`. The beta backend stays bound to loopback, not LAN or WAN. Caddy Basic Auth guards every path, including `/api/bootstrap`, `/api/settings` and photo uploads; cross-origin browser requests are denied; `/bridge/v1/*` is unavailable from the beta public route; internal Host/Origin rewrites preserve native checks.

## Exact installation / safety

The new owner-run installer is `tools/adhd-v02/install-adhd-photo-independent-gateway.sh` on draft PR #39. It must be downloaded **pinned to a reviewed commit**, syntax checked and run interactively. It fails closed if the production Caddyfile differs from the most recent pre-beta backup, existing containers are not running, beta health fails, LAN IP or port 18768 is unavailable, an existing gateway is already present, or existing Docker Caddy image is absent.

The installer uses the same Caddy image already locally present on Unraid; it validates an independent candidate Caddyfile with a disposable, no-network, read-only Caddy container using only temporary data/config. It then validates combined Compose **without starting** existing services, and asks the owner to enter `INSTALL INDEPENDENT BETA GATEWAY`. Only after that does it create:

- `/mnt/user/appdata/adhd-assistant-photo-beta/gateway/conf/Caddyfile` (contains hashed, non-plaintext Basic Auth credentials);
- `/mnt/user/appdata/adhd-assistant-photo-beta/gateway/data` (independent private CA; NEVER share `root.key`);
- `/mnt/user/appdata/adhd-assistant-photo-beta/gateway/config`;
- `/boot/config/plugins/compose.manager/projects/pixelpals/docker-compose.photo-gateway.yml` (additional service overlay).

It starts **ONLY** the new `adhd-assistant-photo-gateway` with `docker compose ... --no-deps`, never touches the production Caddyfile or existing containers, and checks that an unauthenticated `/api/bootstrap` returns **401** (using `curl -k` solely for this local negative test). The overlay file is additional to the existing Compose Manager base, override and photo-beta files; **avoid full-stack Compose Up/Down**, as Compose Manager's stored set may omit optional overlays.

## Certificate trust on both devices (required before sending photos)

This new gateway has its **OWN** internal CA, distinct from production Caddy. The **public** root certificate is expected after successful startup at:

`/mnt/user/appdata/adhd-assistant-photo-beta/gateway/data/caddy/pki/authorities/local/root.crt`

Verify its SHA-256 fingerprint on the Unraid server before transferring. Do **not** copy `root.key` or any private CA key.

- **CachyOS:** via Konsole `scp` transfer the public certificate securely to your computer, compare fingerprints, then explicitly trust it in the relevant browser or OS certificate store. Firefox and Chromium may use different trust sources on Linux; verify with each browser used. No "Proceed anyway" shortcuts.
- **iPhone:** transfer the verified public root certificate through a private method, install under **Settings → General → VPN & Device Management**, then enable full trust under **Settings → General → About → Certificate Trust Settings**. Only trust a root CA you control and have fingerprint-verified. See [Apple support](https://support.apple.com/en-us/102390).
- **Network:** first pilot supports private home LAN only. **Do not port-forward 18768**. Cellular/Tailscale access requires a separately reviewed private remote-access route.

## Acceptance and rollback

After verified trust, browse `https://10.200.1.30:18768` from CachyOS and iPhone. Confirm an unauthenticated browser receives a login challenge; authenticated access displays the correct native beta (including **Do It With Me**). In beta Settings use `Local Ollama` and vision model `qwen3-vl:4b`. Test Start Without Photo, then choose a non-sensitive room photograph and request one actionable cleaning suggestion. No progress persistence across refresh yet, no conversational voice body doubling.

On any failure, inspect **only** `adhd-assistant-photo-gateway` logs, container status and the new gateway files. To roll back, stop only the new gateway container with the targeted Compose command; do not remove unrelated services or production data. Preserve files for inspection until the owner authorizes cleanup. Continue to verify the production Caddy 18765 listener, Pixel Pals and ADHD Assistant health.

**This documentation and draft PR are not deployment proof.** Only the owner can run the installer on live Unraid. Never post credentials, CA private keys, config bodies, personal photos or real database contents in GitHub or this chat.
