# 生产级部署前验收与 Runbook（2026-11-15 状态快照）

> 范围：按「生产级部署前」执行核对与准备。不推翻架构、不重复审计、不伪造或 Mock 数据、不覆盖已有改动、不执行 `git reset` / `git clean`。所有结论以代码与实库为准，未验证的部分明确标注。
>
> 本文已纳入版本库 `docs/pre-deploy-acceptance-2026-11-15.md`，查阅入口见 `AGENTS.md`「按任务查阅」表。

## 0. 文档定位与时效（入库新增）

| 项 | 说明 |
|---|---|
| 用途 | 上线前检查清单、环境与密钥清单、验收矩阵、回滚要点、明确不宣称清单 |
| 权威关系 | **实际发布只走 GitHub Actions CI artifact + systemd，以 `docs/ci-cd.md` 与 `scripts/deployment-plan.mjs` 为准**。第 5 节是核对顺序，不构成 SSH 手工部署授权 |
| 时效 | 迁移数量、DDL 违规数、磁盘、HEAD、构建日志、空模块数量均为 2026-11-15 实测快照；改代码前以当前代码、目标库实库与 CI 日志重新核验 |
| 不随仓库分发 | 原稿 `output/承接池定义审计与修改规划_2026-11-14.md`（历史审计报告）、`logs/prod-build-clean.log`、干净检出目录 `deploy-verify/` 都在 `woker` 仓库之外；CI 上以自身构建日志为准。本文结论已自包含，不依赖这些文件 |
| 本机构建验证的定位 | 4.1 的 `BUILD_EXIT=0` 是本机隔离验证，**不替代生产 CI 的构建证据**；`AGENTS.md` 第 128 行明确 CI artifact 发布的生产构建在 CI 执行 |

### 0.1 与仓库内权威文档的一致性核对（入库新增）

| 仓库内事实 | 结论 |
|---|---|
| `.github/workflows/ci-cd.yml` 第 137 行 `npm run build` | CI 直接执行 `npm run build` → `node scripts/next-run.mjs .next-build build`，**不调用 `docker build`** |
| `Dockerfile` 被 `git ls-files` 跟踪，三阶段 COPY `.next-build/standalone` | 文件存在，但**不是当前发布链路**。`docs/ci-cd.md` 第 82 行「仓库不保留应用 Dockerfile」与 `git ls-files` 事实不符，应理解为策略表述（禁止为 web/worker 恢复 Docker build）；发布链路约束仍以 `docs/ci-cd.md` 为准 |
| `docs/ci-cd.md` 第 83 / 86 行 | 禁止每次发布默认迁移数据库、默认重启全部 worker；仅 migration 变化才 `migrate deploy`。第 5 节第 3 步须服从此约束 |
| `docs/ci-cd.md` 第 85 行 | 仅文档改动只同步 GitHub，不发布应用 |
| `.dockerignore` | 排除 `.next-*` 与 `.env` / `.env.*`；历史产物与密钥不进镜像的结论成立 |
| `AGENTS.md` 第 140–141 行 | 服务器发布只走 CI artifact + deployment-plan；禁止 ssh patch、源码 rsync、本机或服务器构建旁路 |

**因此**：本机 Windows file-tracing 缺陷与历史 `.next-*` 目录不构成生产 CI 的阻塞（CI 是干净 checkout），但也不等于生产构建已验证；生产 `BUILD_EXIT=0` 仍须在 CI 上取得。

## 1. 代码基线（实测快照）

| 项 | 结果 |
|---|---|
| 仓库 | `woker`（本机路径 `C:/Users/jingbao12/Desktop/条条/woker`，不随仓库分发） |
| 基线 HEAD | `7cee92bedfbd375d765783eaa816741f2b126404`，为**本文入库前**的快照，不是当前 HEAD |
| 当时工作区 | `git status --short` 为空 |
| 当时远端 `ssh` 分支 | `main d9949c62`、`tiaotiao-erp 7cee92b`、`codex/amazon-multistore-mcp 75c2af2` |
| **风险** | 本地 `wimoor` 分支 upstream 指向 `ssh/wimoor`，该远端分支已不存在，`git branch -vv` 误导显示 `ahead 4`。推送/部署必须显式指定 `ssh tiaotiao-erp`，或先把 upstream 改为 `ssh/tiaotiao-erp` |

