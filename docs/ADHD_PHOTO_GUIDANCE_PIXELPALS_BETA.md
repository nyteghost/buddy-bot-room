# Do It With Me — add photo-guidance beta to the *existing* Pixel Pals stack

**Owner decision (Nov. 8, 2026):** Put the ADHD Assistant photo-guidance pilot into the **same Unraid Docker Compose Manager project named `pixelpals`**, which currently runs `buddy-bot-room` (**Pixel Pals**), `adhd-assistant`, and `adhd-assistant-bridge`. The `buddy-bot-room` container *is* Pixel Pals, not an additional service.

The repo also contains a separate `docker-compose.unraid-beta.yml` defining `pixelpals-beta` on 8091. **That is NOT the running beta installation shown in the owner's screenshots.** Do not switch to it or run it accidentally.

This change is a **staging service within the existing Pixel Pals beta Compose project**, not a new stack, not a replacement for Pixel Pals, and not an overwrite of the running ADHD Assistant.

## Sources and test requirements

- The beta photo-guidance implementation lives in the **private** `nyteghost/adhd-assistant` repository, draft PR #7 (stacked on drafts #3 and #2). Use only a reviewed isolated feature checkout.
- Live `buddy-bot-room` uses `ghcr.io/nyteghost/buddy-bot-room:beta` on 8090 and is healthy.
- Live `adhd-assistant` uses host networking, separate source/data bind mounts under `/mnt/user/appdata/adhd-assistant/`; live bridge uses private `pixelpals_default` network. **Do not share these mounts** with staging.
- Existing gaming-PC Ollama is `http://10.200.1.149:11434` and already serves Pixel Pals. Owner successfully installed `qwen3-vl:4b` on Ollama 0.40.13. Do not create another Ollama container and do not change Pixel Pals' default `gemma2:9b`.
- Photo staging backend uses its own `ADHD_OLLAMA_URL` (only explicitly approved private IPs, without redirects) and its native server binds to `127.0.0.1`. It is **not** ready for direct LAN/iPhone access without a separately reviewed authenticated HTTPS reverse-proxy route.

## First action — safe read-only preflight on Unraid

The repo includes a self-contained Bash script `tools/adhd-v02/photo-beta-readonly-preflight.sh`. It **does not** run `docker compose up/down`, start/stop/restart containers, read database contents, expose secrets, change networks or write to appdata. It reads Docker project labels/status, checks for the proposed staging container/port, and performs a GET to the existing gaming-PC Ollama `/api/tags`.

