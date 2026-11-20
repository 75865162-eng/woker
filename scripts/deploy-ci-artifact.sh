#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${1:-dist/amazon-ad-bulk-operation-release.tar.gz}"
RELEASE_CHECK_PATH="${RELEASE_CHECK_PATH:-$(dirname "$ARTIFACT_PATH")/release-check.json}"
SERVER_HOST="${SERVER_HOST:-123.207.47.225}"
SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_DIR="${SERVER_DIR:-/opt/amazon-ad-bulk-operation}"
SERVER_KEY="${SERVER_KEY:-}"
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=yes}"
if [ -n "$SERVER_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SERVER_KEY -o IdentitiesOnly=yes"
fi
SOURCE_BRANCH="${SOURCE_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)}"
SOURCE_COMMIT="${SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
REMOTE_ARTIFACT="/tmp/amazon-ad-bulk-operation-${SOURCE_COMMIT}.tar.gz"
REMOTE_RELEASE_SCRIPT="/tmp/amazon-ad-bulk-operation-server-artifact-release-${SOURCE_COMMIT}.sh"

if [ ! -f "$ARTIFACT_PATH" ]; then
  echo "Artifact not found: $ARTIFACT_PATH" >&2
  exit 1
fi

if [ ! -f "$RELEASE_CHECK_PATH" ]; then
  echo "Release check not found: $RELEASE_CHECK_PATH" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  artifact_sha256="$(shasum -a 256 "$ARTIFACT_PATH" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  artifact_sha256="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
else
  echo "Neither shasum nor sha256sum is available." >&2
  exit 1
fi
if ! node - "$RELEASE_CHECK_PATH" "$SOURCE_COMMIT" "$artifact_sha256" <<'NODE'
const fs = require("fs");
const [path, sourceCommit, artifactSha256] = process.argv.slice(2);
let data;
try {
  data = JSON.parse(fs.readFileSync(path, "utf8"));
} catch {
  console.error("Invalid release-check.json.");
  process.exit(1);
}
const passed = (value) => value === "passed";
// On the fast_deploy path lint/tests are honestly recorded as "skipped".
const passedOrSkipped = (value) => value === "passed" || value === "skipped";
const checks = data.checks || {};
const paths = checks.requiredPaths && checks.forbiddenPaths;
const digest = checks.sha256;
if (data.status !== "passed" || !sourceCommit || sourceCommit === "unknown" ||
    data.commit !== sourceCommit || data.expectedCommit !== sourceCommit ||
    !passed(data.build) || !passedOrSkipped(data.lint) || !passedOrSkipped(data.tests) ||
    digest !== true || checks.requiredPaths !== true || checks.forbiddenPaths !== true ||
    data.artifactSha256 !== artifactSha256) {
  console.error("release-check.json does not validate this artifact and commit.");
  process.exit(1);
}
NODE
then
  exit 1
fi

quoted_source_branch="$(printf "%q" "$SOURCE_BRANCH")"
quoted_source_commit="$(printf "%q" "$SOURCE_COMMIT")"
quoted_remote_artifact="$(printf "%q" "$REMOTE_ARTIFACT")"
quoted_remote_release_script="$(printf "%q" "$REMOTE_RELEASE_SCRIPT")"
quoted_artifact_sha256="$(printf "%q" "$artifact_sha256")"
quoted_install_deps="$(printf "%q" "${INSTALL_DEPS_ON_SERVER:-false}")"
quoted_run_bootstrap_seed="$(printf "%q" "${RUN_BOOTSTRAP_SEED:-false}")"
quoted_initial_deployment="$(printf "%q" "${INITIAL_DEPLOYMENT:-false}")"

scp ${SSH_OPTS} scripts/server-artifact-release.sh "${SERVER_USER}@${SERVER_HOST}:${REMOTE_RELEASE_SCRIPT}"
scp ${SSH_OPTS} "$ARTIFACT_PATH" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_ARTIFACT}"

# Print the running release before switching so operators can recover base_sha from CI logs.
ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_HOST}" "sudo -n cat /opt/amazon-ad-bulk-current/RELEASE.json 2>/dev/null || cat /opt/amazon-ad-bulk-current/RELEASE.json 2>/dev/null || echo '{\"commit\":null,\"note\":\"no current RELEASE.json\"}'"

remote_release_command="cd ${SERVER_DIR} && SOURCE_BRANCH=${quoted_source_branch} SOURCE_COMMIT=${quoted_source_commit} EXPECTED_ARTIFACT_SHA256=${quoted_artifact_sha256} INSTALL_DEPS_ON_SERVER=${quoted_install_deps} RUN_BOOTSTRAP_SEED=${quoted_run_bootstrap_seed} INITIAL_DEPLOYMENT=${quoted_initial_deployment} bash ${quoted_remote_release_script} ${quoted_remote_artifact}"

if [ "$SERVER_USER" != "root" ]; then
  remote_release_command="cd ${SERVER_DIR} && sudo -n env SOURCE_BRANCH=${quoted_source_branch} SOURCE_COMMIT=${quoted_source_commit} EXPECTED_ARTIFACT_SHA256=${quoted_artifact_sha256} INSTALL_DEPS_ON_SERVER=${quoted_install_deps} RUN_BOOTSTRAP_SEED=${quoted_run_bootstrap_seed} INITIAL_DEPLOYMENT=${quoted_initial_deployment} bash ${quoted_remote_release_script} ${quoted_remote_artifact}"
fi

ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_HOST}" "$remote_release_command"
