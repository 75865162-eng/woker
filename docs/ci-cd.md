# CI/CD 发布方案

本项目的默认发布链路是 CI 构建产物发布；三端对齐时也走同一条链路，不把 build 放回服务器：

1. 本地只提交代码到 GitHub / GitLab。
2. CI 机器执行 `npm ci`、`npm run lint`、`npm run build`。
3. CI 调用 `scripts/package-ci-artifact.sh` 打包已经构建好的 Next standalone 产物。
4. CI 上传 artifact 到服务器。
5. 服务器调用 `scripts/server-artifact-release.sh` 解压产物、执行 Prisma migrate、切换 release、重启 systemd。

服务器端只负责解压、切换 release、重启服务，不执行 `npm run build`。

## GitHub Secrets

生产部署需要配置：

- `PRODUCTION_SERVER_HOST`：生产服务器 IP，例如 `159.75.203.221`
- `PRODUCTION_SERVER_USER`：SSH 用户，例如 `ubuntu`
- `PRODUCTION_SERVER_DIR`：应用目录，例如 `/opt/amazon-ad-bulk-operation`
- `PRODUCTION_SSH_PRIVATE_KEY`：CI 用 SSH 私钥

服务器 `.env`、R2 密钥、数据库和 Redis 运行态配置仍保留在服务器，不进入 CI artifact。

## 发布方式

- PR / push：只构建和上传 artifact，不自动部署。
- 手动 `workflow_dispatch` 且 `deploy_production=true`：部署 CI 产物到生产。

`RUN_BOOTSTRAP_SEED` 默认是 `false`，普通部署不会重置管理员密码或重复写 bootstrap audit；只有初始化环境时才临时设为 `true`。

当前 workflow 的生产部署默认不在服务器执行 `npm run build`；如果后续确有服务器依赖安装的特殊需求，再单独约定，不作为常规路径。后续把 worker 预编译成 JS 后，可以进一步收紧服务器侧步骤。
