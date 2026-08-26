# Marrow

Video-first research knowledge platform. Marrow ingests long-form video (YouTube first; podcasts, uploads, captured posts, newsletters later) into structured, timestamped, searchable knowledge — word-timestamped transcript, captioned keyframes, a readable article, resolved references — organised into topic-scoped **namespaces**, and exposes it to a research chat agent, a reader, and external agents (Claude Code) through an MCP server + REST API.

The spec is `docs/PRD.mdx`; the technology choices are `docs/STACK.md`; every decision the PRD doesn't make is in `DECISIONS.md`.

## Status

- **Phase 1 — Ingestion core** ✅ `ingest <youtube-url>` runs pipeline stages 1–8 end to end.
- **Phase 2 — MCP + REST** ✅ every PRD §8 tool over MCP (stdio + Streamable HTTP) and REST, hybrid search with RRF.
- **Phase 3 — Web app** ✅ library → item page with Reader / Chat / Transcript, YouTube player that seeks on `[MM:SS]` citations, per-video chat (AI Elements + Vercel AI SDK) with `view_frame` / `web_search` / `fetch_url`, "What's on screen now", and a **knowledge graph** per namespace (`/namespaces/<name>/graph`, also `get_graph` over MCP/REST).
- **Phase 4 — Namespaces at scale** ✅ playlist/channel subscriptions polled on a schedule, the watch inbox as the landing page (Read / Chat / Skip), novelty triage from the 6th item, namespace summaries every 3 ingests, namespace-level chat with the retrieval tools.
- Phases 5–6 (capture + text sources, language mode) follow.

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

## Web app

```bash
bun run server                 # API + MCP + jobs on :3001
cp apps/web/.env.example apps/web/.env.local   # MARROW_API_URL + MARROW_API_KEY
bun run web                    # Next.js on :3000
```

`/` is the **inbox** (PRD §6.4): every ready video you haven't skipped, newest first, with its summary and — once a namespace has more than five items — a novelty verdict ("34% new" + the new spans as timecodes). Read / Chat open the item; Skip archives it (undo in the toast). `/library` lists namespaces with their corpus summary, what they **follow** (playlists/channels, polled every `POLL_EVERY_MINUTES`, "check now" per source), an ingest form, and links to each namespace's **chat** and **graph**. `/namespaces/<name>/chat` is the cross-video research chat: it searches the corpus with the §8 tools and cites `[Title @ MM:SS](/items/…?t=…)` links that open the item at that moment. `/items/<id>` is the item page: sticky YouTube player + **Reader** (summary, takeaways, sections with timestamp margin links, "Ask about this" → chat), **Chat** (cites `[MM:SS]`; clicking seeks the player; "What's on screen now" sends the playback position so the model calls `view_frame`), **Transcript** (follows the playhead). The browser never sees the API key — client calls go through `app/api/marrow/[...path]` which injects it.

**Read as text / share** — every item has a text version at `/items/<id>/read`: summary, takeaways, then the transcript as speaker-labelled dialogue with timecodes that open the video at that moment. Copy as Markdown, download `.md` / `.txt`, print to PDF, or share the link. Same content over the API (`GET /items/:id/export.md?transcript=1`, `GET /items/:id/export.txt`) and MCP (`export_markdown` with `format`).

**Who is speaking** — podcasts, interviews and panels get a second STT pass with `gpt-4o-transcribe-diarize` (≈ +$0.36/hour), aligned onto the word-timestamped whisper transcript, with speaker identity kept consistent across ~7-minute pieces via reference clips, and speakers named by the cheap LLM ("Host", "Guest — Jane Doe"). It runs automatically when the title/description/channel looks multi-speaker, for `podcast_episode` sources, or for namespaces created with `--diarize` (`DIARIZE=always|auto|off`).

**Knowledge graph** — `/namespaces/<name>/graph` draws the namespace as item nodes (videos) and entity nodes (papers, tools, techniques, people, repos, datasets) joined by mention edges weighted by count; dashed edges carry an opposing claim. Click a node for its connections with first-mention timecodes (deep-linking into the item at that moment); search, per-kind filters, zoom, drag. Same data as the MCP `get_graph` tool.

Stack: latest Next.js (App Router), Tailwind v4, shadcn/ui (`base-nova`), [AI Elements](https://elements.ai-sdk.dev) for the conversation/prompt/tool UI, Vercel AI SDK `useChat` ↔ the server's `POST /items/:id/chat` UI-message stream, d3-force for the graph. Type: Source Serif 4 for reading, IBM Plex Sans for chrome, IBM Plex Mono for timecodes and metadata.

Offline UI work: `bun run scripts/seed-demo.ts 4` seeds a `demo` namespace through the fake pipeline (no yt-dlp/OpenAI).

## Full local stack (docker-compose)

```bash
docker compose up --build       # Postgres + pgvector, MinIO (S3 API), server on :3001, web on :3000
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
| `GET /namespaces/:ref/graph?max_entities=150` | `get_graph` |
| `GET /inbox?namespace=&archived=1` · `POST /items/:id/archive {archived?}` | `inbox` |
| `GET /sources?namespace=` · `POST /sources {namespace,url,kind?,poll?}` · `DELETE /sources/:id` · `POST /sources/:id/poll` · `POST /namespaces/:ref/poll` | `subscribe`, `list_sources`, `poll_sources` |
| `POST /namespaces/:ref/summary` · `POST /namespaces/:ref/chat` (AI SDK stream) | — |
| `POST /items/:id/chat` (AI SDK UI-message stream) · `POST /items/:id/events {kind}` | — (web app) |

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
| Run the web app | `bun run web` (needs `apps/web/.env.local`) · `bun run build` builds everything via Turborepo |
| Deploy to AWS | `docs/DEPLOY.md` (EC2 + RDS + S3, `docker-compose.prod.yml` with Caddy HTTPS) |

Tests run on an in-memory PGlite with fake providers — no network, no ffmpeg. Live tests against OpenAI are gated behind `LIVE=1`.

## Layout

```
packages/core/   schema (Drizzle), video document types, storage (S3/local), OpenAI clients, pipeline, services
apps/server/     one process: Hono REST API (+ MCP in Phase 2) + pg-boss job runner + CLI
apps/web/        Next.js app: library, item page (player + reader + chat + transcript), proxy route to the server
docker/          server image (bun + ffmpeg + yt-dlp)
docs/            PRD.mdx (normative), STACK.md (resolved tech choices)
```

## Cost

Target ≤ $1 per ingested hour-long video (PRD §13). Every stage records its API usage and cost on the job (`bun run cli job <id>`): whisper-1 ≈ $0.36/hr, ≤120 keyframes through gpt-5.6-luna ≈ $0.10, article + enrichment ≈ $0.10–0.20, embeddings ≈ $0.01.
