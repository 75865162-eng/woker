# ERP 最终集成验收报告

**结论：NO-GO，不得部署生产。**

本报告只记录本轮实际操作和证据。未把执行环境拒绝、已有测试或静态检查冒充为生产验收。生产数据库、外部授权和正式服务器均未连接；没有部署、迁移或生产数据修改。

## 基线与工作区

- 初始 HEAD：`80dc88cdfd8c159d452757a1434812d7374f4910`。
- 检查期间观察到 HEAD 自动变化为 `2cbb962502c51c2e635c658d8a2c2a2fd297ee7a`（merge commit）。该变更不是本轮执行的，且测试跨越了 HEAD 变化，因此本轮结果不属于固定单一 Commit 的验收证据。
- 最终工作区：`src/components/app-shell/app-shell-client.tsx` 有本轮修改；未提交。未提交、未推送。
- 最初状态中存在的多个用户修改和未跟踪测试文件在测试期间消失，同时 HEAD 变化。无法确认其来源及同步机制。本轮没有执行 reset、clean、stash 或 checkout；建议先由用户核实该外部工作区变更，再固定候选 commit。
- 所有记录均为本机隔离检查，不代表线上环境。

## 实际修改

修复 `src/components/app-shell/app-shell-client.tsx` 中导航项已渲染 `<Icon>` 却未在该循环绑定 `item.icon` 的错误，增加 `const Icon = item.icon`。

验证：该文件单独 ESLint 通过；`npm run typecheck` 通过；全站 ESLint 复跑通过（0 errors，2 个既有 `<img>` 优化 warning）。没有改动其它代码。

## 测试记录

观察时间约为 2026-11-16 17:46–18:03（UTC+8）。环境提供的起始 HEAD 为 `80dc88c`，最终检查时 HEAD 为 `2cbb962`。因测试过程中 HEAD 变化，下列结果不能归属到唯一 commit。

| 命令 | 结果 | 数量/说明 |
|---|---|---|
| `npm run typecheck`（初次） | 退出码 0 | 类型检查通过 |
| `npx prisma validate --schema prisma/schema.prisma` | 退出码 0 | Prisma schema 静态校验通过，不连接数据库 |
| `npx eslint src/components/app-shell/app-shell-client.tsx` | 退出码 0 | 修复文件通过 |
| `npm run typecheck`（修改后） | 退出码 0 | 通过 |
| `npm run lint`（修复后全站） | 退出码 0 | 0 errors，2 warnings：`amazon-products-panel.tsx`、`replica-workbench.tsx` 使用 `<img>` |
| `npm run test` | 退出码 1，耗时约 526.5 秒 | 1,672 项：1,624 pass、48 fail、0 skipped、0 todo。失败明细输出存取被权限拒绝，无法复核失败名称；不得声称全量测试通过 |
| `git diff --check` | 退出码 0 | 通过；早先对已有清单文件仅有 LF/CRLF 警告，最终 diff 无 whitespace error |
| `npm run test:runtime:integration` | 未运行 | Docker CLI 不存在；脚本需要新建受限 PostgreSQL/Redis 临时容器 |
| `scripts/test-wms-core-offline.mjs --browser` | 未运行 | 依赖 Docker 临时 PostgreSQL；WMS 全链路未验证 |
| `npm run performance:dev` / `performance:build` | 未运行 | 依赖 Docker PostgreSQL fixture；无法取得本轮基线或回归结果 |
| 真实迁移历史 / `migrate deploy` | 未运行 | 真实库操作需独立授权；隔离迁移脚本又因 Docker 缺失无法启动 |
| 浏览器 E2E / 生产构建 | 未运行 | Chromium 已安装；标准构建使用已存在的 `.next-build`，为避免覆盖未知现有产物未启动。E2E 还需数据库 fixture |

本机只读网络检查：3000、5432、6379 正在监听；3017、55439、6399 未监听。由于 Docker 不可用，不能识别或复用这些现有服务；未停止、重启或注入故障。检查时 Git HEAD 从 `80dc88c` 变更为 `2cbb962`。

## 模块验收状态

普通测试覆盖了一部分纯函数/API 逻辑与权限、租户边界、迁移策略、队列恢复、WMS 规则；它们不等于真实服务联调。

