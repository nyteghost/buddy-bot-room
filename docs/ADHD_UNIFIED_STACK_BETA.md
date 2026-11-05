# Pixel Pals + ADHD Assistant — unified Unraid beta Compose stack

This is an **opt-in upgrade** for the specific running installation previously verified on Unraid:
- Pixel Pals container `buddy-bot-room`, image `ghcr.io/nyteghost/buddy-bot-room:beta`, Compose project `pixelpals` with Docker network `pixelpals_default`.
- ADHD Assistant `adhd-assistant` on `python:3.12-alpine`, host network, owner `99:100`, application bind mount `/mnt/user/appdata/adhd-assistant/code:/opt/adhd`, and data bind mount `/mnt/user/appdata/adhd-assistant/data:/data`.
- A separate `adhd-assistant-lan` Caddy container (left untouched).

**This migration is not a complete standalone ADHD Assistant v0.2 application rebuild.** It adds a standalone v0.2 *bridge receiver sidecar* without changing the existing ADHD Assistant v0.1 dashboard or patching its launcher, and adopts that app as a separate service in the current Pixel Pals Compose project. The ADHD dashboard remains the existing dashboard; incoming bridge handoffs are reviewed by a terminal command. We do not automatically transfer private memories or activate any AI tools.

## Architecture

The Compose project manages three services: `buddy-bot` (or the running Pixel Pals service name), `adhd-assistant` (the original dashboard), and `adhd-bridge` (the private v0.2 receiver). The dashboard **alone** uses `network_mode: host` to preserve its existing `127.0.0.1:8765` address and Caddy proxy. The bridge is attached only to the `pixelpals_default` Docker network, listens on port `18766` inside that network, **publishes no host or LAN port**, and accepts only allowlisted private Docker clients with an authenticated bearer token. Pixel Pals reaches it using Docker service DNS at `http://adhd-bridge:18766`, not `host.docker.internal` or a host gateway. The bearer token comes from a read-only bind mount at `/run/secrets/adhd_bridge_token`. The two applications' SQLite/data directories remain separate.

## Inspect before installing

Review `tools/adhd-v02/install-unified-stack.sh` and `tools/adhd-v02/bridge_v02.py` on the `beta` branch. The unified installer supports two modes:

```bash
bash tools/adhd-v02/install-unified-stack.sh --plan
bash tools/adhd-v02/install-unified-stack.sh --install
```

`--plan` performs read-only checks. `--install` pulls a tested beta image, installs the standalone v0.2 bridge receiver, then moves the original ADHD container to a stopped `adhd-assistant-preunified-<timestamp>` rollback checkpoint before creating the Compose-managed `adhd-assistant`. The script downloads a reviewed standalone Python bridge into `/mnt/user/appdata/adhd-assistant/bridge/bridge_v02.py`, creates a private bridge token/configuration, and writes a backup of the original Compose file to `/mnt/user/appdata/adhd-assistant/unified-stack-backup-<UTC timestamp>/` before modifying it. It runs a disposable unauthenticated test across the private Docker network before restarting any application. It uses `docker compose up -d --no-deps` only for the affected services; **it never runs `docker compose down` or `--remove-orphans`**.

The installer intentionally refuses unrecognized project paths, conflicting bridge settings, service names, image tags, network modes, mount points, users, or Docker configurations. A refusal means it needs a human review of your active stack; do not bypass the guard with ad-hoc `sed` commands.

## After installation

Check `docker compose ls` and the existing Pixel Pals stack in Unraid Compose Manager. Pixel Pals, the ADHD-A dashboard and the bridge sidecar should all appear under the same Compose project. Your existing Caddy container remains separate until we migrate it intentionally.

ADHD bridge inbox commands:

```bash
docker exec adhd-assistant-bridge python -B /opt/bridge/bridge_v02.py list
# After verifying the intended handoff ID:
docker exec adhd-assistant-bridge python -B /opt/bridge/bridge_v02.py approve YOUR_HANDOFF_ID
# Or reject it:
docker exec adhd-assistant-bridge python -B /opt/bridge/bridge_v02.py reject YOUR_HANDOFF_ID
```

In Pixel Pals Pal Room, create a task handoff, review and approve it, and choose Send. Its receipt means *received and pending ADHD approval*, not task completion. Check the receiver with the manual **Check ADHD approval** action.

## Failure recovery

If installation fails after migration starts, the script restores the backed-up Compose definition, stops/removes only its newly created Compose-managed ADHD service, renames and restarts the original stopped container, and reverses Pixel Pals bridge configuration and restores previous pinned bridge files. It does not erase `/data`.

After a **successful** installation, do not delete the old stopped ADHD container until the dashboard, Caddy access, bridge service, task queue and restart behavior have been verified. Manual recovery later must restore the original Compose file from the printed backup, stop/remove only the new `adhd-assistant` service, rename the stopped `adhd-assistant-preunified-...` container, and start it. Avoid `docker compose down`, which would affect unrelated services. Bridge source file changes from the v0.2 overlay have their own timestamped backup under `/mnt/user/appdata/adhd-assistant/`.

## Verification limits

GitHub CI validates shell syntax, the migration's embedded Compose generator with a disposable Compose fixture, TypeScript, the full unit test suite, application build, and browser smoke tests. This does **not** prove the migration works on the user's actual Unraid Compose Manager: only running it on that host can verify the live networking, Docker labels, Caddy routing and installed v0.1 layout.

Production `main` remains unchanged. No user conversations, private work email, AI tokens, or stored memories are copied between services automatically.
