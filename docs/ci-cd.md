# CI/CD 发布方案

本项目保留原来的服务器源码发布脚本作为备用，同时新增 CI 构建产物发布路径：

1. GitHub Actions 执行 `npm ci`、`npm run lint`、`npm run build`。
2. CI 调用 `scripts/package-ci-artifact.sh` 打包已经构建好的 Next standalone 产物。
3. CI 上传 artifact 到服务器。
4. 服务器调用 `scripts/server-artifact-release.sh` 解压产物、执行 Prisma migrate、切换 release、重启 systemd。

服务器的 artifact 发布路径不执行 `npm run build`。

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

当前 workflow 在生产部署时设置 `INSTALL_DEPS_ON_SERVER=true`，允许服务器在 `package-lock.json` 变化时执行 `npm ci` 更新运行依赖；服务器仍不会执行 `npm run build`。后续把 worker 预编译成 JS 后，可以进一步移除服务器依赖安装步骤。