| 范围 | 本轮结论 |
|---|---|
| 用户/权限/租户隔离 | 有单元测试覆盖；无最终版本真实浏览器与数据库联调 |
| 商品、采购、订单、供应商 | 部分单元测试覆盖；完整新增/编辑/审核/撤销/查询业务 E2E 未验收 |
| WMS 质检作业 | 规则测试存在；两用户浏览器全链路未运行，未验收 |
| FBA、物流、库存 | 部分规则/纯逻辑测试存在；端到端数据库闭环未验收 |
| 财务、结算、费用分摊 | 部分精确计算与隔离测试通过；真实持久化/审批闭环未验收 |
| Amazon SP-API / Ads | 离线协议与权限测试有覆盖；没有真实授权、Amazon 请求或真实数据验证。Ads 写入能力不得推断为已具备 |
| Lili / MCP / Skills / AI 查询 | 单元测试有覆盖；外部服务授权和真实租户数据查询未验收 |
| 文件导入导出 | 部分单测通过；真实 worker、对象存储与浏览器完整闭环未验收 |
| 调度、队列、恢复 | 模拟/单测覆盖部分行为；真实 PostgreSQL/Redis 故障矩阵与恢复未运行 |
| 全站导航与工作台 | AppShell 图标错误已修；针对该文件 lint 和类型检查通过；全站 E2E 未运行 |

## 未完成项与部署阻断

1. **必须恢复可识别的隔离执行环境。** 安装/启动经团队批准的 Docker Desktop/Engine，并准备 `postgres:16-alpine`、`redis:7`、Playwright Chromium。不要复用当前 5432/6379 服务；隔离脚本须自行分配 loopback 端口和随机容器标签。
2. **固定最终候选 commit。** 先调查 HEAD 自动变化和用户修改消失的来源；提交动作需用户授权。本轮不创建 commit。随后所有验收必须对同一个 commit 执行并保存原始日志、退出码、通过/失败/跳过数。
3. **复核 48 个单测失败。** 需要在可读日志的位置重跑 `npm run test`，输出 TAP 到获准的工作区日志路径，逐项定位并修复；当前失败明细不可访问，不能断言是环境错误或代码错误。
4. **真实隔离端到端。** 运行 `npm run test:runtime:integration`，覆盖完整迁移链、重复部署幂等、运行态故障、真实 App Router 浏览、API 持久化、Worker/Redis/PostgreSQL 恢复及独立空库备份恢复。该脚本的部分任务内容为合成 fixture，不能代表外部供应商或生产数据验收。
5. **WMS 浏览器全链路。** Docker 可用后运行 `node scripts/test-wms-core-offline.mjs --browser`，保留真实 Playwright 日志和双会话的质检、审核、入库/状态转换证据；任何失败须修复并复测。
6. **Workspace 性能门禁。** 在同模式、同机器的认可基线上分别运行 dev/Turbopack 与 production fixture，并比较登录和热切页 P50/P95、导航请求、DOM 持久性及撤权/禁用账号断言。当前无本轮数据，不能判定 SLO 达标。
7. **迁移历史。** 在隔离空 PostgreSQL 上执行仓库完整 `migrate deploy`、核对 checksum/历史并重复执行验证幂等。生产目标库的 `_prisma_migrations` 及零步迁移历史必须在单独批准的目标环境中只读核实；禁止擅自执行生产迁移。
8. **最终完整回归。** 同一固定 commit 上按 CI 流程执行 typecheck、lint、全量单测、集成、浏览器 E2E、production build、迁移、权限隔离、并发/幂等/故障恢复、性能与资源压测及数据库备份恢复。当前没有这些完整证据。
9. **外部配置和授权缺失。** `deploy/production.env.example` 中仍有 `REPLACE:`、`GENERATE:` 或空值。需由正式运维方在服务器密钥管理边界内生成并配置 DATABASE_URL、REDIS_URL、认证/站点 URL、加密密钥、组织/工作区绑定、SP-API/Ads OAuth 凭据、Seller/站点身份、同步授权、持久存储及必要的 Sellfox/AI/MCP 凭据。不要把值写入本报告或提交到仓库。
10. **备份/恢复和运维能力未验收。** 文档明确备份 timer 尚未启用；本轮没有数据库 dump 的独立空库恢复演练，也没有上传文件/密钥的异机恢复证据。还缺生产资源容量、队列 SLO、告警接收方与 TLS/代理的真实验收。
11. **生产 readiness 未执行。** 不连接目标生产数据库，不运行会进行完整数据库连接的 `check:production --gate full`，不执行部署。正式发布仍须按 CI artifact + deployment-plan 流程并取得另行审批。

