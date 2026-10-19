# Pixel Pals (buddy-bot-room) — self-hosted.
#   docker compose up -d --build     -> http://<this-machine>:8090
#
# Targets:
#   dev  (default)  Vite dev server. The reliable way to run this app away from Lovable's hosting.
#   prod            EXPERIMENTAL Node production build. The project builds for Cloudflare Workers by
#                   default, so this forces Nitro's node-server preset. Try it with
#                   BUDDY_TARGET=prod docker compose up -d --build
FROM oven/bun:1 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY . .
# Where the app finds SearXNG (web search) from inside the container. Override in .env.local.
ENV SEARXNG_URL=http://host.docker.internal:8081 BUDDY_ALLOW_ALL_HOSTS=1 BUDDY_SELF_HOSTED=1
ENV BUDDY_DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 8090

FROM base AS prod
ENV NITRO_PRESET=node-server NODE_ENV=production PORT=8090 HOST=0.0.0.0
RUN bun run build
CMD ["bun", ".output/server/index.mjs"]

FROM base AS dev
CMD ["bun", "run", "dev", "--host", "0.0.0.0", "--port", "8090"]
