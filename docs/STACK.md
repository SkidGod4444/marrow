# STACK.md — Marrow tech stack sheet

The PRD (`docs/PRD.mdx`) leaves every technology choice as a `STACK:*` placeholder and instructs the coding agent **not** to pick a stack itself. This sheet is where the owner's choices are recorded. Agents: treat every row as fixed; if a new concern appears that this sheet doesn't cover, ask the owner or log the simplest choice in `DECISIONS.md`.

Status: **RESOLVED 2026-08-27** (owner answers: TypeScript on bun · AWS for infra — S3, RDS Postgres, one EC2 box — using AWS credits · OpenAI for everything · docker-compose + Turborepo · one server process, no separate worker). Owner rules: **use the latest version of everything**, including the newest Next.js — pin whatever `bun add` resolves at the time; **keep the number of processes minimal**.

## Placeholders named in the PRD

| Placeholder | Decision | Notes |
|---|---|---|
| `STACK:queue` | **pg-boss** (Postgres-backed), running **inside the server process** | Same Postgres (`pgboss` schema); durable, retries. Per-stage checkpoints are Marrow's own `jobs` table, not pg-boss state. Also provides cron (below). No separate worker deployable. |
| `STACK:stt` | **OpenAI `whisper-1`**, `response_format: verbose_json`, `timestamp_granularities: ["word","segment"]` | The only OpenAI-hosted model with word-level timestamps (PRD §4.3 rule: "use that model"). File cap **25 MB** → audio is encoded mono Opus 24 kbps (≈ 11 MB/hr) and silence-split above the cap. $0.006/min ≈ $0.36/hr. |
| `STACK:diarization` | **OpenAI `gpt-4o-transcribe-diarize`** (`diarized_json`, `chunking_strategy: auto`, `known_speaker_references`) as a conditional second pass, aligned onto whisper words | Runs for podcasts/interviews (heuristics, `podcast_episode`, namespace flag `diarize`, or `DIARIZE=always`); ≈ +$0.36/hr. Output cap 2k tokens/request → ~7-minute pieces with reference clips for label consistency. Single-speaker items keep the `S1` fallback. Resolves PRD §15 Q3. |
| `STACK:vlm_cheap` | **OpenAI `gpt-5.6-luna`** (image input, structured outputs) | Caption + OCR per keyframe, `reasoning.effort: "none"`. |
| `STACK:llm_cheap` | **OpenAI `gpt-5.6-luna`** ($0.20 / $1.20 per M tokens) | Article, enrichment, novelty, rerank. Structured outputs via zod. |
| `STACK:embeddings` | **OpenAI `text-embedding-3-small`** (1536 dims, $0.02/M) | `segments.embedding vector(1536)` via pgvector. |
| `STACK:cron` | **pg-boss `schedule()`** behind `JobQueue.schedule()` (a `setInterval` on PGlite) | The server process polls subscriptions every `POLL_EVERY_MINUTES` (default 30). |
| `STACK:inbound_email` | **Provider-agnostic webhook** `POST /inbound/email/<token>` accepting Postmark, CloudMailin and generic JSON; **provider: owner to pick** — Postmark or CloudMailin need no domain (an assigned inbound address); with a domain, Resend/SES work the same way | Routing by recipient plus-tag (`x+<namespace>@…`) or `INBOUND_EMAIL_NAMESPACE`. Setup in `docs/CAPTURE.md` §3. |
| Chat model | **OpenAI `gpt-5.6-terra`** via `@ai-sdk/openai` (Responses API), `reasoningEffort: low`, `promptCacheKey` per item | Interactive only. |
| `STACK:api` | **Hono** on bun, owner API key header | MCP HTTP transport mounts on the same Hono app; MCP stdio is a second entrypoint of the same package. |

## Choices the PRD implies but doesn't name

