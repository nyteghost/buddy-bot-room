# Pixel Pals — Stage 4A isolated Unraid personal test (NOT DEPLOYED)

**Scope:** approved non-production *build and packaging only* at draft [PR #44](https://github.com/nyteghost/buddy-bot-room/pull/44). **NO Unraid changes / no container starts / no merging to beta or main.** Obtain separate owner authorization before installing or starting anything.

## Image provenance and immutability

Publish workflow builds `Dockerfile` target `prod` from the **exact PR head SHA**, only after frozen dependencies, high/critical audit, typecheck, complete Vitest, regular build, self-hosted build, browser smoke and manifest checks pass. Image is pushed under **only** `ghcr.io/nyteghost/buddy-bot-room:stage4a-test-<40-character-sha>`. It NEVER writes `:beta` or `:latest`. **Use the published immutable `@sha256:<64 hex>` manifest digest**, not the movable tag. Check the publish run's "Verify immutable test image" step for digest. Do not use a guessed digest or the example placeholder.

The `.dockerignore` excludes checkout `.git` metadata, `.env*`, private key formats and build outputs from the image context. Image runtime contains no production data, mounts or credentials.

## Files

- `docker-compose.unraid-stage4a-test.yml` — dedicated project name, host **8091** mapped to container **8090**, internal-only bridge, fresh named volumes, no external networks, no Unraid, Obsidian, Pixel Pals or ADHD bind mount, no GPU.
- `docs/stage4a-unraid.env.example` — example only. **Never commit the real env file**; use a NEW 12+ character disposable setup code, not the production password.
- `tools/stage4a/validate-compose.py` — read-only post-render configuration safety validator.

## Safe preflight — READ ONLY, before separate install approval

**Important possible collision:** existing repository `docker-compose.unraid-beta.yml` also maps **8091:8090**. If the beta container currently uses 8091, this Stage 4A stack cannot bind there. Do **not** stop or change the beta container; report the occupied port and seek further instructions.

On the Unraid host (only when authorized to run read-only diagnostics):

```bash
docker ps --format '{{.Names}} | {{.Ports}}' | grep -E '8090|8091|pixelpals|buddy-bot' || true
ss -ltn | grep -E ':8090 |:8091 ' || true
```

Confirm the production 8090 container remains unchanged, no active service uses 8091, and no pre-existing `pixelpals-stage4a-test` project/volumes should be retained. **Do not run compose up, pull or create volumes yet** without separate authorization.

## Installation steps — FUTURE, only after owner explicitly authorizes isolated install

1. Retrieve the exact reviewed `docker-compose.unraid-stage4a-test.yml` file from PR #44 and enter it in a **new** Docker Compose Manager stack named **pixelpals-stage4a-test**. Do not edit the production stack.
2. Create the stack's **private** environment file from `docs/stage4a-unraid.env.example`. Insert the **verified published image digest**, a new disposable setup code, and set `STAGE4A_BIND_IP` to your Unraid **private LAN IP** only if you must open it from another LAN device. Default `127.0.0.1` is host-only and cannot be reached directly from your workstation.
3. Run **validation only** before pulling images or starting containers:
   ```bash
   docker compose --env-file stage4a-private.env -f docker-compose.unraid-stage4a-test.yml config --format json | python3 tools/stage4a/validate-compose.py
   docker compose --env-file stage4a-private.env -f docker-compose.unraid-stage4a-test.yml config --quiet
   ```
4. After the separate installation authorization, and ONLY with a free 8091 and validated config: pull the pinned digest and explicitly start the new stack. Never point its volumes at existing production appdata. A Docker host may require GHCR authentication for a private package; use a **new read:packages-only identity**, not an application production secret.
5. In a fresh private-browser window browse `http://<your-unraid-lan-ip>:8091` (when bound to LAN), create an **entirely disposable** first account using the new setup code. Do not log in with production identity, import backups, copy cookies, enable real Strata/Ollama/API integrations, or enter private data.
6. In Room Appearance select HD, enable HD Office, switch to Linux/Office theme, then opt in to **Isometric Office (grey-box preview)**. Check nine Pal desks, visitor changes, camera Fit/Zoom/Pan/Follow, UI controls, Room Settings popup, and switching ISO → flat HD → Pixel/Classic. The preview is synthetic SVG, **not final HD256 art**. Forced mobile/coarse/data-save/low-power should not mount ISO.
7. Verify 8090 Pixel Pals remains healthy and never changed; test account uses only its own empty data. Report performance and UX observations to PR #44 / issue #37.

**Rollback (only once authorized and after test):** stop/remove the **stage4a project only**. A later separately approved disposable cleanup may remove its three named volumes. NEVER use `docker system prune`, touch production mounts, run `docker compose down -v` from another project, or replace a production image. Do not delete test data without explicit owner confirmation.

## Restrictions & unverified gates

The private internal Docker bridge blocks normal egress, intentionally preventing AI inference and integrations during this first visual test. The Compose file has no access to production data and no production secrets. Browser-side networking, host firewall/Docker daemon rules and LAN reachability still require on-host verification; a rendered Compose config is not a physical network-isolation penetration test. Production Strata end-to-end and physical iPhone performance remain independent release gates.

**No container was started by preparing this package.** Future owner approval must specify **isolated test installation/start only**, separate from beta/main merge or production deployment.
