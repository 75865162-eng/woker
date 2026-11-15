# 生产部署与上线手册

本目录是**运维资产**，不是发布链路。应用发布**只允许**走既有 CI artifact 流程，详见 [`docs/ci-cd.md`](../docs/ci-cd.md)。禁止在服务器上执行 `npm run build`、禁止用 SSH 补丁或源码同步绕过 CI。

---

## 1. 发布链路（唯一入口）

| 阶段 | 脚本 | 位置 |
| --- | --- | --- |
| 首次装 Ubuntu 24.04 主机 | `scripts/bootstrap-server.sh` | 服务器，sudo 执行一次 |
| CI 构建与测试 | `npm ci`、`npm run test`、`npm run lint`、`npm run build` | CI |
| 打包 standalone 产物 | `scripts/package-ci-artifact.sh` | CI |
| 生成发布清单 | `scripts/release-check.sh` → `release-manifest.json` / `release-check.json` | CI |
| 部署产物、迁移、切换 release、健康检查 | `scripts/server-artifact-release.sh` | 服务器 |
| 人工审核部署计划 | `scripts/deployment-plan.mjs` | CI / 审批 |
| 日常部署调用 | `scripts/deploy-ci-artifact.sh` | CI |

发布失败时脚本只回滚**应用代码 / current symlink / systemd 进程 / Caddy 配置**，**不回滚数据库 migration**——数据库回滚必须走第 6 节的人工流程。

> 注意：本机开发环境（Docker Desktop + `127.0.0.1:5432/6379`）**不是生产环境**，其数据库含不可删除的 append-only 合成证据，**严禁**把该库或该 `.env` 直接搬上生产。生产必须使用全新数据库。

---

## 2. 环境文件与密钥

生产由 systemd `EnvironmentFile` 注入环境变量，`ERP_RUNTIME_MODE=production` 时运行时**不会再读取项目根 `.env`**。因此：

```bash
# 在服务器上，文件放在 release 目录之外
sudo install -d -m 700 /etc/tiaotiao
sudo install -m 600 deploy/production.env.example /etc/tiaotiao/erp.env

# 一次性生成所有随机密钥（AUTH_SECRET / 三个 32 字节加密密钥 / DB 密码 / 管理员口令）
sudo npm run prod:env:init -- --output /etc/tiaotiao/erp.env --apply
```

`production-env-init.mjs` 会替换模板里所有 `GENERATE:<字节数>:<编码>` 令牌，保留 `REPLACE:` 项供操作员填写，并强制 `0600`。**默认 dry-run，不加 `--apply` 不写文件；已存在文件时拒绝覆盖**（防止误轮换密钥导致已入库的 Amazon 凭据无法解密）。

必须填写的 `REPLACE:` 项：

| 键 | 来源 |
| --- | --- |
| `DATABASE_URL` / `REDIS_URL` | 生产托管实例，必须非 loopback，建议 TLS |
| `POSTGRES_DB` / `POSTGRES_USER` | 同上 |
| `BOOTSTRAP_ORG_*` / `BOOTSTRAP_ADMIN_EMAIL` | 公司信息与管理邮箱 |
| `LILI_PUBLIC_ORIGIN` | 对外 HTTPS 域名，无尾斜杠 |
| `AMAZON_SP_API_LWA_*` | Seller Central 的 LWA 应用凭据 |
| `AMAZON_ADS_LWA_*` / `AMAZON_ADS_OAUTH_REDIRECT_URI` | Amazon Ads 应用 |
| `AMAZON_SP_API_ALLOWED_ORGANIZATION_ID` / `_WORKSPACE_ID` | 首次登录后在系统内读取 |
| `AMAZON_SYNC_CENTER_SCOPES` | `[["组织ID","工作区ID"]]`，启用同步中心试点 |

**关键门禁**：`AMAZON_API_EXECUTION_ROLE` 必须是 `cloud`。设为 `local` 会关闭官方 SP-API / Ads 的 OAuth、读取、报表下载与任务分发，只保留本地副本查询——配了凭据也不会同步。

`AMAZON_FBA_REMOTE_EXECUTION_ENABLED` 与 `AMAZON_ADS_EXECUTION_ENABLED` 保持 `false`：真实写操作需要另行审批的云执行 rollout、作用域策略与独立审批，本轮范围不包含。

