# Deploying Marrow on AWS (first-time AWS, step by step)

Target (docs/STACK.md): **one EC2 instance** running docker-compose (server + web + Caddy), **RDS PostgreSQL** with pgvector, **one S3 bucket**. ≈ $40/month, all credit-eligible. No ALB, NAT Gateway, ECS, Aurora, CloudFront, or Route 53 needed.

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

## 4. Point the subdomain at the box (5 min + DNS propagation)

At your domain registrar's DNS panel (wherever `yourdomain.com` lives — not AWS):

- Add an **A record**: name `marrow` (→ `marrow.yourdomain.com`), value = the Elastic IP, TTL 300.

Caddy inside the compose stack will obtain the HTTPS certificate automatically once the name resolves. (`dig marrow.yourdomain.com` should print the Elastic IP.)

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
DATABASE_URL=postgres://marrow:<RDS_PASSWORD>@<RDS_ENDPOINT>:5432/marrow
STORAGE_DRIVER=s3
S3_BUCKET=marrow-<something-unique>
S3_REGION=<your region>
OPENAI_API_KEY=sk-...
MARROW_API_KEY=<openssl rand -hex 24>
MARROW_DOMAIN=marrow.yourdomain.com
```

**S3 credentials without keys (recommended):** EC2 → the instance → *Actions → Security → Modify IAM role* → create a role `marrow-ec2` with an inline policy allowing `s3:GetObject, s3:PutObject, s3:DeleteObject, s3:ListBucket` on your bucket (and `arn:...:bucket/*`). The AWS SDK inside the server container picks the role up automatically — leave `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` empty. (Fallback: IAM → Users → create `marrow-s3` with the same policy → access key → put the pair in `.env`.)

## 6. Launch

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f server   # wait for "marrow server on ..."
```

Then:
- `https://marrow.yourdomain.com` → the web app (library).
- `https://marrow.yourdomain.com/api/v1/health` → `{"ok":true}` (REST is under `/api/v1/`, MCP at `/mcp`).
- Claude Code: `claude mcp add --transport http marrow https://marrow.yourdomain.com/mcp --header "x-api-key: <MARROW_API_KEY>"`.

Updating: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

## 7. Things that bite first-time AWS users

- **Only the Elastic IP is stable** — if you stop/start the instance without an EIP, the public IP changes.
- **Stopped instances still bill for EBS**; a terminated instance loses its disk (the corpus lives in RDS + S3, so that is fine — `.env` is the only thing to back up).
- **RDS "Public access: No"** is correct; the box reaches it privately via the security group rule in step 3.5. If the server logs `ECONNREFUSED`/timeouts to the DB, that rule is missing.
- **YouTube may throttle yt-dlp from EC2 IPs.** If ingests fail at the fetch stage, run `bun run cli ingest …` from your Mac with the same `DATABASE_URL`/S3 settings — the pipeline is the same code and writes to the same place.
- When credits run out, the bill is the ~$40/mo above; nothing here needs a Savings Plan.
