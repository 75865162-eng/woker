#!/usr/bin/env bash
# 仅由已批准的首次初始化或 CI artifact 发布调用；不连接数据库、不改写环境文件。
set -euo pipefail

prepare_runtime_user() {
  local mode="${1:-}" release="${2:-}" app="${3:-}" account uid groups upload driver directory
  [ "$(id -u)" = 0 ] || { echo '运行账号准备需要 root 运维权限。' >&2; return 1; }
  case "$mode" in --initialize|--prepare-release) ;; *) return 2 ;; esac
  if ! getent passwd amazon-erp >/dev/null; then
    [ "$mode" = --initialize ] || { echo '缺少 amazon-erp；需先批准首次账号初始化。' >&2; return 1; }
    useradd --system --user-group --home-dir /var/lib/amazon-erp --shell /usr/sbin/nologin amazon-erp
  fi
  account="$(getent passwd amazon-erp)"
  uid="$(id -u amazon-erp)"
  groups="$(id -Gn amazon-erp)"
  if [ "$uid" = 0 ] || [ "$groups" != amazon-erp ] || [ "$(printf '%s' "$account" | cut -d: -f6-)" != '/var/lib/amazon-erp:/usr/sbin/nologin' ]; then
    echo 'amazon-erp 身份、组、HOME 或 shell 不符合专用账号要求，停止发布。' >&2
    return 1
  fi
  if [ ! -e /var/lib/amazon-erp ]; then install -d -m 0700 -o amazon-erp -g amazon-erp /var/lib/amazon-erp; fi
  runuser -u amazon-erp -- test -w /var/lib/amazon-erp || return 1
  [ "$mode" = --prepare-release ] || return 0
  [ -d "$release" ] && [ -f "$app/.env" ] || return 1
  # systemd 由 PID 1 读取 root:0600 的唯一 .env；应用账号无需读取部署/数据库管理密钥。
  driver="$(node --env-file="$app/.env" -p 'process.env.STORAGE_DRIVER || "local"')"
  upload="$(node --env-file="$app/.env" -p 'process.env.UPLOAD_DIR || ""')"
  if [ "$driver" = local ]; then
    case "$upload" in /*) ;; *) echo '本地上传必须在根 .env 配置绝对持久 UPLOAD_DIR，不能落入 release。' >&2; return 1 ;; esac
    case "$(realpath -m "$upload")/" in "$(realpath -m "$(dirname "$release")")/"*|"$(realpath -m "$app")/"*) echo 'UPLOAD_DIR 不得在应用或 releases 目录内。' >&2; return 1 ;; esac
    # 不接管已有上传文件的所有权；已有数据的权限迁移必须独立批准。
    [ -e "$upload" ] || install -d -m 0700 -o amazon-erp -g amazon-erp "$upload"
    runuser -u amazon-erp -- test -w "$upload" || { echo '上传目录不可写；请单独审核已有数据权限迁移。' >&2; return 1; }
  fi
  for directory in "$release/tmp" "$release/.next-build/standalone/.next-build/cache"; do
    [ ! -L "$directory" ] || { echo '拒绝对符号链接运行目录改权限。' >&2; return 1; }
    install -d -m 0700 -o amazon-erp -g amazon-erp "$directory"
  done
  runuser -u amazon-erp -- test -r "$release/.next-build/standalone/server.js" || return 1
  runuser -u amazon-erp -- test -r "$release/node_modules/tsx/package.json" || return 1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then prepare_runtime_user "$@"; fi
