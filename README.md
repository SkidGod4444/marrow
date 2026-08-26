# Marrow

Video-first research knowledge platform. Marrow ingests long-form video (YouTube first; podcasts, uploads, captured posts, newsletters later) into structured, timestamped, searchable knowledge — word-timestamped transcript, captioned keyframes, a readable article, resolved references — organised into topic-scoped **namespaces**, and exposes it to a research chat agent, a reader, and external agents (Claude Code) through an MCP server + REST API.

The spec is `docs/PRD.mdx`; the technology choices are `docs/STACK.md`; every decision the PRD doesn't make is in `DECISIONS.md`.

## Status

- **Phase 1 — Ingestion core** ✅ `ingest <youtube-url>` runs pipeline stages 1–8 end to end.
- **Phase 2 — MCP + REST** ✅ every PRD §8 tool over MCP (stdio + Streamable HTTP) and REST, hybrid search with RRF.
- Phases 3–6 (reader + chat web app, subscriptions/inbox/novelty, capture, language mode) follow in order.

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

## Connect Claude Code (MCP)

**Over HTTP** (recommended — talks to the running server, which also runs ingest jobs):

```bash
bun run server                                   # or docker compose up
claude mcp add --transport http marrow http://localhost:3001/mcp --header "x-api-key: $MARROW_API_KEY"
```

or in a project's `.mcp.json`:

```json
{ "mcpServers": { "marrow": { "type": "http", "url": "http://localhost:3001/mcp", "headers": { "x-api-key": "<MARROW_API_KEY>" } } } }
```

**Over stdio** (no server needed; the MCP process runs ingest jobs itself and owns the PGlite DB while it is alive):

```bash
claude mcp add marrow -- bun run /ABSOLUTE/PATH/marrow/apps/server/src/mcp-stdio.ts
```

Tools: `list_namespaces`, `search`, `get_context`, `get_video_document`, `get_frame` (returns the JPEG), `lookup_entity`, `list_items`, `ingest`, `job_status`, `export_markdown`. Every search hit carries `t_start` and a `deep_link` (`…&t=1423s`) — cite as `title @ MM:SS`.

### REST mirror

| Method + path | MCP tool |
|---|---|
| `GET /namespaces` · `POST /namespaces` | `list_namespaces` |
| `GET /search?namespace=&q=&k=8&source_type=` | `search` |
| `GET /segments/:id/context?window_s=120` | `get_context` |
| `GET /items/:id/document?transcript=full\|none&max_entries=&words=1` | `get_video_document` |
| `GET /frames/:id` (frame or segment id → `image/jpeg`) | `get_frame` |
| `GET /entities?namespace=&name=` · `GET /namespaces/:ref/entities` | `lookup_entity` |
| `GET /items?namespace=&status=` · `GET /items/:id` | `list_items` |
| `POST /ingest {namespace,url,force?}` | `ingest` |
| `GET /jobs/:id` | `job_status` |
| `GET /items/:id/export.md?transcript=1` · `GET /namespaces/:ref/export.md` | `export_markdown` |

All routes except `/health` require `x-api-key` (or `Authorization: Bearer`) when `MARROW_API_KEY` is set.

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
