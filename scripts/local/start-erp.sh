#!/usr/bin/env bash
# BOX LOCAL ONLY — do not deploy.
set -euo pipefail
cd "$(dirname "$0")/../.."
export NODE_ENV=development
export PORT="${PORT:-3000}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
# ensure redis/pg if already initialized by prior session
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes --port 6379
pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 || true
exec node --env-file=.env scripts/next-run.mjs .next-dev dev --turbopack -H "$HOSTNAME" -p "$PORT"
