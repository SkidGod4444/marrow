# Deploying Marrow — web on Vercel, API on AWS (step by step)

Two deployables:

- **Web app (`apps/web`) → Vercel.** Pure Next.js; talks to the API over HTTPS; people sign in, and the proxy forwards their session. Nothing else.
- **Server (`apps/server`) → AWS.** REST + MCP + the ingestion pipeline (ffmpeg/yt-dlp) on **one EC2 instance** with docker-compose (server + Caddy), **RDS PostgreSQL** with pgvector, **one S3 bucket**. ≈ $40/month, all credit-eligible. No ALB, NAT Gateway, ECS, Aurora, CloudFront, or Route 53 needed.

You need two DNS names at your registrar: `api.marrow.yourdomain.com` → the EC2 Elastic IP (A record), and `marrow.yourdomain.com` → Vercel (CNAME, Vercel tells you the target).

## Part A — API on AWS

Everything below is in the AWS Console (https://console.aws.amazon.com). Pick **one region** and stay in it (top-right region selector). `ap-south-1` (Mumbai) if you are in India; otherwise the region closest to you.

## 0. Account hygiene (10 min, once)

1. Sign in as the root user → **IAM** → **Users** → *Create user* `marrow-admin`, tick *Provide user access to the console*, attach **AdministratorAccess**. Sign out of root and use this user from now on.
2. **IAM** → *Users* → `marrow-admin` → *Security credentials* → **Enable MFA** (phone app). Do the same for root.
3. **Billing** → *Credits* — confirm the credits show up. **Billing → Budgets** → create a budget of $100/month with an email alert at 80%.

## 1. S3 bucket (5 min)

1. **S3** → *Create bucket* → name `marrow-<something-unique>` (bucket names are global), your region, **Block all public access ON** (default), **Bucket Versioning: Enable**. Create.
2. Bucket → *Management* → **Lifecycle rules** → *Create rule* `cleanup`: scope = whole bucket; actions: *Delete expired object delete markers or incomplete multipart uploads* → **Delete incomplete multipart uploads after 7 days**; *Permanently delete noncurrent versions* after 30 days. Save.

## 2. RDS PostgreSQL (15 min)

1. **RDS** → *Create database* → *Standard create* → **PostgreSQL** (latest 17.x).
2. Template **Free tier** if offered, otherwise *Dev/Test*. Instance: **db.t4g.micro**. Storage **gp3 20 GB**, *enable storage autoscaling* (max 100 GB).
3. DB instance identifier `marrow`, master username `marrow`, **Auto generate password** (copy it from the banner after creation — shown once).
4. Connectivity: *Don't connect to an EC2 compute resource* (we'll do the security group by hand), default VPC, **Public access: No**, VPC security group: *Create new* named `marrow-db-sg`.
5. Additional configuration: initial database name `marrow`, **automated backups 7 days**, disable Performance Insights, **single-AZ**. Create (takes ~10 min).
6. Note the **Endpoint** (like `marrow.xxxx.ap-south-1.rds.amazonaws.com`) and port 5432.

The `vector` extension is preinstalled on RDS PostgreSQL ≥ 15; the app runs `CREATE EXTENSION IF NOT EXISTS vector` itself on first start.

## 3. EC2 instance (15 min)

1. **EC2** → *Launch instance*: name `marrow`, AMI **Ubuntu Server 24.04 LTS (arm64)**, instance type **t4g.small** (2 vCPU / 2 GB, ~$12/month before credits — with the swap added in step 5 it runs the server, `yt-dlp`, `ffmpeg` and two ingests at once; a `t4g.micro` with 1 GB gets OOM-killed during image builds, and a `t4g.medium` is only worth it for three or more concurrent ingests). Key pair: *Create new* `marrow-key` (.pem) — download and keep it.
2. Network settings: *Create security group* `marrow-web-sg`: allow **SSH (22) from My IP**, **HTTP (80) from Anywhere**, **HTTPS (443) from Anywhere**.
3. Storage: **30 GB gp3**. Launch.
4. **EC2 → Elastic IPs** → *Allocate* → *Associate* with the `marrow` instance. Note the IP.
5. Let the DB accept the box: **EC2 → Security Groups → `marrow-db-sg`** → *Inbound rules* → *Edit* → add **PostgreSQL (5432)**, source = the `marrow-web-sg` security group. Save.

