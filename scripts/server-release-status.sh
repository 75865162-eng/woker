#!/usr/bin/env bash
set -euo pipefail

RELEASES_DIR="/opt/amazon-ad-bulk-releases"
CURRENT_LINK="/opt/amazon-ad-bulk-current"
RELEASE_LOG="/opt/amazon-ad-bulk-release-log.jsonl"

current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

if [ -n "$current_target" ] && [ -f "$current_target/RELEASE.json" ]; then
  echo "Current release:"
  cat "$current_target/RELEASE.json"
else
  echo "Current release: unavailable"
fi

echo
echo "Recent releases:"
if [ -d "$RELEASES_DIR" ]; then
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r | head -10 | while read -r release; do
    marker=""
    if [ "$(readlink -f "$release")" = "$current_target" ]; then
      marker=" current"
    fi
    echo "- $(basename "$release")${marker}"
  done
else
  echo "- none"
fi

echo
echo "Recent log entries:"
if [ -f "$RELEASE_LOG" ]; then
  tail -10 "$RELEASE_LOG"
else
  echo "none"
fi
