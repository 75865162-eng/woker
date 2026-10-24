# CI/CD 发布方案

本项目的默认发布链路是 CI 构建产物发布；三端对齐时也走同一条链路，不把 build 放回服务器：

1. 本地只提交代码到 GitHub / GitLab。
2. CI 机器执行 `npm ci`、`npm run test`、`npm run lint`、`npm run build`。
3. CI 调用 `scripts/package-ci-artifact.sh` 打包已经构建好的 Next standalone 产物。
4. CI 调用 `scripts/release-check.sh`，生成机器可读的 `release-manifest.json` 和 `release-check.json`。
5. CI 上传 artifact 和 manifest 到发布系统。
6. 服务器校验 artifact SHA256 后调用 `scripts/server-artifact-release.sh` 解压产物、执行 Prisma migrate、切换 release、重启 systemd。

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
