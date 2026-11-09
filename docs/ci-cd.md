# CI/CD 发布方案

执行规则：服务器发布只走现有 CI artifact 流程并独立审批；下方迁移的服务器清单保留数据保护约束，机器状态须本次只读核验。迁移、依赖安装与基础设施更新按 deployment-plan 按需执行；当前应用发布统一切换全部四类注册 Worker，纯文档不发布应用。不使用 SSH 补丁或源码同步绕过 CI。

本项目的默认发布链路是 CI 构建产物发布；三端对齐时也走同一条链路，不把 build 放回服务器：

1. 本地只提交代码到 GitHub / GitLab。
2. CI 机器执行 `npm ci`、`npm run test`、`npm run lint`、`npm run build`。
3. CI 调用 `scripts/package-ci-artifact.sh` 打包已经构建好的 Next standalone 产物。
4. CI 调用 `scripts/release-check.sh`，生成机器可读的 `release-manifest.json` 和 `release-check.json`。
5. CI 上传 artifact 和 manifest 到发布系统。
6. 服务器校验 artifact SHA256 后调用 `scripts/server-artifact-release.sh` 解压产物、按清单决定是否执行 Prisma migrate、切换 release 并重启相应 systemd 服务。

服务器端只负责下载、校验、解压、迁移、切换 release、重启服务和本机 HTTP 健康检查，不执行 `npm run build`。发布完成后只输出 `RELEASE-RESULT.json` 摘要；如果切换后的应用无法通过健康检查，会只回滚应用代码、current symlink、systemd 进程和 Caddy 配置，不回滚数据库 migration。

当前 worker 仍以 `tsx scripts/*.ts` 运行，因此第一阶段 artifact 仍保留 worker 所需的 `src/`、`scripts/` 和 Prisma 文件；这些目录不是 Web standalone 的重复依赖。后续 worker 预编译为 JS 后，再进一步删除这部分源码。

artifact 不包含完整项目工作区、`node_modules/`、`.git/`、`coverage/`、`tests/`、`.next/`、`.next-dev/`、`uploads/` 或 `.env`。Web standalone 内部的 traced `node_modules` 也会被删除，生产服务器使用共享的、按 `package-lock.json` SHA 校验的 `node_modules`。

## GitHub Secrets

生产部署需要配置：

- `PRODUCTION_SERVER_HOST`：部署服务器 IP，例如 `123.207.47.225`
- `PRODUCTION_SERVER_USER`：SSH 用户，例如 `ubuntu`
- `PRODUCTION_SERVER_DIR`：应用目录，例如 `/opt/amazon-ad-bulk-operation`
- `PRODUCTION_SSH_PRIVATE_KEY`：CI 用 SSH 私钥

服务器 `.env`、R2 密钥、数据库和 Redis 运行态配置仍保留在服务器，不进入 CI artifact。

## 发布方式

- PR / push：只构建和上传 artifact，不自动部署。
- 手动 `workflow_dispatch` 且 `deploy_production=true`：部署 CI 产物到生产。

`RUN_BOOTSTRAP_SEED` 默认是 `false`，普通部署不会重置管理员密码或重复写 bootstrap audit；只有初始化环境时才临时设为 `true`。

常规发布默认不在服务器执行 `npm run build`，也不主动执行 `npm ci`。如果 `package-lock.json` 发生变化，必须显式允许服务器依赖安装；依赖未变化时服务器只执行 artifact 发布步骤。后续把 worker 预编译成 JS 后，可以进一步收紧服务器侧步骤。

## Ubuntu 首次安装

新建 Ubuntu 24.04 主机时，先通过 SSH 运行 `sudo bash scripts/bootstrap-server.sh`。脚本安装 Node.js 22、Docker Compose 和 UFW，限制应用端口到 localhost，仅开放 SSH/HTTP/HTTPS；仅在 `.env` 不存在时创建独立数据库密码和 `AUTH_SECRET`。初始管理员密码保存在 `/root/amazon-ad-bulk-credentials.txt`，不得提交到 GitHub。

之后通过 CI 的 `workflow_dispatch` 构建并部署，显式启用 `initial_deployment`、`install_dependencies` 并审核部署计划。首发会在新主机创建全新 PostgreSQL/Redis volumes，应用完整迁移，创建管理员并启动 systemd workers。没有前版 release 时只接受显式首发标记；已有 release 仍必须满足 base commit 校验。

默认 `docker-compose.yml` 只管理 PostgreSQL/Redis。HTTP 入口由 Caddy 容器反代；初装默认访问 `http://123.207.47.225/`。新机使用本地 `uploads/`，不复制旧数据库、上传文件、R2 凭据或 Docker volumes。导入文件因此只保存在新主机，后续切换对象存储时应配置独立的 R2/S3 凭据和迁移流程。


