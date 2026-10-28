# Pixel Pals (buddy-bot-room) — self-hosted.
#   docker compose up -d --build     -> http://<this-machine>:8090
#
# Targets:
#   dev             Vite dev server (the Portainer stack now uses prod). The way this app is run self-hosted.
#   prod            EXPERIMENTAL Node production build. The project builds for Cloudflare Workers by
#                   default, so this forces Nitro's node-server preset. Try it with
#                   BUDDY_TARGET=prod docker compose up -d --build
# BUN_VERSION=1 follows the newest Bun 1.x. For a build you can repeat exactly, pass a full version (--build-arg BUN_VERSION=1.4.2) or pin the image digest.
ARG BUN_VERSION=1
FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /app
# git lets the build stamp the real version and commit on the sidebar label.
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates && rm -rf /var/lib/apt/lists/* && git config --global --add safe.directory /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
# Portainer builds without git history, so ask GitHub which commit this is (a public-repo lookup).
# This layer sits after COPY, so it re-runs whenever the code changes. Failure is harmless: the label just says "local".
ARG BUDDY_REPO=nyteghost/buddy-bot-room
RUN SHA=$(curl -fsSL --max-time 15 -H 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$BUDDY_REPO/commits/main" 2>/dev/null | cut -c1-7); \
    COUNT=$(curl -fsSI --max-time 15 "https://api.github.com/repos/$BUDDY_REPO/commits?per_page=1&sha=main" 2>/dev/null | grep -i '^link:' | sed -n 's/.*[?&]page=\([0-9]*\)>; rel="last".*/\1/p'); \
    printf '{"count":"%s","commit":"%s"}' "$COUNT" "$SHA" > /app/.build-info.json; cat /app/.build-info.json; echo
# Where the app finds SearXNG (web search) from inside the container. Override in .env.local.
ENV SEARXNG_URL=http://host.docker.internal:8081 BUDDY_ALLOW_ALL_HOSTS=1 BUDDY_SELF_HOSTED=1
ENV BUDDY_DATA_DIR=/data
LABEL org.opencontainers.image.source="https://github.com/nyteghost/buddy-bot-room" org.opencontainers.image.title="Pixel Pals"
RUN mkdir -p /data
EXPOSE 8090

FROM base AS prod
ENV NITRO_PRESET=node-server NODE_ENV=production PORT=8090 HOST=0.0.0.0
RUN bun run build
CMD ["bun", ".output/server/index.mjs"]

FROM base AS dev
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "8090"]
