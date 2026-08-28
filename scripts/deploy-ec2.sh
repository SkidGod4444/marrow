#!/usr/bin/env bash
# Deploy the latest `main` on the EC2 box: pull, rebuild the images, restart, health-check.
# Run by the systemd timer (docker/marrow-deploy.timer) every minute; safe to run by hand (FORCE=1 to rebuild regardless).
#
# What was deployed successfully is remembered in .deployed (a commit hash), not inferred from HEAD: a build that fails
# leaves .deployed alone, so the next timer run tries again (after a short back-off) instead of reporting "up to date".
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${DEPLOY_BRANCH:-main}"
COMPOSE="docker compose -f docker-compose.prod.yml"
MARK=.deployed
FAILMARK=.deploy-failed

git fetch --quiet origin "$BRANCH"
TARGET=$(git rev-parse "origin/$BRANCH")
DEPLOYED=$(cat "$MARK" 2>/dev/null || echo none)
if [ "${FORCE:-0}" != "1" ] && [ "$TARGET" = "$DEPLOYED" ]; then
  echo "up to date ($(git rev-parse --short "$TARGET"))"
  exit 0
fi
# A failed deploy of this very commit is retried every 15 minutes, not every minute.
if [ "${FORCE:-0}" != "1" ] && [ -f "$FAILMARK" ]; then
  read -r FAILED_SHA FAILED_AT < "$FAILMARK" || true
  if [ "${FAILED_SHA:-}" = "$TARGET" ] && [ $(( $(date +%s) - ${FAILED_AT:-0} )) -lt 900 ]; then
    echo "deploy of $(git rev-parse --short "$TARGET") failed recently; retrying after 15 min"
    exit 0
  fi
fi
echo "deploying $(git rev-parse --short "${DEPLOYED#none}" 2>/dev/null || echo none) → $(git rev-parse --short "$TARGET")"
git reset --hard --quiet "$TARGET"
export GIT_SHA="$(git rev-parse --short HEAD)"   # → MARROW_COMMIT in the image → GET /health {"commit"}
if ! $COMPOSE up -d --build --remove-orphans; then
  echo "$TARGET $(date +%s)" > "$FAILMARK"
  echo "build or start failed for $GIT_SHA" >&2
  exit 1
fi

# Health: the server port isn't published on the host in production, so ask from inside the container.
for i in $(seq 1 30); do
  if $COMPOSE exec -T server curl -fsS http://localhost:3001/health >/dev/null 2>&1; then
    echo "$TARGET" > "$MARK"
    rm -f "$FAILMARK"
    echo "healthy at $GIT_SHA"
    $COMPOSE ps
    # Old images and build layers pile up on a 30 GB disk; keep a few GB of cache for fast rebuilds.
    docker image prune -f >/dev/null
    docker builder prune -f --keep-storage 3GB >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done
echo "$TARGET $(date +%s)" > "$FAILMARK"
echo "server did not become healthy — recent logs:" >&2
$COMPOSE logs --tail=40 server >&2
exit 1
