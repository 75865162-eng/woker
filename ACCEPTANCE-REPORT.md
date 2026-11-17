# ERP 生产部署前代码验收报告

> 验收依据：`ERP_全系统功能需求总纲与落地实施计划`（V1.0）
> 验收时间：2026-11-18
> 验收原则：以当前代码为准、状态诚实、禁止假成功、不自动部署
> 代码基线：`main` @ `9301ed1`（已 push，远程 == 本地）

## 一、状态定义（按需求文档第 13 节）

| 状态 | 含义 | 是否计入完成 |
|---|---|---|
| DONE_REAL | 真实环境/真实数据端到端验证，有日志与回读证据 | 是 |
| DONE_LOCAL | 本地真实依赖验证通过，生产未验证 | 计入本地完成 |
| PARTIAL | 部分链路可用，仍有明确缺口 | 否 |
| WAITING_AUTH | 等待真实 API 授权/凭证 | 否 |
| WAITING_EXTERNAL | 等待第三方/服务器/业务条件 | 否 |
| TECH_DEBT | 已知实现与需求有差距，延后处理 | 否 |

---

## 二、P0 安全与数据边界（本地可核验，全部合规）

| 需求项 | 需求来源 | 代码位置 | 状态 | 证据 | 风险 |
|---|---|---|---|---|---|
| 赛池/Amazon 双池物理隔离 | §2.1/2.2/2.3 | `prisma/schema.prisma` | DONE_LOCAL | 赛狐 `Sellfox*`（含 `payload Json`）、Amazon `AmazonSyncRawPage.rawCiphertext`/`Amazon*Snapshot` 分属不同表，无混合事实表 | 低 |
| ProductRecord 主档不被外部覆盖 | §2.3/4.1 | `src/lib/products/product-record-repository.ts:85,130,149`、`amazon-field-policy.ts:5-10`、`amazon-sync/policy.ts:46` | DONE_LOCAL | `sellfox/`、`amazon-sync/` 均无 ProductRecord 写入；写入前 `stripAmazonProductObservations` 剥离观察字段；统一经 `saveProductRecord` | 无 |
| MCP 强制 Seller Account + Marketplace 边界 | §6.2 | `src/lib/mcp/mcp-scope.ts:9-20`、`mcp.ts:822-823`、`data-access.ts:32-35` | DONE_LOCAL | 每次调用必须显式单账号+站点；服务端校验用户→账号分配，未分配 403 fail-closed | 低 |
| MCP 只读 + 禁止任意 SQL + 双池隔离 | §6.2 | `src/lib/sellfox/mcp.ts:181-232,424-439`、`isolation.ts:41-72,137-150` | DONE_LOCAL | `BEGIN READ ONLY`+只读 DB 角色、工具白名单、参数化查询、凭证行强制注入组织/工作区边界、跨源标识拒绝 | 低 |
| AI 不擅自写 Amazon | §0.1-10/§6.4 | `src/lib/amazon-ads.ts:203-211`、`amazon-action-audit.ts:85,120-125`、`ads-client.ts:27-28`、`remote-action-executor.ts:41,104` | DONE_LOCAL | 默认 dry_run + Adjustment Draft；写 transport 恒抛 `NOT_IMPLEMENTED`（开关无法绕过）；FBA 远程写需显式门禁；人工审批后方可 CONFIRMED | 低 |
| SP-API 与 Ads API 授权独立 | §2.2/§6.2 | `schema.prisma:3144-3172`(SP-API)、`:1834-1872`(Ads)、`mcp.ts:80-101` | DONE_LOCAL | 两套独立授权模型与校验路径，Ads 读取要求独立 `AmazonAdsAuthorization`，不因 SP-API 授权而开放 | 低 |
| 登录限流 / CSRF / 安全头 / 健康探针 | §4.10/§10 | `src/lib/auth/login-rate-limit.ts`、`csrf.ts`、`next.config.ts`、`src/app/api/health/route.ts` | DONE_LOCAL | 8/账号·30/IP·15分钟；Cookie 跨站写 CSRF 拦截；HSTS 可选；免登录探针 | 低 |

