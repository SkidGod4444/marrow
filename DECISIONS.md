# DECISIONS.md

Engineering decisions not dictated by the PRD (`docs/PRD.mdx`). Where the spec is silent, pick the simplest option that satisfies the acceptance criteria (PRD §14) and record it here. Newest entries at the bottom.

Format: date, decision, why, PRD section it relates to.

---

## 2026-08-27 — PRD lives at `docs/PRD.mdx`

The PRD (Draft v1, 2026-08-27) is checked in verbatim at `docs/PRD.mdx` and is the single source of truth. `CLAUDE.md` summarises it for agents but never overrides it; if the two disagree, the PRD wins and `CLAUDE.md` gets fixed. (PRD preamble)

## 2026-08-27 — Stack choices live in `docs/STACK.md`, not in code

The PRD says every `STACK:*` placeholder is resolved by the owner and that the agent must not pick a stack. `docs/STACK.md` holds one row per placeholder (plus the choices the PRD implies but doesn't name). No application code is scaffolded until that sheet has no `TBD` rows. (PRD preamble, §15 Q2)

## 2026-08-27 — Stack resolved by owner; recorded in `docs/STACK.md`

Owner chose TypeScript on bun, Supabase Postgres + Storage, OpenAI for all hosted ML, and VPS hosting (Cloudflare evaluated: Workers can't run ffmpeg/yt-dlp; Containers can — worker stays a plain Docker image so either works). Owner rule: latest version of everything, including Next.js. (PRD preamble, §15 Q2)

## 2026-08-27 — `whisper-1` for STT; diarization deferred

`whisper-1` is the only OpenAI model that returns word-level timestamps (`timestamp_granularities: ["word"]`), which the PRD makes mandatory. `gpt-4o-transcribe-diarize` returns speakers but not words, so diarization would be a second full STT pass — deferred; the `diarize` stage writes the `speakers: [S1]` fallback. Audio is encoded to mono Opus 24 kbps so a 2-hour episode (~22 MB) fits whisper-1's 25 MB cap without splitting; longer audio is split at `silencedetect` boundaries and timestamps re-offset. (PRD §4.3, §5 stages 1–3, §15 Q3)

## 2026-08-27 — Audio key is `audio/{item}.ogg` (Opus), not `.m4a`

PRD §5 allows "m4a/opus"; §12 shows `audio/{item}.m4a`. Opus gives better speech quality per byte, which matters for the 25 MB STT cap, so the transcription audio is Opus-in-Ogg at `audio/{item}.ogg`. Language-mode clips stay `clips/{item}/{n}.m4a` (AAC plays natively in every browser). (PRD §5, §12)

## 2026-08-27 — One `jobs` row per pipeline run, per-stage detail in `stages` jsonb

PRD §12 gives `jobs(id, item_id, stage, state, error, updated_at)`. Implemented literally as one row per (item, pipeline version): `stage` = current stage, `state` ∈ queued|running|failed|done, plus `stages` jsonb keyed by stage name holding `{state, started_at, finished_at, error, usage, cost_usd}` and a summed `cost_usd`. `ingest()` returns the job id; `job_status(job_id)` returns the row. Resume = skip stages whose `stages[name].state === "done"` at the same version. (PRD §5, §8, §13)

## 2026-08-27 — Re-ingest semantics

`ingest(namespace, url)` is idempotent on `(namespace_id, source_url)` (unique index). Existing `ready` item → returns the existing item/job unless `force: true`, which starts a new job at `version + 1` and replaces derived artifacts. Existing `failed`/`queued` item → resumes its latest job. (PRD §5 "idempotent per (source_url, namespace)")

## 2026-08-27 — `packages/core` holds the pipeline too

One shared package (schema, document types, storage, OpenAI clients, pipeline stages + runner, services) rather than separate `core`/`pipeline` packages. `apps/worker` is a thin pg-boss consumer + CLI; the CLI can run the pipeline in-process (`--sync`) so Phase 1 works on PGlite with no queue infrastructure. (PRD §5, §14 Phase 1)

## 2026-08-27 — Owner pivot: AWS (credits), one server process, docker-compose, Turborepo

Supersedes the Supabase/VPS rows above. Owner has AWS credits and wants everything AWS-compatible: **S3** for objects, **RDS PostgreSQL** (pgvector) for the DB, **one EC2 instance** running docker-compose for the app. Assessed against the AWS startup-advisor guidance: for a solo owner the minimal footprint (EC2 + RDS micro + S3, no ALB/NAT/ECS/Aurora/CloudFront) is appropriate, ≈ $40/mo, and not overkill; a plain VPS would be cheaper but credits make AWS free and the owner wants to learn it. Code stays portable: S3 API (MinIO locally), plain Postgres. The separate `apps/worker` was dropped — `apps/server` is a single process (Hono REST + MCP + in-process pg-boss runner + CLI). Turborepo orchestrates the bun workspaces. Deployment/AWS console setup is deferred to Phase 3; Phases 1–2 run locally. (PRD preamble, §5, §8, §12, §14)

## 2026-08-27 — PGlite for tests and no-Docker dev; `@electric-sql/pglite-pgvector` for the vector extension

Tests and the bare CLI run on PGlite (Postgres-in-WASM) so nothing needs installing; the same Drizzle migrations run on RDS. PGlite 0.5.x ships pgvector as the separate package `@electric-sql/pglite-pgvector` (not `@electric-sql/pglite/vector` as older docs say). The migration's `CREATE EXTENSION IF NOT EXISTS vector;` is prepended by hand after `drizzle-kit generate`. (PRD §12)

## 2026-08-27 — OpenAI SDK directly in the pipeline (Responses API + zod structured outputs)

The pipeline uses the official `openai` SDK rather than the Vercel AI SDK: transcription needs `verbose_json` word output, and `responses.parse` + `zodTextFormat` gives typed structured outputs with the hosted `web_search` tool in the same call. The AI SDK is reserved for the Phase 3 chat UI where streaming hooks matter. Cost accounting lives in `packages/core/src/openai/client.ts` (`PRICING`, `UsageTracker`) and is written per stage into `jobs.stages[*].cost_usd`. (PRD §5, §13)

## 2026-08-27 — oxlint instead of ESLint + typescript-eslint

Owner rule is "latest of everything", which puts TypeScript at 7.x; `typescript-eslint` refuses to run against TS 7.0 (tracking issue typescript-eslint#10940). Rather than pin TS back, linting uses **oxlint** (`.oxlintrc.json`: correctness = error, suspicious = warn, typescript/unicorn/oxc plugins). Type errors are caught by `tsc --noEmit`, not the linter. Revisit if typescript-eslint gains TS 7 support and its type-aware rules are wanted. (docs/STACK.md "Tests / lint")

## 2026-08-27 — Real-binary smoke tests confirmed the ffmpeg/yt-dlp command lines

Verified on the dev Mac (not unit-tested, since CI has no binaries): `yt-dlp -J` returns title/channel/upload_date/duration/chapters and the 720p-capped format string downloads + merges to `source.mp4`; the single-pass `select='gt(scene,T)',metadata=print:file=-` keyframe extraction lands exactly on hard cuts with correct `%05d.jpg` ↔ `pts_time` mapping; `silencedetect` parsing + `planChunks` cut at silence midpoints. Homebrew's ffmpeg lacks `drawtext`, so synthetic test videos must use `concat` of `color`/`testsrc` sources. (PRD §5 stages 1, 4)

## 2026-08-27 — `frames` table mirrors document keyframes

PRD §12 lists no frames table (frames live inside the document JSON). `get_frame(segment_id | frame_id)` and search hits' frame captions would otherwise need to fetch and parse a multi-hundred-KB document per call, so the frames stage writes a `frames(id, item_id, t, s3_key, caption, ocr_text, scene_score)` row per keyframe and the vision stage updates captions. The document stays canonical; the table is derived and replaced on re-ingest. (PRD §4.3, §8)

## 2026-08-27 — MCP over Streamable HTTP via `@hono/mcp`, stateless; stdio as a second entrypoint

The HTTP transport mounts at `/mcp` on the same Hono app (behind the API-key middleware) using `@hono/mcp`'s `StreamableHTTPTransport` with `sessionIdGenerator: undefined` — no session bookkeeping for a single owner. `apps/server/src/mcp-stdio.ts` serves the same `McpServer` over stdio for `claude mcp add … -- bun run …`; without `DATABASE_URL` that process owns the PGlite DB and runs ingest jobs itself. Tool handlers and REST routes only map arguments to `@marrow/core` services (PRD §8 "one service layer, two skins"). (PRD §8, §14 Phase 2)

## 2026-08-27 — `capture` deferred to Phase 5; `export_markdown` shipped in Phase 2

PRD §8 lists `capture` among the tools but §14 places capture + text sources in Phase 5, and it needs the text-source pipeline path. `export_markdown` is cheap and immediately useful to agents, so it ships now. (PRD §7, §8, §14)

## 2026-08-27 — Web app is a separate process but a pure client of the server

Phase 3 adds `apps/web` (Next.js). The owner asked to keep processes minimal; the web UI is still its own process (Next.js needs one), but it holds **no** database, storage, or OpenAI access — server components fetch from the Hono API with the owner key from `MARROW_API_URL`/`MARROW_API_KEY`, and client components go through `app/api/marrow/[...path]`, a transparent proxy that injects the key and streams bodies (chat SSE, frame JPEGs). All chat logic (`services/chat.ts`, `POST /items/:id/chat`) lives in the server process, so PGlite's single-process lock is never contended and LLM/DB code stays in one place. Static export was rejected because dynamic `/items/[id]` routes and SSR of large documents are wanted. (PRD §6.1, §14 Phase 3)

## 2026-08-27 — shadcn `base-nova` + AI Elements (vendored), Streamdown for markdown

`shadcn init -d` (latest CLI) picks the `base-nova` style on `@base-ui/react`; AI Elements components are copied into `components/ai-elements/` by the `ai-elements` CLI and patched locally where they lag base-ui 1.7 types (`prompt-input.tsx` event handler types, HoverCard delays). Article sections and chat answers render through Streamdown (`MessageResponse`) with an `a` component override so `[MM:SS](#t=N)` links seek the player. YouTube embedding uses a ~100-line IFrame-API wrapper (`components/marrow/player.tsx`) instead of a dependency. (PRD §6.2, §14 Phase 3)

## 2026-08-27 — Production compose + Caddy; AWS guide in docs/DEPLOY.md

`docker-compose.prod.yml` runs server + web + Caddy (automatic HTTPS for `MARROW_DOMAIN`) on the EC2 box; RDS and S3 come from `.env`. Caddy routes `/mcp` and `/api/v1/*` (prefix stripped) to the server and everything else to the web app. `docs/DEPLOY.md` is the click-by-click console guide (IAM user + MFA, S3 bucket with multipart-abort lifecycle, RDS db.t4g.micro single-AZ, EC2 t4g.medium + Elastic IP + security groups, registrar A record, instance role for S3). (docs/STACK.md hosting row)

## 2026-08-27 — Knowledge graph is a projection of `mentions`, served by API/MCP and drawn with d3-force

Owner asked for a graph knowledge base with a graph on the web. Adding a graph database for a single-owner corpus would duplicate the entity index the PRD already specifies (§9), so the graph is computed from `entities`/`mentions`/`items`: item ⟷ entity edges with mention count, stance mix and first timestamp. It ships as `GET /namespaces/:ref/graph`, the MCP `get_graph` tool (agents can reason over structure), and a d3-force SVG page (`/namespaces/[name]/graph`) with search, kind filters, zoom/drag, and a node panel whose links deep-link into items at the first mention (`/items/:id?t=`). Entity-kind colours use the validated dataviz categorical slots (checked in light and dark with the palette validator; direct labels are the required relief for the low-contrast slots). (PRD §8, §9, §14 Phase 3)

## 2026-08-27 — Design system: serif reading text, keycap buttons, timeline rail

Owner brief: research-oriented, minimalist, better fonts, 3D/small buttons, "next level". Choices: Source Serif 4 (with optical sizing) for everything read, IBM Plex Sans for chrome, IBM Plex Mono for time and data; one accent (`--time`, a marrow red) reserved for the live playhead/hover; timecodes as small keycaps and every time-indexed list on a shared "rail" with ticks; shadcn `Button` variants patched into tactile keycaps one size smaller. The shadcn init's `--font-sans: var(--font-sans)` self-reference (which silently fell back to a serif system font) is fixed in `globals.css`. (PRD §6.2, §14 Phase 3)

## 2026-08-27 — Close PGlite on shutdown

Killing the server mid-write left PGlite's on-disk data in a state the next start aborted on (WASM `Aborted()` at the first query). The server and stdio entrypoints now stop the queue, close the DB handle, and only then exit; stale `.marrow/pglite` from an unclean kill can be deleted and re-seeded. Real Postgres is unaffected. (docs/STACK.md database row)

## 2026-08-27 — Phase 4 shape: polling via `JobQueue.schedule`, inbox as `archived_at`, novelty per article section

Subscriptions live in the PRD's `sources` table (plus `title`/`last_error`); polling lists a playlist/channel with `yt-dlp --flat-playlist` (channels are listed via their `/videos` tab, newest first, capped at 100) and ingests only URLs the namespace doesn't already have. The schedule is a method on the queue so Postgres gets pg-boss cron and PGlite gets a timer — same server code. The inbox is simply ready items without `archived_at`; "Skip" is an archive + `skipped` event, undoable. Novelty triage (§10) uses article sections as the unit (chapters, then the whole item, as fallbacks), the nearest existing segments (excluding the item) as evidence, and a cheap-LLM known/new label; the verdict string follows the PRD's example. The namespace summary regenerates on every 3rd ready item and its cost is added to the triggering job. `items.summary` is denormalised so the inbox never loads documents. (PRD §6.4, §9, §10, §11, §14 Phase 4)

## 2026-08-27 — Namespace chat cites internal links

The PRD asks namespace chat to cite `title @ MM:SS` with deep links. The model is instructed to write `[Title @ MM:SS](/items/ITEM_ID?t=SECONDS)` from the tool results; the web renders those as client-side links and the item page seeks to `t` on load. YouTube deep links stay available in the tool results (`deep_link`) for agents over MCP. (PRD §6.1, §14 Phase 4)

## 2026-08-27 — UI conventions: cursor-pointer everywhere, responsive by default, shadcn first

Owner asks: all clickables show a pointer (Tailwind v4 preflight had removed it — restored globally, `not-allowed` when disabled), the platform must be responsive with proper spacing, and shadcn/ui components should be used and customised rather than replaced. Checked at 390px width. (owner brief 2026-08-27)

## 2026-08-27 — Diarization as an aligned second pass (resolves PRD §15 Q3)

Owner asked for speaker-attributed dialogue for podcast reading. `gpt-4o-transcribe-diarize` returns speaker spans without word timestamps and caps output at 2,000 tokens per request, so it runs as a second pass on ≤ ~7-minute silence-cut pieces, with 2–10 s reference clips of each speaker from the first piece passed as `known_speaker_references` so labels stay consistent, and the spans are aligned onto the whisper word timestamps (entries split where the speaker changes). It runs only when metadata looks multi-speaker, for `podcast_episode` sources, or when a namespace is flagged `diarize` (`DIARIZE=always|auto|off`). Cost ≈ +$0.36/hour, logged on the job. Speaker names come from a cheap-LLM pass over a sample of tagged lines. (PRD §5 stage 3, §6.3, §15 Q3)

## 2026-08-27 — Text version + exports; hydration and scrolling conventions

`/items/[id]/read` is the "convert to text" surface (article + dialogue, copy/download/print/share) backed by `documentToMarkdown`/`documentToText` and `/export.md|txt`. Client-side dates use `fmtDate` (UTC ISO) because `toLocaleDateString` differs between server and browser and caused hydration warnings; the YouTube player is created only for valid 11-character ids (demo items no longer throw). Smooth scrolling is global (`scroll-behavior: smooth`, disabled under reduced motion) and programmatic scrolls pass `behavior: "smooth"`; print styles turn the reading page into a clean document. (owner brief 2026-08-27)

## 2026-08-27 — UX review pass (heuristics + WCAG 2.2) and what changed

Reviewed every page against Nielsen's heuristics and WCAG 2.2. Fixed: current-page state in the nav; skip link and visible focus rings on links; keycap text contrast raised to ≥ 4.5:1 and keycaps to a 24 px target; "Ask about this section" always discoverable (was hover-only, invisible on touch); transcript auto-follow yields to the reader's own scrolling with a "Follow playhead" toggle; skipped items can be shown and restored; ingesting items appear as shimmering cards in the inbox with the live pipeline stage, failures show plainly with Retry, and the inbox auto-refreshes while anything is in flight; namespace summaries render as markdown; graph nodes are keyboard-reachable; route error boundary, 404 and loading states added. User-facing errors never mention env vars or commands (owner feedback). (owner brief 2026-08-27)

## 2026-08-27 — Site metadata and dynamic OpenGraph images

`metadataBase` from `NEXT_PUBLIC_SITE_URL`; per-page titles/descriptions; `robots: noindex` (single-owner tool). OG images are rendered with `next/og` in the app's look (charcoal, Source Serif 4 title, Plex Mono meta, keycap motif) at `/opengraph-image`, `/items/[id]/opengraph-image` (title, channel, duration, summary), and `/namespaces/[name]/opengraph-image`; fonts are fetched from Google Fonts as TTF at render time and cached per process (falls back to the default face offline).

## 2026-08-27 — ffmpeg keyframes: `-pix_fmt yuvj420p -strict unofficial`

The first real ingest failed at the frames stage: some YouTube encodes are full-range YUV and the mjpeg encoder refuses them. Both flags are now on the keyframe command; the failed job resumed from `frames` and completed ($0.003 for a 19 s video). (PRD §5 stage 4)

## 2026-08-27 — Web on Vercel, API on AWS

Owner decision: deploy the web app on Vercel and keep the server/API/pipeline on AWS. Changes: `next.config.ts` skips `output: "standalone"` on Vercel and traces `apps/web/assets/**` (fonts + brand mark, now checked in) into the serverless functions for the OG routes; the `/api/marrow/*` proxy declares `maxDuration = 60` for streamed chat; `metadataBase` falls back to `VERCEL_PROJECT_PRODUCTION_URL`; `docker-compose.prod.yml` runs only `server` + `caddy` on `api.<domain>` (`MARROW_API_DOMAIN`); `docs/DEPLOY.md` has Part A (AWS API) and Part B (Vercel). Scrollbars are hidden globally by CSS on request. (docs/STACK.md hosting row)

## 2026-08-27 — `DATABASE_URL` passwords are percent-encoded by the app

The first RDS deploy failed with `Invalid URL`: the auto-generated master password contained `? < : ( )`. `normalizeDatabaseUrl` (applied in `loadConfig`) percent-encodes the password segment — using the last `@` as the host separator, which RDS guarantees — so the URL works as pasted and already-encoded values are unchanged. (docs/DEPLOY.md step 5)

## 2026-08-27 — TLS to Postgres by default

The first RDS connection was rejected with `no pg_hba.conf entry … no encryption`: RDS PostgreSQL requires TLS. `databaseSsl(url)` now returns TLS options for any non-local host (shared by postgres.js and pg-boss's pg): with the Amazon RDS CA bundle present (`/etc/ssl/certs/rds-global-bundle.pem`, downloaded into the server image) certificates are verified; otherwise encrypted-but-unverified (`DATABASE_SSL=require`). Local/compose hosts (`localhost`, `db`, `postgres`) stay plain. Override with `DATABASE_SSL=auto|require|verify-full|off`. (docs/DEPLOY.md)

## 2026-08-27 — SSL query parameters are stripped from `DATABASE_URL`

`pg` (used by pg-boss) lets URL parameters override explicit options, so a leftover `?sslmode=require` forced verification without our CA bundle (`SELF_SIGNED_CERT_IN_CHAIN`). Both drivers now receive the URL with `sslmode`/`ssl`/`sslrootcert`/`uselibpqcompat` removed and take TLS settings only from `databaseSsl` (which still respects `sslmode=disable`). (docs/DEPLOY.md)

## 2026-08-27 — Server continuous deployment

Vercel redeploys the web on push; the EC2 server gets `scripts/deploy-ec2.sh` (fetch, reset to origin/main, compose build/up, in-container health check) driven either by `.github/workflows/deploy-server.yml` (push-based over SSH with a dedicated deploy key; needs port 22 open to GitHub runners) or by `docker/marrow-deploy.timer` (pull-based systemd timer, no inbound SSH, ≤1 min latency). `ci.yml` runs lint/typecheck/tests on every push and PR. (docs/DEPLOY.md Part C)

## 2026-08-27 — Server CD is pull-based only

Owner chose the systemd timer over the GitHub Actions SSH deploy (no need to open port 22 to the internet for a one-person box). `deploy-server.yml` removed; `ci.yml` stays. (docs/DEPLOY.md Part C)