以上事项都阻止生产 GO；不是非阻断优化。

## 生产配置与授权清单

权威变量模板：`deploy/production.env.example`。不要在本报告复制任何真实密钥。至少需要明确：

- 运行环境：`NODE_ENV`、`ERP_RUNTIME_MODE`、`PORT`、`HOSTNAME`、`ERP_HSTS_ENABLED`。
- 数据库/队列：TLS PostgreSQL `DATABASE_URL`、TLS Redis `REDIS_URL`、`QUEUE_DRIVER=redis`、事务超时；数据库身份和网络策略需由运维核验。
- 身份认证：`AUTH_DRIVER=database`、独立 `AUTH_SECRET`、首次管理员组织/邮箱/强口令、`AUTH_PUBLIC_ORIGIN`、`AUTH_TRUSTED_PROXY`、`LILI_PUBLIC_ORIGIN`。
- 加密密钥：SP-API、Ads、Sellfox 各自 32 字节 Base64 密钥；必须独立备份，轮换会使已存凭据无法解密。
- Amazon SP-API：LWA client ID/secret/refresh token、实际 endpoint/region、准确 organization/workspace 绑定、seller 身份及启用的数据源。AWS SigV4 字段为可选，不能凭空补值。
- Amazon Ads：LWA client ID/secret、精确 OAuth redirect URI、授权 profile 与允许的 report scope。Ads/FBA 写开关维持 false，除非经过单独安全审批。
- Worker：并发、资源 freshness、精确 organization/workspace 同步范围；所有已注册 Worker 同一生产连接目标。
- 文件存储：持久挂载的 `UPLOAD_DIR` 或经配置验证的 S3/R2 端点、bucket 与专用凭据；多主机场景不能依赖单机本地目录。
- 可选集成：按启用能力配置 Sellfox、AI provider、MCP 只读数据库与授权范围。空值应保持功能关闭，不得伪报 ready。
- 主机与运维：受支持 Node 运行时、systemd services、Caddy/TLS、数据库/Redis 容量、队列监控与告警接收方、磁盘/对象存储容量、异机备份及恢复密钥。

现有模板明确禁止复用本地 `.env`。只由运维在服务器受控环境填入真实值。

## 部署与回滚

权威发布步骤：`docs/ci-cd.md`、`deploy/PRODUCTION-CHECKLIST.md` 及 `scripts/deployment-plan.mjs`。不在此重写脚本，也不执行部署。

生产步骤摘要：固定并审查单一候选 commit → CI 对该 commit 运行测试、Lint、类型检查、性能对比和生产构建 → 生成并核验 CI artifact、manifest、release metadata、commit 与 SHA → 核对服务器独立 EnvironmentFile 与 readiness 阻断项 → 经审批按 deployment-plan 下载/校验 artifact → 只在 schema/migration 确认且获批时按流程向前迁移 → 切换 release 与 systemd services → `/api/health`、登录、认证 worker-health、关键业务读写与审计核验 → 保存 `RELEASE-RESULT.json`、日志和审批证据。

回滚按 `docs/ci-cd.md`：发布失败只回滚应用 release/current symlink、systemd 进程及适用的 Caddy 配置；**数据库 migration 不自动回滚**，不得运行 `migrate down`、删除表或覆盖生产库。数据恢复只能在事故评估和单独批准后从验证过的备份恢复到经确认目标；同时处理上传对象与独立加密密钥。当前没有本轮备份恢复证据，因此回滚操作条件尚未满足。

## 最终判定

**NO-GO。** 有一个代码缺陷已修复，类型检查和 Lint 通过，但全量测试有 48 项失败；最终 commit 不固定；Docker 及隔离 PostgreSQL/Redis 缺失；WMS 浏览器、运行态故障、真实迁移历史、性能门禁、生产构建和备份恢复均未完成；生产外部授权及环境配置也未提供。满足这些阻断条件前，不得宣称已完成最终集成或生产就绪。