| Concern | Decision |
|---|---|
| Language / runtime | **TypeScript (latest, strict) on bun** — **Turborepo** over bun workspaces: `packages/core` (schema, document types, storage, OpenAI clients, pipeline, services), `apps/server` (**one process**: Hono REST + MCP HTTP + in-process pg-boss job runner + CLI + MCP stdio entrypoint), `apps/web` (latest Next.js). |
| Web framework | **Next.js 16.3 (App Router, Turbopack, standalone output)** + React 19 + Tailwind v4 + **shadcn/ui (`base-nova` style, @base-ui/react)** + **AI Elements** (vendored into `components/ai-elements/`) + Vercel AI SDK `useChat` + **d3-force/d3-zoom** for the knowledge graph. Fonts via `next/font/google`: Source Serif 4, IBM Plex Sans, IBM Plex Mono. The web app is a pure API client (no DB/OpenAI access); a proxy route injects the API key. |
| Database | **Amazon RDS for PostgreSQL** (`db.t4g.micro`, single-AZ, automated snapshots) with `pgvector` + `tsvector`, accessed via **Drizzle ORM** + `postgres` driver. **Local dev**: `pgvector/pgvector` container in docker-compose. **Tests / no-Docker dev**: PGlite (Postgres-in-WASM with the vector extension) when `DATABASE_URL` is unset — same SQL, same migrations. |
| Object storage | **Amazon S3** (one bucket, Standard class, versioning on, lifecycle: abort incomplete multipart after 7 days) via `@aws-sdk/client-s3`. **Local dev**: MinIO in docker-compose (same S3 API, `S3_ENDPOINT`). **Tests**: local filesystem driver. Keys follow PRD §12 exactly; raw video is deleted after the pipeline finishes (only audio, frames, clips, documents are kept). |
| Hosting | **Web app on Vercel** (Next.js, root dir `apps/web`, env `MARROW_API_URL`/`MARROW_API_KEY`; the browser never talks to the API directly — the app's `/api/marrow/*` proxy does). **Server on AWS**: one EC2 instance (`t4g.medium`, Elastic IP) running docker-compose (`server` + `caddy`) on `api.<domain>`; RDS PostgreSQL (pgvector) and one S3 bucket. No ALB/NAT/ECS/CloudFront/Route 53. Setup guide: `docs/DEPLOY.md`. |
| Strong chat model | **OpenAI `gpt-5.6-terra`** (`gpt-5.6-sol` as opt-in override). Interactive chat only — never in the pipeline. |
| Web search provider | **OpenAI Responses API `web_search` tool** (used with Luna for reference resolution; with Terra in chat). |
| Reranker | **RRF score fusion** by default; optional Luna rerank behind a flag. |
| MCP SDK | `@modelcontextprotocol/sdk` (stdio + `InMemoryTransport` for tests) with **`@hono/mcp`** `StreamableHTTPTransport` mounted at `/mcp` on the same Hono app, stateless mode. |
| OpenAI client | Official `openai` SDK in the pipeline (transcription needs `verbose_json` word output). Vercel AI SDK only in the web app for streaming chat. |
| Owner login | **Better Auth 1.7** (`better-auth`) running inside the Hono server on the same Postgres (Drizzle adapter, tables `auth_*`), email + password, sign-up closed after the first account; the Next.js app proxies `/api/auth/*`, gates pages in `proxy.ts` + the `(app)` layout, and its `/api/marrow` proxy injects the API key only for a verified session. MCP/CLI keep the API key. |
| Language mode (PRD §6.3) | Expressions via `gpt-5.6-luna` (structured output, line timestamps) → exact spans from whisper word timestamps → **ffmpeg AAC clips** (`clips/{item}/{n}.m4a`, ±0.15 s); review queue in Postgres (`expression_reviews`, 2 d / 7 d / 30 d). No extra services. |
| End-to-end tests | **Playwright** (Chromium; a Pixel-7 project for phones) + **axe-core** (WCAG 2.x A/AA incl. colour contrast) against the app in `MARROW_FAKE=1` mode — no network in CI. |
| Capture / feeds | `@mozilla/readability` + `linkedom` (article extraction), `turndown` (HTML → markdown), `unpdf` (PDF text), `fast-xml-parser` (RSS/Atom) — all pure JS, no headless browser. |
| Tests / lint | **Vitest** (PGlite in-memory per test file, fake providers); ESLint; `tsc --noEmit`. Live tests gated behind `LIVE=1`. |

## Owner decisions still open (PRD §15)

| # | Question | Status |
|---|---|---|
| 3 | Diarization in v1? | **Deferred** (see `STACK:diarization`). |
| 4 | Auto-ingest YouTube links from captured posts — default on or off? | **Default off** (linked videos are offered on the item page with an "Ingest" button); a namespace with flag `auto_ingest_links: true` queues them immediately. Owner can flip the default. |
| 5 | Licence (repo ships AGPL-3.0) and copyright entity | TBD before the repo goes public. |

## Local prerequisites (dev machine)

- `ffmpeg` — `/opt/homebrew/bin/ffmpeg`
- `yt-dlp` — installed 2026-08-27 via Homebrew (2026.08.19)
- bun 1.3.5, node 24, docker