**结论**：所有 P0 安全边界在本地代码层面成立，无越权/主档污染/AI 越写风险。这是明天部署最关键的部分，已闭环。

---

## 三、生产发布就绪度（本地可核验）

| 需求项 | 代码位置 | 状态 | 证据 |
|---|---|---|---|
| 生产构建 | `npm run build` | DONE_LOCAL | 构建成功，standalone 产物 + middleware 编译，全路由生成 |
| 部署门禁（代码/产物） | `check:production --gate code` | DONE_LOCAL | 通过 10 / 阻塞 0 |
| 部署门禁（清单/资产） | `check:deploy`（生产模板渲染后配置） | DONE_LOCAL | 通过 28 / 阻塞 0；systemd×6、Caddy、backup、CSRF、health、onboarding 全齐 |
| 备份与恢复 | `scripts/runtime/backup-postgres.mjs` | DONE_LOCAL | 真实 `pg_dump` + `pg_restore --list` 校验 + sha256 + 原子 rename + 仓库外目录 + `--apply` 批准 |
| 发布 runbook | `deploy/README.md` | DONE_LOCAL | 唯一发布入口、密钥生成、口令轮换预演、双管理员凭据接入、备份恢复回滚、上线清单、门禁命令齐全 |
| 唯一官方同步执行端 | `scripts/runtime/worker-manager.mjs`、`deploy/systemd/*` | PARTIAL | 代码有 advisory 单实例锁、systemd 5 worker 单元；**本地/云端双端切换属运维动作，须部署时人工停止本地 worker** |
| 全量门禁 + 真实端到端 | `check:production --gate full` | WAITING_EXTERNAL | 需生产 EnvironmentFile、真实 DB/Redis、真实 Amazon 授权 |

---

## 四、上线前置条件与限制（必须由操作员完成，不造假）

> 以下本地无真实凭据/环境，**无法闭环**，按文档要求如实列为上线限制，禁止用本地测试替代。

1. **真实 Amazon 授权**：SP-API OAuth 授权、`AmazonSellerIdentity` 有记录、`AmazonSpApiAuthorization` 为 `CONFIGURED` 且 `identityVerifiedAt` 非空；Ads API 独立授权。
2. **生产环境配置**：用 `prod:env:init` 生成 EnvironmentFile 并填完 REPLACE 项，`ERP_RUNTIME_MODE=production`、`NODE_ENV=production`、`AMAZON_API_EXECUTION_ROLE=cloud`、`STORAGE_DRIVER` 用持久卷或 s3/r2。
3. **生产全量门禁**：在目标机用真实 EnvironmentFile 跑 `--gate full`，确认 `ready=true` 且 db.connect/migrations/clean、授权、授予、身份、数据源、worker 心跳全 PASS。
4. **真实端到端**：手动触发小范围同步，核验落库数据与官方返回一致；Ads profile/reporting 真实账号验收；页面与 MCP 回读数量一致。
5. **唯一同步端**：云端成为唯一正式同步执行端后，停止本地官方同步 Worker，避免双端重复执行。
6. **备份恢复演练**：在生产环境实测备份与恢复，关闭 `config.storage` 的 WARN。
7. **发布后冒烟**：登录、CSRF、限流、HTTPS/HSTS、关键页面与 API。

---

## 五、金额字段 Float → Decimal 整改（原技术债，已按用户要求消除）

> 用户明确将本项由"部署后技术债"升级为"必须淘汰的硬伤，马上整改"，本轮已完成。

| 项 | 整改结果 | 证据 |
|---|---|---|
| 赛狐域及 `ProductRecord.purchasePrice` 金额使用 `Float` | 122 个金额字段改为 `Decimal @db.Decimal(20,4)`；18 个非金额字段（比率/件数/评分/限流）保留 Float；补齐 3 模型 `currency` | migration `20261118050000_money_float_to_decimal`；`tests/money-decimal.test.ts`；`UPGRADE-STATUS.md` 第十一章 |