## 4. Point the API subdomain at the box (5 min + DNS propagation)

At your domain registrar's DNS panel (wherever `yourdomain.com` lives — not AWS):

- Add an **A record**: name `api.marrow` (→ `api.marrow.yourdomain.com`), value = the Elastic IP, TTL 300.

Caddy inside the compose stack obtains the HTTPS certificate automatically once the name resolves (`dig api.marrow.yourdomain.com` should print the Elastic IP).

**No domain?** Use a free IP-based name: for Elastic IP `3.7.96.159`, set `MARROW_API_DOMAIN=3-7-96-159.sslip.io` — `sslip.io` resolves it to the IP with no signup, and Let's Encrypt issues certificates for it. (DuckDNS is the free alternative if you want a memorable name.) The AWS-provided `ec2-….amazonaws.com` name does **not** work — Let's Encrypt refuses that domain.

## 5. Prepare the box (10 min)

```bash
ssh -i marrow-key.pem ubuntu@<ELASTIC_IP>
# Docker
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu && newgrp docker
# 2 GB swap — turns a memory spike (image build, ffmpeg) into "slower" instead of "killed"
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab && sudo sysctl -w vm.swappiness=10
# Code
sudo apt-get install -y git unzip && git clone https://github.com/<you>/marrow.git && cd marrow
cp .env.example .env && nano .env
```

Fill `.env` on the box:

```
# Paste the RDS password as-is; the server percent-encodes special characters (? < : ( ) …) itself,
# and connects with TLS automatically (RDS requires it), verifying Amazon's CA bundle baked into the image.
DATABASE_URL=postgres://marrow:<RDS_PASSWORD>@<RDS_ENDPOINT>:5432/marrow
STORAGE_DRIVER=s3
S3_BUCKET=marrow-<something-unique>
S3_REGION=<your region>
OPENAI_API_KEY=sk-...
MARROW_API_KEY=<openssl rand -hex 24>
MARROW_WEB_URL=https://marrow.yourdomain.com # the address people open the web app at (owner login cookies + CSRF)
BETTER_AUTH_SECRET=<openssl rand -hex 32>    # signs login sessions; changing it signs everyone out once
INBOUND_EMAIL_TOKEN=<openssl rand -hex 24>   # only if you wire inbound email (docs/CAPTURE.md §3)
MARROW_API_DOMAIN=api.marrow.yourdomain.com
INGEST_CONCURRENCY=2                         # jobs at once (2 on a t4g.small)
YTDLP_COOKIES=/secrets/youtube-cookies.txt   # YouTube blocks cloud IPs — see "YouTube blocks the server" below
```

Leave `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` out (or empty) when the instance has the IAM role from step 3 — an *empty* pair with no role is the classic silent failure: `/health` says `"storage":"error"` and every ingest fails with *Could not load credentials from any providers*.

**How you know S3 is not set up:** `curl https://api…/health` shows `"storage":"error"`, the server log has `[storage] s3 check failed: Could not load credentials from any providers`, and every ingest lands in the inbox as *failed — Reason: Could not load credentials…* (the broker retries it twice first, so it sits on "Queued" for about a minute). Fix the credentials (below), then press **Retry** on the card.

**S3 credentials without keys (recommended):** EC2 → the instance → *Actions → Security → Modify IAM role* → create a role `marrow-ec2` with an inline policy allowing `s3:GetObject, s3:PutObject, s3:DeleteObject, s3:ListBucket` on your bucket (and `arn:...:bucket/*`). The AWS SDK inside the server container picks the role up automatically — leave `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` empty. (Fallback: IAM → Users → create `marrow-s3` with the same policy → access key → put the pair in `.env`.)

