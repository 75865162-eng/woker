# 现有系统审计报告

## 1. 审计范围与证据级别

基于 2026-11-04 本地真实工作区，HEAD `cd2be5e5fbad8e67f1e565abe1248927ee135515` 及当时未提交修改。检查范围：`src/lib/amazon`、`src/lib/operations`、对应 routes/components、商品列表关联、Agent 工具/CLI、Prisma、queue、Amazon systemd/部署计划和相关测试。不读取密钥值，不连接生产，不运行真实 Amazon 请求或数据库维护。

“已实现”表示代码路径存在并有相关回归依据；不等于生产已部署、授权有效或通过真实容量测试。数据库实例的 migration 状态、Redis 存活、实际店铺授权和生产数据覆盖本次未验证。

## 2. 能力清单

| 项目 | 已有能力及证据 | 缺失/限制 | 处置 |
| --- | --- | --- | --- |
| 凭证 | `integration-secrets.ts` AES-256-GCM；AAD 绑定 org/workspace；DB 优先、环境 fallback；更新审计只记字段名 | `AmazonIntegrationSecret.provider @unique` 全局一组；无逐 seller/区域授权实体；无 OAuth 回调、撤销/轮换编排 | 扩展现有 Secret/Connection，不另建明文库 |
| 店铺站点 | `seller-bindings.ts` 显式 Seller ID、ERP SellerAccount、marketplace、authorizedResources；DB 优先 | 每组最多 10 行、同工作区仅一个 Seller ID；authorizedResources 是本地声明，不证明 Amazon 已授角色 | 保留验证，新增 authorization 引用；不得猜 accountKey |
| 连接验证 | `/connection/validate` 经 LWA 调 Sellers `getMarketplaceParticipations` 并持久化 readiness run | HTTP route 内同步执行一次连接探测；站点可访问不等于所有 API 角色可用 | 保留轻量探测，耗时同步仍走 Worker |
| FBA 库存 | `getInventorySummaries` 全量翻页、SKU＋condition 去重、嵌套数量校验、成功快照事务写入 | 未传官方支持的 startDateTime；无持久水位；非 FBM；不含货件级 ETA | 复用适配器，先快照；增量单独验证 |
| 在线商品 | Listings `searchListingsItems`，按站点取 summaries；SKU/ASIN/状态/履约类型快照 | 名称 catalog 容易误解；未用 lastUpdatedAfter；只存部分字段，无完整商品详情 | 保留 resource 兼容名，UI 改称在线商品；不替代 ProductRecord |
| 计划 | Schedule DB 间隔配置、启停、下次时间；15–10080 分钟，默认停用；库存60/刊登1440 | org/workspace/resource 唯一；无店铺站点/模式/窗口/优先级/重试/保留/时区；首次等一周期；修改重置计时 | 扩展现表及明确计划版本 |
| 队列 | BullMQ `amazon-sync-jobs`，jobId 去重、3 次指数退避，起始5秒 | 不是按计划可配；无实时/回填配额隔离；不读取 usage plan 响应头 | 复用，增加持久调度意图与分类调度 |
| Worker | `scripts/amazon-sync-worker.ts` 独立后台进程，30秒调度/恢复/心跳，并发默认1、上限2 | 每轮恢复串联调度→stale→排队→补货；前段报错会跳过后段；补货可拖长扫描间隔 | 分步骤隔离错误，维护受控有界工作 |
| 防双跑 | 调度事务 advisory lock、手动共享入队锁、执行 PG session advisory lock | 锁粒度 org/workspace/resource，非 seller/marketplace；每个运行占 PG 连接 | 扩展作用域＋租约 fencing，保留 DB 原子性 |
| 恢复 | 启动/每30秒重新派发 QUEUED；RUNNING超过15分钟且 session锁已释放才失败清理 | 中断标 FAILED，不续页；BullMQ stalled重投时RUNNING会直接return，可能队列completed但DB仍RUNNING，后续靠清理 | 必须测试并整改状态对齐；不能声称断点续跑 |
| 数据新鲜度 | 库存默认360分钟（env可配）、刊登48小时；保留最近成功与最近失败 | 工作区域聚合；零行成功没有 capturedAt 会显示未同步；频率与stale阈值分离但UI不充分；catalog-only行freshness仍由库存决定 | 以每作用域成功manifest/coverage为准，逐域呈现 |
| 任务监控 | QUEUED/RUNNING/SUCCEEDED/FAILED/BLOCKED；summary/error、最近20次；WorkerHeartbeat | startedAt实际入队时间；无真实开始时间、日志表、attempt、页进度、请求/429计数；前端只筛最近20条 | 新增持久日志/attempt，服务端分页筛选与趋势聚合 |
| 数据质量 | 解析响应及数量校验、超页/超量失败、不发布半成品、旧成功保留 | 没有issue表、覆盖区间、重复异常统计、订单迟到/报告完整性规则 | 按域验证，不以通用空结果判成功 |
| 订单/财务/履约/报告 | 当前类型或占位 | 无执行器；无 Reports client；sales/traffic等未接入 | 后续阶段新增适配器；UI规划中 |
| 商品中心 | `/api/products` 原分页主读后批量附加Amazon快照；operations:view门槛；保存剔除附加字段 | Seller SKU与公司sku字符串相等未必是明确映射；关联行上限4000，旧NULL店铺排除 | 保留只读校准边界，显式映射另评审 |
| 补货 | Worker持久化Policy/Plan，手工销量＋Amazon库存，或赛狐完整日销量＋赛狐库存 | 无Amazon订单销量/货件ETA；不能把库存汇总在途当按期到货 | 复用计算器，后续新增明确Amazon来源分支 |
| Agent/MCP | `tool-gateway.ts`、Product/Listing/Supplier等内部adapter；`ops-cli.ts` 本地DB只读授权和事务；Ads preview/审批审计 | 内部adapter名字含MCP不代表对外SP-API MCP server；未发现统一Amazon数据MCP传输端点；Ads真实写回未实现 | 复用服务/权限，Phase4加薄只读工具层 |
| 运维 | systemd Amazon worker、PG/Redis infra、心跳、journal，CI artifact及deployment-plan | 代码可证明部署定义，不能证明进程在线；无同步级结构日志/告警SLO | 延用发布链路，新增可观测字段 |

