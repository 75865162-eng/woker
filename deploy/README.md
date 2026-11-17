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
# 唯一运行环境源；已存在时禁止覆盖，不创建第二份 EnvironmentFile。
sudo install -d -m 755 /opt/amazon-ad-bulk-operation
sudo test ! -e /opt/amazon-ad-bulk-operation/.env
sudo install -m 600 deploy/production.env.example /opt/amazon-ad-bulk-operation/.env

# 一次性生成所有随机密钥（AUTH_SECRET / 三个 32 字节加密密钥 / DB 密码 / 管理员口令）
sudo npm run prod:env:init -- --output /opt/amazon-ad-bulk-operation/.env --apply
```

`production-env-init.mjs` 会替换模板里所有 `GENERATE:<字节数>:<编码>` 令牌，保留 `REPLACE:` 项供操作员填写，并强制 `0600`。**默认 dry-run，不加 `--apply` 不写文件；已存在文件时拒绝覆盖**（防止误轮换密钥导致已入库的 Amazon 凭据无法解密）。

必须填写的 `REPLACE:` 项：

| 键 | 来源 |
| --- | --- |
| `DATABASE_URL` / `REDIS_URL` | 按 docs/ci-cd.md 使用本机 Docker 的 loopback 地址；若另行批准托管实例则核对 TLS 与目标身份 |
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
sudo npm run prod:rotate-password -- --env-file /opt/amazon-ad-bulk-operation/.env --generate

# 实际轮换：更新 scrypt 口令哈希、吊销该用户全部会话、写审计、同步 EnvironmentFile
sudo npm run prod:rotate-password -- --env-file /opt/amazon-ad-bulk-operation/.env --generate --apply --update-env
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

### 非 root 账号与数据库角色（本地准备，真实环境尚未实施）

六个应用 unit 统一为 `User=amazon-erp` / `Group=amazon-erp`，不授 Docker/sudo 组，启用 `NoNewPrivileges`、清空 capabilities、`UMask=0077`。PID 1 从唯一根 `.env` 读取配置；文件保持 root:0600，不将数据库管理密钥文件放给运行账号。发布与迁移仍由获批准的运维身份执行，不将部署身份当成应用身份。

新机 bootstrap 调用 `deploy/systemd/prepare-runtime-user.sh --initialize` 创建非登录系统账号；已有主机必须先单独批准该初始化（不得重跑整个 bootstrap 变更主机）。常规 CI artifact 发布只校验已有账号，并在切换前准备当前新 release 的 `tmp`、Next image cache；代码和依赖继续由部署身份所有，不递归 chown。local 存储要求根 `.env` 中 `UPLOAD_DIR` 为绝对持久目录且运行账号可写；已有上传数据的属主/ACL 迁移需独立批准，脚本不接管已有数据。缺账号、不安全附加组、相对上传路径、旧 root unit 或 drop-in 覆盖均停止，不静默回退 root。

systemd 变更由 deployment-plan 的 `requiresRuntimeConfig` 安排，仍需 CI artifact 和人工部署审核。第一次切换前必须确认旧版回滚 unit：历史 root unit 将被新身份门禁拒绝，不能以自动回滚恢复 root；应事先审核保留非 root 配置的应用回退方案。上线后实际 UID/GID、可写路径、全部 Worker 消费、图片缓存和上传下载需要目标机器验收，仓库 unit 不能证明服务器已非 root。

**历史 root unit / drop-in 拒绝时的恢复路径（须独立批准，本轮未执行）：**

1. 发布检查 `systemctl show <service> --property=User/Group --value` 的合并结果；不是 `amazon-erp` 即返回 1，打印“拒绝启动非专用身份服务”，不执行该服务的 enable/restart。即便文件本身是非 root，root drop-in 也会被拒绝。
2. 若已切换后触发回滚，脚本先恢复共享配置与旧 current 链接，再安装旧 unit。历史 root unit 被身份门禁拒绝时，记录 `rollback_failed`、`RELEASE-RESULT.json` 中 `rollback.status=failed`，发布返回非零；不把仍运行新版本的进程视为已恢复。数据库始终 `not_rolled_back`。不得删除门禁或用手动 `User=root` 强启。
3. 运维先保留 `RELEASE-RESULT.json`、日志与当前 symlink/各服务 MainPID/cwd/User/Group 证据，确认是否有新旧混跑；按维护审批停止未通过验收的服务，避免继续消费或写入。不要删除 release、uploads、volumes，也不要回退数据库。
4. 如为意外 drop-in，由运维定位 `systemctl cat <service>` 的来源，审核并修正该覆盖项，保持专用账号及精确写路径；配置变更必须走受审查的 artifact/deployment-plan，不以 SSH patch 改仓库发布内容。
5. 恢复应用只使用预先审核、包含非 root unit 且数据库兼容的 CI artifact，基于已核实当前 release 重新生成部署计划。必要时将已审核旧版代码重新构建成新的 CI artifact，保留新非 root 运行配置；不得直接强行执行历史 root release。恢复后重新核验全部服务的身份/cwd、HTTP、队列消费、上传和图片缓存。离线测试已覆盖 root 拒绝及非 root 旧版恢复，但不替代这些实机步骤。

| 数据库身份/职责 | 所需操作与禁止项 | 验收门槛 |
|---|---|---|
| 迁移 owner / DBA | Prisma migration 的 schema DDL；只在获批维护/发布窗口使用 | 不用于常驻 web/worker；迁移凭证不下发应用进程 |
| web 应用登录 | 会话/组织与工作区授权读取，业务 API 对商品/凭据/任务/审计及 outbox 的事务读写；并非只读角色 | 无 superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS、无对象所有权/DDL、无危险成员关系；逐表/列按真实调用生成清单，禁止猜测全库 GRANT |
| 注册 Worker 应用登录 | import/product outbox 写入；Amazon/Sellfox 同步任务租约、快照与状态写入；image 文件/任务写入；forecast 预测结果写入，并读取对应实时授权与输入 | 当前统一 DATABASE_URL，未实现每 worker 独立 DSN；不得声称已分角色。共享角色需审核实际职责并集，进一步拆角色需另立配置契约 |
| amazon_mcp_ro / sellfox_mcp_ro | 各提供方当前表 SELECT，禁止跨池、写入、成员继承、函数与未来默认授权 | 见 docs/mcp-isolation-amazon-sellfox.md 的 DBA 事务脚本和两个实际登录审计 |

当前 bootstrap 的 `POSTGRES_USER` 是容器初始化管理身份，不是最小权限应用角色；不能把生成的默认 DATABASE_URL 作为最终验收。DBA 必须针对目标库确认应用调用对象、sequence 使用、事务/锁行为、PUBLIC/default ACL、所有权与成员闭包，制定精确授权清单，分离迁移身份后将根 `.env` 的 DATABASE_URL 切至验收过的应用登录。发布脚本在清单要求迁移时调用 `deploy/systemd/run-migration.mjs`，从同一根 `.env` 显式注入 `MIGRATION_DATABASE_URL`，要求主机/端口/库与应用连接一致且登录不同，仅对迁移子进程替换 DATABASE_URL；缺失、不一致或同登录均停止，禁止回退应用凭证。全部应用 unit 通过 UnsetEnvironment 移除 MIGRATION_DATABASE_URL/POSTGRES_PASSWORD；环境文件继续 root:0600。bootstrap 不猜测创建应用数据库角色，DBA 审阅精确授权和配置两身份仍是首发阻塞，不能为使发布通过而重新给应用角色 DDL。上述真实环境步骤均未执行，不能称数据库最小权限已落地。

HTTPS 由 `deploy/caddy/Caddyfile` + `deploy/caddy/run-caddy.sh`（Caddy 容器，host network）终结。HSTS 由 `ERP_HSTS_ENABLED=true` 开启，**只有在所有对外域名都正确配置有效 TLS 之后**才能开启，否则浏览器会被 HSTS 锁死在不可用状态。

`/api/health` 是唯一免登录探针，只返回 `{"status":"ok"}`，不查库、不暴露版本或租户信息。深度就绪检查请用 CLI（第 7 节）。

---

## 5. Amazon 真实凭据接入

环境文件填好 LWA 值只是第一步。系统强制「独立审批、禁止自批」，且卖家身份只能由 Amazon OAuth 确认。因此**不存在「填完凭据就自动全量同步」**。

```bash
# 预演：只打印计划，不发任何网络请求、不改任何数据
sudo npm run prod:onboard-amazon -- --env-file /opt/amazon-ad-bulk-operation/.env \
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
- 备份包含数据库；三个加密密钥、`/opt/amazon-ad-bulk-operation/.env`、`uploads/`（或 S3/R2 桶）必须**单独**备份。
- **数据库回滚需人工批准**：先停写入类 worker，确认备份可恢复，再执行 `pg_restore`，最后校验 migration 版本。CI 发布脚本不会、也不应该自动回滚数据库。
- 应用回滚由 `server-artifact-release.sh` 完成（切回上一个 release + 重启服务 + 恢复 Caddy 配置）。