**加密密钥备份**：三个 `*_ENCRYPTION_KEY` 必须与数据库备份分开保管且永不轮换。丢失后已入库的 Amazon / Sellfox 凭据将永久无法解密。

---

## 3. 管理员账号与口令

模板中 `BOOTSTRAP_ADMIN_PASSWORD` 已由 `prod:env:init` 生成 24 字节随机值；**本地开发用的 `1 / 123` 绝不能进入生产**。

首次安装时 CI 的 `RUN_BOOTSTRAP_SEED=true` 只在初始化时执行一次，普通发布不会重置密码。之后如需轮换：

```bash
# 预演（不连库、不改文件）
sudo npm run prod:rotate-password -- --env-file /etc/tiaotiao/erp.env --generate

# 实际轮换：更新 scrypt 口令哈希、吊销该用户全部会话、写审计、同步 EnvironmentFile
sudo npm run prod:rotate-password -- --env-file /etc/tiaotiao/erp.env --generate --apply --update-env
```

脚本拒绝 <12 位或常见弱口令，且只在 `--apply` 时写库。新口令**只打印一次**，请立即存入密码管理器。轮换后重启 web 服务使 EnvironmentFile 生效。

---

## 4. systemd 服务与 HTTPS

`deploy/systemd/` 中的单元由 `bootstrap-server.sh` / `server-artifact-release.sh` 安装：

| 单元 | 脚本 |
| --- | --- |
| `amazon-web.service` | `start:standalone`（`127.0.0.1:3000`） |
| `amazon-worker.service` | `worker:import` |
| `amazon-sync-worker.service` | `worker:amazon-sync` |
| `amazon-sellfox-sync-worker.service` | `worker:sellfox-sync` |
| `amazon-image-upscale-worker.service` | `worker:image-upscale` |
| `amazon-forecast-worker.service` | `worker:forecast`（本轮补齐，与 `worker-manager.mjs --list` 的 5 个注册项对齐） |

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now amazon-web amazon-worker amazon-sync-worker \
  amazon-sellfox-sync-worker amazon-image-upscale-worker amazon-forecast-worker
sudo systemctl status amazon-web --no-pager
curl -fsS https://erp.example.com/api/health      # -> {"status":"ok"}
```

HTTPS 由 `deploy/caddy/Caddyfile` + `deploy/caddy/run-caddy.sh`（Caddy 容器，host network）终结。HSTS 由 `ERP_HSTS_ENABLED=true` 开启，**只有在所有对外域名都正确配置有效 TLS 之后**才能开启，否则浏览器会被 HSTS 锁死在不可用状态。

`/api/health` 是唯一免登录探针，只返回 `{"status":"ok"}`，不查库、不暴露版本或租户信息。深度就绪检查请用 CLI（第 7 节）。

---

## 5. Amazon 真实凭据接入

环境文件填好 LWA 值只是第一步。系统强制「独立审批、禁止自批」，且卖家身份只能由 Amazon OAuth 确认。因此**不存在「填完凭据就自动全量同步」**。

```bash
# 预演：只打印计划，不发任何网络请求、不改任何数据
sudo npm run prod:onboard-amazon -- --env-file /etc/tiaotiao/erp.env \
  --base-url https://erp.example.com \
  --workspace-id <ws> --seller-account-id <seller> --marketplace-id ATVPDKIKX0DER \
  --amazon-seller-id <真实 Seller ID> --grant-user-id <user>

# 实际执行：必须提供两个不同管理员的会话 Cookie
sudo npm run prod:onboard-amazon -- ... \
  --requester-cookie 'amazon_bulk_ad_session=...' \
  --approver-cookie  'amazon_bulk_ad_session=...' --apply