## 3. 当前模型与关联

当前 Amazon 模型大多使用标量 ID，**没有 Prisma relation/外键来保证所有跨表作用域一致**，由服务校验；后续需设计复合约束，不能仅新增 sellerId 字段就称完成隔离。

| 表 | 关键键/字段 | 用途与局限 |
| --- | --- | --- |
| SellerAccount | ERP店铺，org/workspace、状态、站点 | 与真实Amazon Seller身份分开 |
| AmazonIntegrationConnection | unique(org,workspace,provider)，status、enabledDomains、marketplaceParticipations | 一组连接概览；lastSyncAt不能表达各域水位 |
| AmazonIntegrationSecret | provider全局unique；unique(org,workspace)，密文、region、endpoint | 多组织/多授权扩展的前置约束 |
| AmazonSellerBinding | unique(org,workspace,ERP店铺,marketplace)及unique(org,workspace,amazonSellerId,marketplace) | 授权域目前只有inventory/catalog；无凭证ID |
| AmazonSyncSchedule | unique(org,workspace,resource)，enabled、interval、lastEnqueuedAt | 一个工作区域一条计划 |
| AmazonSyncRun | org/workspace/resource、idempotencyKey、status、summary/error、startedAt/finishedAt | unique(org,workspace,idempotencyKey)；没有seller/marketplace/checkpoint |
| AmazonInventorySnapshot | run、可空sellerAccountId、marketplace、sellerSku、condition、各数量、capturedAt | unique(run,marketplace,sellerAccount,sku,condition)；旧NULL身份不能猜配 |
| AmazonCatalogSnapshot | sourceRun、sellerAccount、marketplace、sku、asin、状态、fieldSources、capturedAt | unique(org,workspace,sellerAccount,marketplace,sku,run) |
| AmazonReplenishmentPolicy/Plan | 每店铺站点sku策略；plan按policy唯一、inventoryRunId/inputSnapshot/result | 明确记录来源与策略版本，不是SP-API同步事实表 |
| WorkerHeartbeat | queueName/status/concurrency/lastSeenAt | 队列工作进程状态，不代表某任务进度 |
| FileObject/storage | local或S3兼容对象存储抽象 | 可复用为脱敏原始响应/报告文件，不新增uploads路径依赖 |

当前没有 AmazonSyncCursor/Report/DataQualityIssue/TaskLog 等持久表。不能把 Sellfox 的日报、current view 或执行器当 Amazon 已接入证据。

## 4. 真实执行与读取路径

```mermaid
flowchart TD
  UI[/operations 同步按钮] --> POST[POST sync-runs 权限/幂等/连接校验]
  Timer[amazon-sync-worker 每30秒] --> Schedule[检查 AmazonSyncSchedule]
  POST --> Run[(AmazonSyncRun QUEUED)]
  Schedule --> Run
  Run --> Recover[重新派发QUEUED]
  POST --> Queue[BullMQ amazon-sync-jobs]
  Recover --> Queue
  Queue --> Lock[工作区＋resource PG session lock]
  Lock --> Claim[QUEUED CAS变RUNNING]
  Claim --> Bind[本工作区所有已授权绑定，顺序执行]
  Bind --> API[FBA Inventory / Listings Items 全量翻页]
  API --> Memory[内存Map累计，页/行上限]
  Memory --> Tx[全部绑定完成后事务写Snapshot＋SUCCEEDED]
  Tx --> Read[本地DB最新成功run]
  Read --> Operations[库存/商品/新鲜度]
  Read --> Product[商品中心只读附加]
  Read --> Replenish[补货Worker]
  Read --> CLI[授权只读CLI]
```

失败：429、5xx、网络和timeout转换为retryable AmazonSpApiError，非最后attempt时恢复QUEUED并抛错，由BullMQ重跑整批；其他错误/最后一次失败终止FAILED或BLOCKED。既有文档“仅429/5xx重试”不完整，**代码还包括网络/超时**。