> **Docker needs one more setting for the role to work.** The server runs in a container, one network hop away from the instance metadata service. EC2 → the instance → *Actions → Instance settings → Modify instance metadata options* → **Response hop limit: 2** (leave IMDSv2 required). Without it the SDK inside the container reports `Could not load credentials from any providers` even with the role attached. Within five minutes `curl https://api…/health` shows `"storage":"ok"`; then press **Retry** on any failed card.
>
> **Keys instead of a role** (fine for a personal instance): IAM → Users → create `marrow-server` with an inline policy allowing `s3:GetObject, s3:PutObject, s3:DeleteObject, s3:ListBucket` on the bucket and its objects → *Create access key (Application running on an AWS compute service)* → put both values in `.env` as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` → `FORCE=1 ./scripts/deploy-ec2.sh`.

## 6. Launch

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f server   # wait for "marrow server on ..."
```

Then:
- `https://api.marrow.yourdomain.com/health` → `{"ok":true}`; MCP at `https://api.marrow.yourdomain.com/mcp`.
- Claude Code: `claude mcp add --transport http marrow https://api.marrow.yourdomain.com/mcp --header "x-api-key: <your key from Settings → API keys>"`.

Updating: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

## Part B — Web app on Vercel (10 min)

1. https://vercel.com/new → import the GitHub repo `SkidGod4444/marrow`.
2. **Root Directory**: `apps/web` (click Edit). Framework preset: Next.js (auto). Leave build/install commands default — Vercel detects the `bun.lock` at the repo root and installs the workspace (the web app imports types from `packages/core`).
3. **Environment variables** (Production + Preview):
   - `MARROW_API_URL` = `https://api.marrow.yourdomain.com`
   - `MARROW_API_KEY` = the same value as in the server's `.env`
   - `NEXT_PUBLIC_SITE_URL` = `https://marrow.yourdomain.com` — the public share pages' canonical URLs, the sitemap and OpenGraph use it (falls back to the Vercel production URL)
4. Deploy. Then *Settings → Domains* → add `marrow.yourdomain.com` and create the CNAME Vercel shows at your registrar.
5. Open `https://marrow.yourdomain.com`, **create your account** — the first workspace made on a fresh instance adopts any namespaces that already exist (see "Accounts" below) — and invite your people from Settings. Then check the inbox, an item page, and a Share link. Chat streams go through the web app's `/api/marrow/*` proxy, which is limited to 60 s per response on Vercel Hobby (`maxDuration`); raise it in `app/api/marrow/[...path]/route.ts` on Pro.

Every push to `main` redeploys the web app; the API on EC2 updates with `git pull` + compose as above.

## Part C — Continuous deployment

The web app redeploys on every push (Vercel). The server deploys itself: a systemd timer on the box checks `origin/main` every minute and, when it changed, runs `scripts/deploy-ec2.sh` (pull → rebuild image → restart → wait for `/health`). No inbound SSH is needed, so the security group's SSH rule stays on *My IP*.

One-time install on the box:

```bash
cd ~/marrow && git pull
sudo cp docker/marrow-deploy.service docker/marrow-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now marrow-deploy.timer
systemctl list-timers marrow-deploy.timer        # shows the next run
```

Day to day:

```bash
journalctl -u marrow-deploy.service -n 50        # last deploy log ("deploying a1b2c3d → e4f5g6h" … "healthy at e4f5g6h")
sudo systemctl start marrow-deploy.service       # deploy right now instead of waiting a minute
FORCE=1 ./scripts/deploy-ec2.sh                  # rebuild even when nothing changed (e.g. after editing .env)
```

Only server-side changes matter to the box; a web-only commit rebuilds in a minute or two and restarts the same code. `.github/workflows/ci.yml` lints, typechecks and tests every push/PR on GitHub.