## 2. 新增发现：本机磁盘才是当时构建阻塞主因

此前仓库外审计报告 12.8.1 把生产构建卡住归因于 Next 15.5 的 Windows `combinedExcludes` glob 缺陷。实测把该结论补充并修正：

| 层次 | 实测事实 |
|---|---|
| 磁盘 | C 盘总 223.3 GB，可用 **0 字节**（`fsutil volume diskfree` 显示可用 -4.6 MB、存储保留 1.1 GB）。Bash/构建工具因 `ENOSPC` 直接无法启动 |
| 历史构建产物 | 项目根 17 个 `.next-*` 目录共 **34.28 GB**；最大 `.next-build-close9` 11.393 GB / 32,288 文件 |
| file-trace 放大 | `.next-build-close9/server/app/(erp)/dashboard/page.js.nft.json` 单文件 **69,172 条引用，其中 63,770 条指向历史 distDir**；该构建共 3,515 个 nft。`scripts/next-run.mjs` 的 `cleanupStandaloneOutput` 又要删这些深层副本，在满盘 + 长路径下无法收敛 |
| 空间不释放的真因 | 回收站 **498,362 文件 / 53.8 GB**。沙箱把 `Remove-Item` 的删除重定向进回收站，于是出现「文件数减少但可用空间始终为 0」；满盘后 NTFS 元数据更新再报 `WinError 5`，形成死锁 |
| 活跃服务 | 当时 PID 31412 运行 `.next-build/standalone/server.js`，`.next-build` 必须保留 |

**关键结论（不改变上线判断）**：生产构建**不在本机 Windows 执行**。生产链路见 0.1：CI `npm run build` → artifact → systemd（`npm run start:standalone`，端口 3000、仅监听 127.0.0.1，由 `deploy/caddy/Caddyfile` 反代）；`.dockerignore` 排除全部历史 `.next-*` 与 `.env`。仓库内 `Dockerfile` 的三阶段定义使用同一 `.next-build` distDir，但 CI 不调用它，不作为发布路径。因此 Windows file-tracing 缺陷与本机历史目录**不构成生产 CI 阻塞**。释放磁盘后，已在干净检出目录取得 `BUILD_EXIT=0`（见 5.1），仓库外报告 12.8.1 挂着的「构建 exit 0 未取得」就此闭环为「本机隔离验证已通过，生产 CI 仍待实跑」。

**构建前置要求**：CI 必须是干净 checkout（无历史 `.next-*`），或 Linux 构建机上执行等价清理；构建机预留充足磁盘与 `NODE_OPTIONS=--max-old-space-size=8192`。经用户明确确认后清空回收站（真正释放 53.8 GB 的动作），并对 11 个历史 `.next-*` 缓存目录做多轮清理：体积从 **34.28 GB 降到约 13.5 GB**，但目录**未完全删除**（沙箱删除重定向 + 满盘 `WinError 5` 死锁）。`.next-build`（当时被服务占用）、`.next`、`.next-dev`、`.next-run`、`.next-dev.bak*` 完整保留。磁盘由 0 字节恢复到 53 GB 可用。**残留的 13.5 GB 历史目录仍会让原目录构建遇到 trace 放大**，因此构建必须在干净检出目录或干净 CI checkout 执行。清理属不可逆操作，授权与未完成部分如实记录。

## 3. P0 — 上线前必须闭环（人工 / 外部依赖，未擅自执行）

