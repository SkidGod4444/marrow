#!/usr/bin/env bash
# Deploy the latest `main` on the EC2 box: pull, rebuild the server image, restart, health-check.
# Run by the systemd timer (docker/marrow-deploy.timer) every minute; safe to run by hand (FORCE=1 to rebuild regardless).
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${DEPLOY_BRANCH:-main}"
COMPOSE="docker compose -f docker-compose.prod.yml"

git fetch --quiet origin "$BRANCH"
if [ "${FORCE:-0}" != "1" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ]; then
  echo "up to date ($(git rev-parse --short HEAD))"
  exit 0
fi
echo "deploying $(git rev-parse --short HEAD) → $(git rev-parse --short "origin/$BRANCH")"
git reset --hard --quiet "origin/$BRANCH"
export GIT_SHA="$(git rev-parse --short HEAD)"   # → MARROW_COMMIT in the image → GET /health {"commit"}
$COMPOSE up -d --build --remove-orphans
docker image prune -f >/dev/null

# Health: the server port isn't published on the host in production, so ask from inside the container.
for i in $(seq 1 30); do
  if $COMPOSE exec -T server curl -fsS http://localhost:3001/health >/dev/null 2>&1; then
    echo "healthy at $(git rev-parse --short HEAD)"
    $COMPOSE ps
    exit 0
  fi
  sleep 2
done
echo "server did not become healthy — recent logs:" >&2
$COMPOSE logs --tail=40 server >&2
exit 1