分页每页固定等待600ms，最多1000页/单次工作区50000行；最后一个绑定失败会使所有绑定均不发布。事务批量插入每1000行、60秒timeout。没有逐页落库检查点和token循环检测；内存/长事务成本须先benchmark。库存行严格验证，刊登部分字段允许null。当前读取使用工作区最近成功run；任务未来拆分后若不同时改成逐作用域snapshot head，容易让最后一个成功店铺遮蔽其他店铺。

当前 `scope.accountId/marketplace` 虽被UI带入，但上述Amazon计划、运行及主要读查询只使用org/workspace；不能将顶部工作区选择器解释成已支持独立店铺/站点同步。

经营指标 `/api/operations/metrics/daily` 真实route返回PPC日SKU/ASIN映射未接通的空结果和null，未查赛狐。`read-models.ts`仍有Sellfox旧查询builder，不能据此判断真实route数据源。`specs/004.../contracts/operations-api.md` 中“指标读取赛狐”“只有inventory可排队”“无Ads审批创建”等描述落后于代码，后续Phase1同步更新历史契约，当前保留原文并在本包明确纠正。

## 5. 文件复用与改造地图

以下为**后续候选修改**，不是本次已改文件：

| 文件 | 决策与工作 |
| --- | --- |
| `src/lib/amazon/sp-api-client.ts` | 复用LWA/timeout/脱敏；提取response metadata、requestId、429计数；按官方版本加只读adapter；不保留600ms为限流策略 |
| `src/lib/amazon/integration-secrets.ts`, `seller-bindings.ts` | 多authorization/seller/region路由，密钥版本/AAD迁移，保留legacy读取 |
| `src/app/api/integrations/amazon/sp-api/{credentials,bindings}/route.ts` | 兼容旧设置流程，新增授权标识/作用域校验；已有settings:edit不降级 |
| `src/lib/operations/{schedules,schedule-policy}.ts` | 扩展范围、模式、窗口、时区、计划版本，逐scope幂等任务；避免100条扫描饿死后排计划 |
| `src/lib/operations/{sync-processor,sync-lock}.ts` | 复用两个执行器；拆有界页、检查点、lease/CAS发布、取消及恢复 |
| `scripts/amazon-sync-worker.ts`, `src/lib/queue/{index,redis-queue}.ts` | 复用队列/心跳；重试/优先级、回填公平性、错误隔离；不增新通用任务平台 |
| `src/lib/operations/{readiness,amazon-products,read-models}.ts`, 对应API | 每scope成功manifest、coverage、过滤/分页/聚合；避免从20行前端推全局指标 |
| `src/components/operations/*`, `src/app/operations/page.tsx` | 渐进七页；原inventory/catalog/replenishment/ads保持可达 |
| `src/app/api/products/route.ts` | 仅Amazon只读关联读取改为scope head；保留原主读、缓存和权限边界 |
| `src/lib/operations/{replenishment,replenishment-service,historical-sales}.ts` | 纯计算复用；Phase2新增Amazon来源，不覆盖赛狐分支 |
| `src/lib/operations/cli.ts`, `scripts/ops-cli.ts`, `src/lib/agent-platform/tool-gateway.ts` | 复用授权服务，后续只读MCP接同源；触发同步为显式不同权限动作 |
| `prisma/schema.prisma`, `prisma/migrations/*` | 分期扩展已有模型；review前不写migration |
| `deploy/systemd/amazon-sync-worker.service`, `scripts/deployment-plan.mjs`, `.github/workflows/ci-cd.yml` | 延用artifact链路；仅运行配置确有变更时审核；本阶段不改 |
| `tests/amazon-*.test.ts`, `tests/operations-*.test.ts`, `tests/browser/operations*` | 保留已有纯函数/模拟API测试；新增真实DB/Redis隔离及故障注入验收 |
| `docs/amazon-operations-hub.md`, `specs/004.../contracts/operations-api.md` | 后续按最终行为更新，不让过时契约替代代码证据 |

## 6. 初始工作区改动盘点

以下12项在本任务开始时已存在；本次不修改、不stash、不回滚、不提交或推送。仅新评审目录属于本次新增。若后续要求同步GitHub/部署，按AGENTS要求先确认完整范围，不能只提交本聊天文件。

```text
 M deploy/caddy/Caddyfile
 M middleware.ts
 M next.config.ts
 M src/app/api/integrations/sellersprite/route.ts
 M src/components/agents/agent-center-workbench.tsx
 M src/components/agents/agent-detail-workbench.tsx
 M src/components/settings/amazon-sp-api-settings-panel.tsx
 M src/components/settings/settings-workbench.tsx
 M src/lib/agent-platform/market.ts
 M src/lib/integrations/sellersprite.ts
 M tests/browser/amazon-sp-api-settings.spec.ts
?? docs/lili-local-routing.md
```

风险：其中授权组件影响当前UI审计，Caddy/middleware/Next配置影响部署范围；已有SellerSprite MCP实现与其route文案也存在不同步迹象，本阶段不扩展无关修复。
