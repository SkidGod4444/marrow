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