1. **数据库双池角色隔离 DDL**：`scripts/mcp-isolation/grant-roles.sql` 仍未执行。顺序：备份 → DBA 现场 `CREATE ROLE amazon_mcp_ro LOGIN PASSWORD '<强密码>'` → 执行脚本（脚本不会内置弱口令，角色不存在直接 `RAISE EXCEPTION`）→ 配置 `AMAZON_MCP_PG_READONLY_URL` → 重启 → `node scripts/mcp-isolation/audit-roles.mjs` 应 0 越权。当时如实为 **2 项违规 / exit 1**；应用层 `assertProviderTable` 前缀封闭清单始终生效，不构成数据泄露，但库层双池独立未闭环。
2. **Prisma 迁移（实库复核，修正仓库外历史报告）**：仓库外审计报告 12.5 / 12.8.3 记「3 个迁移未在真实库执行」**已过时**。连本地实库核对：`prisma/migrations` 目录 **180** 个 = `_prisma_migrations` **180** 条，`finished_at IS NULL` **0** 条，`MISSING_IN_DB=[]`、`EXTRA_IN_DB=[]`；被点名的 3 个均已 APPLIED —— `20261115000000_sellfox_api_endpoints` 2026-11-14T18:19:52Z、`20261115010000_sellfox_endpoint_date_format` 2026-11-15T00:18:31Z、`20261214230000_sellfox_sync_shards` 2026-11-14T15:34:28Z；`20261215000000_user_preferences` 亦已执行。**本地库无需补跑迁移，当时未擅自执行任何迁移**。但生产目标库是另一个库、不能据此推断：上线前仍须对目标库独立核对 `_prisma_migrations`，按 deployment-plan 决定是否 `npm run db:migrate`。`20261214230000` 时间戳为未来日期，建议核对笔误但不改名，以免破坏已拉取环境。
3. **Amazon 真实 API 契约**：B 类 11 个同步链路、33 条端点参数模板缺真实契约/样本/联调，保持 `SCHEMA_UNVERIFIED` / `PENDING_API_CONTRACT`；不得猜字段名或默认启用。
4. **真实写操作人工审批**：`AMAZON_ADS_EXECUTION_ENABLED=false`、`AMAZON_FBA_REMOTE_EXECUTION_ENABLED=false`（`.env.example` 默认值），生产开启必须走人工审批，不得因部署自动放开。
5. **数据真实性**：12 个页面模块中 7 个有充分真实数据，5 个（Amazon 在线商品、财务利润、采购补货、仓储物流、供应商）真实空或近乎空，**不宣称业务贯通**。缺失数据保留 null / `NEEDS_DATA`，不补造零值。
6. **方案 B 深度改造 / retention 执行器**：唯一键含 `capturedAt`、快照全批事务、失败批次不覆盖 Head、同步日志独立行数字段、retention 授权，均需 schema 变更与排期，不在最小修改范围。

## 4. 环境与密钥清单（`.env.example` 实测，勿提交真实值）

| 分组 | 变量 |
|---|---|
| 数据库 / 缓存 | `DATABASE_URL`、`POSTGRES_DB/USER/PASSWORD`、`REDIS_URL`、`PRISMA_TRANSACTION_MAX_WAIT_MS`、`PRISMA_TRANSACTION_TIMEOUT_MS` |
| 鉴权 | `AUTH_DRIVER=database`、`AUTH_SECRET`（≥32 字符）、`BOOTSTRAP_*`（组织/管理员初始密码） |
| MCP 双池只读 | `MCP_PG_READONLY_URL`（赛狐）、`AMAZON_MCP_PG_READONLY_URL`（Amazon，待配）、`MCP_ORG_ID`、`MCP_WORKSPACE_ID`、`MCP_STORE_IDS`、`MCP_DISABLE_SHARED_TOKEN` |
| SP-API | `AMAZON_SP_API_LWA_CLIENT_ID/SECRET`、`_REFRESH_TOKEN`、`_AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY/SESSION_TOKEN`、`_ENDPOINT`、`_AWS_REGION`、`_ENCRYPTION_KEY`、`_ALLOWED_ORGANIZATION_ID/WORKSPACE_ID`、`_SELLER_BINDINGS`（按 Seller Account 围栏） |
| Ads / 赛狐 | `AMAZON_ADS_LWA_*`、`AMAZON_ADS_ENCRYPTION_KEY`、`SELLFOX_CREDENTIAL_ENCRYPTION_KEY`、`SELLFOX_CLIENT_ID/SECRET` |
| 队列 / 存储 / worker | `QUEUE_DRIVER=redis`、`WORKER_CONCURRENCY`、`*_WORKER_CONCURRENCY`、`AMAZON_SYNC_WORKER_MODE`、`STORAGE_DRIVER`、`UPLOAD_DIR`、S3_* |
| AI / 其它 | `TOGOAPI_*`、`AIGOCODE_*`、`LILI_PUBLIC_ORIGIN`、`REALESRGAN_*`、`NEXT_TELEMETRY_DISABLED=1` |

