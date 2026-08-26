# Marrow server: bun + ffmpeg + yt-dlp. One process runs the REST API, MCP server, and the ingestion pipeline.
FROM oven/bun:1-debian AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so source edits don't bust the layer cache.
COPY package.json bun.lock turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN bun install --frozen-lockfile --production

COPY apps/server apps/server
COPY packages/core packages/core

ENV NODE_ENV=production PORT=3001 WORK_DIR=/data/work
VOLUME ["/data"]
EXPOSE 3001
CMD ["bun", "run", "apps/server/src/index.ts"]
