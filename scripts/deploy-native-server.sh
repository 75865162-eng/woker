#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-108.61.0.221}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_DIR="${SERVER_DIR:-/opt/amazon-ad-bulk-operation}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/codex_known_hosts}"

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

ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_HOST}" "cd ${SERVER_DIR} && bash scripts/server-native-release.sh"
