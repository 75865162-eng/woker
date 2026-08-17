#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-108.61.0.221}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_DIR="${SERVER_DIR:-/opt/amazon-ad-bulk-operation}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/codex_known_hosts}"
SOURCE_BRANCH="${SOURCE_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)}"
quoted_source_branch="$(printf "%q" "$SOURCE_BRANCH")"
quoted_source_commit="$(printf "%q" "$SOURCE_COMMIT")"

rsync -av --delete --no-owner --no-group \
  -e "ssh ${SSH_OPTS}" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=node_modules.* \
  --exclude=.next \
  --exclude=.next-* \
  --exclude=uploads \
  --exclude=coverage \
  --exclude=out \
  --exclude=build \
  --exclude=.env \
  --exclude=.env.* \
  ./ "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/"

ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_DIR} && SOURCE_BRANCH=${quoted_source_branch} SOURCE_COMMIT=${quoted_source_commit} bash scripts/server-native-release.sh"