### Is the latest commit live?

Both surfaces say which build they run — no SSH needed:

```bash
curl -s https://api.marrow.yourdomain.com/health     # {"ok":true,"commit":"29c8538","started_at":"2026-08-28T05:12:03.412Z"}
curl -s https://marrow.yourdomain.com/api/version    # {"ok":true,"commit":"29c8538","ref":"main","env":"production"}
git rev-parse --short origin/main                     # what both should say
```

The API's `commit` is the `GIT_SHA` build argument `scripts/deploy-ec2.sh` passes to the image (`"unknown"` when the image was built by hand without it); `started_at` moves on every restart. Vercel's comes from its system variable `VERCEL_GIT_COMMIT_SHA` — if it reads `null`, turn on *Automatically expose System Environment Variables* (Project → Settings → Environment Variables) and redeploy. If the API lags `origin/main` for more than a couple of minutes, read the timer's log on the box: `journalctl -u marrow-deploy.service -n 50`. One quirk: the deploy script updates itself, but the copy already running finishes as it was — so a change to `scripts/deploy-ec2.sh` takes effect on the deploy *after* the one that pulled it.

**Every API deploy restarts the server** (image built first, then the container is replaced): roughly 10–20 s during which Caddy answers 502/503. The web app rides that out — page loads and reads retry for about a second (`apps/web/lib/http.ts`), a reply cut off mid-restart is treated as a failure rather than data, and if the window is longer the page says *"This page couldn't load … it may be restarting after an update"* with a **Try again** that re-fetches. Writes (adding, chatting) are never retried automatically; the person sees a plain "try again in a moment". If you want zero-downtime deploys later, run two server containers behind Caddy and swap them (`docker-compose.prod.yml` is a single service today).

### YouTube blocks the server ("Sign in to confirm you're not a bot")

YouTube flags cloud addresses: from the EC2 box every `yt-dlp` client gets `Sign in to confirm you're not a bot`, and the inbox card says *YouTube is asking this server to sign in*. yt-dlp's answer is a **cookies file from a signed-in browser**. Use a **spare Google account** made for this (YouTube may act on the account it sees downloading), and don't keep using that account in the same browser afterwards — YouTube rotates the cookies and the file goes stale.

1. In Chrome, sign in to YouTube with the spare account, install *Get cookies.txt LOCALLY*, open youtube.com, export → `youtube-cookies.txt` (Netscape format).
2. Copy it to the box (the folder is git-ignored and mounted into the container — writable, because yt-dlp rewrites the file as YouTube rotates cookies):
   ```bash
   scp -i marrow-key.pem youtube-cookies.txt ubuntu@<ip>:~/marrow/secrets/youtube-cookies.txt
   ```
3. In the box's `.env`: `YTDLP_COOKIES=/secrets/youtube-cookies.txt`, then `FORCE=1 ./scripts/deploy-ec2.sh`. Press **Retry** on the card.

**Streams need a JavaScript runtime too.** Since late 2025 yt-dlp solves YouTube's signature/"n" challenge with a bundled script that needs Deno (or Bun/Node); without one it says *n challenge solving failed* and offers only image formats — "Requested format is not available". The Docker image ships Deno, and the server always enables Bun as a fallback, so nothing to configure. On a dev machine with Homebrew's yt-dlp the same applies: Bun is enabled automatically.

**The check still fires now and then, even with cookies.** Seen on the box: a fetch fails three times in a minute with the same "not a bot" message, then the very same request passes — YouTube refreshed the session during the failing runs. Two things absorb this: the fetch stage retries a bot check itself (20 s, then 40 s) before the broker's own retries, and the production stack runs a **PO-token provider** (`pot-provider` in `docker-compose.prod.yml`, the bgutil server; the yt-dlp plugin is in the server image and `YTDLP_POT_PROVIDER_URL` points at it), which makes the requests look legitimate to YouTube. `docker compose -f docker-compose.prod.yml exec server yt-dlp -v --simulate <url> 2>&1 | grep -i pot` shows the plugin talking to it. If a card still says *YouTube rejected this server's session*, press Retry; if it keeps happening for hours, the cookies have gone stale — export again.

