#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/amazon-ad-bulk-operation}"
RELEASES_DIR="${RELEASES_DIR:-/opt/amazon-ad-bulk-releases}"
CURRENT_LINK="${CURRENT_LINK:-/opt/amazon-ad-bulk-current}"
RELEASE_LOG="${RELEASE_LOG:-/opt/amazon-ad-bulk-release-log.jsonl}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SOURCE_BRANCH="${SOURCE_BRANCH:-unknown}"
SOURCE_COMMIT="${SOURCE_COMMIT:-unknown}"
INSTALL_DEPS_ON_SERVER="${INSTALL_DEPS_ON_SERVER:-false}"
RUN_BOOTSTRAP_SEED="${RUN_BOOTSTRAP_SEED:-false}"
ARTIFACT_PATH="${1:-}"

if [ -z "$ARTIFACT_PATH" ]; then
  echo "Usage: $0 <artifact.tar.gz>" >&2
  exit 1
fi

if [ ! -f "$ARTIFACT_PATH" ]; then
  echo "Artifact not found: $ARTIFACT_PATH" >&2
  exit 1
fi

release_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
release_stamp="$(date -u +"%Y%m%d-%H%M%S")"
safe_branch="$(printf '%s' "$SOURCE_BRANCH" | tr -c 'A-Za-z0-9._-' '-')"
release_id="${release_stamp}-${safe_branch}-${SOURCE_COMMIT}"
release_dir="${RELEASES_DIR}/${release_id}"
extract_dir="${release_dir}.extracting"

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
  if [ -n "${extract_dir:-}" ] && [ -d "$extract_dir" ]; then
    rm -rf "$extract_dir"
  fi
}

trap 'write_release_log failed "artifact release failed before service switch"; cleanup_failed_release' ERR

cd "$APP_DIR"

docker compose up -d --remove-orphans postgres redis

mkdir -p "$RELEASES_DIR"
rm -rf "$extract_dir"
mkdir -p "$extract_dir"
tar -xzf "$ARTIFACT_PATH" -C "$extract_dir"

if [ ! -d "$extract_dir/.next-build/standalone" ] || [ ! -f "$extract_dir/package-lock.json" ]; then
  echo "Artifact is not a complete release package." >&2
  exit 1
fi

package_lock_checksum="$(sha256sum "$extract_dir/package-lock.json" | awk '{print $1}')"
cached_package_lock_checksum="$(cat "$APP_DIR/node_modules/.package-lock.sha256" 2>/dev/null || true)"

if [ ! -d "$APP_DIR/node_modules" ] || [ "$package_lock_checksum" != "$cached_package_lock_checksum" ]; then
  if [ "$INSTALL_DEPS_ON_SERVER" != "true" ]; then
    echo "Server node_modules do not match artifact package-lock.json." >&2
    echo "Set INSTALL_DEPS_ON_SERVER=true to allow npm ci on the server, or update dependencies before deploying." >&2
    exit 1
  fi

  cp "$extract_dir/package.json" "$APP_DIR/package.json"
  cp "$extract_dir/package-lock.json" "$APP_DIR/package-lock.json"
  npm ci
  echo "$package_lock_checksum" > "$APP_DIR/node_modules/.package-lock.sha256"
fi

cp "$extract_dir/package.json" "$APP_DIR/package.json"
cp "$extract_dir/package-lock.json" "$APP_DIR/package-lock.json"
rm -rf "$APP_DIR/prisma" "$APP_DIR/scripts" "$APP_DIR/deploy"
cp -a "$extract_dir/prisma" "$APP_DIR/prisma"
cp -a "$extract_dir/scripts" "$APP_DIR/scripts"
cp -a "$extract_dir/deploy" "$APP_DIR/deploy"
cp "$extract_dir/docker-compose.yml" "$APP_DIR/docker-compose.yml"

npm run db:generate
npm run db:migrate

if [ "$RUN_BOOTSTRAP_SEED" = "true" ]; then
  node --env-file="$APP_DIR/.env" scripts/seed-admin.mjs
else
  echo "Skipping bootstrap admin seed. Set RUN_BOOTSTRAP_SEED=true to run it."
fi

ln -sfn "$APP_DIR/node_modules" "$extract_dir/node_modules"
ln -sfn "$APP_DIR/.env" "$extract_dir/.env"

escaped_release_id="$(json_escape "$release_id")"
escaped_source_branch="$(json_escape "$SOURCE_BRANCH")"
escaped_source_commit="$(json_escape "$SOURCE_COMMIT")"
escaped_app_dir="$(json_escape "$APP_DIR")"
cat > "$extract_dir/RELEASE.json" <<JSON
{
  "releaseId": "$escaped_release_id",
  "branch": "$escaped_source_branch",
  "commit": "$escaped_source_commit",
  "builtAt": "$release_started_at",
  "appDir": "$escaped_app_dir",
  "source": "ci-artifact"
}
JSON

mv "$extract_dir" "$release_dir"
ln -sfn "$release_dir" "$CURRENT_LINK"

install -m 0644 "$release_dir/deploy/systemd/amazon-web.service" /etc/systemd/system/amazon-web.service
install -m 0644 "$release_dir/deploy/systemd/amazon-worker.service" /etc/systemd/system/amazon-worker.service
systemctl daemon-reload
systemctl enable amazon-web amazon-worker
systemctl restart amazon-web amazon-worker

sh "$release_dir/deploy/caddy/run-caddy.sh"

write_release_log deployed "artifact deployed and services restarted successfully"

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