```

脚本对每个变更走真实三步链：`POST /api/operations/sync-center`（202 申请）→ 审批人 `APPROVED` → 申请人 `APPLY`。顺序为：

1. `save-authorization`：LWA 凭据加密入库，创建 SP-API 授权
2. `save-access-grant`：给指定用户授予店铺/站点数据访问
3. 逐项 `save-source`：启用白名单数据域（`orders` / `finance` / `catalog` / `inventory` / `sales_traffic` / `settlements` 等）
4. 可选 `--allow-live-validation`：`validate-authorization`，**会真实调用 Amazon**
5. 打印 Amazon OAuth 同意链接，**必须由操作员在浏览器完成**（10 分钟有效）

脚本**不直接写数据库、不伪造 `identityVerifiedAt`**。Seller ID 与参与站点的身份证据只能来自官方 OAuth / API 返回。Ads 侧还需独立在「设置 → 集成 → Amazon Ads」完成 OAuth，并在 profiles 页确认 profile 已同步。

同步触发需要：常驻 `amazon-sync` worker（Redis 队列）、已启用的数据源、站点归属确认、以及手动或计划任务触发；同步范围是白名单资源域，不是「所有数据」。

---

## 6. 备份、恢复与回滚

```bash
# 立即做一次校验过的备份（只读检查用 --dry-run）
sudo node scripts/runtime/backup-postgres.mjs --apply --directory=/var/backups/amazon-erp

# 定时备份（默认不自动启用，需独立审批后 enable）
sudo systemctl enable --now amazon-postgres-backup.timer
```

- 备份目录必须位于仓库之外的绝对路径，脚本会校验 `0700/0600`、SHA-256 与可恢复性。
- 备份包含数据库；三个加密密钥、`/etc/tiaotiao/erp.env`、`uploads/`（或 S3/R2 桶）必须**单独**备份。
- **数据库回滚需人工批准**：先停写入类 worker，确认备份可恢复，再执行 `pg_restore`，最后校验 migration 版本。CI 发布脚本不会、也不应该自动回滚数据库。
- 应用回滚由 `server-artifact-release.sh` 完成（切回上一个 release + 重启服务 + 恢复 Caddy 配置）。

---

## 7. 上线前检查清单

```bash
# 1) 部署包完整性（不连数据库，CI/本机都能跑，应 ready=true）
npm run check:deploy

# 2) 代码 / 构建 / 数据内部门禁
npm run check:production -- --gate code

# 3) 全量门禁：在服务器上用真实 EnvironmentFile 执行
sudo npm run check:production -- --env /etc/tiaotiao/erp.env --gate full
# 或 systemd 已注入环境变量时：
sudo npm run check:production -- --env process --gate full
```

`--gate full` 的 `ready=true` 只代表**配置侧**就绪，还必须完成：

- [ ] 真实 Amazon 账号 OAuth 授权完成，`AmazonSellerIdentity` 有记录
- [ ] `AmazonSpApiAuthorization` 为 `CONFIGURED` 且 `identityVerifiedAt` 非空
- [ ] 数据访问授予、启用的同步数据源、站点绑定均已核对
- [ ] 5 个 worker 心跳在线，队列积压正常
- [ ] 手动触发一次小范围同步，核验落库数据与官方返回一致
- [ ] Ads profile / reporting 已在真实账号验收
- [ ] HTTPS 证书、HSTS、登录、CSRF、限流、备份恢复演练全部实测
- [ ] 全新数据库，无本地合成业务数据（`db.clean` 通过）

**无法在本侧完成的项**：真实 Amazon 凭据与账号授权、生产 DB/Redis、域名与证书、以及真实 Amazon 端到端验收。这些必须由操作员提供；任何脚本都不会用 mock 或伪造记录冒充真实验收。

---

## 8. 本轮新增的安全边界

| 项 | 位置 |
| --- | --- |
| 生产环境 `AUTH_SECRET` 缺失/占位时 fail closed（middleware 与 session 一致） | `middleware.ts`、`src/lib/auth/session.ts` |
| 生产环境 `BOOTSTRAP_ADMIN_EMAIL` 未配置时拒绝回退到 `1` | `src/lib/auth/constants.ts` |
| Cookie 会话的跨站写请求 CSRF 拦截（`Origin` / `Sec-Fetch-Site`），Bearer MCP/OAuth 不受影响 | `src/lib/auth/csrf.ts`、`middleware.ts` |
| 登录失败限流（Redis 共享计数 + 进程内兜底，8 次/账号 / 30 次/IP / 15 分钟） | `src/lib/auth/login-rate-limit.ts` |
| 安全响应头 `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Permissions-Policy` / 可选 HSTS | `next.config.ts` |
| 免登录存活探针 `/api/health` | `src/app/api/health/route.ts` |
