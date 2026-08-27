#!/usr/bin/env bash
# (Re)start the offline stack the E2E tests run against: fake API on :3101 (fresh corpus) + web dev server on :3100.
# Playwright reuses these when they are up (reuseExistingServer), so iterations don't pay the boot cost.
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f "apps/server/src/index.ts" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 1
TMP=$(mktemp -d /tmp/marrow-e2e.XXXXXX)
LOG=${E2E_LOG_DIR:-$TMP}
MARROW_FAKE=1 MARROW_FAKE_SEED="${E2E_SEED:-1}" PORT=3101 STORAGE_DRIVER=local PGLITE_DIR="$TMP/pglite" LOCAL_STORAGE_DIR="$TMP/storage" WORK_DIR="$TMP/work" \
  POLL_EVERY_MINUTES=0 MARROW_API_KEY=e2e-key OPENAI_API_KEY=test DATABASE_URL= \
  nohup bun run apps/server/src/index.ts > "$LOG/api.log" 2>&1 &
( cd apps/web && MARROW_API_URL=http://localhost:3101 MARROW_API_KEY=e2e-key NEXT_PUBLIC_SITE_URL=http://localhost:3100 nohup bun run dev -- -p 3100 > "$LOG/web.log" 2>&1 & )
for i in $(seq 1 60); do curl -sf localhost:3101/health >/dev/null && curl -sf -o /dev/null localhost:3100/ && break; sleep 1; done
echo "e2e stack up — api :3101 (fake, $TMP), web :3100 — logs in $LOG"