- 运算层全部走 `Prisma.Decimal`（decimal.js）：`src/lib/sellfox/ads-proposal.ts` ACOS/阈值比较、财务域既有 Decimal 范式
- 展示/导出边界用 `moneyToNumber()` 转 number 保持前端契约（null 保持 null，不补造零值）
- 现有 `FinanceExchangeRate.rate` 为 `Decimal(24,12)`，比规范 (12,6) 更精确，保留
- 验证：单测 2332/0 失败、typecheck/lint/ui:guard 全绿、build 成功、code gate 阻塞 0、数据库列 numeric(20,4) 回读精度无损、11 视图重建可查

**仍未闭环的能力缺口**（对照需求第 4/6 节，均为需新建表/状态机的大功能或外部授权依赖，本窗口不强行实现）：O2C 回款/对账闭环、通用费用单后端、AI 经营复盘顺序编排（6.5）、统一经营分析层、FBA/Ads 真实写入（需外部授权）。详见 `UPGRADE-STATUS.md` 第十一章审计结论。

---

## 六、租户边界 + 统一管理中心 + 多源接入整改（两份参考文档，全量推进）

| 阶段 | 交付项 | 证据 |
|---|---|---|
| 一·租户硬伤 | Amazon view/export 读路径并入角色级 grant（成员∪角色，停用店铺过滤）；赛狐新增成员/角色店铺授权两表+迁移+渐进启用服务端过滤+管理接口+MCP 凭证范围校验 | `src/lib/amazon-sync/data-access.ts`、`src/lib/sellfox/store-access.ts`、`browse-store-scope.ts`、迁移 `20261219000000`、`src/app/api/sellfox/store-grants`、`tests/sellfox-store-access.test.ts` |
| 二·统一中心 | `/accounts` 四 Tab（members/roles/points/mcp）+ `?tab=` 同步；成员详情聚合抽屉；`/settings` 积分/MCP 改跳转占位；Lili 设备并入 mcp Tab | `src/components/accounts/account-workbench.tsx`、`account-detail-drawer.tsx`、`account-members-table.tsx`、`src/app/(erp)/settings/page.tsx` |
| 三·多源接入 | 统一只读目录（资源/角色探测、官方窗口如实标注、available+原因）；赛狐 MCP 数据集目录补 available 与"按行返回/不跨币种汇总"警告；SB/SD、订单明细按既有契约标 not_implemented 不臆造采集 | `src/lib/integration-catalog.ts`、`src/app/api/integrations/catalog/route.ts`、`tests/integration-catalog.test.ts` |

- **安全边界**：owner/database_admin 全量豁免；赛狐授权渐进启用（无授权记录零破坏）；越界店铺 403；角色 grant 店铺再经 active 状态过滤，不泄漏停用店铺
- **回归发现并修复**：干净 HEAD worktree 对照发现本轮 data-access 改动使 `operations-replenishment-service.test.ts` 因缺 role-grant mock 异步挂起（2 cancelled），补齐 mock 后恢复 2/2 pass——证明非环境抖动而是真实回归
- **UI 范式守卫**：成员抽屉新增 5 处 `font-bold` 触发 ui:guard +5 回退，改 `font-semibold` 后 376→376 零回退

**验证（Node 22.19.0）**：check:fast EXIT=0（2349 测试 / 0 失败 / 0 cancelled；lint 0 error；typecheck/ui:guard 通过）；build EXIT=0；code gate 阻塞 0；本地 DB 新迁移已应用、结构与 schema 一致
**未闭环（如实留档，不造假）**：真实连通性校验端点接线（需真实外部 API；赛狐已有 token-only 校验、Ads 有孤立 probe）、Ads SB/SD 与订单明细真实采集、生产 EnvironmentFile 下的 full gate 端到端。

