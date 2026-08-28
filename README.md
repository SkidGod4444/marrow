# Marrow

Video-first research knowledge platform. Marrow ingests long-form video and audio (YouTube, podcast feeds) and captured text (articles, papers, pasted posts, newsletters) into structured, timestamped, searchable knowledge — word-timestamped transcript, captioned keyframes, a readable article, resolved references — organised into topic-scoped **namespaces**, and exposes it to a research chat agent, a reader, and external agents (Claude Code) through an MCP server + REST API.

The spec is `docs/PRD.mdx`; the technology choices are `docs/STACK.md`; every decision the PRD doesn't make is in `DECISIONS.md`.

## Status

- **Phase 1 — Ingestion core** ✅ `ingest <youtube-url>` runs pipeline stages 1–8 end to end.
- **Phase 2 — MCP + REST** ✅ every PRD §8 tool over MCP (stdio + Streamable HTTP) and REST, hybrid search with RRF.
- **Phase 3 — Web app** ✅ library → item page with Reader / Chat / Transcript, YouTube player that seeks on `[MM:SS]` citations, per-video chat (AI Elements + Vercel AI SDK) with `view_frame` / `web_search` / `fetch_url`, "What's on screen now", and a **knowledge graph** per namespace (`/namespaces/<name>/graph`, also `get_graph` over MCP/REST).
- **Phase 4 — Namespaces at scale** ✅ playlist/channel subscriptions polled on a schedule, the watch inbox as the landing page (Read / Chat / Skip), novelty triage from the 6th item, namespace summaries every 3 ingests, namespace-level chat with the retrieval tools.
- **Phase 5 — Capture + text sources** ✅ `POST /capture` (URL → readable text or PDF, or pasted text; social posts need the text), iOS/Android share sheet + bookmarklet (`docs/CAPTURE.md`), inbound-email webhook, RSS/podcast feeds through the same subscriptions, linked-video offers, Obsidian-ready markdown with front-matter.
- **Phase 6 — Language mode + review queue** ✅ namespaces flagged `language_learning` mine idioms, phrasal verbs and slang from podcasts/videos with playable exact-span clips (word-timestamp aligned), a Language tab, and `/review` recall prompts on a 2 d / 7 d / 30 d schedule.

All six PRD phases are built and verified end to end (Vitest with fakes, Playwright against the whole app in fake mode, axe accessibility incl. colour contrast). Live runs need `OPENAI_API_KEY`.

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

