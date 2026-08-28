# Deploying Marrow — web on Vercel, API on AWS (step by step)

Two deployables:

- **Web app (`apps/web`) → Vercel.** Pure Next.js; talks to the API over HTTPS with the owner key from its env. Nothing else.
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

1. **EC2** → *Launch instance*: name `marrow`, AMI **Ubuntu Server 24.04 LTS (arm64)**, instance type **t4g.medium** (2 vCPU / 4 GB — ffmpeg needs it). Key pair: *Create new* `marrow-key` (.pem) — download and keep it.
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
# Code
sudo apt-get install -y git && git clone https://github.com/<you>/marrow.git && cd marrow
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
BETTER_AUTH_SECRET=<openssl rand -hex 32>    # signs login sessions; changing it signs the owner out once
INBOUND_EMAIL_TOKEN=<openssl rand -hex 24>   # only if you wire inbound email (docs/CAPTURE.md §3)
MARROW_API_DOMAIN=api.marrow.yourdomain.com
```

**S3 credentials without keys (recommended):** EC2 → the instance → *Actions → Security → Modify IAM role* → create a role `marrow-ec2` with an inline policy allowing `s3:GetObject, s3:PutObject, s3:DeleteObject, s3:ListBucket` on your bucket (and `arn:...:bucket/*`). The AWS SDK inside the server container picks the role up automatically — leave `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` empty. (Fallback: IAM → Users → create `marrow-s3` with the same policy → access key → put the pair in `.env`.)

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
   - `NEXT_PUBLIC_SITE_URL` = `https://marrow.yourdomain.com` (optional; falls back to the Vercel production URL)
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
- **YouTube may throttle yt-dlp from EC2 IPs.** If ingests fail at the fetch stage, run `bun run cli ingest …` from your Mac with the same `DATABASE_URL`/S3 settings — the pipeline is the same code and writes to the same place.
- When credits run out, the bill is the ~$40/mo above; nothing here needs a Savings Plan.