`EnvironmentFile=/opt/amazon-ad-bulk-operation/.env`（systemd），`.dockerignore` 已排除 `.env` / `.env.*`，密钥不进镜像。

## 5. 验收矩阵

| 检查 | 状态 |
|---|---|
| `npm run typecheck` | 上一轮 exit 0 |
| `npm run lint` | 上一轮 exit 0，0 error / 7 个既有 warning |
| `npm test` | 上一轮 1846 / 1846 通过 / 0 失败 |
| 实库只读验收 | 一致快照、0 SQL 失败、0 越权、真实行数如实；上一轮已验收，本轮未重复审计 |
| `audit-roles.mjs`（实跑） | **exit 1 / 2 项违规**：`sellfox_mcp_ro` 仍可读 62 张 `Amazon*` 表（自身 27 张 `Sellfox*`），且 `AMAZON_MCP_PG_READONLY_URL` 未配置。需 DDL 后复跑 |
| 迁移状态（实库核对） | 目录 180 = 实库 180，无未完成、无缺失、无多余；见第 3 节第 2 项 |
| 双 MCP 真实读取 | 上一轮已验收；本轮未重复审计，不冒充重新验证 |
| 生产构建 `exit 0` | **本机隔离验证已取得**（干净检出目录，5m39s）；生产 CI 的 `exit 0` 仍待实跑，详见 5.1 |
| 编译 / 静态页 | `✓ Compiled successfully in 2.6min`、`✓ Generating static pages (212/212)`、`Collecting build traces` 与完整路由表 |
| standalone 启动冒烟 | `PORT=3100` 启动 `server.js`：`/` 307、`/login` 200、`/api/health` 401（鉴权保护，非 500）；验证后已停止进程 |

### 5.1 干净检出构建实测（本机隔离验证，非生产发布路径）

| 项 | 结果 |
|---|---|
| 目录 | `deploy-verify/`：`git archive HEAD` 导出 3,358 个 tracked 条目（2,679 个文件）+ 独立 `node_modules` 副本；位于 `woker` 仓库之外，**不随仓库分发** |
| 目的 | 与干净 CI checkout 同形态：干净 root、无历史 `.next-*`，`outputFileTracingRoot` 下不含历史产物 |
| 命令 | `NODE_OPTIONS=--max-old-space-size=8192 node scripts/next-run.mjs .next-prod build` |
| 结果 | **`BUILD_EXIT=0`**，耗时 5m39s；日志为本机 `logs/prod-build-clean.log`，**未随仓库分发** |
| 产物 | `.next-prod/BUILD_ID`、`standalone/server.js`（245 MB / 5,725 文件）、`static`（7.0 MB）；standalone 内**仅 `.next-prod` 一个 distDir**，无历史副本，`cleanupStandaloneOutput` 已收敛 |
| 冒烟 | `PORT=3100 HOSTNAME=127.0.0.1 node .next-prod/standalone/server.js` → `/` 307、`/login` 200、`/api/health` 401；已停止进程，未占用生产端口 |

**两点如实说明**：

1. 本次 distDir 用 `.next-prod` 是为避开本机活跃服务占用的 `.next-build`；生产 `npm run build` 与 CI 用 `.next-build`，与 `Dockerfile` 的 COPY 路径一致。**本机 `.next-prod` 产物不能直接当生产包**。
2. 干净检出目录含真实 `.env`，因此 standalone 顶层带入了 `.env` 与项目文档；生产 CI artifact 不含 `.env`（`docs/ci-cd.md`）。**任何绕过 CI artifact、直接拷贝 standalone 目录部署的做法，必须先剔除 `.env`**。未改 `next.config.ts`，不提交无效配置补丁。

## 6. 部署前核对顺序（不是服务器操作授权）

