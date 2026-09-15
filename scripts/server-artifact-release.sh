#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/amazon-ad-bulk-operation}"
RELEASES_DIR="${RELEASES_DIR:-/opt/amazon-ad-bulk-releases}"
CURRENT_LINK="${CURRENT_LINK:-/opt/amazon-ad-bulk-current}"
RELEASE_LOG="${RELEASE_LOG:-/opt/amazon-ad-bulk-release-log.jsonl}"
VERSION_STATE_FILE="${VERSION_STATE_FILE:-/opt/amazon-ad-bulk-version.json}"
RELEASE_RESULT_FILE="${RELEASE_RESULT_FILE:-}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
SOURCE_BRANCH="${SOURCE_BRANCH:-unknown}"
SOURCE_COMMIT="${SOURCE_COMMIT:-unknown}"
EXPECTED_ARTIFACT_SHA256="${EXPECTED_ARTIFACT_SHA256:-}"
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

actual_artifact_sha256="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
if [ -n "$EXPECTED_ARTIFACT_SHA256" ] && [ "$actual_artifact_sha256" != "$EXPECTED_ARTIFACT_SHA256" ]; then
  echo "Artifact SHA256 verification failed." >&2
  exit 1
fi

release_started_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
release_stamp="$(date -u +"%Y%m%d-%H%M%S")"
safe_branch="$(printf '%s' "$SOURCE_BRANCH" | tr -c 'A-Za-z0-9._-' '-')"
release_id="${release_stamp}-${safe_branch}-${SOURCE_COMMIT}"
release_dir="${RELEASES_DIR}/${release_id}"
extract_dir="${release_dir}.extracting"
app_version_label=""
previous_release_dir=""
release_switched="false"

read_previous_version() {
  if [ -f "$VERSION_STATE_FILE" ]; then
    sed -n 's/.*"appVersion":"\([^"]*\)".*/\1/p' "$VERSION_STATE_FILE" | tail -n 1
  fi
}