---

## 七、本轮结论

- **本地可核验部分已闭环**：P0 安全边界全部合规（本轮进一步加固角色授权读路径 + 赛狐店铺授权），统一管理中心四 Tab 落地，多源目录如实暴露能力边界，构建/测试/门禁全绿。
- **未闭环部分均为外部环境依赖**：真实授权与连通校验、Ads SB/SD 采集、生产 DB/Redis/证书、full gate 端到端——必须由操作员在目标机完成，本报告不假称完成。
- **不为凑数制造改动**：真实连通校验端点与 SB/SD 采集需外部 API，当前环境无法验证，按数据真实性原则留档而非接跑不通的端点。
- 当前代码健康：2349 测试 / 0 失败、lint 0 error、code gate 全绿、ui:guard 零回退、build 成功。

---

## 八、P2 性能整改 + 连接池（两份新文档，已落地）

| 项 | 交付 | 证据 |
|---|---|---|
| Y2 轮询可见性 | 新增 `use-visible-polling`（hidden 暂停/visible 补刷/终态停/busy 跳过），迁移文档 8 处 + 审计发现的 3 处，sync-center 参照实现保留 | `src/lib/hooks/use-visible-polling.ts` 及各 workbench 组件 |
| Y1 角色权限缓存 | 进程 LRU(45s)+可选 Redis+写后失效+降级回源；合并逻辑收口 `mergeRolePermissions`；仅非事务路径(db===prisma)走缓存，事务内直查；成员状态不缓存 | `src/lib/accounts/role-permission-cache.ts`、`data-access.ts`、`authorization.ts`、`role-catalog-server.ts`、`tests/role-permission-cache.test.ts` |
| Y4 hub 概览缓存 | 12 条聚合统计按 org+ws 做 45s TTL 缓存，实时字段每次重建，任一表失败整批不缓存；同步 done/failed 失效 | `src/lib/sellfox/hub-overview-cache.ts`、`api/sellfox/hub/route.ts`、`sync-service.ts`、`tests/hub-overview-cache.test.ts` |
| Y3 请求缓存层 | 泛化 `cachedApiGet`（TTL/inflight 去重/retries/force/scope 失效），第一批接入 host-workbench overview；强实时与写操作不进缓存 | `src/lib/workspace/workspace-api-cache.ts`、`host-workbench.tsx`、`tests/workspace-api-cache.test.ts` |
| B1 连接池 | `PrismaPg` 透传 PoolConfig（max 默认10=原行为 + idle/connection timeout），env 可配，缺省回退 | `src/lib/db/prisma.ts`、`.env.example`、`tests/pg-pool-config.test.ts` |

- **安全不变**：金额字段未新增 Float；权限成员∪角色并集、owner/database_admin 豁免口径不变；事务内鉴权保持直查避免一致性风险
- **边界如实**：第二份文档 B2–B8（慢查询告警/索引实测/Redis8 专项/PG16 压测）为需真实数据量与生产版本环境的复核项，明确"只做规划不改代码"，本轮只落地其唯一明确代码项 B1，其余不假称完成
- **Build 说明**：首次 build 与 check:fast 并行因内存竞争被 SIGKILL（非代码错误），单独重跑 EXIT=0

**验证（Node 22.19.0）**：check:fast EXIT=0（2367 测试 / 0 失败 / 0 cancelled；lint 0 error；typecheck/ui:guard 通过）；build EXIT=0；P0 安全边界回归 26/26。

---

## 九、本轮结论

- P0 安全边界、统一管理中心、多源目录（前几章）与本轮 P2 性能整改均已落地并通过本地全量验证。
- 未闭环项均为外部环境依赖或需真实数据量的复核项（真实授权/连通校验、SB/SD 采集、full gate、慢查询压测），本报告不假称完成。
- 当前代码健康：2367 测试 / 0 失败、lint 0 error、code gate 全绿、ui:guard 零回退、build 成功。