From the Unraid terminal, review the [pinned script source](https://github.com/nyteghost/buddy-bot-room/blob/ad3222269f7cce1e0f324b161ea66eab2cadcdb3/tools/adhd-v02/photo-beta-readonly-preflight.sh), then run:

```bash
curl -fsSL --retry 2 -o /tmp/adhd-photo-preflight.sh \
  https://raw.githubusercontent.com/nyteghost/buddy-bot-room/ad3222269f7cce1e0f324b161ea66eab2cadcdb3/tools/adhd-v02/photo-beta-readonly-preflight.sh
bash -n /tmp/adhd-photo-preflight.sh
bash /tmp/adhd-photo-preflight.sh
```

This downloads a **version-pinned** script only to temporary storage; it leaves the current Compose project and appdata untouched. Share only the status summary; if anything unexpected or sensitive appears, redact it. **Do not run a full-stack Compose Up.** A passing static preflight still does not authorize activation or prove authenticated iPhone HTTPS behavior.

## Additive Compose overlay

`tools/adhd-v02/photo-beta-service.yml` defines one extra service:
`adhd-assistant-photo-beta`, with a deliberately opt-in profile `adhd-photo-beta`, a separate container name, host-loopback port 18765 (proposed/unverified), isolated code and data paths, read-only root FS, no privilege escalation, no host-published port, and no automatic restart.

The overlay should be **composed with the exact active Pixel Pals Compose configuration** under the same `pixelpals` project. Do not substitute the unrelated `pixelpals-beta` sample. The overlay alone is NOT a complete stack.

Before any deployment, a read-only preflight must identify the active Compose Manager project's actual source file(s), environment file, project name, and Docker labels; verify the service and port are unused, isolate the data paths and test local AI connectivity. Keep any bridge/Caddy passwords, auth tokens and production SQLite out of the test checkout.

**Example only, after preflight and explicit owner authorization** (paths need to be verified on Unraid):

```bash
# Validate merged Compose definition without starting containers.
docker compose -p pixelpals \
  -f /path/to/ACTIVE/compose.yml \
  -f /path/to/photo-beta-service.yml \
  --profile adhd-photo-beta config --quiet

# Create ONLY the new pilot service when approved.
# --no-deps is essential: do NOT recreate Pixel Pals or ADHD Assistant.
docker compose -p pixelpals \
  -f /path/to/ACTIVE/compose.yml \
  -f /path/to/photo-beta-service.yml \
  --profile adhd-photo-beta up -d --no-deps adhd-assistant-photo-beta
```

**Important:** Running an extra Compose command with an added overlay file does **not** necessarily persist the overlay in Compose Manager's configured stack definition. On Unraid, the approved final change should be recorded in the same existing `pixelpals` Compose Manager project (service addition only), not as a separate stack. Carefully reconcile with the *actual* active configuration before editing it; do not overwrite its existing services or secrets.

## Proposed isolated environment (not confirmed available)

```env
ADHD_PHOTO_BETA_CODE_PATH=/mnt/user/appdata/adhd-assistant-photo-beta/code
ADHD_PHOTO_BETA_DATA_PATH=/mnt/user/appdata/adhd-assistant-photo-beta/data
ADHD_PHOTO_BETA_PORT=18765
ADHD_PHOTO_BETA_OLLAMA_URL=http://10.200.1.149:11434
```

All paths are examples and require an **empty test database and isolated source checkout**. Make directories owned/readable as required by container UID 99:100. The `adhd-photo-beta` Compose profile is intentionally off by default. No upstream service depends on it.

## Authentication and iPhone caveat

The current native ADHD Assistant server validates loopback **Host**, **Origin** and a session token. It cannot safely be exposed on a new iPhone-accessible URL merely by changing `--host`, adding `ports`, or bypassing those checks. Security and Infrastructure must coordinate a private HTTPS test route with correct authentication and proxy trust. Existing `adhd-assistant-lan` Caddy remains untouched until its live config and auth model are independently reviewed. The native private URL must not become publicly accessible.

## Acceptance gates and rollback

1. PR #7 automated tests pass; review against actual image upload and model response.
2. Current Compose project/config labels, port 18765, and volume paths verified. No production data or secret files mounted.
3. Only `adhd-assistant-photo-beta` starts. Existing `buddy-bot-room`, `adhd-assistant`, `adhd-assistant-bridge` remain on their prior images/ports/mounts and uninterrupted.
4. Staging can reach `10.200.1.149:11434` and run `qwen3-vl:4b` without changing Pixel Pals models.
5. Private authenticated iPhone access is verified end-to-end before a real room photo is submitted.
6. User can take/select a room photo, request one useful cleaning action, make it smaller, mark done/next, and stop; offline nonphoto starter still works.
7. Limitation disclosed: progress does **not** persist across reloads, and conversational voice body doubling is not yet implemented.
8. Stop/remove **only the pilot service**, retaining test data for inspection or clearing it only with owner consent. No `compose down`, no `--remove-orphans`, no production data cleanup.

**No merge, live Unraid Compose edit, container creation, restart, or deployment is authorized just by committing this file.** Implementation is prepared for review and explicit owner-approved rollout.

Coordination: Pixel Pals Issue #23, ADHD Assistant private Issue #6, iPhone capture Issue #35.