> 实际发布只走 GitHub Actions CI artifact，按 `scripts/deployment-plan.mjs` 清单执行（`docs/ci-cd.md`、`AGENTS.md` 第 140–141 行）。下列命令是核对与回滚参考，**任何 SSH 手工停服 / 迁移 / 构建都需单独授权，且不得绕开 CI**。

1. **备份**：PostgreSQL 全量备份（`deploy/backup/amazon-postgres-backup.service` / `.timer` 应已启用并验证过一次恢复），并留存当前 `RELEASE.json` 与镜像 tag。
2. **停旧**（由 CI 发布流程按清单执行）：确认 `amazon-web` 等 systemd 单元与端口 3000 释放。
3. **迁移（按需）**：仅当 deployment-plan 判定本次有 migration 变化时才 `npm run db:migrate`；核对 `_prisma_migrations` 与 `prisma/migrations` 目录一致，记录 `finished_at`。禁止每次发布默认迁移。
4. **DDL**：DBA 执行第 3 节第 1 项，配置 `AMAZON_MCP_PG_READONLY_URL`。
5. **配置**：核对第 4 节全部变量；确认写操作开关仍为 `false`；`AUTH_SECRET`、各 `ENCRYPTION_KEY` 与旧环境一致（否则已加密凭证不可解）。
6. **构建**：干净 Linux checkout → `npm ci` → `NODE_OPTIONS=--max-old-space-size=8192 npm run build`，确认 `BUILD_EXIT=0`、`.next-build/standalone/server.js` 与 `static` 存在；由 CI `scripts/package-ci-artifact.sh` 打包，**服务器不执行构建**，仓库内 `Dockerfile` 不作发布路径。
7. **启动**：按清单启动各服务 → `curl -fsS http://127.0.0.1:3000/api/health`（按实际健康检查端点）→ Caddy 反代与 TLS。
8. **冒烟**：登录 → 双 MCP 各跑一个真实只读查询 → 按 Seller Account 验证围栏 → `node scripts/mcp-isolation/audit-roles.mjs` 应 0 越权 → 复跑实库只读验收。
9. **留证**：CI 构建日志、迁移输出、DDL 执行记录、冒烟结果、回滚点。

## 7. 回滚

- 镜像/目录切换到上一个 `/opt/amazon-ad-bulk-*` 版本并重启 systemd 单元；`EnvironmentFile` 保持同一路径。
- 数据库**不做自动 down migration**：按备份时间点恢复，并核对 `PRISMA` 迁移记录与业务数据版本。
- 密钥回滚：恢复上一版 `.env`（尤其各 `ENCRYPTION_KEY`），否则凭证解密失败。

## 8. 明确不宣称完成

- 生产 Linux CI 上的 `npm run build` / artifact 打包（仅在本机干净检出目录验证 `BUILD_EXIT=0`，未跑 CI/Docker 构建）、DDL 授权闭环、**生产目标库**迁移状态（本地库已核对为 180/180，不推断生产库）、11 个同步链路真实联调、方案 B 深度改造、retention 执行器、5 个空模块业务贯通。
- 已实际执行的动作：经用户确认清空回收站并部分瘦身历史构建目录、干净检出构建取得 `BUILD_EXIT=0`、standalone 启动冒烟、实库迁移与角色审计复核、核对清单整理；**未执行**任何 DDL、迁移、Amazon 写操作、Mock 数据填充、业务代码改动或生产发布。
- 11 个历史 `.next-*` 目录未完全删除（残留约 13.5 GB）；生产 CI 构建仍未实际跑过。
- 任何以 0 值 / Mock / 历史记录冒充真实业务数据的行为均未发生。
- **入库说明**：本文原稿是 2026-11-15 的本机验收记录（仓库外 `output/`）。经用户授权整理入库，并修正了原稿把 `Dockerfile` 三阶段构建当作生产发布路径、以及部署顺序可能被误读为 SSH 手工授权两处冲突；入库提交号与推送状态以 `git log` 为准，不在文中硬编码。此前 `git push ssh HEAD:tiaotiao-erp` 为 `Everything up-to-date`（无新对象）。
