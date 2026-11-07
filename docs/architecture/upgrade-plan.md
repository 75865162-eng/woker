# 条条 ERP 升级计划

日期：2026-11-06。评审基线：`codex/amazon-multistore-mcp` @ `a8995f3`（已合并 [PR #6](https://github.com/75865162-eng/woker/pull/6)）。未合并增量：[PR #7](https://github.com/75865162-eng/woker/pull/7)（`cursor/sellfox-orders-shipments-restock-a4cd`，相对基线 +1431 / −69）。本文只描述代码里已经存在的行为和一条可执行的升级顺序，不改业务代码、不开迁移、不调用赛狐或 MCP。

本文和这些文档分工：

- 赛狐读模型与同步细节仍以 `docs/sellfox-agent-read.md`、`docs/sellfox-sync-workbench-plan.md` 为准。
- Amazon MCP / `data_*` 的已落地批次仍以 `docs/ai-mcp-erp-collaboration-upgrade-todo-2026-11-06.md` 为准（C01–C09 为本地离线实现，C10–C11 未做）。
- 生产发布步骤仍以 `AGENTS.md`「服务器部署与更新规则」为准。本文不改那套步骤，只标出缺口和建议顺序。

## 1. 当前工程形态

### 1.1 技术栈

`package.json` 锁定的运行时组合：

| 层 | 版本 / 包 |
|---|---|
| Web | Next.js `^15.5.25`，React `^19.3.0`，Tailwind 4 |
| 语言 | TypeScript 5，路径别名 `@/*` → `src/*` |
| 数据 | Prisma `^7.10.0`，`@prisma/adapter-pg`，`pg`，PostgreSQL 16 |
| 队列 | BullMQ `^5.80.9`，Redis 8 |
| HTTP | Next Route Handlers；AI 出站用 `undici` `8.10.2`（`package-lock.json` 10289–10296，`engines.node >= 22.19.0`） |
| 前端状态 | zustand。PPC Workspace 的 IndexedDB 只做本地恢复，不是商品或赛狐事实源 |

`package.json` 没有 `engines` 字段。CI（`.github/workflows/ci-cd.yml` 71–72）和 `scripts/bootstrap-server.sh` 23–30 要求 Node 主版本 ≥ 22。bootstrap 不检查 `22.19`，低于 undici 声明的最低版本时仍会通过安装。

### 1.2 目录

| 路径 | 职责 |
|---|---|
| `src/app/` | App Router 页面和 Route Handler。赛狐复刻在 `src/app/sellfox/{sales,performance,listings,orders,shipments,restock}` |
| `src/components/sellfox/` | 工作台和复刻页 UI |
| `src/lib/sellfox/` | 同步、契约、浏览查询、三套读 SQL。本基线 41 个 TS 文件，最大的是 `agent-read.ts`（503 行）、`replica-pages.ts`（422 行）、`workbench-read.ts`（301 行） |
| `src/lib/amazon-sync/` | SP-API / Ads 同步和 MCP（含 `data_*`） |
| `src/lib/agent-platform/` | 已有 `createToolGateway`（`tool-gateway.ts`） |
| `src/lib/integrations/sellersprite.ts` | 卖家精灵 MCP，工具别名落到 `market_*` |
| `src/lib/server/ai-fetch.ts` | AI 出站与代理探测 |
| `prisma/schema.prisma` | 3274 行，单一 schema |
| `prisma/migrations/` | 100 个迁移目录 |
| `scripts/` | worker 入口、发布脚本、选品 CLI、ERP CLI |
| `deploy/systemd/` | 五个 systemd unit |
| `deploy/caddy/run-caddy.sh` | 单独 `docker run` 起 Caddy，不在 compose 里 |

### 1.3 进程组装

生产形态是「本机 Node + systemd」加「Docker 只跑基础设施」。`docker-compose.yml` 只有两个服务，都绑在回环：

- `postgres:16-alpine` → `127.0.0.1:5432`
- `redis:8-alpine` → `127.0.0.1:6379`

应用进程（`deploy/systemd/*.service`，`User=root`，工作目录 `/opt/amazon-ad-bulk-current`，环境文件 `/opt/amazon-ad-bulk-operation/.env`）：

| unit | 启动命令 | 入口 |
|---|---|---|
| `amazon-web` | `npm run start:standalone` | `.next-build/standalone/server.js`，`127.0.0.1:3000` |
| `amazon-worker` | `npm run worker` | `tsx scripts/import-worker.ts` |
| `amazon-image-upscale-worker` | `npm run worker:image-upscale` | `tsx scripts/image-upscale-worker.ts` |
| `amazon-sync-worker` | `npm run worker:amazon-sync` | `tsx scripts/amazon-sync-worker.ts` |
| `amazon-sellfox-sync-worker` | `npm run worker:sellfox-sync` | `tsx scripts/sellfox-sync-worker.ts` |

Caddy 由 `deploy/caddy/run-caddy.sh` 以容器反代到本机 web。公网只开 22/80/443。新机入口是 `http://123.207.47.225`；旧机 `159.75.203.221` / `https://aecob.com` 是另一套库，本文不把两边当成同一数据集。

发布链路已经存在，但是人工触发：

1. `scripts/deployment-plan.mjs` 用 `BASE_SHA..HEAD` 生成 `deployment-plan.json`（是否迁移、重启哪个 worker）。
2. `scripts/package-ci-artifact.sh` 打 standalone 包，剥掉 `.env`。
3. `scripts/release-check.sh` 核对包内容。
4. `workflow_dispatch` 且 `deploy_production=true` 时，`scripts/deploy-ci-artifact.sh` 把包 scp 到服务器，执行 `scripts/server-artifact-release.sh`。
5. 服务器按清单 `npm run db:migrate`（即 `prisma migrate deploy`），切 `/opt/amazon-ad-bulk-current`，按需 `systemctl restart`，健康检查失败则 `rollback_application_release`。

`.github/workflows/ci-cd.yml` 3–8：`pull_request` 和 `push` 到 `main` 会跑 build。`deploy-production` 的条件是 `github.event_name == 'workflow_dispatch' && inputs.deploy_production`（125 行）。推送到 `codex/amazon-multistore-mcp` 本身不触发这条 workflow，除非该推送同时是一个 PR。

## 2. 数据域地图

权威关系先说清楚，后面的读路径和补货都靠它。

| 数据 | 表 / 视图 | 权威是谁 | 读的时候怎么用 |
|---|---|---|---|
| 商品主档 | `ProductRecord`（`prisma/schema.prisma` 350） | 唯一商品事实源。事务、revision、审计、Outbox | 商品中心。赛狐和 Amazon 快照不得回写它 |
| 赛狐店铺 | `SellfoxStore`（1241） | 赛狐店铺列表的本地副本 | 所有赛狐行的 `storeId` 外键 |
| 赛狐当前头 | `SellfoxSnapshotHead`（2448–2455），主键 `(storeId, resource)` | 某一家店、某一个资源「最近一次完整采集」的 `capturedAt` | 只给库存和 Listing 的 current 视图。注释写明：整店采集完成才发布，空采集也会替换 current |
| 库存历史 | `SellfoxFbaInventorySnapshot`（1292），唯一键 `(storeId, capturedAt, sourceKey)` | 每次采集的库存行，历史保留 | current = 快照 JOIN head，`resource='inventory'`（迁移 `20261025020000` 202–203 行的 `sellfox_inventory_current`） |
| Listing 历史 | `SellfoxListingSnapshot`（2457） | 每次采集的 Listing 行 | current = `sellfox_listing_current`，`resource='listings'`（同迁移 204 行）。`listings-read.ts` 9 行注明：current 已经带上店铺和最后一次完整 head，不要再 JOIN payload |
| 销量日 | `SellfoxSalesDailySnapshot`（1332），唯一键 `(storeId, reportDate, sourceKey)` | 报表日事实，不是「当前一行」 | 视图 `sellfox_sales_daily` 用 `SellfoxSalesDayCoverage` 标 `complete`。缺日不补 0 |
| 利润日 | `SellfoxProductDailySnapshot`（1119） | 报表日事实，费用列是后加的类型化投影，`payload` 仍保留 | 视图 `sellfox_profit_daily`。没有 SnapshotHead |
| 广告日 | `SellfoxAdsProductDaily` / Targeting / SearchTerm / Campaign / AdGroup / Placement | 报表日事实 | 工作台 SQL 按报表日读，不经 head |
| 小时样本 | `SellfoxHourlyMetric`（1078） | 广告小时样本 | Prisma `findMany`，不经 head |
| 同步运行 | `SellfoxSyncRun`（1273） | 一次同步尝试的行。`status` 是字符串，不是枚举 | `queued` / `running` / `done` / `failed`（`run-lease.ts` 17–39，`sync-service.ts` 249–254） |
| 同步计划 | `SellfoxSyncSchedule`（1359），`enabled` 默认 false | 组织 + 工作区 + resource 一条计划 | worker 每 30 秒扫描 |
| Amazon 连接与密钥 | `AmazonIntegrationConnection` / `AmazonIntegrationSecret` / `AmazonMcpCredential` | Amazon 授权和 MCP 个人凭证 | 与赛狐 `.env` 凭据分开 |
| Amazon 经营快照 | `AmazonInventorySnapshot`、`AmazonCatalogSnapshot`、`AmazonOrderRecord`、`AmazonFinanceRecord`、`AmazonReturnRecord`、`AmazonSalesTrafficSnapshot`、`AmazonAds*` | SP-API / Ads 自己的已发布快照 | 经营中台和 Amazon MCP 的 `data_*`。不覆盖 `ProductRecord`，也不覆盖赛狐表 |
| Amazon 补货 | `AmazonReplenishmentPolicy` / `AmazonReplenishmentPlan` | 独立建议，不生成采购单 | 与赛狐复刻页的补货建议不是同一张表 |
| AI 配置 | `AiModelSetting`（922），`settings` / `profiles` 为 Json，唯一键 `(organizationId, workspaceId, userId)` | 用户在某工作区的模型配置 | `/api/ai-settings`。密钥在 JSON 里，不是独立轮换表 |

「同一 SKU 同一时刻只有一份读快照」在本基线只对 **current 视图**成立，而且粒度是 **店铺 + 资源**，不是 SKU：

- head 一行覆盖整店该资源的一个 `capturedAt`。
- 行级身份在快照表：`(storeId, capturedAt, sourceKey)`。
- 工作台把事实行配到 Listing 时，用 `LEFT JOIN LATERAL ... LIMIT 1`（`workbench-read.ts` 164），先 MSKU 再 ASIN。这是读模型选择，不是 head 的主键语义。
- 销量、利润、广告按报表日保留多天，本来就不是「一份当前快照」。

## 3. 同步 worker

入口 `scripts/sellfox-sync-worker.ts`。BullMQ `concurrency: 1`（30 行）。没有 Redis 或没有 `SELLFOX_CLIENT_ID` / `SELLFOX_CLIENT_SECRET` 时，调度循环直接返回（40 行），API 也不改成请求内同步。

### 3.1 本基线已接入的 resource

`src/lib/sellfox/sync-contract.ts` 1–2：

`stores`、`inventory`、`sales`、`performance`、`hourly`、`listings`、`ads_report`、`ads_targeting`、`ads_search_term`、`ads_campaign`、`ads_ad_group`、`ads_placement`。

`processSellfoxSyncRun`（`sync-service.ts` 206–240）按这个名单分支。名单外抛出「此赛狐数据域暂未接入 Open API」。**本基线没有 `orders` / `fba_shipments`。**

### 3.2 调度

`sellfoxScheduleIntervals`（`schedule-time.ts` 2）：

| resource | 间隔 | 时钟 |
|---|---|---|
| `stores` | 480 分钟 | 从 `lastEnqueuedAt` 起算 |
| `inventory` | 180 分钟 | 同上 |
| `sales`、`performance`、`listings`、六个 `ads_*` | 1440 分钟 | 上海时间 06:30（`390 * 60_000`，9–14 行）。当天槽位前等待，过了槽位且今天还没入队则补一次 |
| `hourly` | 不在间隔表的 06:30 名单里 | 走固定间隔公式；计划若没写入 `intervalMinutes` 则不能靠这张表 |

计划默认 `enabled = false`。页面不启动 worker。入队时间而不是完成时间决定下一槽。销量补数默认从上一完整冬季的 11-01 起，每轮最多 90 天、默认 7 天（`SELLFOX_BACKFILL_DAYS_PER_RUN`）。

两把锁：

1. **范围锁**：组织 + 工作区 + resource，事务级 `pg_advisory_xact_lock`（worker 51–53 行，同步 API 和计划 API 同样使用）。锁键是 `sellfoxSyncScopeLock`（`schedule-time.ts` 23–25）。
2. **全局限流锁**：`client.ts` 106–111，独立的 `pg` 连接，会话级 `pg_advisory_lock(hashtextextended('sellfox-open-api-global-rate-limit', 0))`，持锁期间再 `sleep 1200ms`，然后才发 HTTP。所有组织共用这一把锁。

### 3.3 限流、重试、失败

- 间隔：持锁的 1200ms，加上请求本身。无 `DATABASE_URL` 时退化为进程内 `lastRequestFinishedAt`（112–114），多进程不再互斥。
- 超时：`SELLFOX_REQUEST_TIMEOUT_MS`，默认 30s，夹在 5–120s（`client.ts` 5）。
- 业务码：`40019` / `40012` / `-1` 可重试；HTTP 429 和 5xx 可重试；`40001` 清 token 再取一次（42–47、173–176）。
- 重试：最多 4 次，退避 `2000 * 2^attempt` 加 0–250ms 抖动（158–182）。
- 不可重试错误进 BullMQ `UnrecoverableError`（worker 23–25）。可重试耗尽后把 run 置回 `queued`，直到 `executionAttempts` 达到上限再 `failed`（`run-lease.ts` 20）。
- 租约丢失不重写 run（worker 22 行）。过期 `running` 收回 `queued`（`run-lease.ts` 39）。
- 失败文案走 `sellfoxStoreFailure`，不回显上游 `msg`（`client.ts` 44 的注释）。

### 3.4 PR #7 尚未进入基线

合入后才会出现，当前树里没有这些文件：

| 项 | PR #7 行为 |
|---|---|
| resource | `orders`、`fba_shipments` 加入 `sellfoxSyncResources` |
| 间隔 | 两者都是 720 分钟，不进 06:30 名单（该分支 `schedule-time.ts` 第 2 行） |
| 订单 | `POST /api/order/pageList.json` → `SellfoxOrderSnapshot`，唯一键 `storeId + orderId + lineKey`，历史保留，同行后写覆盖 |
| 货件 | `POST /api/fba/shippingOrder/pageList.json` → `SellfoxFbaShipmentSnapshot`。整页成功后删掉该店更早采集，并更新 `SellfoxSnapshotHead(resource='fba_shipments')` |
| 补货 | 不建表。`sellfox_listing_current` + 销量日 + 当前货件。公式在该分支 `src/lib/sellfox/restock.ts`：`round(max(0, (30+7) * 加权日均 - (可售 + 在途)))`，权重 7/14/30 = 50/30/20。缺任一窗口、可售或在途则建议为 null，不补 0 |
| 读 | 新增 `orders-read.ts`、`shipments-read.ts`、`restock-read.ts`。`replica-query.ts` 只做查询参数别名（`shopIds` → `shopExternalId`，`searchContent` → `search`），不是第三套 SQL |

阶段 X 按「等 #7 合并再抽 repository」安排，避免和这三套新 SQL 撞车。见第 8 节开放问题 3。

## 4. 读路径

`/sellfox` 不带 domain 仍是原工作台（广告、库存、同步日志）。六个复刻页各自有 `page.tsx`，也经 `src/app/sellfox/replica-by-id.tsx` 11–17 行按 id 分发。

本基线的查询模板是三种，名字在 `replica-pages.ts` 7 行：`ReplicaQuery = "workbench" | "agent" | "stub"`。

| 模板 | 谁用 | 实现 | 数据 |
|---|---|---|---|
| workbench | 销量（65 行）、利润（125 行） | `readSellfoxWorkbench`，`workbench-read.ts` | `sellfox_sales_daily` / `sellfox_profit_daily`，再 LATERAL 配 `sellfox_listing_current` |
| agent | 在线产品（178 行） | `listings-read.ts` 的 `listingsReadSql`，列清单来自 `agent-read.ts` 的 `sellfoxAgentColumns` | `sellfox_listing_current` |
| stub | 订单（236）、货件（294）、补货（341） | `sellfoxEmptyStub`（`replica-stub.ts` 4–21） | 固定 `{ rows: [], stub: true, message: "暂无数据 / 待接赛狐" }`，仍要 `sellfox:view` |

`browse` 不是第三套 SQL。`browse-query.ts` 是所有列表共用的查询解析器（分页、店铺、日期、排序、搜索）。`[domain]/route.ts` 24–26 行决定走 workbench SQL、agent SQL，还是 Prisma `findMany`。

`[domain]/route.ts` 25 行是一条把 layout、排序、标签和几十个广告/Listing 区间筛选项串成条件的分支，然后才调用 `readSellfoxWorkbench`。库存在没有日期筛选时走 `readSellfoxAgentRows`（26 行），带了 `from` / `to` / `allDates` 才落到快照表 `findMany`（44–47 行）。

三套 SQL 都用 `Prisma.sql` 绑定参数。膨胀点是分支本身：`workbench-read.ts` 用 `Prisma.raw` 拼列名和排序（15、37、121、126、151、166、189、205、226 行），其中 126 行的维度和 151 行的列名依赖「解析器已经收成闭集」。`agent-read.ts` 用同一份 `sellfoxAgentColumns` 生成 `s."<key>"`。`listings-read.ts` 再维护一份投影列和筛选。

新增一个复刻维度或筛选项，现在要动的位置：

1. `src/lib/sellfox/replica-pages.ts`：维度、列、按钮、`disabled` 文案。
2. 筛选 UI：各页 `*Workbench.tsx` 读 `replicaPage()`，筛选项本身写在页面配置里。
3. 读 SQL：`browse-query.ts` 增加解析，再改 `workbench-read.ts` 和/或 `listings-read.ts` / `agent-read.ts`。
4. API：`src/app/api/sellfox/[domain]/route.ts` 的 domain 名单和 25 行分支；导出路由要再对一份。新复刻域还要 `src/app/sellfox/replica-by-id.tsx` 加一个 `if`。

PR #7 会把 stub 换成 `orders-read` / `shipments-read` / `restock-read`，触点变成五处，`replica-query.ts` 是第六处参数别名。

## 5. 认证范围

`requireApiPermission(moduleId, action, request?)` 定义在 `src/lib/auth/api-permissions.ts`。动作只有五种：`view | create | edit | approve | export`（`src/lib/accounts/permissions.ts` 4）。

它检查的是：

1. 当前用户已登录，否则 401。
2. 角色在该 **模块** 上有该 **动作**，否则 403。模块是 `permissionModules`（20–35 行）里的一项，赛狐整个产品是一个模块 `sellfox`，路径前缀 `/sellfox`。
3. 请求里如果带了工作区，再 `assertWorkspaceAccess`。Cookie 不授予工作区。

它不检查行、店铺、SKU、resource。赛狐路由的实际粒度：

| 路由 | 调用 |
|---|---|
| overview、`[domain]`、`[domain]/[id]`、sales、performance、orders/shipments/restock stub | `("sellfox", "view")` |
| `[domain]/export`、performance export | `("sellfox", "export")` |
| `POST /api/sellfox/sync` | `("sellfox", "create")` |
| schedules GET / POST | `view` / `create` |

同步执行开始时 `canExecuteSellfoxSync` 会再看启用计划的用户是否仍有效（worker 56–59 行）。这是运行期复核，不是 `requireApiPermission` 的行级能力。

AI 测试聊天用的是 `("settings", "view")`（`test-chat/route.ts` 22）。Amazon MCP 的 `data_*` 另有凭证、店铺和工具名单，不走 `sellfox` 模块。

## 6. 现状不足

每条都是本基线能指到的代码。PR #7 的行为单独注明。

### 6.1 Prisma 迁移目录已经不好审

`prisma/migrations` 有 100 个目录。能在树上直接看到的问题：

- **同一时间戳两套迁移。** `20261022000000_add_amazon_data_hub` 和 `20261022000000_add_meeting_notes` 前缀相同、目录名不同。Prisma 按完整目录名记账，所以不是「同名无法应用」，而是审阅和跨库对齐时容易看成一次迁移。两边改的表不同（Amazon Data Hub 表 vs `ProductMeetingNote`）。
- **利润费用被拆成一串加法迁移。** `20261026060000_sellfox_listing_publish_state` 到 `20261026190000_sellfox_product_daily_fee_wrap`，中间 60000–190000 每档加一组类型化费用列。`docs/sellfox-sales-profit-p0.md` 写明 123 要先有全部前置迁移再加下一档。`SellfoxProductDailySnapshot` 因此在 schema 1119–1238 行铺了几十个可空 Float，`workbench-read.ts` 150 行和 171 行把同一份列名再写进 SELECT 和汇总。
- **「30000 改名」在当前树里对不上一个被改名的目录。** 能对上的是 `20261025030000_allow_deleted_sellfox_listing_without_msku`：只对 `SellfoxListingSnapshot.msku` `DROP NOT NULL`（该迁移 SQL 1–4 行）。`docs/sellfox-sync-workbench-plan.md` 36 行记录过本机 migration history 与 Amazon 分支不一致、未 reset。若某环境曾经改过已应用目录的名字，checksum 只存在 `_prisma_migrations` 里，本次没有连库，不能断言生产已经冲突。

影响：下一张订单/货件表（PR #7 的 `20261106140000`）会排在这条长链后面。没有影子库 dry-run 时，审的人无法从目录名判断「这 100 个里哪些已经在 123 上」。

### 6.2 全局限流绑在数据库连接上

`src/lib/sellfox/client.ts` 75–96、106–111、142–146。每次 Open API 调用：

- 另开一条 `pg` 连接（不是 Prisma 事务）；
- `pg_advisory_lock` 全局键 `sellfox-open-api-global-rate-limit`；
- 持锁睡眠 1200ms；
- 连接断开则中止本次 HTTP，错误「全局限流连接不可用 / 已断开」，`retryable: true`。

数据库不可用时，同步本来也写不进快照。额外的故障点是：**数据事务还没开始，限流连接先失败，请求就不会发出。** 锁是全局的，一家店的慢响应挡住所有组织。进程崩溃时会话锁会随连接释放，这一点 PostgreSQL 会处理；持锁睡眠仍把吞吐卡在大约每 1.2 秒加一次往返。

worker 已经要求 Redis，并且 BullMQ `concurrency` 为 1。限流不需要再占一条业务库连接。

### 6.3 `scutil` 只在 macOS 上有意义

`src/lib/server/ai-fetch.ts` 25–45。顺序是环境变量 `HTTPS_PROXY` / `HTTP_PROXY`，然后 `execFileSync("scutil", ["--proxy"])`。没有 `process.platform === "darwin"` 判断。`catch` 把结果缓存成 `null`，所以 Linux 上进程不会因此退出，但：

- 每次进程第一次 AI 请求都会尝试执行一个不存在的二进制；
- 服务器若只配了 macOS 系统代理、没配环境变量，Linux 上代理探测结果是空，`fetchAiApi` 66 行会报「当前服务端未检测到可用代理」。

生产机是 Ubuntu。这条路径对 123 没有正向作用。

### 6.4 AI 测试路由依赖 Node 22.19+ 的 undici

`src/app/api/ai-settings/test-chat/route.ts` 6 行 import `fetchAiApi`。`ai-fetch.ts` 2 行顶层 `import { fetch as undiciFetch, ProxyAgent } from "undici"`。锁定版本 undici `8.10.2` 声明 `node >= 22.19.0`（`package-lock.json` 10294–10296）。

仓库源码没有 `markAsUncloneable` 这个标识符。它在 undici 内部：Node 20 的 `node:util` 不导出该函数，路由模块在加载期就会失败，走不到 20 行的 handler。CI 用 Node 22（workflow 71 行），bootstrap 只断言主版本 ≥ 22（`bootstrap-server.sh` 23、30 行）。BOX 若仍是 Node 20，或生产是 22.0–22.18，测试聊天和任何引用 `ai-fetch.ts` 的服务端 AI 调用都会在 import 阶段失败。

### 6.5 读 SQL 按页面复制分支

见第 4 节。具体膨胀：

- `workbench-read.ts` 149–171 行：销量、利润、广告三套字段列表和「null 当 0 的费用列」名单各写一遍。利润费用名单和 schema 列同步增长。
- `[domain]/route.ts` 25 行：筛选是否走 workbench 的判断已经是一行超长条件。
- `agent-read.ts` 的列数组、`listings-read.ts` 的投影列、视图定义，三处都要认识同一列。

PR #7 不收敛这个趋势：它新增三份 `*-read.ts`，再用 14 行的 `replica-query.ts` 做参数别名。

### 6.6 一个新维度要改多处，复刻壳也在分叉

`replica-by-id.tsx` 已经把 6 个 id 写成 6 个组件。每个 `*Workbench.tsx` 再读 `replica-pages.ts`。筛选项、空态、灰显原因、API 分支不在一个注册表里。第 4 节的四处是下限；导出路由和 `replica-by-id` 是额外两处。

### 6.7 Snapshot head 的语义比补货需要的更窄

本基线只在两处写入 head：

- 库存最后一页：`snapshot-sync.ts` 58–59。
- Listing 最后一页：`listing-sync.ts` 35。

销量、利润、广告不写 head。current 视图要求 `h.capturedAt = t.capturedAt`（迁移 203–204 行）。这保证「这一家店的库存/Listing 要么整份可见，要么仍是上一份」。

PR #7 的补货把三个时刻拼在一行：Listing current 的 `capturedAt`、销量日（按报表日，无 head）、货件 head 的 `capturedAt`。三个时刻可以不同。公式在缺数时返回 null，这避免了补 0，但没有表达「这三份快照不是同一时刻」。读的人会把它当成一份建议。

### 6.8 凭据没有轮换模型

赛狐：`client.ts` 22–26 直接读 `SELLFOX_CLIENT_ID` / `SELLFOX_CLIENT_SECRET`。overview 和 schedules 只返回 `configured` 布尔（`overview/route.ts` 33，`schedules/route.ts` 21、35）。token 缓存在 worker 进程内存（`client.ts` 50–66），`expires_in` 按毫秒提前刷新。没有 secret 版本、没有 `rotatedFrom`、换密钥要改服务器 `.env` 并重启 worker。

AI：`AiModelSetting.settings` Json 存 baseUrl 和 apiKey（schema 922–936，`src/lib/ai-settings.ts`）。按用户 + 工作区一条，不是工作区级密钥，也没有轮换记录。

卖家精灵 MCP token 在集成配置里，和模型设置分开。Amazon MCP 已有 `AmazonMcpCredential` 和 `rotatedFromId`（迁移 `20261105010000_amazon_multistore_mcp`）。三套密钥三种存法。

### 6.9 测试金字塔不齐

| 现有 | 实际覆盖 | 缺口 |
|---|---|---|
| `tests/sellfox-replica-pages.test.ts` | `node:test`，断言 `replicaPages`、日期预设 | 不打 API，不渲染页面 |
| `npm run test:sellfox:browser` → `tests/browser/sellfox.config.ts` | 本地 Playwright，`headless: true`，`page.route` 拦截 `127.0.0.1` 上的模拟 API | 不是 BrowserStack，不连真实赛狐，不验证 SQL |
| `tests/integration/amazon-ads-mcp.integration.ts` | Amazon MCP 的离线库集成 | 不覆盖卖家精灵 `market_*` 的响应契约 |
| `npm run test` | `tsx --test tests/*.test.ts`，设计上不依赖数据库和密钥 | 大 SQL 的回归靠 fixture 和相邻单测，六个复刻页没有同一份契约测试 |

PR #7 为订单、货件、补货加了单测（该 PR 描述写 24 项相关单测）。合入前，这三个页面在本基线上只有 stub 单测能兜住。

### 6.10 发布要人点，回滚不含数据库，也没有内存门禁

- 合并 `codex/amazon-multistore-mcp` 不会部署。`push` 触发器只写了 `main`（workflow 5–7 行）。部署只在 `workflow_dispatch`（125 行）。这和「先改仓库，你确认后再上 123」一致，缺的是：这条产品分支合并后没有自动的 build + artifact + release-check。
- `server-artifact-release.sh` 375–380：`requires_migration` 或首次安装时直接 `npm run db:migrate`。没有 `prisma migrate diff`，没有待执行 SQL 的人工附件，没有单独的迁移角色。
- 五个 unit 都是 `User=root`（`amazon-web.service` 19 行）。迁移使用应用 `.env` 里的 `DATABASE_URL`，也就是能读写业务表的那个用户。
- 失败回滚是 `rollback_application_release`（218 行起）：切回上一版 symlink，重启本次动过的进程。`RELEASE-RESULT.json` 固定写 `database: not_rolled_back`（134 行）。迁移只向前。
- 脚本记录磁盘，不读内存水位。123 内存紧时，`systemctl restart` 同时拉起 web 和多个 tsx worker，没有「可用内存低于阈值就停」的门禁。这里没有名为 RAM rollback 的实现；应用回滚存在，数据库不回滚，内存不足不会单独触发回滚。

### 6.11 灰显原因堆在前端配置常量里

`replica-pages.ts` 35–36：

```text
locked = "赛狐页面有此控件，本地快照没有对应字段，不造数。"
noWrite = "此复刻页不发起同步或导入，避免写入数据库。"
```

销量、订单等按钮的 `disabled` / `reason` 引用这两句（例如 100–103 行附近的同步按钮，以及 45 行业务员维度的专用原因）。页面组件只渲染配置。结果是：

- 原因是静态文案，不反映这家店 head 缺失、计划关闭、还是接口 40021；
- 每加一个控件就长大文件。现在 422 行，六个页面的列、维度、按钮都在里面；
- 服务端 stub 另有一句「暂无数据 / 待接赛狐」（`replica-stub.ts` 20），和页面 `emptyHint` 不是同一来源。

### 6.12 赛狐客户端没有调用指标

`src/lib/sellfox` 下没有 OpenTelemetry、Prometheus 或延迟直方图。一次调用的结局只留在：

- `SellfoxSyncRun.error` 的自由文本；
- `SellfoxSyncRun.summary` Json；
- worker 的 `console.error`（`sellfox-sync-worker.ts` 87–92）；
- `WorkerHeartbeat`（schema 905–920）只有 online/stopping、concurrency、`lastSeenAt`。

看不到每个 path 的次数、P95、`40019`/`40012`/`40021` 的分布。Amazon Ads 侧已有 `AmazonAdsApiBudget` 和 sync attempt 表，赛狐没有对等物。

## 7. 升级建议

顺序：数据语义 → 同步 → 读路径 → 接口契约 → AI → 发布与观测 → 测试。每一条都写目标、原理、范围、验收、不做的事。工作量用小 / 中 / 大，不估日历时间。

### 7.1 Domain repository，收口多套 SQL

- **目标：** 页面和 Route Handler 只依赖一个领域读接口，SQL 仍留在该资源的一个文件里。
- **原理：** 现在的正确行为（参数化、缺数不补 0、current 必须配 head、导出与列表共用 `sellfoxBrowseQuery`）要保留。要拆掉的是「路由里决定用哪段 SQL」和「同一列名在三处手写」。repository 按资源导出 `list(query, scope)` / `export(query, scope)`，返回已经存在的 `{ rows, pagination, facets, totals }`。workbench 与 agent 的差异变成资源实现内部的策略，而不是 `[domain]/route.ts` 25 行的条件。新筛选项只加：解析器白名单、该资源 repository 的一处谓词、`replica-pages` 里的一个筛选项 id。
- **影响：** `src/lib/sellfox/*-read.ts`、`[domain]/route.ts`、导出路由、六个复刻 route。不改 JSON 字段名。不需要迁移。前端契约不破，前提是响应形状和空值语义保持不变。PR #7 的三个 read 文件一并收进同一接口，不单留 `replica-query.ts` 做别名。
- **验收：** 现有 `tests/sellfox-*.test.ts` 中 browse / agent / export 断言保持通过；为每个资源加一条「未知筛选项被拒绝」的单测；`tsc --noEmit`。不在这一阶段改页面像素。
- **不做：** 不把 SQL 改写成 Prisma `findMany`；不合并销量日和 current 库存；不引入新的筛选维度。

### 7.2 Snapshot head 一致性契约

- **目标：** 读「当前」数据的人能指出这份行属于哪一次完整采集；拼了多个资源时，时刻不一致要显式出现在响应里。
- **原理：** head 已经是「整店、整资源、一次 `capturedAt`」的发布指针。契约写成三条：只有最后一页成功才 upsert head（现有库存/Listing 已如此）；current 视图只 JOIN 这个 `capturedAt`；跨资源计算（补货）在结果上带 `asOf: { listings, salesThrough, shipments }`，三个时间不同就带 `consistency: "mixed"`，缺 head 的资源不参与建议（建议保持 null）。不把混合时刻藏进一个数字。
- **影响：** 读响应增加可选元数据。旧客户端忽略未知字段即可，不删现有字段。PR #7 的货件 head 沿用同一主键 `(storeId, resource)`，resource 用 `fba_shipments`，不复用 `inventory`。若要持久化 `consistency`，用响应字段即可，不必先加列。
- **验收：** 单测覆盖「未完成采集不推进 head」「空采集替换 current」「补货三个 `capturedAt` 不同则 `consistency=mixed` 且建议仍按现有公式、缺数仍为 null」。用现有 PGlite / 单元测试，不连生产。
- **不做：** 不按 SKU 建 head；不回溯修改历史快照；不在这一阶段改补货公式的 30/7 和权重。

### 7.3 把一次同步写成带阶段的 `SellfoxSyncRun`

- **目标：** 一次执行能回答停在哪一阶段、失败属于哪一类，而不只靠 `error` 自由文本。
- **原理：** 行已经存在，状态是字符串。加性扩展：`phase`（`claim` / `fetch` / `parse` / `commit` / `publish_head`）和 `failureCode`（`rate_limited` / `unauthorized` / `bad_payload` / `lease_lost` / `retry_exhausted` / `credential_missing`）。仍写现在的 `status`，避免旧查询 `status IN ('queued','running')`（worker 64 行）失效。阶段在 `processSellfoxSyncRun` 的现有分支更新，不新开队列表。失败码从 `SellfoxRequestError.code` 和现有错误类映射，禁止把上游 `msg` 写入码。
- **影响：** 一张加法迁移（两列可空，旧行保持 null）。worker、`sync-service.ts`、`run-lease.ts`、同步日志 UI 若展示 `error` 可继续展示，阶段作为附加列。不改 BullMQ job 形状。
- **验收：** `tests/sellfox-sync-run.test.ts` 扩展：可重试 40019 记 `rate_limited` 且最终可回到 `queued`；payload 不完整记 `bad_payload` 且 `UnrecoverableError`；租约丢失不覆盖新主人的 phase。
- **不做：** 不把 `status` 改成 Postgres enum（那会重写已有行的类型）；不记录响应体；不在这一阶段做多副本租约以外的新锁。

### 7.4 限流从业务库挪到队列侧

- **目标：** Open API 仍全局串行且间隔不少于 1200ms，但不再为了睡眠去占 PostgreSQL 会话。
- **原理：** 赛狐要求串行和 1200ms，这是对方的限制，保留。worker 已经依赖 Redis，BullMQ 并发为 1。把 `pg_advisory_lock('sellfox-open-api-global-rate-limit')` 换成 Redis 上的同一个名字（`SET` 带令牌和 PX，释放时核对令牌）。等待发生在发 HTTP 之前，不包住数据库事务。Postgres 挂了，任务在写快照时失败，失败码走 7.3 的 `credential_missing` 以外的基础设施失败；限流连接本身不再是第一故障点。范围锁 `pg_advisory_xact_lock` 留在入队事务里，它保护的是「不要插入两行 run」，时间很短。
- **影响：** `client.ts`、worker 测试里对 `DATABASE_URL` 缺省退化为进程内节流的分支（112–114 行）改为「无 Redis 则拒绝发请求」，与「无队列不调度」一致。不改 1200ms，不改签名算法。无迁移。
- **验收：** `tests/sellfox-client.test.ts`：两段并发调用间隔 ≥ 1200ms；Redis 不可用时零次 HTTP；不再要求为限流建立 `pg` Client。
- **不做：** 不按店铺拆配额（对方限制是开发者账号级的）；不把间隔改成可配置到 1200ms 以下。

### 7.5 赛狐调用指标

- **目标：** 能按 path 和错误码看次数与延迟，不引入一套新的监控产品。
- **原理：** 在 `sellfoxPost` 成功和最终失败处打一条结构化日志：`path`、`httpStatus`、`code`、`durationMs`、`attempt`、`organizationId`。不打 token、sign、body。进程内保留一份滚动计数（次数、错误码、最大延迟），挂到现有 `WorkerHeartbeat.metadata`（schema 913 行已是 Json）。P95 用心跳周期内的样本，不在数据库建时序表。Amazon 已有预算表，赛狐先不抄那张表，避免两套预算。
- **影响：** `client.ts`、心跳写入。日志新增字段。无迁移。前端无契约变化。
- **验收：** 单测断言日志对象含 path 与 duration、不含 `client_secret` / `access_token` / `sign`；心跳 metadata 在一次成功和一次 40019 后计数不同。
- **不做：** 不上 OpenTelemetry collector；不把指标当告警平台；不在页面画图。

### 7.6 AI 工具网关：`market_*` 与 `data_*` 进同一注册表

- **目标：** ERP 的 AI 配置面板能发现并调用两类工具：外部市场 MCP 的 `market_*`，以及本系统已有的 `data_*`。默认关闭，按工作区计配额。
- **原理：** 不要新建第二套执行器。`src/lib/agent-platform/tool-gateway.ts` 的 `createToolGateway` 已经有工具名单、adapter、审批、`invokeMcp` 的 schema 校验和超时。`src/lib/amazon-sync/mcp-tool-registry.ts` 19–23 行已经注册 `data_list_tables`、`data_describe_table`、`data_query`、`data_sync_status`、`data_sync_start`。`src/lib/integrations/sellersprite.ts` 214–222 行把卖家精灵能力别名到 `market_find_products`、`market_research_keyword`、`market_scan_node` 等。缺的是 AI 面板到这张注册表的一条路，以及「谁的密钥、这个月还能调几次」。

  建议的 `AiToolGateway` 是这层薄注册，不是新运行时：

  1. 工具定义仍来自现有注册表。`data_sync_start` 保持「只创建申请」，不因为进了 AI 面板就变成执行同步。
  2. `market_*` 只读。写操作不进第一批。
  3. 密钥按工作区存在独立记录（可复用 `ExternalIntegrationSetting` 的组织边界，或新增工作区级行），不塞进 `AiModelSetting.settings`。接口只返回 `configured`，与赛狐 overview 相同。
  4. 默认 `enabled=false`。开启后按工作区自然月计数，超限拒绝并返回稳定错误码，不降级成伪造数据。
  5. 模型 baseUrl 仍走 `AiModelSetting`。工具密钥和模型密钥分开轮换。

  代码里没有名为「多宝鱼」的 MCP 客户端。`src/lib/lili/catalog.ts` 51 行只把 slug 前缀 `duobaoyu-` 去掉。`tests/selection-research.test.ts` 168 行还断言研究报告 HTML 不包含「多宝鱼」。在开放问题 1 确认之前，`market_*` 只接已经存在的卖家精灵适配器。
- **影响：** `/settings` 的 AI 面板增加「工具」区，按工作区开关和配额。新表或扩表现有集成表（加法迁移，密钥列不明文进日志）。不改 `/api/mcp/amazon` 的旧工具名。`docs/ai-mcp-erp-collaboration-upgrade-todo-2026-11-06.md` 的 C10 是「逐域登记已有只读 service」，本条是它在 AI 面板上的入口，不提前做 C10 的全模块开放。
- **验收：** 扩展现有 MCP 集成测试：未开启时 `tools/list` 不返回 `market_*`；开启且配额为 0 时调用被拒绝且零次外部 HTTP；`data_query` 仍走原权限和店铺范围；响应与日志不含 token。
- **不做：** 不在 CI 调用真实 MCP；不把内部 Agent 工具整表导出；不让 AI 写 `ProductRecord`、不让 AI 确认 Amazon 出价。

### 7.7 `ai-report`：工具结果收成一份可打开的报告

- **目标：** 一次调研生成一份 HTML 或 Markdown，落在 `documents`，页面 `/reports/:id` 只读打开。
- **原理：** 调用链是 7.6 的网关，不是模型直接抓 URL。流程：用户在已有 AI 面板发起「调研」→ 网关按配额调用已注册的 `market_*` / `data_*` → 服务端用固定段落聚合（机会、自有销量、缺数）→ 生成 Markdown，并渲染一份无外链脚本的 HTML → 写入 `documents`（组织、工作区、作者、工具版本、配额流水 id）。`/reports/:id` 做 `settings:view` 或新模块 `reports:view`，只渲染本工作区文档。缺数保持 null，沿用选品研究「空不是 0」的规则。HTML 沿用 `tests/selection-research.test.ts` 已有的约束：不含 `<script>`，不含外部 `src`/`href`。
- **影响：** 新模块 `src/lib/ai-report/`、新页面、一张 `documents` 表（加法迁移）。AI 面板加一个入口。不改 Listing AI 的返回结构（`src/lib/listing-ai/types.ts`）。
- **验收：** 用固定 MCP fixture（见 7.9）生成报告；断言章节、null、以及 HTML 无脚本；配额耗尽时不写文档；别的工作区 id 返回 404。
- **不做：** 不自动刊登、不改广告、不把报告回写赛狐；第一版不做协同编辑。

### 7.8 发布：合并即构建，上 123 仍要确认

- **目标：** `codex/amazon-multistore-mcp` 合并后自动完成 build、artifact、release-check；安装到 123 仍由你在 workflow 里明确打开。
- **原理：** 现有四段脚本可以留用。要改的是触发器：`push` 增加 `codex/amazon-multistore-mcp`，让合并产生通过 release-check 的制品（保留 14 天，workflow 121 行已是 14 天）。`deploy-production` 继续要求 `workflow_dispatch` + `deploy_production=true` + `base_sha` 等于线上 `RELEASE.json` 的 commit。`target_host` 在这次确认里选 `123.207.47.225`。旧机不作为默认主机。文档改动仍走 `deployment-plan.mjs` 的「只同步、不发布应用」判断，避免文档 PR 重启 web。
- **影响：** `.github/workflows/ci-cd.yml` 的 `on.push.branches`。不改服务器脚本的回滚语义。前端无变化。
- **验收：** 用一次文档 PR 证明 workflow 在该分支上跑了 release-check 且 `deploy-production` 被跳过；部署作业仍只在手动输入 `deploy_production=true` 时出现。不在本计划的实施里真正对 123 执行部署。
- **不做：** 不把合并直接等同于部署；不自动选 159；不在失败时 `migrate down`。

### 7.9 迁移门禁与数据库角色

- **目标：** 生产上的 `prisma migrate deploy` 之前能看到将执行的 SQL，并且应用角色最终不再是超级用户。
- **原理：** CI 在有迁移文件的变更上，对临时 Postgres 16 执行 `migrate deploy`（仓库已有 `scripts/test-amazon-sync-integration.mjs` 的临时库做法可复用），并把 `prisma migrate diff` 的待执行 SQL 附在制品旁供人读。这是 dry-run，不碰 123。生产步骤仍是向前 `migrate deploy`，失败只回滚应用（现有 134 行）。角色分离是另一步：新建迁移角色和应用角色，`.env` 的 `DATABASE_URL` 换成应用角色；这一步改服务器密钥，必须单独确认，不能夹在普通发布里。
- **影响：** CI 与发布文档。角色分离会改 123 的 `.env` 和 Postgres 角色，属于全局操作。无业务 schema 变更，直到真的要加 7.3 / 7.6 / 7.7 的列。
- **验收：** 临时库从空库应用到当前迁移目录，`migrate status` 无 pending；故意缺迁移的 schema 改动被 `deployment-plan.mjs` 拒绝（该脚本已有此检查）。角色分离的验收是：应用角色执行 `migrate deploy` 失败，迁移角色才能成功。后者在获得确认前不做。
- **不做：** 不 squash 已应用迁移；不改 100 个历史目录的名字；不在文档任务里连生产库对账 checksum。

### 7.10 灰显原因改由服务端给出

- **目标：** `replica-pages.ts` 只保留控件 id 和「这个复刻页永远不写库」这类静态约束；数据还没同步、head 缺失、计划关闭，由接口的 `disabledReasons` 返回。
- **原理：** 静态 `locked` / `noWrite` 适合「没有这个字段，不造数」。不适合「这家店昨晚的货件采集失败」。页面渲染 `reason` 时优先用响应，响应没有再用静态句。这样加一个筛选项不必再发明一句新的全局常量。
- **影响：** 列表响应多一个可选数组。旧页面忽略它仍能显示静态原因。`replica-pages.ts` 随 7.1 停止膨胀，不要求一次删空。
- **验收：** stub 或空库响应仍是「暂无数据」；有失败店铺时响应带店铺级原因（PR #7 已有 `failures` 字段，接上即可）；单测锁定文案不出现密钥。
- **不做：** 不把整份 `replica-pages.ts` 拆文件作为独立 PR；不改视觉。

### 7.11 测试金字塔

- **目标：** 复刻页和 AI 工具各有一层契约测试，浏览器测试继续只证明壳和路由。
- **原理：**

  | 层 | 测什么 | 建议落点 |
  |---|---|---|
  | unit | 公式、日期、head 是否推进、配额计算 | `tests/sellfox-*.test.ts`、`tests/ai-report.test.ts` |
  | contract | 已知 MCP / 赛狐响应 fixture → 解析结果与错误码 | `tests/fixtures/sellfox/` 已有赛狐样例；`market_*` 用脱敏 JSON，断言工具名和 null，不发网 |
  | integration | 临时库上的迁移 + repository 列表与导出一致 | 复用 amazon-sync 临时库脚本的模式，赛狐单独一个 `--sellfox-reads` |
  | browser | 登录壳、筛选 URL、灰显、空态、切工作区迟到响应 | 保持 `tests/browser/sellfox.config.ts` 的本地 Playwright。不引入 BrowserStack |

- **验收：** `npm run test` 覆盖新增 unit 和 contract；browser 命令仍是 `npm run test:sellfox:browser`，配置里没有第三方云。
- **不做：** 不把 Playwright 当成 SQL 正确性的证明；不在 CI 默认跑全套 browser。

## 8. 阶段计划

价值优先，风险从低到高。阶段可以有两个 PR，但不要把后一阶段的迁移提前塞进前一阶段。

### 阶段 X — 读路径与快照契约

- **范围：** 7.1、7.2、7.10 的响应字段。用户可见行为不变：六个页面仍读现在的数据；订单/货件/补货在 #7 合入前仍是空态。合入 #7 之后，repository 包住那三份 read，补货响应带上 `asOf` 和 `consistency`。
- **工作量：** 中。主要 PR 两个：先抽 repository（不改 JSON），再补 head 元数据。
- **依赖：** 开放问题 3。建议本阶段的代码 PR 等 #7 合并后从该提交切开，避免两套 read 文件互相覆盖。无生产迁移。不需要第三方配置。
- **验收门：** 第 7.1、7.2 的测试通过；`tsc --noEmit`；列表 JSON 旧字段快照对比无变化。不上 123。

### 阶段 Y — 同步可观测与限流

- **范围：** 7.3、7.4、7.5。同步结果更易读，限流不再占业务库连接。计划仍默认关闭，1200ms 不变。
- **工作量：** 中。一个加法迁移 PR（phase / failureCode），一个 client 限流 PR。
- **依赖：** 阶段 X 的读路径不依赖本阶段。本阶段的迁移要走现有人工 `workflow_dispatch`，或等阶段 W 的 dry-run。需要你确认可以在 123 上执行这一张加法迁移，确认前只合并到分支。
- **验收门：** 第 7.3–7.5 的单测；worker 在 Redis 关闭时零 HTTP；旧 `status` 查询仍能找到在途 run。

### 阶段 W — 发布与迁移门禁

- **范围：** 7.8 全部，7.9 的 CI dry-run。数据库角色分离单列，不进第一张 PR。
- **工作量：** 触发器改动为小；角色分离为大。
- **依赖：** 开放问题 4。不依赖 X/Y 的业务代码。角色分离依赖你提供维护窗口，并接受 `.env` 中 `DATABASE_URL` 换成非超级用户。
- **验收门：** 文档或空改动 PR 在 `codex/amazon-multistore-mcp` 上产出 release-check 且不部署；临时库能从空库应用到仓库里的迁移目录。真正上 123 仍是另一次你点的 workflow。

### 阶段 Z — AI 网关与报告

- **范围：** 7.6、7.7，以及 7.11 里的 MCP contract。
- **工作量：** 大。至少三块：注册与配额、面板、`documents` + `/reports/:id`。
- **依赖：** 开放问题 1 和 2。阶段 W 的迁移 dry-run 先于 `documents` 表上生产。沿用已有 gateway 和 `data_*` 注册表，不重做 C01–C09。卖家精灵密钥若已在集成配置里，工作区开关只引用它，不复制 token。
- **验收门：** fixture 报告可在隔离页面打开；默认关闭；配额用尽零外部请求；跨工作区 404；HTML 无脚本。不接真实多宝鱼、不部署。

## 9. 技术债登记

| # | 出处 | 影响 | 缓解 | 挡住下一阶段？ |
|---|---|---|---|---|
| D1 | 两个 `20261022000000_*` 目录；`20261026060000`–`20261026190000` 费用列迁移；`schema.prisma` 1119–1238 与 `workbench-read.ts` 150、171 行列名单 | 审迁移的人无法靠目录名判断生产进度；加一列费用要改 schema、迁移、SELECT、汇总名单 | 新列停止「一档一迁移」的节奏，费用投影改由 7.1 的列清单生成 SELECT。历史目录不改名 | 不挡 X。挡任何「整理旧迁移」的想法，那件事不做 |
| D2 | `client.ts` 106–111 全局 `pg_advisory_lock` | 数据库抖动时同步停在发请求之前；全组织串行 | 阶段 Y 的 Redis 锁 | 不挡 X。Y 的限流 PR 要先做这个 |
| D3 | `ai-fetch.ts` 34–42 `scutil` | Linux 上探测无意义；没配 `HTTPS_PROXY` 时 AI 出站报无代理 | 仅在 `darwin` 调用 `scutil`。可随 Z 之前的小补丁，不必单开阶段 | 不挡 X/Y。挡 Z 在 Linux 上的真实模型调用，除非环境变量已配代理 |
| D4 | `test-chat/route.ts` 6 行 → `ai-fetch.ts` 2 行；undici 8.10.2 要求 Node ≥ 22.19（lock 10294–10296）；bootstrap 只检查主版本 ≥ 22 | Node 20 或 22.18 以下，AI 路由在 import 期失败 | `package.json` `engines` 写成 `>=22.19.0`，bootstrap 同步检查 | 不挡 X/Y。挡 Z 的联调环境 |
| D5 | `[domain]/route.ts` 25 行；`workbench-read.ts`；`agent-read.ts`；`listings-read.ts`；`replica-by-id.tsx` 11–17 | 新筛选项改多处，行为容易只改到其中一处 | 阶段 X | 这就是 X 要还的债 |
| D6 | head 只在 `snapshot-sync.ts` 58–59、`listing-sync.ts` 35；PR #7 补货拼三个时刻 | 建议看起来像同一时刻的结论 | 阶段 X 的 `asOf` / `consistency` | 不挡 X 的 repository PR。挡「把补货数字当采购量」 |
| D7 | `client.ts` 22–26；`AiModelSetting` 922–936 | 赛狐和模型密钥无版本；Amazon MCP 已有 `rotatedFromId` | 阶段 Z 的工作区密钥记录。赛狐密钥轮换仍是改 `.env`，不塞进本计划 | 不挡 X/Y。Z 若把市场密钥放进模型 JSON，会加重这条债，所以 Z 禁止那样做 |
| D8 | `tests/sellfox-replica-pages.test.ts`；`tests/browser/sellfox.config.ts` 本地 Playwright | 复刻页的 SQL 和空态没有同一份契约；浏览器测试不证明数据 | 阶段 X 加 repository 单测；阶段 Z 加 MCP fixture | 不挡开工。X/Z 的验收门依赖补上的测试 |
| D9 | workflow 5–7、125 行；`server-artifact-release.sh` 134、218、375–380；unit `User=root` | 产品分支合并无制品；迁移无 dry-run；回滚不含库；root 跑迁移 | 阶段 W。角色分离单独确认 | 不挡 X。挡 Y/Z 的迁移上 123 |
| D10 | `replica-pages.ts` 35–36 及各页 `disabled` | 原因与真实失败脱节，文件继续变长 | 阶段 X 的 7.10 | 不挡 |
| D11 | 赛狐 client 无指标；`WorkerHeartbeat` 905–920 只有存活 | 限流和 40021 只能翻日志文本 | 阶段 Y 的 7.5 | 不挡 |
| D12 | `SellfoxSyncRun.status` 是字符串（schema 1279） | 拼写错误的状态不会被数据库拒绝 | 阶段 Y 加 `failureCode`，保留 `status` 字符串 | 不挡。不要在 Y 里改成 enum |
| D13 | 多宝鱼没有客户端；卖家精灵才有 `market_*`（`sellersprite.ts` 214–222） | 若把两者当成一个系统，会接错密钥和端点 | 开放问题 1 之前，Z 只注册卖家精灵 | 挡 Z 的市场工具范围 |
| D14 | `docs/ai-mcp-erp-collaboration-upgrade-todo-2026-11-06.md` C10–C11 未做；Gateway 与 MCP 调用尚未在生产验证 | AI 面板若绕过现有 gateway，会绕过 schema 校验和审批 | Z 必须调用 `createToolGateway` | 挡任何「在面板里直接 `fetch` MCP」的实现 |

## 10. 开放问题

最多五条，都是不决定就无法开工或会接错系统的事。

1. **市场 MCP 是哪一个。** `market_*` 在仓库里是卖家精灵（`src/lib/integrations/sellersprite.ts`）。没有多宝鱼客户端，只有 `duobaoyu-` slug 前缀。阶段 Z 是只接卖家精灵，还是你另外提供多宝鱼的 endpoint 和工具名单？密钥放在工作区，还是组织下所有工作区共用？
2. **配额单位。** 工作区月度限制按调用次数、按估算金额，还是两者都要？超限时是直接拒绝，还是只保留 `data_*`、停掉 `market_*`？需要一个默认数字才能写验收。
3. **阶段 X 是否等待 PR #7。** #7 会新增订单、货件、补货三套读 SQL 和 `replica-query.ts`。建议 X 等它合并再抽 repository。若 #7 还要改公式或 head，请先定，避免 repository PR 和它互相重写。
4. **上 123 的确认方式。** 计划是：合并后自动 build + artifact + release-check，部署仍要你手动跑 workflow，`deploy_production=true` 且 `target_host=123.207.47.225`。请确认旧机 `159.75.203.221` 不出现在默认选项里。本文的 PR 不会触发部署。
5. **补货的时刻。** PR #7 用各自最新的 Listing current、销量日和货件 head 计算，缺数则为 null。是否接受结果里带 `consistency: "mixed"`，还是三个时刻不一致时整行建议必须为空？这决定阶段 X 的契约，不改变 30+7 和 50/30/20 的公式，除非你要求改公式。

## 11. 本文件不做的事

- 不修改 `prisma/schema.prisma`，不新增迁移，不执行 `migrate deploy`。
- 不调用赛狐 Open API、卖家精灵、多宝鱼或任何模型。
- 不改前端、worker、CI 配置。那些改动留到对应阶段的代码 PR。
- 不合并 PR，不向 123 或 159 发布。