next_version_label() {
  local current="${1:-}"
  if [[ "$current" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    local major="${BASH_REMATCH[1]}"
    local minor="${BASH_REMATCH[2]}"
    local patch="${BASH_REMATCH[3]}"
    echo "v${major}.${minor}.$((patch + 1))"
  else
    echo "v0.0.1"
  fi
}

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

write_release_result() {
  local result_path="$1"
  local status="$2"
  local failure_phase="$3"
  local rollback_status="$4"
  local rollback_release="$5"
  local error_message="$6"
  local health_status="$7"
  cat > "$result_path" <<JSON
{
  "status": "$(json_escape "$status")",
  "releaseId": "$(json_escape "$release_id")",
  "commit": "$(json_escape "$SOURCE_COMMIT")",
  "artifactSha256": "$actual_artifact_sha256",
  "healthUrl": "$(json_escape "${health_url:-}")",
  "health": "$(json_escape "$health_status")",
  "failurePhase": "$(json_escape "$failure_phase")",
  "rollback": {
    "status": "$(json_escape "$rollback_status")",
    "releaseId": "$(json_escape "$rollback_release")",
    "database": "not_rolled_back"
  },
  "error": "$(json_escape "$error_message")",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON
}

install_runtime_from_release() {
  local runtime_release="$1"
  install -m 0644 "$runtime_release/deploy/systemd/amazon-web.service" /etc/systemd/system/amazon-web.service
  install -m 0644 "$runtime_release/deploy/systemd/amazon-worker.service" /etc/systemd/system/amazon-worker.service
  install -m 0644 "$runtime_release/deploy/systemd/amazon-image-upscale-worker.service" /etc/systemd/system/amazon-image-upscale-worker.service
  systemctl daemon-reload
  systemctl enable amazon-web amazon-worker amazon-image-upscale-worker
  systemctl restart amazon-web amazon-worker amazon-image-upscale-worker
  sh "$runtime_release/deploy/caddy/run-caddy.sh"
}

rollback_application_release() {
  local failed_phase="$1"
  local failure_message="$2"
  local result_path="${RELEASE_RESULT_FILE:-$release_dir/RELEASE-RESULT.json}"
  local rollback_status="not_attempted"
  local rollback_release=""
  local rollback_health="not_checked"

  if [ ! -d "$release_dir" ]; then
    result_path="${RELEASE_RESULT_FILE:-$RELEASES_DIR/${release_id}.RELEASE-RESULT.json}"
  fi
  mkdir -p "$(dirname "$result_path")"

  if [ "$release_switched" != "true" ]; then
    cleanup_failed_release
    write_release_log failed "$failed_phase: $failure_message; database not rolled back"
    write_release_result "$result_path" "failed" "$failed_phase" "$rollback_status" "$rollback_release" "$failure_message" "failed"
    return 1
  fi

  if [ -z "$previous_release_dir" ] || [ ! -d "$previous_release_dir" ]; then
    rollback_status="unavailable"
    write_release_log failed "$failed_phase: $failure_message; no previous release available; database not rolled back"
    write_release_result "$result_path" "failed" "$failed_phase" "$rollback_status" "$rollback_release" "$failure_message" "failed"
    return 1
  fi

  rollback_release="$(basename "$previous_release_dir")"
  if ln -sfn "$previous_release_dir" "$CURRENT_LINK" \
    && install_runtime_from_release "$previous_release_dir" \
    && curl --fail --silent --show-error --max-time 15 "$health_url" >/dev/null; then
    rollback_status="succeeded"
    rollback_health="passed"
    write_release_log rolled_back "$failed_phase: $failure_message; application rolled back to $rollback_release; database not rolled back"
    write_release_result "$result_path" "failed" "$failed_phase" "$rollback_status" "$rollback_release" "$failure_message" "$rollback_health"
  else
    rollback_status="failed"
    rollback_health="failed"
    write_release_log rollback_failed "$failed_phase: $failure_message; application rollback to $rollback_release failed; database not rolled back"
    write_release_result "$result_path" "failed" "$failed_phase" "$rollback_status" "$rollback_release" "$failure_message" "$rollback_health"
  fi

  return 1
}

on_release_error() {
  local exit_code="$?"
  trap - ERR
  if [ "${release_switched:-false}" = "true" ] && [ -n "${health_url:-}" ]; then
    rollback_application_release "runtime_verification" "release command failed with exit code $exit_code" || true
  else
    rollback_application_release "pre_switch" "release command failed with exit code $exit_code" || true
  fi
  exit "$exit_code"
}

trap on_release_error ERR

cd "$APP_DIR"

docker compose up -d --remove-orphans postgres redis

mkdir -p "$RELEASES_DIR"
rm -rf "$extract_dir"
mkdir -p "$extract_dir"
tar -xzf "$ARTIFACT_PATH" -C "$extract_dir"

previous_version="$(read_previous_version)"
app_version_label="$(next_version_label "${previous_version:-}")"
previous_release_dir="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
health_url="${HEALTH_URL:-http://127.0.0.1:3000/login}"

if [ ! -d "$extract_dir/.next-build/standalone" ] || [ ! -f "$extract_dir/package-lock.json" ] || [ ! -f "$extract_dir/RELEASE-METADATA.json" ]; then
  echo "Artifact is not a complete release package." >&2
  exit 1
fi

metadata_commit="$(node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(data.commit || "")' "$extract_dir/RELEASE-METADATA.json")"
if [ "$SOURCE_COMMIT" != "unknown" ] && [ "$metadata_commit" != "$SOURCE_COMMIT" ]; then
  echo "Artifact commit does not match requested source commit." >&2
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
cp "$extract_dir/prisma.config.ts" "$APP_DIR/prisma.config.ts"
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
escaped_app_version_label="$(json_escape "$app_version_label")"
cat > "$extract_dir/RELEASE.json" <<JSON
{
  "releaseId": "$escaped_release_id",
  "branch": "$escaped_source_branch",
  "commit": "$escaped_source_commit",
  "builtAt": "$release_started_at",
  "artifactSha256": "$actual_artifact_sha256",
  "appVersion": "$escaped_app_version_label",
  "appDir": "$escaped_app_dir",
  "source": "ci-artifact"
}
JSON

cat > "$VERSION_STATE_FILE" <<JSON
{
  "appVersion": "$escaped_app_version_label",
  "releaseId": "$escaped_release_id",
  "updatedAt": "$release_started_at"
}
JSON

mv "$extract_dir" "$release_dir"
ln -sfn "$release_dir" "$CURRENT_LINK"
release_switched="true"
install_runtime_from_release "$release_dir"

if ! curl --fail --silent --show-error --max-time 15 "$health_url" >/dev/null; then
  trap - ERR
  rollback_application_release "health_check" "HTTP health check failed: $health_url"
  exit 1
fi

trap - ERR

web_status="$(systemctl is-active amazon-web 2>/dev/null || true)"
worker_status="$(systemctl is-active amazon-worker 2>/dev/null || true)"
image_worker_status="$(systemctl is-active amazon-image-upscale-worker 2>/dev/null || true)"
postgres_container="$(docker compose ps -q postgres)"
redis_container="$(docker compose ps -q redis)"
if [ -n "$postgres_container" ]; then
  postgres_status="$(docker inspect --format='{{.State.Status}}' "$postgres_container" 2>/dev/null || true)"
else
  postgres_status="missing"
fi
if [ -n "$redis_container" ]; then
  redis_status="$(docker inspect --format='{{.State.Status}}' "$redis_container" 2>/dev/null || true)"
else
  redis_status="missing"
fi
disk_available_kb="$(df -Pk / | awk 'NR == 2 {print $4}')"
runtime_status="passed"
if [ "$web_status" != "active" ] || [ "$worker_status" != "active" ] || [ "$image_worker_status" != "active" ] || [ "$postgres_status" != "running" ] || [ "$redis_status" != "running" ]; then
  runtime_status="failed"
fi
if [ "$runtime_status" != "passed" ]; then
  trap - ERR
  rollback_application_release "runtime_status" "one or more runtime services are not healthy"
  exit 1
fi
result_path="${RELEASE_RESULT_FILE:-$release_dir/RELEASE-RESULT.json}"
cat > "$result_path" <<JSON
{
  "status": "$runtime_status",
  "releaseId": "$(json_escape "$release_id")",
  "commit": "$(json_escape "$SOURCE_COMMIT")",
  "artifactSha256": "$actual_artifact_sha256",
  "healthUrl": "$(json_escape "$health_url")",
  "health": "passed",
  "rollback": {
    "status": "not_needed",
    "database": "not_rolled_back"
  },
  "services": {
    "amazon-web": "$(json_escape "$web_status")",
    "amazon-worker": "$(json_escape "$worker_status")",
    "amazon-image-upscale-worker": "$(json_escape "$image_worker_status")",
    "postgres": "$(json_escape "$postgres_status")",
    "redis": "$(json_escape "$redis_status")"
  },
  "diskAvailableKb": $disk_available_kb,
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
JSON

if [ "$runtime_status" = "passed" ]; then
  write_release_log deployed "artifact deployed and services restarted successfully"
else
  write_release_log failed "artifact passed HTTP health check but runtime status verification failed; database not rolled back"
fi

find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | awk "NR>${KEEP_RELEASES}" | while read -r old_release; do
  if [ "$(readlink -f "$CURRENT_LINK")" != "$(readlink -f "$old_release")" ]; then
    rm -rf "$old_release"
  fi
done

cat "$result_path"
echo "Current release: $release_id"
