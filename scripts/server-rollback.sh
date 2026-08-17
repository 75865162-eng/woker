#!/usr/bin/env bash
set -euo pipefail

RELEASES_DIR="/opt/amazon-ad-bulk-releases"
CURRENT_LINK="/opt/amazon-ad-bulk-current"
RELEASE_LOG="/opt/amazon-ad-bulk-release-log.jsonl"
TARGET="${1:-previous}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

log_rollback() {
  local status="$1"
  local release_id="$2"
  local note="$3"
  local logged_at
  logged_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '{"time":"%s","status":"%s","releaseId":"%s","note":"%s"}\n' \
    "$logged_at" \
    "$(json_escape "$status")" \
    "$(json_escape "$release_id")" \
    "$(json_escape "$note")" >> "$RELEASE_LOG"
}

if [ ! -d "$RELEASES_DIR" ]; then
  echo "No releases directory found: $RELEASES_DIR" >&2
  exit 1
fi

current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

if [ "$TARGET" = "previous" ]; then
  target_dir="$(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | while read -r release; do
    if [ "$(readlink -f "$release")" != "$current_target" ]; then
      echo "$release"
      break
    fi
  done)"
else
  target_dir="$RELEASES_DIR/$TARGET"
fi

if [ -z "${target_dir:-}" ] || [ ! -d "$target_dir" ]; then
  echo "Rollback target not found: $TARGET" >&2
  exit 1
fi

if [ ! -f "$target_dir/package.json" ] || [ ! -d "$target_dir/.next-build/standalone" ]; then
  echo "Rollback target is not a complete release: $target_dir" >&2
  exit 1
fi

ln -sfn "$target_dir" "$CURRENT_LINK"
systemctl restart amazon-web amazon-worker

release_id="$(basename "$target_dir")"
log_rollback rolled_back "$release_id" "services restarted after rollback"

systemctl is-active amazon-web amazon-worker
echo "Rolled back to: $release_id"