<!-- AGENTS migration 2026-11-08: original lines 253-316 -->
## 服务器部署与更新规则

本节承接原 AGENTS.md 的服务器操作约束。执行前阅读本文件；历史服务器状态须重新只读核验，不代表本次授权。

生产服务器当前资源较紧，部署时必须先按磁盘空间规划，避免把本地开发产物、旧修复目录或 Docker 构建缓存带上服务器。

- 更新服务器前必须先执行完整改动区盘点：用 `git status --short` 确认所有已修改、已删除和未跟踪改动；只要这些改动属于本次要上线的工作范围，就必须全部纳入 GitHub 同步、artifact 打包和服务器发布，不能只发布当前聊天窗口或当前 agent 修改的文件。
- 如果发现改动区里有不确定是否该上线的内容，先向用户说明文件清单和风险并等待确认；不要静默跳过，也不要用局部打包、局部 rsync 或局部提交制造本地、GitHub、服务器三端不一致。
- 新部署目标服务器 IP：`123.207.47.225`。
- SSH 用户：`ubuntu`。
- 默认服务器目录：`/opt/amazon-ad-bulk-operation`。
- 新部署访问地址：`http://123.207.47.225`（HTTP 未加密；仅用于用户明确要求的 IP 临时入口）。
- 旧服务器 `159.75.203.221` 与 `https://aecob.com` 仍在独立运行，保留原有数据库和 R2 数据；新服务器为空库，不自动迁移或同步旧主机数据。不要将两端误认为同一数据集，也不要未经明确要求关闭旧服务器或修改 DNS。
- 服务器系统：Ubuntu 24.04 LTS x64。
- 生产架构：PostgreSQL 和 Redis 使用 Docker；Next web 和 worker 使用服务器本机 Node.js + systemd；Caddy 使用 Docker 反代到本机 web。
- Docker Compose 只管理 infra：`postgres`、`redis`。不要再为普通代码更新执行 `docker compose up -d --build web worker`。
- systemd 服务：`amazon-web`、`amazon-worker`、`amazon-image-upscale-worker`、`amazon-sync-worker`、`amazon-sellfox-sync-worker`。
- UFW 必须允许 `22/tcp`、`80/tcp`、`443/tcp`；`3000`、`5432`、`6379` 不开放公网。
- Caddy 证书和配置使用 Docker volumes `amazon-caddy-data`、`amazon-caddy-config` 持久化；不要无备份删除这些 volumes。
- 服务器 `.env` 路径：`/opt/amazon-ad-bulk-operation/.env`。这里保存 `AUTH_SECRET`、管理员 bootstrap 配置、R2/S3 配置等敏感运行环境变量。
- 管理员登录信息保存位置：`/root/amazon-ad-bulk-credentials.txt`。不要把密码写入仓库文档。
- 旧服务器文件存储：Cloudflare R2，`STORAGE_DRIVER=r2`，bucket 为 `amazon-bulk-uploads`。新空库服务器首次安装使用独立 local uploads；切换 R2 必须另行配置目标环境密钥和明确对象数据范围。R2/S3 密钥只允许写在服务器 `.env` 或受控密钥管理中，不要提交到仓库或写入文档。
- 本地开发可继续使用 `STORAGE_DRIVER=local` 和 `uploads/`。更新生产系统时，不要把本地 local uploads 覆盖到服务器，也不要把生产 R2 设置改回 local。
- 部署同步必须排除大目录和历史产物：`.git`、`node_modules`、`node_modules.*`、`.next`、`.next-*`、`uploads`、`coverage`、`out`、`build`。
- 项目目录里曾出现过 `node_modules.broken-audit-fix-*`、`.next-build.broken-*`、`.next-build-stale-*` 等历史目录；这些目录绝不能同步到服务器。
- 不要使用会把整个本地工作区无差别覆盖到服务器的命令。同步前先确认排除规则；文件传输只能服务于已批准的 CI artifact 发布，不允许工作区源码 rsync 发布。
- 服务器上的 `.env`、Docker volumes、`uploads` 属于运行态数据；除非用户明确要求，不要删除或覆盖。
- PostgreSQL 和 Redis 只绑定 `127.0.0.1:5432`、`127.0.0.1:6379`，不要暴露公网端口。
- 生产 `.env` 中 `DATABASE_URL` 应指向 `127.0.0.1:5432`，`REDIS_URL` 应指向 `127.0.0.1:6379`。
- 本机生产进程必须使用 `npm run build` 后的 standalone 输出，web 启动命令是 `npm run start:standalone`，不要用 `npm run dev` 跑公网。
- 全新 Ubuntu 24.04 主机先运行 `sudo bash scripts/bootstrap-server.sh`，再通过 workflow_dispatch 显式启用 `initial_deployment=true` 和 `install_dependencies=true`。该脚本生成独立 `.env` 与管理员初始密码文件；首发执行迁移、管理员 seed，并启用 systemd workers。
- worker 由 systemd 执行 `npm run worker`。服务器发布脚本会用 `node_modules/.package-lock.sha256` 判断依赖是否变化；`package-lock.json` 未变时跳过 `npm ci`。
- 仓库不保留应用 Dockerfile；生产应用进程只走本机 Node.js + systemd。不要为 web/worker 恢复 Docker build，除非用户明确要求重新容器化。
- 发布最高原则：根据实际改动按需迁移和重启。禁止每次发布默认迁移数据库、重启全部 worker、重建 Caddy 或更新 infra。
- CI 使用明确的 BASE_SHA 与目标 commit 生成 `deployment-plan.json`，随校验产物发布；服务器核对 headSha 与产物一致、baseSha 与当前线上 RELEASE.json 的 commit 一致。清单缺失、字段无效或基线不一致时停止，不默认全量操作。
- 仅文档改动只同步 GitHub；当前 `scripts/deployment-plan.mjs` 对应用发布安排 web 和全部四类已登记 Worker 切换新 release。不得沿用历史按入口选择性重启规则；依赖、迁移、配置和 infra 仍按清单按需执行。
- 仅 Prisma schema、migration 或依赖锁文件变化才执行服务器 Prisma generate；仅 migration 变化才执行 migrate deploy。schema 变化缺少配套 migration 时禁止发布，迁移必须人工审核。服务器 npm ci 仍需锁文件变化和明确安装授权。
- systemd、Caddy 和 Docker infra 分别按清单更新；发布脚本和基础设施变化必须人工审核并显式确认。普通发布不执行 bootstrap seed 或商品维护脚本，不触碰 .env、上传文件或 volumes。
- 服务器校验 CI artifact SHA256、按清单执行必要操作、生成 release、切换 current symlink、健康检查并记录结果；不执行 Next standalone build。失败只回滚应用及本次涉及的运行配置，不自动回滚数据库。
- 发布产物目录：`/opt/amazon-ad-bulk-releases/<timestamp>-<branch>-<commit>`。
- 当前发布版本软链接：`/opt/amazon-ad-bulk-current`。web 和 worker 均从此链接启动；应用发布按当前清单切换全部已登记 Worker；清理时仍必须保留被任何进程使用的版本目录。
- 发布记录文件：`/opt/amazon-ad-bulk-release-log.jsonl`。每次部署和回滚都应追加记录。
- release 目录只保存运行所需的 standalone、源码、脚本、Prisma 和 public；`node_modules` 通过 symlink 共享 `/opt/amazon-ad-bulk-operation/node_modules`，避免复制大依赖。
- 默认只保留最近 5 个 release。可通过服务器环境变量 `KEEP_RELEASES` 临时调整；不要为了省空间删除当前 release 或 Docker volumes。
- 小盘服务器上如果历史 Docker build cache 占用过高，可在服务启动并验证通过后运行 `docker builder prune -af`；不要清理 Docker volumes。
- 每次部署后优先读取 release 目录中的 `RELEASE-RESULT.json`；只有摘要显示失败时，再检查 `df -h /`、`docker compose ps`、`systemctl status amazon-web amazon-worker` 和 `journalctl -u amazon-web -u amazon-worker -n 100 --no-pager`。
- 发布失败时只允许回滚应用代码、current symlink、systemd 进程和 Caddy 配置；数据库 migration 只向前执行，不自动执行 `migrate down`、删表或恢复数据库。`RELEASE-RESULT.json` 必须明确记录 `database: not_rolled_back`。

推荐更新流程（只使用 GitHub Actions CI artifact 发布）：

```bash
# 先盘点完整改动区，确认范围并提交、推送。
# base_sha 必须来自当前线上 RELEASE.json 的 commit。
gh workflow run ci-cd.yml --ref main -f base_sha=<线上commit> -f deploy_production=true
# 涉及发布脚本/基础设施：审核后追加 -f deployment_reviewed=true
```

GitHub CI 负责测试、lint、build、打包和 release-check；本机不重复生产构建，服务器只接收校验产物按清单发布。普通发布不运行 bootstrap seed；初始化需单独授权。

服务器发布只使用现有 CI artifact 链路；旧 ssh patch、源码发布和本机／服务器构建旁路不再作为有效路径。CI 失败应修复 CI。

不再引用已不存在的源码发布脚本。CI 失败不得改成本机或服务器构建；本文件不提供应急旁路授权。迁移结果读取发布摘要确认，不为验证重复执行迁移。