Tools: `list_namespaces`, `search`, `get_context`, `get_video_document`, `get_frame` (returns the JPEG), `lookup_entity`, `get_graph`, `list_items`, `ingest`, `capture`, `job_status`, `export_markdown`, `subscribe`, `list_sources`, `poll_sources`, `inbox`, `list_expressions`, `save_expression`, `review_queue`, `answer_review`. Every search hit carries `t_start` and a `deep_link` (`…&t=1423s`) — cite as `title @ MM:SS`; text items (posts, papers, newsletters) have no timestamps and are cited by title.

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
| `POST /capture {namespace,url?,text?,title?,author?,note?,source_type?}` · `POST /inbound/email/:token` (Postmark / CloudMailin / generic JSON) | `capture` |
| `GET /jobs/:id` | `job_status` |
| `GET /items/:id/export.md?transcript=1` · `GET /namespaces/:ref/export.md` | `export_markdown` |
| `GET /namespaces/:ref/graph?max_entities=150` | `get_graph` |
| `GET /inbox?namespace=&archived=1` · `POST /items/:id/archive {archived?}` | `inbox` |
| `GET /sources?namespace=` · `POST /sources {namespace,url,kind?,poll?}` · `DELETE /sources/:id` · `POST /sources/:id/poll` · `POST /namespaces/:ref/poll` | `subscribe`, `list_sources`, `poll_sources` |
| `GET /items/:id/expressions` · `POST\|DELETE /items/:id/expressions/:n/save` · `GET /items/:id/clips/:n` (audio) | `list_expressions`, `save_expression` |
| `GET /reviews?now=` · `GET /reviews/summary` · `POST /reviews/:id/answer {result: got_it\|again}` | `review_queue`, `answer_review` |
| `PATCH /namespaces/:ref {flags}` (e.g. `language_learning`, `auto_ingest_links`, `diarize`) | — |
| `POST /namespaces/:ref/summary` · `POST /namespaces/:ref/chat` (AI SDK stream) | — |
| `POST /items/:id/chat` (AI SDK UI-message stream) · `POST /items/:id/events {kind}` · `GET /items/:id/audio` (podcast playback) | — (web app) |

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
| Language mode | Flag a namespace `language_learning` (library toggle or the new-namespace checkbox): podcasts and videos get a **Language** tab — idioms, phrasal verbs, collocations and slang with a playable clip of the exact span and a jump link; **Learn** puts one in the review queue (`/review`), which brings it back after 2 days, then 7, then 30. MCP: `list_expressions`, `save_expression`, `review_queue`, `answer_review`. |
| Capture | `docs/CAPTURE.md` — `POST /capture`, iOS/Android share sheet, bookmarklet, inbound email webhook, RSS/podcast feeds, Obsidian export |
| Deploy | `docs/DEPLOY.md` — web app on **Vercel** (root dir `apps/web`, push-to-deploy), server/API on **AWS** (EC2 + RDS + S3, `docker-compose.prod.yml` with Caddy); server self-deploys from `main` via `docker/marrow-deploy.timer` on the box |

Tests run on an in-memory PGlite with fake providers — no network, no ffmpeg. Live tests against OpenAI are gated behind `LIVE=1`.

## Layout

```
packages/core/   schema (Drizzle + migrations), video document types, storage (S3/local), OpenAI clients,
                 capture (page/PDF/feed parsing), pipeline (10 checkpointed stages), services (one function per API tool)
apps/server/     one process: Hono REST API + MCP (HTTP + stdio) + pg-boss job runner + CLI; MARROW_FAKE mode with a seeded corpus
apps/web/        Next.js app: inbox (landing), library, item page (player/audio + reader + chat + transcript + language),
                 shared read page, namespace chat + knowledge graph, /review; e2e/ Playwright suite; proxy route to the server
docker/          server image (bun + ffmpeg + yt-dlp + RDS CA), Caddy, systemd deploy timer
docs/            PRD.mdx (normative), STACK.md (resolved tech choices), DEPLOY.md (AWS + Vercel), CAPTURE.md (share sheet, email, feeds)
scripts/         seed-demo.ts, e2e-stack.sh, deploy-ec2.sh
```

## Cost

Target ≤ $1 per ingested hour-long video (PRD §13). Every stage records its API usage and cost on the job (`bun run cli job <id>`): whisper-1 ≈ $0.36/hr, ≤120 keyframes through gpt-5.6-luna ≈ $0.10, article + enrichment ≈ $0.10–0.20, embeddings ≈ $0.01.

## Testing

| Layer | What runs | Command |
|---|---|---|
| Unit / integration | Vitest over the pipeline, services, REST and MCP with PGlite in memory and fake providers (no network) | `bun run test` |
| End to end | Playwright drives the real web app against the real server in **fake mode** (`MARROW_FAKE=1`: fake pipeline with real media bytes, scripted chat, seeded corpus) — inbox, library/add/follow, item reader/chat/transcript/share, text items, podcast player, shared page, namespace chat, graph, first run, a Pixel-7 pass and an axe accessibility scan; every test fails on any browser error | `./scripts/e2e-stack.sh` then `cd apps/web && bun run e2e` (first-run screens: `E2E_SEED=0 ./scripts/e2e-stack.sh` + `E2E_EMPTY=1 bun run e2e e2e/firstrun.spec.ts`) |

CI runs both on every push and pull request (the E2E job against a production build).