Alternatives: `YTDLP_PROXY=http://user:pass@host:port` routes yt-dlp through a residential/other proxy (no cookies needed if that address isn't flagged); `YTDLP_EXTRA_ARGS` appends anything else yt-dlp wants (for instance a PO-token provider later). Test from the box: `docker compose -f docker-compose.prod.yml exec server yt-dlp -J --no-playlist --cookies /secrets/youtube-cookies.txt <url> | head -c 200`. Marrow still never automates a login — this is you exporting your own session once.

### The box: memory, swap, and how many jobs at once

The server idles at ~150 MB, but an ingest adds `yt-dlp` + `ffmpeg` (and yt-dlp's JS challenge solver runs Deno), and a deploy builds the image on the same box. Measured on the first real ingest: a 1 GB `t4g.micro` (no swap) was OOM-killed during a build, and even with the 2 GB swap from step 5 an 11-minute video pushed ~260 MB into swap. **`t4g.small` (2 GB) is the baseline**; keep the swap anyway.

**Resizing a running box (about three minutes of downtime):**

1. First make sure the address survives: **EC2 → Elastic IPs** must list the instance's public IP. If it doesn't, *Allocate* one and *Associate* it now — a stop/start without an Elastic IP changes the public IP, and `MARROW_API_DOMAIN` (e.g. `3-7-96-159.sslip.io`), Vercel's `MARROW_API_URL` and any DNS record would all point at the old one.
2. **EC2 → Instances → the instance → Instance state → Stop** (not *Terminate*). Wait for *Stopped*.
3. **Actions → Instance settings → Change instance type → `t4g.small`** → Apply.
4. **Instance state → Start.** Docker and the Marrow stack come back on their own (`restart: unless-stopped`); the deploy timer keeps running.
5. `curl https://api…/health` → `"ok":true` with the same `commit`; `ssh … free -m` shows ~1.9 GB.

Then, in `.env` on the box: `INGEST_CONCURRENCY=2` (3 on a `t4g.medium`) — how many jobs run at once; `STT_CONCURRENCY` (default 3) is how many audio chunks go to the transcription API in parallel. The instance's IAM role is S3-only on purpose — resizing is a console action, not something the box can do to itself. (`aws` CLI is installed on the box for diagnostics; with that role it can only talk to S3.)

Looking at the tables without installing anything: `docker run --rm --network host -e PGSSLMODE=require postgres:16-alpine psql "$DATABASE_URL" -c "select state, count(*) from jobs group by 1"` (the broker's own view is `pgboss.job`, its error text in `output`).

### Ingests during a deploy, and "why is it still queued?"

The pipeline runs **one job at a time** inside the server (pg-boss, `batchSize: 1`): a second video waits until the first finishes, and a followed playlist can queue several at once — that alone can mean minutes in "Queued". A deploy replaces the container: the old one gets up to 100 s (`stop_grace_period`) to finish the stage it is on, and whatever is still unfinished is **re-queued when the new container boots** (`recoverJobs`, plus the broker's orphaned `active` rows are released) and resumes at the interrupted stage. Nothing needs a hand.

`GET /health` shows the queue without a key:

```json
{ "ok": true, "commit": "…", "started_at": "…",
  "queue": { "driver": "pg-boss", "queued": 2, "running": 1, "failed": 0, "oldest_queued_s": 340, "running_since_progress_s": 95 } }
```

Read it as: `running: 1` with `running_since_progress_s` ticking up past a few minutes → a stage is slow (transcribing an hour of audio takes ~3–4 min; `yt-dlp` on a throttled download can take longer); `queued > 0, running: 0` for more than a minute → the worker isn't picking jobs up (`docker compose -f docker-compose.prod.yml logs --tail=100 server` on the box; look for `[pg-boss]`). A job that hangs is expired by the broker after an hour and retried twice.

## Accounts

The web app is multi-user: anyone who reaches it can sign up and gets a workspace of their own; people join yours through an invitation link from Settings (nothing is e-mailed). Two variables on the **server** (`.env` on the box; the next deploy — any push to `main`, or `FORCE=1 ./scripts/deploy-ec2.sh` — restarts the container with them):

```
MARROW_WEB_URL=https://try-marrow.vercel.app      # exactly the address you open the web app at
BETTER_AUTH_SECRET=<openssl rand -hex 32>
```

Nothing changes on Vercel: the web app proxies `/api/auth/*` to the server, cookies stay on the web app's domain. The gate is `apps/web/proxy.ts` plus the `(app)` layout, and the API checks the role behind every route; `MARROW_AUTH=off` in the web app's env removes sign-in (local development only — never on Vercel). Until `MARROW_WEB_URL` and `BETTER_AUTH_SECRET` are set, the server derives a secret from `MARROW_API_KEY` and trusts the web proxy's origin, so a fresh deploy can still sign in. Changing the secret signs everyone out once.

**Upgrading from the single-owner version:** nothing to do. Sign in with the existing account — an account without a workspace gets its personal one at sign-in, and the **first workspace created on an instance adopts the namespaces from before** — so the old library is right there. Invite the others from Settings afterwards.

`MARROW_API_KEY` stays the instance key for the CLI and operations; it acts in the workspace named by `x-marrow-org: <slug>`. People connecting Claude Code use their own key from Settings → API keys instead. Inbound e-mail routes to `INBOUND_EMAIL_NAMESPACE=<workspace-slug>/<namespace>`.

## Database migrations

The server applies pending Drizzle migrations (`packages/core/src/db/migrations/`) at boot, before it starts serving — a deploy that adds a table (e.g. `0003_expression_reviews`, `0004_review_context`) needs nothing from you. If a boot ever fails on a migration, the log names it; the previous container keeps running until the new one is healthy (`scripts/deploy-ec2.sh` waits for `/health`).

## Things that bite first-time AWS users

- **Only the Elastic IP is stable** — if you stop/start the instance without an EIP, the public IP changes.
- **Stopped instances still bill for EBS**; a terminated instance loses its disk (the corpus lives in RDS + S3, so that is fine — `.env` is the only thing to back up).
- **"no pg_hba.conf entry … no encryption"** means the client connected without TLS — RDS requires it. The app does this automatically; if you see it on an old image, add `?sslmode=require` to `DATABASE_URL` and rebuild.
- **RDS "Public access: No"** is correct; the box reaches it privately via the security group rule in step 3.5. If the server logs `ECONNREFUSED`/timeouts to the DB, that rule is missing.
- **YouTube blocks cloud IPs outright** ("Sign in to confirm you're not a bot") and its streams need yt-dlp's JS challenge solver. Both are handled — cookies file + Deno/Bun in the image — but the cookies are yours to export and refresh (see "YouTube blocks the server"). Emergency alternative: `bun run cli ingest …` from your Mac with the same `DATABASE_URL`/S3 settings — same code, home IP.
- **An IAM role is invisible from inside Docker until the metadata hop limit is 2** (instance → *Modify instance metadata options*). Symptom: role attached, still `Could not load credentials`.
- **1 GB is not enough.** A `t4g.micro` gets OOM-killed by its own image build; `t4g.small` + the 2 GB swap from step 5 is the floor.
- **A job stuck on "Queued"** means the worker tried and hit something before the first stage — `/health` (`storage`, `queue`) and the inbox card's *Reason:* line say what; the raw text is in `docker compose logs server`.
- When credits run out, the bill is the ~$40/mo above; nothing here needs a Savings Plan.
