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

## 2026-08-27 — Phase 5: capture, feeds, inbound email (PRD §7, §14)

- **Text extraction** uses `@mozilla/readability` over a `linkedom` DOM, `turndown` for markdown, `unpdf` for PDFs, `fast-xml-parser` for feeds — pure JS, no headless browser (PRD: plain fetch, no automation). arXiv `abs`/`html` links resolve to the PDF so papers get full text. (§7)
- **Social platforms are never fetched** (X, LinkedIn, Facebook, Instagram, Threads): a capture of such a link requires `text` (share-sheet passes both) — honours the "never scrape LinkedIn/X" rule. (§3, §7)
- **SSRF guard**: capture/podcast downloads only reach public http(s) hosts (loopback, link-local, RFC1918 rejected) even though the endpoint is API-key protected — the server sits inside the VPC next to RDS. (§7)
- **Pasted text is keyed by content hash** (`marrow:text:<sha256[:24]>`) and emails by `Message-ID` (`marrow:email:<id>`) so the (namespace, source_url) idempotency rule of §5 covers text without a URL. Synthetic ids are never rendered as links.
- **Capture fetches synchronously** (title/author/body known at `POST` time; the pipeline's fetch stage is a no-op for text) so the share-sheet acceptance ("searchable in < 1 min") only waits on article/enrich/segment. A bare URL that yields < 80 characters of text is rejected with a plain-language error rather than stored empty.
- **Linked YouTube videos (owner Q4)**: default **off** — offered on the item page; namespace flag `auto_ingest_links` queues them (max 5 per capture). Owner may flip the default.
- **Feeds**: RSS 2.0/Atom via `sources.kind = "rss"`; enclosures → `podcast_episode` through the media pipeline (direct download instead of yt-dlp; feed title/author/date kept by the fetch stage), other entries → captured text (feed body when ≥ 500 chars, else the page). **At most `FEED_MAX_PER_POLL` (5) new entries per poll, newest first**, so a new subscription doesn't ingest a back-catalogue at ≈ $1/hour. (§7, §13)
- **Inbound email is a provider-agnostic webhook** (`/inbound/email/<INBOUND_EMAIL_TOKEN>`; Postmark / CloudMailin / generic JSON), namespace from the recipient plus-tag or `INBOUND_EMAIL_NAMESPACE`. Unroutable mails are answered 200 and logged so providers stop retrying. **Provider choice is the owner's** (`STACK:inbound_email`): Postmark or CloudMailin work without a domain. (§7)
- **Podcast playback**: `GET /items/:id/audio` streams the pipeline's mono Opus audio (range requests) and the web player drives an `<audio>` element behind the same `PlayerApi` as the YouTube iframe, so timecodes seek podcasts too. (§6.2)
- **Markdown export gains YAML front-matter** (title/source/type/author/published/duration/tags) for Obsidian's properties panel; text items export their original text under `?transcript=1`. (§8)

## 2026-08-27 — End-to-end tests and fake mode

Playwright drives the real Next.js app against the real Hono server in `MARROW_FAKE=1` mode (fake pipeline providers with real media bytes, fake retrieval, scripted chat model, seeded corpus in a throw-away PGlite + local storage), so every feature is exercised offline and deterministically — no OpenAI/yt-dlp in CI. Every test asserts zero browser errors (uncaught exceptions, console errors, hydration warnings); an axe-core WCAG 2.x A/AA scan runs on every main page; a Pixel-7 project checks for horizontal overflow. Bugs it caught on the first runs: nested `<p>` hydration error on the inbox, keycap links announced as buttons, an unlabelled player slider, namespace citations mangled by timestamp linkification, chat page overflowing on phones, seeded questions sent twice in dev. (PRD §14 acceptance)

## 2026-08-28 — Colour contrast is enforced (WCAG AA)

The axe scan in the E2E suite now includes `color-contrast`. Tokens were re-tuned so every text colour clears 4.5:1 on every ink, including key faces and 80%-opacity placeholders: `--muted-foreground` #9a9a96 → #a6a6a2 (≥ 5.1:1), `--time` oklch L 0.72 → 0.74, `--destructive` L 0.70 → 0.74 (≥ 4.9:1); placeholders render at full muted ink (`::placeholder { opacity: 1 }` overriding Tailwind's 50% currentColor). The audit also exposed a real bug: shadcn's InputGroup dims itself (`has-disabled:opacity-50`) whenever *any* descendant is disabled — the chat's empty-state submit button faded the whole prompt box to 50%; it now only dims when its own control is disabled. (design system, PRD §14)

## 2026-08-28 — Phase 6: language mode + review queue (PRD §6.3, §14)

- **Expression spans come from word timestamps**: the model only names the expression and its line time; `locateSpan` matches the exact word run (normalised, near that time) so the clip is the spoken span, not a whole line — the PRD's reason for mandating word-level timestamps. A miss falls back to the line span and is counted in the stage log.
- **Clips are AAC (`cutClip`, ±0.15 s padding) at `clips/{item}/{n}.m4a`**, served by `GET /items/:id/clips/:n` (content type sniffed so the fakes' WAVs play too).
- **Review queue is a table (`expression_reviews`)**, not document state: "learn" marks, stage and due date are the owner's data and must survive re-ingests (which replace the document). Schedule: 2d → 7d → 30d, then every 30d; "again" restarts at 2d. Answers are stamped with real time; `?now=` on `/reviews` exists only so tests and demos can time-travel.
- **Language mode is a per-namespace switch** (library toggle → `PATCH /namespaces/:ref`, new-namespace checkbox); turning it on later and re-running an item (`--force`) adds the pack without redoing transcription (stage checkpoints).
- The nav shows **Review** always (so the feature is discoverable) with a due-count badge; the page explains where expressions come from when the queue is empty.

## 2026-08-28 — Language mode / review UX pass

Expressions carry the sentence they were said in (`context`, stored on the review row too — migration 0004): recall works on a phrase in context, not a phrase alone. The Language tab shows the quote with the phrase highlighted (long lines windowed to ~160 chars), top-aligned controls, human dates ("next prompt 4 Sep" via `fmtDay`, UTC-deterministic), tooltips on Play/Learn, and a "Review →" shortcut once something is saved. The review card shows "card N of M" with a progress bar, a *Later* button (defers within the session, key L), the context quote on reveal, what each answer does to the schedule, and hides keyboard hints on phones.

## 2026-08-28 — "Review" is called Practice, and only appears when it applies

The owner couldn't tell what the Review page was for. The nav entry is now **Practice** ("flashcards for the expressions you marked Learn"), the page opens with a one-sentence explanation of the 2/7/30-day spacing, and the entry is hidden until a namespace is in language mode or something has been saved — a research-only user never sees it. Route stays `/review`; PRD wording ("review queue") stays in code and API names. (PRD §6.3)

## 2026-08-28 — Full app review pass

Inbox: the header separates "ingesting" from "failed"; failed cards can be skipped (archived) and unskipped like anything else, so a dead link doesn't stay red forever. Dates people read (inbox, item header, shared page, source card, graph panel, subscriptions) use `fmtDay` ("28 Aug"); ISO stays in exports and metadata. Library rows no longer print "ready" where a duration would be for text items. Everything else (transcript rail, chat, graph, practice, shared page, phone layouts) held up against the checklist; 50 E2E tests cover the changes.

## 2026-08-28 — Owner login with Better Auth

Until now the web app injected the API key for every visitor, so the Vercel URL was effectively public. Better Auth (email + password) now runs **inside the API server** on the same Postgres — keeping "the web app never touches the database" — and the web app proxies `/api/auth/*`, so cookies stay first-party on the web app's origin (`baseURL` = `MARROW_WEB_URL`). Single owner: the first sign-up creates the account, `databaseHooks.user.create.before` refuses any later one. Pages are gated in Next's `proxy.ts` (cookie presence) and verified in the `(app)` layout and the API proxy (server-side `get-session`). No social providers, no e-mail sending, no password reset (delete the `auth_user` row to recreate). MCP/CLI keep the API key. (PRD §2 single owner, §8 auth)

## 2026-08-28 — Owner account created on the live app

The owner created the single account on `try-marrow.vercel.app` and set `MARROW_WEB_URL` + `BETTER_AUTH_SECRET` on the EC2 box; the next deploy picked them up (sessions signed before the secret change were invalidated once, by design). Docs now describe the login in README/DEPLOY/CAPTURE.

## 2026-08-28 — Multi-user workspaces with roles (supersedes the single owner)

Owner decision, in their words: "make it a multi user app, a proper SAAS dont do this first user owner thing use roles and RBAC". This overrides PRD §2 ("single owner") and the single-owner login above. Built on Better Auth's `organization` plugin (workspace = organization; members, invitations, roles from `createAccessControl`) and `@better-auth/api-key` — no separate auth service, still one Postgres. Scoping: `namespaces.organization_id` (unique per workspace + name) and everything hangs off namespaces; expression reviews and events are per user. Callers are a **principal** — session cookie, personal API key bound to a workspace, or the instance key naming its workspace with `x-marrow-org` — and every route/MCP tool checks the role (`viewer` read + practise · `member` + add/skip/follow/chat/keys · `admin` + namespaces/items delete + people · `owner` + the workspace). Sign-up is open (a SaaS, not an allow-list); each account gets a personal workspace the first time it signs in (one code path — the session hook — so a fresh sign-up and an account from before workspaces existed behave the same); invitations are copyable links because there is no mail provider (`requireEmailVerificationOnInvitation: false`); the first workspace created on an instance adopts the pre-tenancy namespaces so the live library isn't orphaned; sign-in returns you to the workspace you used last. The UI hides what a role can't do (`GET /me` → `useCan`) but the server is the gate. Migration 0006. (PRD §2, §8, §12)

## 2026-08-28 — Client state: TanStack Query + Zustand

Owner: "use proper state manager sdks". Client components keep server state in **TanStack Query** (`apps/web/lib/queries.ts`: me, workspace roster, API keys, practice summary, and the learn / answer / skip / retry / workspace mutations; cache invalidation replaces the ad-hoc `marrow:reviews-changed` window event) and per-browser preferences in **Zustand** with `persist` (`lib/store.ts`: graph layout/labels/filters, shared-page player, practice progress) instead of hand-rolled `localStorage` code. Server components still fetch via `lib/api.ts` and re-render with `router.refresh()`.

## 2026-08-28 — Build identity: `GET /health` and `/api/version` report the commit

Checking whether a push had reached the box meant SSH and `journalctl`. The Docker build now bakes the git SHA in (`GIT_SHA` build arg → `MARROW_COMMIT`, set by `scripts/deploy-ec2.sh`), `GET /health` returns `{ ok, commit, started_at }`, and the web app's public `/api/version` returns Vercel's `VERCEL_GIT_COMMIT_SHA`. A short SHA gives nothing away, so both stay unauthenticated: a plain `curl` (or an uptime checker) answers "is the latest commit live?". Config stays env-only. (docs/DEPLOY.md Part C)

## 2026-08-28 — Riding out API restarts: retries, strict parsing, a real error boundary

The owner saw "This page couldn't load" twice on the live app with a client `TypeError: … reading 'includes'`. Cause: the server restarts for ~10–20 s on every deploy (many pushes that day); a page loading in that window failed outright, and a reply cut off mid-restart was parsed as `{}` by the browser client and handed to `useCan` as `me`. Fix in one shared layer (`apps/web/lib/http.ts`): GET/HEAD retried on 502/503/504 and dropped connections (three attempts, ~1.2 s; writes never), a 2xx that isn't JSON is an error, plain sentences for statuses the server didn't explain; `getMe` only treats 401/403/404 as "signed out" and lets anything else reach the error boundary — which now exists at the root too (a layout error skips its segment's own `error.tsx`) and whose *Try again* refreshes the server side. Permission checks tolerate a missing list. Zero-downtime deploys (two containers behind Caddy) deferred until a single-service restart window actually matters.

## 2026-08-28 — Ingest progress a person can read

The owner added a YouTube link and saw "queued"/"ingesting" for minutes with nothing moving — it looked stuck. The pipeline already records every stage's state and timestamps on the job, so the inbox card and the library row now show that: the running step in plain words, "step k of n", a stepped bar (done · running in the time accent · skipped dimmed · failed), elapsed time since enqueue, and an estimate — deliberately rough, from media length (~2 min + 8 s per minute; text ≈ 1 min) and phrased as "about 6 min left" / "taking longer than usual — still working", never a fake percentage of time. Polled every 2.5 s only while a job is in flight; the page re-renders itself when the job ends. The in-flight card is a neutral lifted panel; red stays for failure. (PRD §5 stage records, §6.4 inbox)

## 2026-08-28 — Jobs survive deploys; the queue is visible on `/health`

The owner asked why an ingest sat in "queued" on production. Two causes in the code: the server runs one job at a time (by design — one small box, cost-bounded), and every deploy restarts the container with Docker's default 10 s grace, killing whatever was in flight: the broker kept that job `active` until its 4-hour expiry, our `jobs` row stayed `running`, and re-adding the URL returned "already in the library" without re-queuing — stuck for hours with no signal. Now: `stop_grace_period: 100s` lets the current stage finish; on boot `PgBossQueue.start` cancels orphaned `active` broker rows and `recoverJobs` re-sends every queued/running job (the runner resumes at the interrupted stage; `singletonKey` de-duplicates); broker expiry is 1 h. `GET /health` reports `queue: { queued, running, failed, oldest_queued_s, running_since_progress_s }` — counts only, so it stays public and a curl answers "is the pipeline moving?". Parallel workers are deliberately not added; if a workspace needs throughput, that is a second container, not a second thread on the same CPU/ffmpeg budget. (PRD §5, §14)

## 2026-08-28 — Production investigation: an ingest stuck on "Queued"

On the box: one job, `queued` in our table, `failed` in pg-boss — its stored error `CredentialsProviderError: Could not load credentials from any providers`. `.env` had empty `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` and no IAM role on the instance (the DEPLOY step), so every ingest died at its first S3 call, before the runner marked anything — and nothing said so. Also found: `t4g.micro`, 1 GB, no swap, two OOM kills that day (one during a deploy build). Done: a storage probe at boot and every 5 min (`/health.storage`, loud log), handler failures outside the stage loop recorded on the job/item (`failJobIfUnstarted`) so the card says *failed — Reason: …* with Retry, 2 GB swap on the box, `INGEST_CONCURRENCY` (pg-boss workers / in-process pool; 2 on the box) and `STT_CONCURRENCY` (audio chunks transcribed in parallel — the long pole). Deliberately not done from here: attaching the IAM role (needs the AWS account; documented) and resizing the instance (owner's call; `t4g.small` recommended). (PRD §5, §14; docs/DEPLOY.md)

## 2026-08-28 — YouTube blocks the EC2 address; cookies/proxy for yt-dlp

With storage fixed the first real ingest failed at fetch: `yt-dlp … Sign in to confirm you're not a bot` for every player client from the AWS IP. yt-dlp's supported remedies are a cookies file from a signed-in browser or a proxy; both are now configuration (`YTDLP_COOKIES`, `YTDLP_PROXY`, plus `YTDLP_EXTRA_ARGS`), applied to metadata, download and playlist listing, with the file mounted read-only from a git-ignored `secrets/` folder. yt-dlp errors are explained in a sentence on the card (`explainYtdlpError`) with the raw text in the log. The PRD's "never automate logins" stands: the owner exports their own (spare-account) session once; nothing signs in. A PO-token provider is the next step if cookies prove brittle. (PRD §5 fetch, §2 constraints)

## 2026-08-28 — yt-dlp needs a JS runtime for YouTube streams

Even with cookies the box got "Requested format is not available": yt-dlp's verbose log said *n challenge solving failed — ensure a supported JavaScript runtime and challenge solver script*. Since 2025.10 yt-dlp decodes YouTube's stream signatures with a bundled JS solver that needs Deno (preferred), Bun or Node — only Deno is enabled by default, and a bare Debian image has none. Fixed twice over: the Docker image installs Deno, and `ytdlpArgs` always passes `--js-runtimes bun:<process.execPath>` (Bun runs Marrow, so it is always there — dev machines included). Proven on the box: with cookies + runtime a stream URL resolves and serves (HTTP 206). (PRD §5 fetch)

## 2026-08-28 — Instance size: `t4g.small` is the baseline

Owner asked to upgrade the box from `t4g.micro` to `t4g.small`. Measured why: 1 GB with no swap was OOM-killed by the deploy's own image build, and the first real ingest (11 min of video) pushed ~260 MB into the 2 GB swap even after the fix. The launch guide now says `t4g.small` (the earlier "t4g.medium" was over-specified; the owner reasonably picked micro), step 5 adds the swap on every new box, and the resize is written as a console walkthrough with the Elastic-IP check first — the instance's role stays S3-only, so the box can't resize itself, and shouldn't. (docs/DEPLOY.md §3, §5, "The box")

## 2026-08-28 — Production verified end to end

After the day's fixes (S3 role + IMDS hop limit, YouTube cookies, JS runtime for yt-dlp, job recovery, 2 workers, `t4g.small` + swap) the live instance ingested a real 11-minute YouTube talk through every stage — fetch, transcribe ($0.065), keyframes, vision ($0.008), article ($0.003), references ($0.014), index — for **$0.09**, well inside the PRD's ≤ $1/hour target. `/health` on the API now answers the three questions that mattered today: which commit, can it store, is the queue moving. Docs (README, DEPLOY, STACK, CLAUDE.md) describe the setup as it actually runs. (PRD §5, §14)

## 2026-08-28 — Spend per item, everything included

Owner: "for each video or post or item it should also log and show how much tokens used total including everything". The job already carried per-stage usage, but chat spend went nowhere and nothing summed per item. Now a single ledger table (`usage_log`) receives a row per model per unit of work — pipeline stages, namespace-summary refreshes, per-video and namespace chat turns — and the item's figure is a sum over rows (re-ingests add up; a retried stage replaces its rows). The chip on the item page reads `$0.09 · 52k tokens` with the full ledger on hover; inbox and library show dollars; logs print tokens per stage and per ingest. Provider list prices from `PRICING`; chat web-search tool calls are not itemised (the SDK reports no count). Pre-ledger jobs are backfilled at boot from their stage records. (PRD §5 cost target, §11 events)

## 2026-08-28 — Chat crash on "What's on screen now"

Reproduced against the real model on a local live stack: when the model starts a tool call, the part's input is still undefined while streaming and the vendored AI Elements `ToolInput` rendered `CodeBlock` with `JSON.stringify(undefined)` → `code.split` threw inside a render → the whole page fell into the error boundary ("This page couldn't load"). The fake chat never emitted tool calls, so E2E never saw it. Fixed in both vendored components (guard undefined) and the fake model now calls `view_frame` for "screen" questions so the tool-part path is covered. Likely the same crash the owner saw twice earlier that day.

## 2026-08-28 — Share pages are public and indexable

Owner: the `/read` share link asked for a login, and it "shouldn't"; make sharing pages public so anyone can view them and Google can index them, and improve SEO overall. Done as a separate public surface rather than loosening the gate: the API gains `/public/*` routes (ready items only — document, audio, frames, exports, a read event) registered before the principal middleware; the web share page moves to a `(public)` route group with its own light layout and reads through `/api/marrow/public/*`, cached 10 minutes; the app stays private and `noindex`. SEO: canonical URLs, OpenGraph/Twitter cards with the generated image, schema.org JSON-LD (VideoObject with duration/thumbnail/embed/transcript, PodcastEpisode, Article), `sitemap.xml` of every ready item, `robots.txt` allowing only share pages and the front door, and an indexable sign-in page carrying the product description. Trade-off accepted knowingly: every ready item in every workspace is reachable by link and listed in the sitemap — ids are unguessable, but the sitemap is not. A per-item "unlisted" switch (kept out of the sitemap and `noindex`) is the natural next step if a workspace needs it. (PRD §6.2 sharing)

## 2026-08-28 — The bot check is intermittent; PO tokens and an in-stage retry

A second real ingest failed at fetch with the same "Sign in to confirm you're not a bot" — while the cookies file was fine: the same request passed minutes later, and the failing runs had refreshed the session cookies themselves. So on a cloud address the check comes and goes even with cookies. Three responses: `withBotCheckRetry` retries a bot check inside the stage (20 s, 40 s) before pg-boss's 30-second retries; the message on the card distinguishes "no cookies configured" from "rejected just now — retry, re-export if it persists" and the stage log keeps yt-dlp's raw tail; and production runs bgutil's PO-token provider as a sidecar (`pot-provider`, plugin in the server image, `YTDLP_POT_PROVIDER_URL`), which is yt-dlp's documented way to make cloud traffic look legitimate. Optional by configuration — a box without the sidecar behaves as before. (PRD §5 fetch)

## 2026-08-28 — Landing page: the front door at "/"

Owner asked for a landing page in the spirit of a poster built on David's *The Death of Socrates* with monumental type. Built with the real painting — The Met's Open Access (CC0) scan — plus two Piranesi etchings of Rome (Forum, Pantheon), all credited on the page and in `public/landing/CREDITS.md`; nothing generated. Signature: the word MARROW cut from the painting itself over the darkened painting (one geometry, `background-clip: text`), so Socrates and his students show through the letters. The rest stays in the product's own vocabulary — the pipeline as a timeline of timecode keycaps, serif thesis, mono eyebrows, small keycap CTAs. Route: `app/(public)/welcome`, rewritten from "/" for visitors (signed-in users keep the inbox at "/"), indexable with canonical "/", WebSite + SoftwareApplication JSON-LD, its own OG image; login/signup keep their plain titles. Images sized for the web (364/588/284 KB), the hero eager, the rest lazy. (PRD §6 surfaces; owner brief)

## 2026-08-28 — yt-dlp must never rewrite the owner's cookie jar

The actual cause of the recurring "not a bot" after the first success: yt-dlp saves the cookie jar back after every run, and the saved jar is a fraction of the export (637 YouTube cookies → 31 on the box). With the shrunken jar YouTube refused the *webpage* itself — before any PO token could matter — while the untouched export passed every time. Every yt-dlp run now gets a private temp copy of the file (`privateCookies`) and the mount is read-only again; retries are spaced wider (45 s, 90 s in the stage; the broker's three retries back off from a minute) so a flagged address isn't hammered. The PO-token sidecar stays: it helps the player/stream requests, not the page fetch. (PRD §5 fetch)
