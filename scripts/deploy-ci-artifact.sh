#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_PATH="${1:-dist/amazon-ad-bulk-operation-release.tar.gz}"
RELEASE_CHECK_PATH="${RELEASE_CHECK_PATH:-$(dirname "$ARTIFACT_PATH")/release-check.json}"
SERVER_HOST="${SERVER_HOST:-123.207.47.225}"
SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_DIR="${SERVER_DIR:-/opt/amazon-ad-bulk-operation}"
SERVER_KEY="${SERVER_KEY:-}"
# 默认连接参数与 CI 保持一致：建立 10s×3=30s 内失败，静默 15s×2=30s 判定挂死，
# BatchMode 禁止交互口令。CI 会以同名 SSH_OPTS 覆盖本默认值。
SSH_OPTS="${SSH_OPTS:--o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=3 -o ServerAliveInterval=15 -o ServerAliveCountMax=2}"
if [ -n "$SERVER_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SERVER_KEY -o IdentitiesOnly=yes"
fi

# 部署加速：GitHub Actions 的 runner 在境外，到国内服务器的 SSH/TCP 握手常因跨境链路
# 抖动反复重试——历史上一个仅 32MB 的 artifact 因为「scp 脚本 + scp 包 + ssh」三次
# 独立连接累计卡了约 33 分钟（服务器端实际部署只用 ~70s）。
# 用 ControlMaster 建立一条长连接，让后续所有 scp/ssh 复用它：跨境握手只做一次。
# scp 加 -C 打开压缩，进一步降低跨境传输体积。
CONTROL_SOCKET="/tmp/woker-deploy-$$-${RANDOM}.sock"
SSH_OPTS="$SSH_OPTS -o ControlMaster=auto -o ControlPath=$CONTROL_SOCKET -o ControlPersist=600"
# 只清理本地 socket 文件；SSH 主连接由 ControlPersist=600 到期自动回收
# （CI runner 本身就是临时的）。这里刻意不调用 ssh -O exit：部署脚本的契约测试
# 会 mock ssh 为非零退出，trap 里再调 ssh 会覆盖真正的命令退出码。
cleanup_control_socket() {
  rm -f "$CONTROL_SOCKET"
}
trap cleanup_control_socket EXIT

# 阶段化日志：每个跨境网络操作前打印带时间戳的阶段标记，避免长时间无反馈盲等。
# 采用 UTC 时间，与 CI 日志时间轴一致。
deploy_stage() {
  printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}
# 单次网络操作硬上限：防止 scp/ssh 在链路半开时无限挂起（ServerAlive 之外再兜一层）。
# 测试环境（契约测试 mock scp/ssh 为 shell 函数）下跳过 timeout 包装：
# timeout 会 fork 新进程而看不到 shell 函数，直接调用才能保留 mock 语义。
SSH_CMD_TIMEOUT="${SSH_CMD_TIMEOUT:-1800}"
run_ssh() {
  if [ "${NODE_ENV:-}" != "test" ] && command -v timeout >/dev/null 2>&1; then
    timeout "$SSH_CMD_TIMEOUT" ssh "$@"
  else
    ssh "$@"
  fi
}
run_scp() {
  if [ "${NODE_ENV:-}" != "test" ] && command -v timeout >/dev/null 2>&1; then
    timeout "$SSH_CMD_TIMEOUT" scp -C "$@"
  else
    scp "$@"
  fi
}
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

# 阶段1：传输发布脚本（复用 ControlMaster 主连接，scp -C 压缩）。
deploy_stage "上传发布脚本 -> ${SERVER_HOST}"
run_scp ${SSH_OPTS} scripts/server-artifact-release.sh "${SERVER_USER}@${SERVER_HOST}:${REMOTE_RELEASE_SCRIPT}"

# 阶段2：传输产物。合并到同一主连接，避免跨境二次握手。
deploy_stage "上传发布产物 ($(du -h "$ARTIFACT_PATH" | awk '{print $1}')) -> ${SERVER_HOST}"
run_scp ${SSH_OPTS} "$ARTIFACT_PATH" "${SERVER_USER}@${SERVER_HOST}:${REMOTE_ARTIFACT}"

# 读旧 release 与执行发布合并为一次 ssh：切换前打印当前 commit 便于从 CI 日志恢复 base_sha。
# 这样把跨境往返从 4 次（scp+scp+ssh读+ssh执行）降到 3 次。
read_current_release="echo '[deploy] 当前生产版本:'; sudo -n cat /opt/amazon-ad-bulk-current/RELEASE.json 2>/dev/null || cat /opt/amazon-ad-bulk-current/RELEASE.json 2>/dev/null || echo '{\"commit\":null,\"note\":\"no current RELEASE.json\"}'; echo '[deploy] 开始原子发布与验收:'"

remote_release_command="cd ${SERVER_DIR} && ${read_current_release} SOURCE_BRANCH=${quoted_source_branch} SOURCE_COMMIT=${quoted_source_commit} EXPECTED_ARTIFACT_SHA256=${quoted_artifact_sha256} INSTALL_DEPS_ON_SERVER=${quoted_install_deps} RUN_BOOTSTRAP_SEED=${quoted_run_bootstrap_seed} INITIAL_DEPLOYMENT=${quoted_initial_deployment} bash ${quoted_remote_release_script} ${quoted_remote_artifact}"

if [ "$SERVER_USER" != "root" ]; then
  remote_release_command="cd ${SERVER_DIR} && ${read_current_release} sudo -n env SOURCE_BRANCH=${quoted_source_branch} SOURCE_COMMIT=${quoted_source_commit} EXPECTED_ARTIFACT_SHA256=${quoted_artifact_sha256} INSTALL_DEPS_ON_SERVER=${quoted_install_deps} RUN_BOOTSTRAP_SEED=${quoted_run_bootstrap_seed} INITIAL_DEPLOYMENT=${quoted_initial_deployment} bash ${quoted_remote_release_script} ${quoted_remote_artifact}"
fi

# 阶段3：服务器端原子发布 + 健康检查 + 运行时状态验收（最长 SSH_CMD_TIMEOUT）。
deploy_stage "服务器端原子发布与验收开始"
run_ssh ${SSH_OPTS} "${SERVER_USER}@${SERVER_HOST}" "$remote_release_command"
deploy_stage "服务器端发布完成"
