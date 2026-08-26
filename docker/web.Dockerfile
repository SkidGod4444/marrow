# Marrow web (Next.js standalone). Talks to the server container over MARROW_API_URL.
FROM oven/bun:1-debian AS deps
WORKDIR /app
COPY package.json bun.lock turbo.json tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY packages/core packages/core
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/web && bun run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
