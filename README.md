# Marrow

Video-first research knowledge platform. Marrow ingests long-form video (YouTube first; podcasts, uploads, captured posts, newsletters later) into structured, timestamped, searchable knowledge — word-timestamped transcript, captioned keyframes, a readable article, resolved references — organised into topic-scoped **namespaces**, and exposes it to a research chat agent, a reader, and external agents (Claude Code) through an MCP server + REST API.

The spec is `docs/PRD.mdx`; the technology choices are `docs/STACK.md`; every decision the PRD doesn't make is in `DECISIONS.md`.

## Status

**Phase 1 — Ingestion core** (PRD §14): `ingest <youtube-url>` runs pipeline stages 1–8 end to end. Phases 2–6 (MCP + REST, reader + chat web app, subscriptions/inbox/novelty, capture, language mode) follow in order.

## Quick start (local, no Docker)

```bash
bun install
cp .env.example .env            # set OPENAI_API_KEY
brew install ffmpeg yt-dlp      # macOS; the Docker image has both

bun run cli ns create sim-to-real --description "Sim-to-real transfer for robot learning"
bun run cli ingest "https://www.youtube.com/watch?v=…" --ns sim-to-real
bun run cli job <job_id>        # per-stage state + cost
bun run cli doc <item_id>       # the video document JSON
```

With no `DATABASE_URL` the CLI uses PGlite (Postgres-in-WASM) at `.marrow/pglite/` and local filesystem storage at `.marrow/storage/` — nothing to install. Re-running `ingest` on the same URL is a no-op once the item is `ready` (`--force` re-ingests at a new pipeline version; a failed job resumes at the failed stage).

## Full local stack (docker-compose)

```bash
docker compose up --build       # Postgres + pgvector, MinIO (S3 API), and the Marrow server on :3001
curl -X POST localhost:3001/namespaces -H 'content-type: application/json' -d '{"name":"sim-to-real"}'
curl -X POST localhost:3001/ingest -H 'content-type: application/json' -d '{"namespace":"sim-to-real","url":"https://www.youtube.com/watch?v=…"}'
curl localhost:3001/jobs/<job_id>
```

Set `MARROW_API_KEY` in `.env` to require `x-api-key` on every request (always do this outside local dev).

## Development

| Task | Command |
|---|---|
| Typecheck everything | `bun run typecheck` (Turborepo → `tsc --noEmit` per package) |
| Unit + pipeline tests | `bun run test` · single file: `bunx vitest run packages/core/src/pipeline/runner.test.ts` |
| Lint | `bun run lint` |
| New migration after editing `packages/core/src/db/schema.ts` | `bun run db:generate` (then add any `CREATE EXTENSION` lines by hand) |
| Apply migrations to `DATABASE_URL` | `bun run db:migrate` (the server and CLI also migrate on start) |
| Run the server | `bun run server` (`server:dev` for watch mode) |

Tests run on an in-memory PGlite with fake providers — no network, no ffmpeg. Live tests against OpenAI are gated behind `LIVE=1`.

## Layout

```
packages/core/   schema (Drizzle), video document types, storage (S3/local), OpenAI clients, pipeline, services
apps/server/     one process: Hono REST API (+ MCP in Phase 2) + pg-boss job runner + CLI
apps/web/        Phase 3: Next.js reader + chat
docker/          server image (bun + ffmpeg + yt-dlp)
docs/            PRD.mdx (normative), STACK.md (resolved tech choices)
```

## Cost

Target ≤ $1 per ingested hour-long video (PRD §13). Every stage records its API usage and cost on the job (`bun run cli job <id>`): whisper-1 ≈ $0.36/hr, ≤120 keyframes through gpt-5.6-luna ≈ $0.10, article + enrichment ≈ $0.10–0.20, embeddings ≈ $0.01.
