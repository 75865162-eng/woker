#!/usr/bin/env bash
set -euo pipefail

cd /opt/amazon-ad-bulk-operation

APP_DIR="/opt/amazon-ad-bulk-operation"
RELEASES_DIR="/opt/amazon-ad-bulk-releases"
CURRENT_LINK="/opt/amazon-ad-bulk-current"
RELEASE_LOG="/opt/amazon-ad-bulk-release-log.jsonl"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SOURCE_BRANCH="${SOURCE_BRANCH:-unknown}"
SOURCE_COMMIT="${SOURCE_COMMIT:-unknown}"
release_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
release_stamp="$(date -u +"%Y%m%d-%H%M%S")"
safe_branch="$(printf '%s' "$SOURCE_BRANCH" | tr -c 'A-Za-z0-9._-' '-')"
release_id="${release_stamp}-${safe_branch}-${SOURCE_COMMIT}"
release_dir="${RELEASES_DIR}/${release_id}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_release_log() {
  local status="$1"
  local note="$2"
  local logged_at
  logged_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  mkdir -p "$(dirname "$RELEASE_LOG")"
  printf '{"time":"%s","status":"%s","releaseId":"%s","branch":"%s","commit":"%s","startedAt":"%s","note":"%s"}\n' \
    "$logged_at" \
    "$(json_escape "$status")" \
    "$(json_escape "$release_id")" \
    "$(json_escape "$SOURCE_BRANCH")" \
    "$(json_escape "$SOURCE_COMMIT")" \
    "$(json_escape "$release_started_at")" \
    "$(json_escape "$note")" >> "$RELEASE_LOG"
}

cleanup_failed_release() {
  if [ -n "${release_dir:-}" ] && [ -d "$release_dir" ]; then
    rm -rf "$release_dir"
  fi
}

trap 'write_release_log failed "release script exited before service switch"; cleanup_failed_release' ERR

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

mkdir -p "$RELEASES_DIR"
mkdir -p "$release_dir"

cp -a package.json package-lock.json tsconfig.json next.config.ts prisma.config.ts "$release_dir/"
cp -a src scripts prisma public "$release_dir/"
mkdir -p "$release_dir/.next-build"
cp -a .next-build/standalone "$release_dir/.next-build/standalone"
ln -sfn "$APP_DIR/node_modules" "$release_dir/node_modules"
ln -sfn "$APP_DIR/.env" "$release_dir/.env"
escaped_release_id="$(json_escape "$release_id")"
escaped_source_branch="$(json_escape "$SOURCE_BRANCH")"
escaped_source_commit="$(json_escape "$SOURCE_COMMIT")"
escaped_app_dir="$(json_escape "$APP_DIR")"
cat > "$release_dir/RELEASE.json" <<JSON
{
  "releaseId": "$escaped_release_id",
  "branch": "$escaped_source_branch",
  "commit": "$escaped_source_commit",
  "builtAt": "$release_started_at",
  "appDir": "$escaped_app_dir"
}
JSON

ln -sfn "$release_dir" "$CURRENT_LINK"

install -m 0644 deploy/systemd/amazon-web.service /etc/systemd/system/amazon-web.service
install -m 0644 deploy/systemd/amazon-worker.service /etc/systemd/system/amazon-worker.service
systemctl daemon-reload
systemctl enable amazon-web amazon-worker
systemctl restart amazon-web amazon-worker

sh deploy/caddy/run-caddy.sh

write_release_log deployed "services restarted successfully"

find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | awk "NR>${KEEP_RELEASES}" | while read -r old_release; do
  if [ "$(readlink -f "$CURRENT_LINK")" != "$(readlink -f "$old_release")" ]; then
    rm -rf "$old_release"
  fi
done

trap - ERR

systemctl --no-pager --full status amazon-web amazon-worker
docker compose ps
df -h /
echo "Current release: $release_id"
