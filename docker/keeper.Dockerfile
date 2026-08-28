# Marrow cookie keeper: a headless Chromium (Playwright's image has the browser and its libraries, arm64 included) that
# owns the YouTube session on the server and rewrites yt-dlp's cookie jar every hour. See apps/keeper/src/index.ts.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

RUN curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
ENV PATH=/root/.bun/bin:$PATH

WORKDIR /app/apps/keeper
COPY apps/keeper/package.json ./
RUN bun install --production
COPY apps/keeper/src ./src
COPY tsconfig.base.json /app/tsconfig.base.json

ENV KEEPER_JAR=/secrets/youtube-cookies.txt KEEPER_STATUS=/secrets/keeper-status.json KEEPER_PROFILE=/data/profile KEEPER_INTERVAL_MINUTES=60
VOLUME ["/data"]
CMD ["bun", "run", "src/index.ts"]
