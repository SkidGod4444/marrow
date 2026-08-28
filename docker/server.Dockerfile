# Marrow server: bun + ffmpeg + yt-dlp. One process runs the REST API, MCP server, and the ingestion pipeline.
FROM oven/bun:1-debian AS base

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl unzip \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 # Deno: the JS runtime yt-dlp's YouTube challenge solver supports first-class (Bun is enabled as a fallback by the wrapper).
 && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- --no-modify-path >/dev/null \
 # bgutil PO-token provider plugin for yt-dlp (the token server is the `pot-provider` service in docker-compose.prod.yml;
 # YTDLP_POT_PROVIDER_URL points yt-dlp at it). A zip in a yt-dlp plugin directory is the no-pip install.
 && mkdir -p /etc/yt-dlp/plugins \
 && curl -fsSL https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/latest/download/bgutil-ytdlp-pot-provider.zip -o /etc/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip \
 # Amazon RDS CA bundle so TLS to RDS is verified (DATABASE_SSL=auto picks it up when present).
 && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /etc/ssl/certs/rds-global-bundle.pem \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first so source edits don't bust the layer cache.
COPY package.json bun.lock turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN bun install --frozen-lockfile --production

COPY apps/server apps/server
COPY packages/core packages/core

# Build identity: scripts/deploy-ec2.sh passes the git SHA; GET /health reports it so a curl tells which commit is live.
ARG GIT_SHA=unknown
ENV MARROW_COMMIT=$GIT_SHA
ENV NODE_ENV=production PORT=3001 WORK_DIR=/data/work
VOLUME ["/data"]
EXPOSE 3001
CMD ["bun", "run", "apps/server/src/index.ts"]