---

## 7. 上线前检查清单

### 构建机资源与产物

生产构建应在 CI runner 完成；不要在生产服务器构建。Next.js 构建可能需要数 GB Node heap，构建机必须同时满足 Node heap 与系统可用内存要求。遇到 `Reached heap limit` 时，先确认没有其他 build/Next 进程占用同一输出目录，再在有足够物理内存的 runner 上重跑；不要在多个进程间共享 `.next-build`，也不要通过删除锁文件绕过仍在运行的构建。standalone 文件追踪应排除仓库中的其他 `.next-build*` 目录，避免把并行验证产物纳入 release trace。

CI 成功后需确认 artifact 中包含 `.next-build/standalone/server.js`、`.next-build/standalone/.next-build/BUILD_ID`、静态资源和 `public`。发布只能消费经过测试、打包与 release manifest 校验的 CI artifact。

### 持久文件存储

`STORAGE_DRIVER=local` 仅在所有 web/worker 主机都挂载同一持久卷至 `UPLOAD_DIR` 时可用；确认挂载路径、读写权限、备份与恢复均已实测。多主机部署应使用共享对象存储（如 S3/R2），并填好对应 endpoint、bucket、region 和凭据。容器/发布目录内的临时磁盘不满足持久化要求。

### 门禁命令

```bash
# 1) 部署包完整性（不连接数据库；build 产物必须先存在）
npm run check:deploy

# 2) 代码 / 构建 / 数据内部门禁
npm run check:production -- --gate code

# 3) 全量门禁：在服务器上用真实 EnvironmentFile 执行
sudo npm run check:production -- --env /opt/amazon-ad-bulk-operation/.env --gate full
# 或 systemd 已注入环境变量时：
sudo npm run check:production -- --env process --gate full
```

`check:deploy` 中 `build.standalone` 失败代表部署产物不完整，不能继续发布；`config.storage` 的 WARN 必须通过持久卷/对象存储配置和恢复演练关闭。`--gate deploy` 跳过数据库检查，不代表迁移已应用或数据库可用。`--gate full` 会连接指定数据库，执行前必须确认环境文件指向目标环境；不得将本地开发库结果当作生产验收。

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
