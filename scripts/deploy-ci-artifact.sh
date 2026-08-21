#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${1:-dist/amazon-ad-bulk-operation-release.tar.gz}"
SERVER_HOST="${SERVER_HOST:-159.75.203.221}"
SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_DIR="${SERVER_DIR:-/opt/amazon-ad-bulk-operation}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=no -o UserKnownHostsFile=/tmp/codex_known_hosts}"
SOURCE_BRANCH="${SOURCE_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)}"
REMOTE_ARTIFACT="/tmp/amazon-ad-bulk-operation-${SOURCE_COMMIT}.tar.gz"

if [ ! -f "$ARTIFACT_PATH" ]; then
  echo "Artifact not found: $ARTIFACT_PATH" >&2
  exit 1
fi

quoted_source_branch="$(printf "%q" "$SOURCE_BRANCH")"
quoted_source_commit="$(printf "%q" "$SOURCE_COMMIT")"
quoted_remote_artifact="$(printf "%q" "$REMOTE_ARTIFACT")"
quoted_install_deps="$(printf "%q" "${INSTALL_DEPS_ON_SERVER:-false}")"
quoted_run_bootstrap_seed="$(printf "%q" "${RUN_BOOTSTRAP_SEED:-false}")"

ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_HOST}" "mkdir -p ${SERVER_DIR}/scripts"

rsync -av --no-owner --no-group \
  -e "ssh ${SSH_OPTS}" \
  scripts/server-artifact-release.sh \
  "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/scripts/"

rsync -av --no-owner --no-group \
  -e "ssh ${SSH_OPTS}" \
  deploy docker-compose.yml \
  "${SERVER_USER}@${SERVER_HOST}:${SERVER_DIR}/"

scp ${SSH_OPTS} "$ARTIFACT_PATH" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_ARTIFACT}"

remote_release_command="cd ${SERVER_DIR} && SOURCE_BRANCH=${quoted_source_branch} SOURCE_COMMIT=${quoted_source_commit} INSTALL_DEPS_ON_SERVER=${quoted_install_deps} RUN_BOOTSTRAP_SEED=${quoted_run_bootstrap_seed} bash scripts/server-artifact-release.sh ${quoted_remote_artifact}"

if [ "$SERVER_USER" != "root" ]; then
  remote_release_command="cd ${SERVER_DIR} && sudo -n env SOURCE_BRANCH=${quoted_source_branch} SOURCE_COMMIT=${quoted_source_commit} INSTALL_DEPS_ON_SERVER=${quoted_install_deps} RUN_BOOTSTRAP_SEED=${quoted_run_bootstrap_seed} bash scripts/server-artifact-release.sh ${quoted_remote_artifact}"
fi

ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_HOST}" "$remote_release_command"
