#!/usr/bin/env bash
set -euo pipefail

cd /opt/amazon-ad-bulk-operation

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 22 before running this release script." >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 22 ]; then
  echo "Node.js 22 or newer is required. Current: $(node -v)" >&2
  exit 1
fi

docker compose up -d --remove-orphans postgres redis

package_lock_checksum="$(sha256sum package-lock.json | awk '{print $1}')"
cached_package_lock_checksum="$(cat node_modules/.package-lock.sha256 2>/dev/null || true)"

if [ ! -d node_modules ] || [ "$package_lock_checksum" != "$cached_package_lock_checksum" ]; then
  npm ci
  echo "$package_lock_checksum" > node_modules/.package-lock.sha256
else
  echo "package-lock.json unchanged; skipping npm ci."
fi

npm run db:generate
npm run db:migrate
node --env-file=.env scripts/seed-admin.mjs
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=768 npm run build
rm -rf .next-build/standalone/.next-build/server .next-build/standalone/.next-build/static
cp -a .next-build/server .next-build/standalone/.next-build/server
cp -a .next-build/static .next-build/standalone/.next-build/static
cp -a public .next-build/standalone/public

install -m 0644 deploy/systemd/amazon-web.service /etc/systemd/system/amazon-web.service
install -m 0644 deploy/systemd/amazon-worker.service /etc/systemd/system/amazon-worker.service
systemctl daemon-reload
systemctl enable amazon-web amazon-worker
systemctl restart amazon-web amazon-worker

sh deploy/caddy/run-caddy.sh

systemctl --no-pager --full status amazon-web amazon-worker
docker compose ps
df -h /
